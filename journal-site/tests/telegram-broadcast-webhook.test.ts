import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/telegram/route';

const mocks = vi.hoisted(() => ({
  rememberChat: vi.fn(),
  arm: vi.fn(),
  cancel: vi.fn(),
  enqueueArmedMessage: vi.fn(),
  latestStatus: vi.fn(),
  runPendingBroadcasts: vi.fn(),
  deleteMessage: vi.fn(),
  sendMessage: vi.fn(),
  groups: vi.fn(),
}));

vi.mock('@/lib/broadcast-store', () => ({
  getBroadcastStore: () => mocks,
}));
vi.mock('@/lib/broadcast-scheduler', () => ({
  kickBroadcastDrain: mocks.runPendingBroadcasts,
}));
vi.mock('@/lib/telegram', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/telegram')>()),
  deleteMessage: mocks.deleteMessage,
  sendMessage: mocks.sendMessage,
}));
vi.mock('@/lib/journal', () => ({
  getJournalGroups: mocks.groups,
}));

const WEBHOOK_SECRET = 'telegram-webhook-secret-123';
const PASSWORD = 'very-long-unique-broadcast-password';

function request(text: string | undefined, options: { chatId?: number; fromId?: number; type?: string; messageId?: number } = {}): Request {
  const chatId = options.chatId ?? 42;
  const body = {
    message: {
      message_id: options.messageId ?? 10,
      from: { id: options.fromId ?? chatId },
      chat: { id: chatId, type: options.type ?? 'private' },
      text,
    },
  };
  return new Request('http://localhost/api/telegram', {
    method: 'POST',
    headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.TELEGRAM_BROADCAST_ADMIN_ID = '42';
  process.env.TELEGRAM_BROADCAST_PASSWORD = PASSWORD;
  mocks.rememberChat.mockResolvedValue(undefined);
  mocks.arm.mockResolvedValue(true);
  mocks.cancel.mockResolvedValue(undefined);
  mocks.enqueueArmedMessage.mockResolvedValue(null);
  mocks.latestStatus.mockResolvedValue(null);
  mocks.runPendingBroadcasts.mockResolvedValue({ claimed: 0, sent: 0, failed: 0 });
  mocks.deleteMessage.mockResolvedValue(true);
  mocks.sendMessage.mockResolvedValue(undefined);
  mocks.groups.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  delete process.env.TELEGRAM_BROADCAST_ADMIN_ID;
  delete process.env.TELEGRAM_BROADCAST_PASSWORD;
});

describe('секретная рассылка в боте', () => {
  it('показывает свой ID для настройки администратора', async () => {
    expect((await POST(request('/myid', { chatId: 73 }))).status).toBe(200);
    expect(mocks.sendMessage).toHaveBeenCalledWith(73, expect.stringContaining('73'));
    expect(mocks.arm).not.toHaveBeenCalled();
  });

  it('принимает пароль только от администратора в личном чате и удаляет сообщение с паролем', async () => {
    await POST(request(PASSWORD, { messageId: 12 }));
    expect(mocks.arm).toHaveBeenCalledWith(42, 12);
    expect(mocks.deleteMessage).toHaveBeenCalledWith(42, 12);

    vi.clearAllMocks();
    await POST(request(PASSWORD, { chatId: 77 }));
    await POST(request(PASSWORD, { chatId: 42, fromId: 77 }));
    await POST(request(PASSWORD, { chatId: -42, fromId: 42, type: 'group' }));
    expect(mocks.arm).not.toHaveBeenCalled();
  });

  it('после пароля ставит одно сообщение в очередь и запускает доставку', async () => {
    mocks.enqueueArmedMessage.mockResolvedValue({ jobId: 5, recipientCount: 3, created: true });
    expect((await POST(request('Привет всем!', { messageId: 13 }))).status).toBe(200);
    expect(mocks.enqueueArmedMessage).toHaveBeenCalledWith(42, 13);
    expect(mocks.runPendingBroadcasts).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessage).toHaveBeenCalledWith(42, expect.stringContaining('3 чатов'));
  });

  it('повтор сообщения с паролем не даёт нового подтверждения', async () => {
    mocks.arm.mockResolvedValue(false);
    await POST(request(PASSWORD, { messageId: 12 }));
    expect(mocks.deleteMessage).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('повтор того же сообщения не запускает доставку ещё раз', async () => {
    mocks.enqueueArmedMessage.mockResolvedValue({ jobId: 5, recipientCount: 3, created: false });
    await POST(request('Привет всем!', { messageId: 13 }));
    expect(mocks.runPendingBroadcasts).not.toHaveBeenCalled();
  });

  it('команда не попадает в рассылку; отмена снимает ожидание', async () => {
    await POST(request('/cancel'));
    expect(mocks.cancel).toHaveBeenCalledWith(42);
    expect(mocks.enqueueArmedMessage).not.toHaveBeenCalled();
  });

  it('без настроенного пароля не даёт отправлять всем', async () => {
    delete process.env.TELEGRAM_BROADCAST_PASSWORD;
    await POST(request(PASSWORD));
    expect(mocks.arm).not.toHaveBeenCalled();
    expect(mocks.enqueueArmedMessage).not.toHaveBeenCalled();
  });

  it('просит Telegram повторить администраторское сообщение при сбое базы', async () => {
    mocks.enqueueArmedMessage.mockRejectedValueOnce(new Error('database unavailable'));
    expect((await POST(request('Срочно всем', { messageId: 21 }))).status).toBe(503);
    expect(mocks.runPendingBroadcasts).not.toHaveBeenCalled();
  });
});
