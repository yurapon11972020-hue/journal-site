import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getSubscriptionStore, setSubscriptionStoreForTests, type SubscriptionStore } from '@/lib/subscriptions';

/**
 * Проверка хранилища на настоящем Postgres.
 *
 * Запускается, только если задан TEST_DATABASE_URL — на обычном прогоне
 * тестов и в CI базы нет, и эти проверки пропускаются.
 */
const url = process.env.TEST_DATABASE_URL?.trim();
const runIf = url ? describe : describe.skip;

runIf('хранилище подписок в Postgres', () => {
  let store: SubscriptionStore;

  beforeAll(() => {
    process.env.DATABASE_URL = url;
    setSubscriptionStoreForTests(null);
    store = getSubscriptionStore();
  });

  afterAll(() => {
    setSubscriptionStoreForTests(null);
    delete process.env.DATABASE_URL;
  });

  it('создаёт таблицы сама и сохраняет подписку', async () => {
    await store.save({
      chatId: 4242,
      groupId: 'g-test',
      studentId: 7,
      studentName: 'Иванов Иван Иванович',
      subjects: [],
    });

    const byGroup = await store.listByGroup('g-test');
    expect(byGroup).toHaveLength(1);
    expect(byGroup[0].chatId).toBe(4242);
    expect(byGroup[0].studentName).toBe('Иванов Иван Иванович');
    expect(byGroup[0].subjects).toEqual([]);
  });

  it('повторное сохранение обновляет, а не плодит копии', async () => {
    await store.save({
      chatId: 4242,
      groupId: 'g-test',
      studentId: 7,
      studentName: 'Иванов Иван Иванович',
      subjects: ['Физ-ра «А» | 1/2', 'Алгебра'],
    });

    const byChat = await store.listByChat(4242);
    expect(byChat).toHaveLength(1);
    expect(byChat[0].subjects).toEqual(['Физ-ра «А» | 1/2', 'Алгебра']);
  });

  it('снимок журнала переживает запись и чтение', async () => {
    const marks = { '[7,"Алгебра","3 сен"]': '5', '[8,"Физика","5 сен"]': 'н' };

    await store.writeSnapshot('g-test', marks);
    expect(await store.readSnapshot('g-test')).toEqual(marks);

    await store.writeSnapshot('g-test', { '[7,"Алгебра","3 сен"]': '4' });
    expect(await store.readSnapshot('g-test')).toEqual({ '[7,"Алгебра","3 сен"]': '4' });
  });

  it('снимок неизвестной группы читается как пусто', async () => {
    expect(await store.readSnapshot('нет-такой-группы')).toBeNull();
  });

  it('отписка убирает запись', async () => {
    await store.remove(4242, 'g-test', 7);
    expect(await store.listByGroup('g-test')).toHaveLength(0);
  });
});
