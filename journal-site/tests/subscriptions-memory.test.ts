import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getSubscriptionStore, setSubscriptionStoreForTests } from '@/lib/subscriptions';

describe('очередь уведомлений в памяти', () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    delete process.env.DATABASE_URL;
    setSubscriptionStoreForTests(null);
  });

  afterEach(() => {
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
    setSubscriptionStoreForTests(null);
  });

  it('ставит сообщения вместе со снимком, не создаёт дублей и удаляет только подтверждённое', async () => {
    const store = getSubscriptionStore();
    const first = { id: 'transition:000001', chatId: 42, text: 'Первая оценка' };
    const second = { id: 'transition:000002', chatId: 42, text: 'Вторая оценка' };

    await store.stageNotificationsAndSnapshot('g1', { mark: '5' }, [first, second]);
    await store.stageNotificationsAndSnapshot('g1', { mark: '5' }, [first, second]);

    expect(await store.readSnapshot('g1')).toEqual({ mark: '5' });
    expect(await store.listPendingMessages('g1')).toEqual([first, second]);
    expect(await store.listPendingMessages('g2')).toEqual([]);

    await store.ackPendingMessage(first.id);
    expect(await store.listPendingMessages('g1')).toEqual([second]);

    // После подтверждения такой же переход оценок может случиться снова.
    await store.stageNotificationsAndSnapshot('g1', { mark: '4' }, [first]);
    expect(await store.listPendingMessages('g1')).toEqual([second, first]);
  });
});
