import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';
import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const OLD_CHAT_TABLES = ['bot_chats', 'subscriptions', 'lecture_subscriptions'] as const;

function authorized(request: Request): boolean {
  const expected = process.env.OLD_CHAT_IMPORT_SECRET?.trim();
  const received = request.headers.get('authorization')?.replace(/^Bearer /i, '');
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

function createPool(url: string): Pool {
  return new Pool({
    connectionString: url,
    ssl: url.includes('sslmode=disable') ? undefined : { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 10_000,
    query_timeout: 20_000,
    idleTimeoutMillis: 1_000,
    allowExitOnIdle: true,
  });
}

/** Разовый перенос адресатов для рассылки: оценки и подписки остаются прежними. */
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ ok: false }, { status: 401 });

  const oldUrl = process.env.OLD_DATABASE_URL?.trim();
  const newUrl = process.env.DATABASE_URL?.trim();
  if (!oldUrl || !newUrl || oldUrl === newUrl) {
    return NextResponse.json({ ok: false, error: 'old_database_not_configured' }, { status: 400 });
  }

  const oldDb = createPool(oldUrl);
  const newDb = createPool(newUrl);
  try {
    const chatIds = new Set<string>();
    const tables: string[] = [];

    for (const table of OLD_CHAT_TABLES) {
      const exists = await oldDb.query<{ found: boolean }>(
        'SELECT to_regclass($1) IS NOT NULL AS found', [`public.${table}`],
      );
      if (!exists.rows[0]?.found) continue;
      tables.push(table);

      // Имена таблиц — неизменяемый список выше; пользовательский ввод здесь не используется.
      const result = await oldDb.query<{ chat_id: string }>(
        `SELECT DISTINCT chat_id FROM public.${table} WHERE chat_id > 0`,
      );
      for (const row of result.rows) {
        const id = String(row.chat_id);
        if (/^[1-9]\d{0,18}$/.test(id)) chatIds.add(id);
      }
    }

    if (!tables.length) {
      return NextResponse.json({ ok: false, error: 'old_chat_tables_not_found' }, { status: 404 });
    }

    const ids = [...chatIds];
    let imported = 0;
    for (let index = 0; index < ids.length; index += 500) {
      const batch = ids.slice(index, index + 500);
      const result = await newDb.query(
        `INSERT INTO bot_chats (chat_id)
         SELECT DISTINCT source.chat_id FROM unnest($1::bigint[]) AS source(chat_id)
         ON CONFLICT (chat_id) DO NOTHING`,
        [batch],
      );
      imported += result.rowCount ?? 0;
    }

    return NextResponse.json({ ok: true, tables, found: ids.length, imported });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[import-old-chats] Не удалось прочитать старую базу:', message);
    return NextResponse.json({ ok: false, error: 'old_database_unavailable' }, { status: 503 });
  } finally {
    await Promise.allSettled([oldDb.end(), newDb.end()]);
  }
}
