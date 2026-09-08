import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST as telegramWebhook } from '@/app/api/telegram/route';
import { GET as telegramSetup } from '@/app/api/telegram/setup/route';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  edit: vi.fn(),
  answer: vi.fn(),
  setWebhook: vi.fn(),
  groups: vi.fn(),
  data: vi.fn(),
}));

vi.mock('@/lib/journal', () => ({
  getJournalGroups: mocks.groups,
  getJournalDataByPath: mocks.data,
}));

vi.mock('@/lib/telegram', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/telegram')>()),
  sendMessage: mocks.send,
  editMessage: mocks.edit,
  answerCallback: mocks.answer,
  setWebhook: mocks.setWebhook,
}));

// Телеграм допускает в секрете только латиницу, цифры, дефис и подчёркивание.
const SECRET = 'very-long-webhook-secret-123';

function update(): string {
  return JSON.stringify({ message: { chat: { id: 42 }, text: '/start' } });
}

function webhookRequest(secret?: string): Request {
  return new Request('http://localhost/api/telegram', {
    method: 'POST',
    headers: secret ? { 'x-telegram-bot-api-secret-token': secret } : {},
    body: update(),
  });
}

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  delete process.env.TELEGRAM_BOT_TOKEN;
});

describe('вебхук телеграм-бота', () => {
  // Без секрета кто угодно, зная адрес сайта, мог отправить боту поддельное
  // сообщение и получить журнал в свой чат.
  it('без настроенного секрета не обслуживает запросы и не читает журнал', async () => {
    const response = await telegramWebhook(webhookRequest());

    expect(response.status).toBe(503);
    expect(mocks.groups).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('поддельный секрет отклоняется', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;

    const response = await telegramWebhook(webhookRequest('wrong-secret-value-000'));

    expect(response.status).toBe(401);
    expect(mocks.groups).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('запрос без заголовка секрета отклоняется', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;

    expect((await telegramWebhook(webhookRequest())).status).toBe(401);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('с верным секретом бот отвечает как раньше', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    mocks.groups.mockResolvedValue([
      { id: 'a', groupName: 'ИСиП-25-9', fileName: 'a.xlsx', filePath: '/a', source: 'local', sourceDetails: 'a' },
    ]);
    mocks.data.mockResolvedValue({
      groupName: 'ИСиП-25-9',
      students: [],
      subjects: [],
      reportCards: [],
      studentCount: 0,
      subjectCount: 0,
    });

    const response = await telegramWebhook(webhookRequest(SECRET));

    expect(response.status).toBe(200);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});

describe('подключение вебхука', () => {
  it('без секрета не подключает вебхук и объясняет, что сделать', async () => {
    const response = await telegramSetup(new Request('http://localhost/api/telegram/setup'));
    const payload = (await response.json()) as { error?: string; next_step?: string };

    expect(response.status).toBe(503);
    expect(payload.next_step).toContain('TELEGRAM_WEBHOOK_SECRET');
    expect(mocks.setWebhook).not.toHaveBeenCalled();
  });

  it('секрет с кириллицей отклоняется с понятным объяснением', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'секрет-по-русски';

    const response = await telegramSetup(new Request('https://journal.example/api/telegram/setup'));
    const payload = (await response.json()) as { next_step?: string };

    expect(response.status).toBe(400);
    expect(payload.next_step).toContain('латинские буквы');
    expect(mocks.setWebhook).not.toHaveBeenCalled();
  });

  it('с секретом подключает вебхук', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    mocks.setWebhook.mockResolvedValue({ ok: true, description: 'Webhook установлен' });

    const response = await telegramSetup(new Request('https://journal.example/api/telegram/setup'));

    expect(response.status).toBe(200);
    expect(mocks.setWebhook).toHaveBeenCalledWith('https://journal.example/api/telegram');
  });
});
