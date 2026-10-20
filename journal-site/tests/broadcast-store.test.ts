import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runPendingBroadcasts } from '@/lib/broadcast-delivery';
import { getBroadcastStore, setBroadcastStoreForTests } from '@/lib/broadcast-store';

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', '');
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-20T10:00:00.000Z'));
  setBroadcastStoreForTests(null);
});

afterEach(() => {
  setBroadcastStoreForTests(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('секретная рассылка', () => {
  it('адресует только личные чаты, сохраняет снимок адресатов и не создаёт дубль при повторе Telegram', async () => {
    const store = getBroadcastStore();
    await store.rememberChat(42, 'private');
    await store.rememberChat(43, 'private');
    await store.rememberChat(-100123, 'supergroup');
    await store.rememberChat(44, 'group');
    await store.rememberChat(42, 'private');
    expect(await store.listRecipientChatIds()).toEqual([42, 43]);

    expect(await store.arm(42, 100)).toBe(true);
    expect(await store.enqueueArmedMessage(42, 100)).toBeNull();
    const queued = await store.enqueueArmedMessage(42, 101);
    expect(queued).toMatchObject({ recipientCount: 2, created: true });
    expect(await store.enqueueArmedMessage(42, 101)).toEqual({ ...queued, created: false });
    expect(await store.enqueueArmedMessage(42, 102)).toBeNull();
    expect(await store.arm(42, 100)).toBe(false); // Telegram may replay the password update after the send.
    expect(await store.enqueueArmedMessage(42, 102)).toBeNull();

    await store.rememberChat(45, 'private');
    expect((await store.claimPending(40)).map((item) => item.chatId)).toEqual([42, 43]);
    expect(await store.latestStatus(42)).toMatchObject({ recipientCount: 2, sent: 0, failed: 0, pending: 2 });
  });

  it('пароль действует пять минут и отменяется без удаления предыдущей рассылки', async () => {
    const store = getBroadcastStore();
    await store.rememberChat(42, 'private');
    expect(await store.arm(42, 100)).toBe(true);
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(await store.enqueueArmedMessage(42, 101)).toBeNull();

    expect(await store.arm(42, 102)).toBe(true);
    await store.cancel(42);
    expect(await store.enqueueArmedMessage(42, 103)).toBeNull();
    expect(await store.latestStatus(42)).toBeNull();
  });

  it('при ошибке повторяет отправку позже, но после необратимой ошибки останавливается', async () => {
    const store = getBroadcastStore();
    await store.rememberChat(42, 'private');
    await store.arm(42, 100);
    const job = await store.enqueueArmedMessage(42, 101);
    expect(job).not.toBeNull();
    const [first] = await store.claimPending(40);
    await store.markDelivery(first.jobId, first.chatId, false, 'network error');
    expect(await store.claimPending(40)).toEqual([]);
    vi.advanceTimersByTime(60_001);
    const [second] = await store.claimPending(40);
    expect(second.attempts).toBe(2);
    await store.markDelivery(second.jobId, second.chatId, false, 'blocked', true);
    expect(await store.claimPending(40)).toEqual([]);
    expect(await store.latestStatus(42)).toMatchObject({ failed: 1, pending: 0 });
  });

  it('пересылает исходное сообщение целиком через copyMessage и отмечает успешную доставку', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, result: { message_id: 500 } }) }));
    vi.stubGlobal('fetch', fetchMock);
    const store = getBroadcastStore();
    await store.rememberChat(42, 'private');
    await store.arm(42, 100);
    await store.enqueueArmedMessage(42, 101);

    expect(await runPendingBroadcasts()).toEqual({ claimed: 1, sent: 1, failed: 0 });
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toContain('/copyMessage');
    expect(JSON.parse(options.body)).toEqual({
      chat_id: 42,
      from_chat_id: 42,
      message_id: 101,
      disable_notification: false,
    });
    expect(await store.latestStatus(42)).toMatchObject({ sent: 1, failed: 0, pending: 0 });
    expect(await runPendingBroadcasts()).toEqual({ claimed: 0, sent: 0, failed: 0 });
  });

  it('не повторяет отправку в заблокировавший бот чат', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ ok: false, description: 'Forbidden: bot was blocked by the user' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const store = getBroadcastStore();
    await store.rememberChat(42, 'private');
    await store.arm(42, 100);
    await store.enqueueArmedMessage(42, 101);

    expect(await runPendingBroadcasts()).toEqual({ claimed: 1, sent: 0, failed: 1 });
    vi.advanceTimersByTime(3 * 60 * 1000);
    expect(await runPendingBroadcasts()).toEqual({ claimed: 0, sent: 0, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await store.latestStatus(42)).toMatchObject({ sent: 0, failed: 1, pending: 0 });
  });
});
