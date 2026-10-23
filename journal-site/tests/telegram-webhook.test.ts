import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST as telegramWebhook } from '@/app/api/telegram/route';
import { GET as telegramSetup } from '@/app/api/telegram/setup/route';
import { setSubscriptionStoreForTests, type Subscription, type SubscriptionStore } from '@/lib/subscriptions';
import { studentNameKey } from '@/lib/telegram-notify-views';

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
  setSubscriptionStoreForTests(null);
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  delete process.env.TELEGRAM_BOT_TOKEN;
});

describe('кнопки подписок после замены журнала ИСиП(Р)-24/1', () => {
  const groupId = 'X0p3qpi4K5zZhKZU';
  const anna = 'Иванова Анна Петровна';
  const boris = 'Сидоров Борис Иванович';
  const subject = 'Математика';
  let subscriptions: Subscription[];

  function callbackRequest(action: string): Request {
    return new Request('http://localhost/api/telegram', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': SECRET },
      body: JSON.stringify({
        callback_query: {
          id: `query-${action}`,
          data: action,
          message: { chat: { id: 42 }, message_id: 100 },
        },
      }),
    });
  }

  async function click(action: string): Promise<{ text: string; buttons: Array<Array<{ callback_data: string }>> }> {
    expect((await telegramWebhook(callbackRequest(action))).status).toBe(200);
    const call = mocks.edit.mock.lastCall;
    expect(call).toBeDefined();
    return { text: call![2] as string, buttons: call![3] as Array<Array<{ callback_data: string }>> };
  }

  function installStore(initial: Subscription[]): void {
    subscriptions = [...initial];
    const store: SubscriptionStore = {
      listByChat: async (chatId) => subscriptions.filter((item) => item.chatId === chatId),
      listByGroup: async (id) => subscriptions.filter((item) => item.groupId === id),
      save: async (item) => {
        subscriptions = subscriptions.filter((saved) =>
          !(saved.chatId === item.chatId && saved.groupId === item.groupId && saved.studentId === item.studentId));
        subscriptions.push(item);
      },
      remove: async (chatId, id, studentId) => {
        subscriptions = subscriptions.filter((item) =>
          !(item.chatId === chatId && item.groupId === id && item.studentId === studentId));
      },
      readSnapshot: async () => null,
      writeSnapshot: async () => undefined,
    };
    setSubscriptionStoreForTests(store);
  }

  function installJournal(studentNames: string[], subjectNames = [subject]): void {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    mocks.edit.mockResolvedValue(true);
    mocks.groups.mockResolvedValue([
      { id: groupId, groupName: 'ИСиП(Р)-24/1', fileName: 'journal.xlsx', filePath: '/journal', source: 'local', sourceDetails: '' },
    ]);
    mocks.data.mockResolvedValue({
      groupName: 'ИСиП(Р)-24/1',
      students: studentNames.map((name, index) => ({ id: index + 1, name, subjects: [] })),
      subjects: subjectNames.map((name) => ({ subjectName: name })),
      reportCards: [],
      studentCount: studentNames.length,
      subjectCount: subjectNames.length,
    });
  }

  it('показывает подписки по имени и старой кнопкой не отключает другого студента', async () => {
    // В старом файле Анна была первой, в новом — второй.
    installJournal([boris, anna]);
    installStore([
      { chatId: 42, groupId, studentId: 1, studentName: anna, subjects: [] },
      { chatId: 42, groupId, studentId: 2, studentName: boris, subjects: [] },
    ]);

    const menu = await click('w:0');
    expect(menu.buttons.flat().map((button) => button.callback_data)).toContain(`wd:0:2:${studentNameKey(anna)}`);
    expect(menu.buttons.flat().map((button) => button.callback_data)).toContain(`wd:0:1:${studentNameKey(boris)}`);

    const oldButton = await click('wd:0:1');
    expect(oldButton.text).toContain('Кнопки обновлены');
    expect(subscriptions).toHaveLength(2);

    await click(`wd:0:2:${studentNameKey(anna)}`);
    expect(subscriptions.map((item) => item.studentName)).toEqual([boris]);
  });

  it('сохраняет новую подписку без перезаписи старого занятого номера', async () => {
    installJournal([boris, anna]);
    installStore([{ chatId: 42, groupId, studentId: 1, studentName: anna, subjects: [] }]);

    await click(`wa:0:1:${studentNameKey(boris)}`);
    expect(subscriptions).toHaveLength(2);
    expect(subscriptions.find((item) => item.studentName === anna)?.studentId).toBe(1);
    expect(subscriptions.find((item) => item.studentName === boris)?.studentId).toBe(-1);
  });

  it('устаревшей кнопкой предмета не переключает другой предмет', async () => {
    installJournal([anna, boris], ['Информатика', subject]);
    installStore([{ chatId: 42, groupId, studentId: 1, studentName: anna, subjects: [subject] }]);

    const screen = await click(`wt:0:1:0:${studentNameKey(anna, subject)}`);
    expect(screen.text).toContain('Кнопки обновлены');
    expect(subscriptions[0].subjects).toEqual([subject]);
  });
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
