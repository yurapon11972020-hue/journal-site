import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST as telegramWebhook } from '@/app/api/telegram/route';
import { lectureGroupKey, lectureGroupsScreen, lectureSettingsScreen } from '@/lib/telegram-lecture-views';

const mocks = vi.hoisted(() => ({
  groups: vi.fn(),
  schedule: vi.fn(),
  listByChat: vi.fn(),
  get: vi.fn(),
  setMode: vi.fn(),
  send: vi.fn(),
  edit: vi.fn(),
  answer: vi.fn(),
}));

vi.mock('@/lib/journal', () => ({
  getJournalGroups: mocks.groups,
  getJournalDataByPath: vi.fn(),
}));

vi.mock('@/lib/lecture-sources', () => ({ getScheduleData: mocks.schedule }));

vi.mock('@/lib/lecture-subscriptions', () => ({
  getLectureStore: () => ({
    listByChat: mocks.listByChat,
    get: mocks.get,
    setMode: mocks.setMode,
  }),
}));

vi.mock('@/lib/telegram', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/telegram')>()),
  sendMessage: mocks.send,
  editMessage: mocks.edit,
  answerCallback: mocks.answer,
}));

const GROUP = 'ИСиП-24/1(Р)';
const SECRET = 'lecture-test-webhook-secret';

function webhookRequest(message: unknown): Request {
  return new Request('http://localhost/api/telegram', {
    method: 'POST',
    headers: { 'x-telegram-bot-api-secret-token': SECRET },
    body: JSON.stringify(message),
  });
}

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
});

describe('подписка на лекции в боте', () => {
  it('показывает две независимые кнопки и хранит группу в стабильном коротком callback', () => {
    const screen = lectureSettingsScreen(GROUP, {
      chatId: 42,
      groupName: GROUP,
      video: true,
      lecture: true,
    });

    expect(screen.text).toContain('Видеолекции: <b>включены</b>');
    expect(screen.text).toContain('Обычные лекции: <b>включены</b>');
    expect(screen.buttons[0][0].callback_data).toBe(`lv:${lectureGroupKey(GROUP)}`);
    expect(screen.buttons[1][0].callback_data).toBe(`ll:${lectureGroupKey(GROUP)}`);
    expect(screen.buttons[0][0].callback_data!.length).toBeLessThanOrEqual(64);

    const list = lectureGroupsScreen([GROUP], []);
    expect(list.buttons[0][0].callback_data).toBe(`ls:${lectureGroupKey(GROUP)}`);
  });

  it('команда /lectures открывает расписание, даже если журнал не загружается', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    mocks.groups.mockRejectedValue(new Error('Журнал недоступен'));
    mocks.schedule.mockResolvedValue({ groups: [GROUP], items: [] });
    mocks.listByChat.mockResolvedValue([]);

    const response = await telegramWebhook(webhookRequest({
      message: { chat: { id: 42 }, text: '/lectures' },
    }));

    expect(response.status).toBe(200);
    expect(mocks.groups).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledWith(42, expect.stringContaining('Напоминания о лекциях'), expect.any(Array));
  });

  it('включает обычные лекции, не отключая видеолекции', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    mocks.schedule.mockResolvedValue({ groups: [GROUP], items: [] });
    mocks.get
      .mockResolvedValueOnce({ chatId: 42, groupName: GROUP, video: true, lecture: false })
      .mockResolvedValueOnce({ chatId: 42, groupName: GROUP, video: true, lecture: true });
    mocks.edit.mockResolvedValue(true);

    const response = await telegramWebhook(webhookRequest({
      callback_query: {
        id: 'query-1',
        data: `ll:${lectureGroupKey(GROUP)}`,
        message: { chat: { id: 42 }, message_id: 7 },
      },
    }));

    expect(response.status).toBe(200);
    expect(mocks.groups).not.toHaveBeenCalled();
    expect(mocks.setMode).toHaveBeenCalledWith(42, GROUP, 'lecture', true);
    expect(mocks.edit).toHaveBeenCalledWith(42, 7, expect.stringContaining('Обычные лекции: <b>включены</b>'), expect.any(Array));
  });
});
