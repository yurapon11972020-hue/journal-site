import { NextResponse } from 'next/server';

import { getJournalGroups } from '@/lib/journal';
import { getSubscriptionStore } from '@/lib/subscriptions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Проверка уведомлений: подключена ли база и что в ней лежит.
 *
 * Ничего секретного не отдаёт — ни строки подключения, ни номеров чатов,
 * только количества, — поэтому страницу можно открывать спокойно.
 */
export async function GET() {
  const configured = Boolean(process.env.DATABASE_URL?.trim());

  try {
    const store = getSubscriptionStore();
    const groups = await getJournalGroups();

    let subscriptions = 0;
    let watched = 0;

    for (const group of groups) {
      subscriptions += (await store.listByGroup(group.id)).length;
      if (await store.readSnapshot(group.id)) {
        watched += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      storage: configured ? 'база' : 'память',
      warning: configured
        ? undefined
        : 'DATABASE_URL не задан: подписки пропадут при перезапуске сервиса.',
      subscriptions,
      groups: groups.length,
      // Сколько групп уже под наблюдением. Пока группа не попала в снимок,
      // уведомления по ней не приходят — это нормально в первые минуты.
      watchedGroups: watched,
      next_step:
        watched < groups.length
          ? 'Часть групп ещё не в снимке — подожди очередное обновление журнала (до 5 минут).'
          : 'Всё готово: изменения в журнале будут доходить до подписчиков.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';

    return NextResponse.json(
      {
        ok: false,
        storage: configured ? 'база' : 'память',
        error: message,
        next_step: configured
          ? 'Проверь DATABASE_URL в Render → Environment: строка должна начинаться с postgresql:// и заканчиваться ?sslmode=require'
          : 'Добавь DATABASE_URL в Render → Environment.',
      },
      { status: 500 },
    );
  }
}
