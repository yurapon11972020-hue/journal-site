import { Pool } from 'pg';

import { watchGroup } from '@/lib/grade-watch';
import { getJournalDataByPath } from '@/lib/journal';
import type { JournalGroupRef } from '@/lib/types';
import {
  forceRefreshPublicJournal,
  getPublicJournalVersion,
  isWithinRefreshWindow,
  listJournalFiles,
} from '@/lib/yandex-disk';

type CheckResult = 'unchanged' | 'updated' | 'unavailable' | 'failed';
type GroupSource = Pick<JournalGroupRef, 'id' | 'groupName' | 'filePath'>;
const GROUP_SOURCE_TTL_MS = 30 * 60 * 1_000;

let pool: Pool | undefined;
let running: Promise<Record<CheckResult, number>> | undefined;

function versionPool(): Pool {
  if (pool) return pool;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error('DATABASE_URL не задан.');
  pool = new Pool({
    connectionString: url,
    ssl: url.includes('sslmode=disable') ? undefined : { rejectUnauthorized: false },
    max: 1,
    idleTimeoutMillis: 1_000,
    allowExitOnIdle: true,
  });
  pool.on('error', (error) => console.error('[grade-watch] Ошибка базы:', error.message));
  return pool;
}

/** Не обращаемся к расписанию и Яндексу, когда подписчиков ещё нет. */
export async function scheduledActivity(): Promise<{ lectures: boolean; grades: boolean; broadcast: boolean }> {
  const result = await versionPool().query<{
    lectures: boolean; grades: boolean; broadcast: boolean;
  }>(`SELECT
    EXISTS (SELECT 1 FROM lecture_subscriptions) AS lectures,
    EXISTS (SELECT 1 FROM subscriptions) AS grades,
    EXISTS (SELECT 1 FROM broadcast_deliveries WHERE state IN ('pending', 'sending')) AS broadcast`);
  return result.rows[0];
}

async function activeGroups(): Promise<GroupSource[]> {
  const db = versionPool();
  const active = await db.query<{ group_id: string }>('SELECT DISTINCT group_id FROM subscriptions');
  if (!active.rows.length) return [];
  const activeIds = new Set(active.rows.map((row) => row.group_id));

  const cached = await db.query<{
    group_id: string; group_name: string; file_path: string; refreshed_at: Date;
  }>('SELECT group_id, group_name, file_path, refreshed_at FROM journal_group_sources');
  const activeCached = cached.rows.filter((row) => activeIds.has(row.group_id));
  const current = activeCached.length === activeIds.size &&
    activeCached.every((row) => Date.now() - new Date(row.refreshed_at).getTime() < GROUP_SOURCE_TTL_MS);
  if (current) {
    return activeCached
      .map((row) => ({ id: row.group_id, groupName: row.group_name, filePath: row.file_path }));
  }

  const groups = await listJournalFiles();
  if (groups.length) {
    const params = groups.flatMap((group) => [group.id, group.groupName, group.filePath]);
    const placeholders = groups.map((_, index) =>
      `($${index * 3 + 1}, $${index * 3 + 2}, $${index * 3 + 3}, now())`,
    );
    await db.query(
      `INSERT INTO journal_group_sources (group_id, group_name, file_path, refreshed_at)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (group_id) DO UPDATE SET
       group_name = EXCLUDED.group_name,
       file_path = EXCLUDED.file_path,
       refreshed_at = EXCLUDED.refreshed_at`,
      params,
    );
  }
  return groups.filter((group) => activeIds.has(group.id));
}

async function checkGroup(group: GroupSource): Promise<CheckResult> {
  try {
    const fingerprint = await getPublicJournalVersion(group.filePath);
    if (!fingerprint) return 'unavailable';

    const db = versionPool();
    const previous = await db.query<{ fingerprint: string }>(
      'SELECT fingerprint FROM journal_source_versions WHERE group_id = $1', [group.id],
    );
    if (previous.rows[0]?.fingerprint === fingerprint) return 'unchanged';

    await forceRefreshPublicJournal(group.filePath);
    const data = await getJournalDataByPath(group.filePath);
    await watchGroup(group.id, group.groupName, data);
    await db.query(
      `INSERT INTO journal_source_versions (group_id, fingerprint, checked_at)
       VALUES ($1, $2, now())
       ON CONFLICT (group_id) DO UPDATE
       SET fingerprint = EXCLUDED.fingerprint, checked_at = EXCLUDED.checked_at`,
      [group.id, fingerprint],
    );
    return 'updated';
  } catch (error) {
    console.error(`[grade-watch] Не удалось проверить ${group.groupName}:`, error);
    return 'failed';
  }
}

async function execute(): Promise<Record<CheckResult, number>> {
  const counts: Record<CheckResult, number> = {
    unchanged: 0, updated: 0, unavailable: 0, failed: 0,
  };
  if (!isWithinRefreshWindow()) return counts;

  const groups = await activeGroups();
  for (let index = 0; index < groups.length; index += 3) {
    const batch = groups.slice(index, index + 3);
    const results = await Promise.all(batch.map((group) => checkGroup(group)));
    for (const result of results) counts[result] += 1;
  }
  return counts;
}

/** На каждой минутной проверке скачиваются только действительно изменённые Excel. */
export function runScheduledGradeWatch(): Promise<Record<CheckResult, number>> {
  running ??= execute().finally(() => { running = undefined; });
  return running;
}
