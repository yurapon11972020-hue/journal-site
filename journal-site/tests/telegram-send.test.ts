import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendMessage, TelegramApiError } from '@/lib/telegram';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TELEGRAM_BOT_TOKEN;
});

describe('отправка сообщения в Telegram', () => {
  it('завершается успешно только после подтверждения API', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendMessage(42, 'Привет')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({ chat_id: 42, text: 'Привет' });
  });

  it('отклоняется с причиной, если Telegram API отказал', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ ok: false, description: 'Forbidden: bot was blocked by the user' }),
      { status: 403 },
    )));

    await expect(sendMessage(42, 'Привет')).rejects.toThrow('Forbidden: bot was blocked by the user');
  });

  it('отклоняется, если API не подтвердил создание сообщения', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: {} }))));

    await expect(sendMessage(42, 'Привет')).rejects.toThrow('не содержит подтверждения');
  });

  it('отклоняется при ошибке сети', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection reset')));

    await expect(sendMessage(42, 'Привет')).rejects.toThrow('connection reset');
  });

  it('передаёт retry_after при явном ограничении Telegram', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      error_code: 429,
      description: 'Too Many Requests',
      parameters: { retry_after: 2 },
    }), { status: 429 })));

    await expect(sendMessage(42, 'Привет')).rejects.toMatchObject({
      name: 'TelegramApiError',
      status: 429,
      retryAfterSeconds: 2,
    } satisfies Partial<TelegramApiError>);
  });
});
