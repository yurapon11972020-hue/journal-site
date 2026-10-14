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

    const states = await Promise.all(groups.map(async (group) => {
      const [groupSubscriptions, snapshot] = await Promise.all([
        store.listByGroup(group.id),
        store.readSnapshot(group.id),
      ]);
      return { groupName: group.groupName, subscriptions: groupSubscriptions.length, watched: Boolean(snapshot) };
    }));
    const subscriptions = states.reduce((sum, state) => sum + state.subscriptions, 0);
    const watched = states.reduce((sum, state) => sum + Number(state.watched), 0);
    const configuredInterval = Number(process.env.JOURNAL_CACHE_INTERVAL_MINUTES);
    const refreshIntervalMinutes = Number.isFinite(configuredInterval) && configuredInterval > 0
      ? configuredInterval
      : 1;
    const configuredFromHour = Number(process.env.JOURNAL_REFRESH_FROM_HOUR);
    const refreshFromHour = Number.isFinite(configuredFromHour)
      ? Math.min(23, Math.max(0, Math.floor(configuredFromHour)))
      : 0;

    return NextResponse.json({
      ok: true,
      storage: configured ? 'база' : 'память',
      warning: configured
        ? undefined
        : 'DATABASE_URL не задан: подписки пропадут при перезапуске сервиса.',
      subscriptions,
      groups: groups.length,
      refreshIntervalMinutes,
      refreshFromHour,
      // Сколько групп уже под наблюдением. Пока группа не попала в снимок,
      // уведомления по ней не приходят — это нормально в первые минуты.
      watchedGroups: watched,
      unwatchedGroups: states.filter((state) => !state.watched).map((state) => state.groupName),
      next_step:
        watched < groups.length
          ? `Часть групп ещё без снимка: проверь, открываются ли их журналы. После успешной загрузки снимок появится при следующем обновлении (интервал ${refreshIntervalMinutes} мин).`
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
