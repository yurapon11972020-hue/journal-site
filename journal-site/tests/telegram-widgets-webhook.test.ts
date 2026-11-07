import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as telegramWebhook } from '@/app/api/telegram/route';
import { setWidgetSettingsStoreForTests, type WidgetSettingsStore } from '@/lib/widget-settings';

import { widgetJournal } from './helpers/widget-fixture';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  edit: vi.fn(),
  answer: vi.fn(),
  remove: vi.fn(),
  markup: vi.fn(),
  widget: vi.fn(),
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
  deleteMessage: mocks.remove,
  editReplyMarkup: mocks.markup,
  sendWidget: mocks.widget,
}));

const SECRET = 'very-long-webhook-secret-123';
const ORIGINAL_WIDGETS = process.env.TELEGRAM_WIDGETS;

class MemorySettings implements WidgetSettingsStore {
  values = new Map<string, boolean>();
  async get(scope: string) { return this.values.get(scope) ?? null; }
  async set(scope: string, enabled: boolean) { this.values.set(scope, enabled); }
}

let settings: MemorySettings;

function post(body: unknown): Promise<Response> {
  return telegramWebhook(new Request('http://localhost/api/telegram', {
    method: 'POST',
    headers: { 'x-telegram-bot-api-secret-token': SECRET },
    body: JSON.stringify(body),
  }));
}

function click(action: string, message: Record<string, unknown> = {}): Promise<Response> {
  return post({ callback_query: { id: `q-${action}`, data: action, message: { chat: { id: 42 }, message_id: 100, text: 'меню', ...message } } });
}

function say(text: string): Promise<Response> {
  return post({ message: { message_id: 7, from: { id: 42 }, chat: { id: 42, type: 'private' }, text } });
}

type Button = { text: string; callback_data?: string };

function buttonTexts(buttons: Button[][] | undefined): string[] {
  return (buttons ?? []).flat().map((button) => button.text);
}

beforeEach(() => {
  process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
  process.env.TELEGRAM_WIDGETS = 'on';
  settings = new MemorySettings();
  setWidgetSettingsStoreForTests(settings);
  mocks.groups.mockResolvedValue([
    { id: 'g1', groupName: 'ИСиП-24/1', fileName: 'a.xlsx', filePath: '/a', source: 'local', sourceDetails: '' },
    { id: 'g2', groupName: 'ПД-24/2', fileName: 'b.xlsx', filePath: '/b', source: 'local', sourceDetails: '' },
  ]);
  mocks.data.mockResolvedValue(widgetJournal());
  mocks.widget.mockResolvedValue('sent');
  mocks.edit.mockResolvedValue(true);
  mocks.remove.mockResolvedValue(true);
  mocks.markup.mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
  setWidgetSettingsStoreForTests(null);
  process.env.TELEGRAM_WIDGETS = ORIGINAL_WIDGETS;
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  delete process.env.TELEGRAM_BROADCAST_ADMIN_ID;
});

describe('бот с анимированными карточками', () => {
  it('табель приходит карточкой, а меню, из которого её открыли, убирается', async () => {
    expect((await click('c:0:1')).status).toBe(200);

    expect(mocks.widget).toHaveBeenCalledTimes(1);
    const [chatId, widget, buttons] = mocks.widget.mock.calls[0];
    expect(chatId).toBe(42);
    expect(widget.html).toContain('Абрамов Пётр Ильич');
    expect(widget.caption).toContain('Абрамов Пётр Ильич');
    expect(buttonTexts(buttons)).toEqual(['🧮 Калькулятор оценок', '📝 Все оценки', '📅 Пропуски по датам', '⬅️ К студентам']);
    expect(mocks.remove).toHaveBeenCalledWith(42, 100);
    expect(mocks.edit).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('калькулятор и рейтинг тоже приходят карточками', async () => {
    await click('k:0:1');
    expect(mocks.widget.mock.calls[0][1].caption).toContain('Калькулятор оценок');
    expect(buttonTexts(mocks.widget.mock.calls[0][2])).toEqual(['⬅️ К табелю']);

    await click('r:0');
    expect(mocks.widget.mock.calls[1][1].caption).toContain('Рейтинг');
    expect(buttonTexts(mocks.widget.mock.calls[1][2])).toEqual(['⬅️ Назад']);
  });

  it('если Telegram не принял карточку, приходит обычный табель на месте меню', async () => {
    mocks.widget.mockResolvedValue('failed');

    await click('c:0:1');

    expect(mocks.edit).toHaveBeenCalledTimes(1);
    expect(mocks.edit.mock.calls[0][2]).toContain('👤 <b>Абрамов Пётр Ильич</b>');
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('каждый экран — карточка: новая заменяет ту, на кнопку которой нажали', async () => {
    const screens: Array<[string, string]> = [
      ['grp', 'Электронный журнал'],
      ['g:0', 'ИСиП-24/1'],
      ['s:0', 'Студенты'],
      ['m:0:1', 'Оценки'],
      ['n:0:1', 'Пропуски'],
      ['p:0', 'Предметы'],
      ['ps:0:0', 'Математика'],
      ['w:0', 'Уведомления'],
      ['wp:0:1', 'Абрамов Пётр Ильич'],
      ['ws:0:1', 'Выбери предметы'],
    ];
    for (const [action, caption] of screens) {
      mocks.widget.mockClear();
      mocks.remove.mockClear();
      await click(action, { text: undefined, widget: { is_copy: false } });
      expect(mocks.widget.mock.calls[0]?.[1].caption, action).toContain(caption);
      expect(mocks.remove, action).toHaveBeenCalledWith(42, 100);
    }
    expect(mocks.edit).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('если карточку не приняли, из карточки приходит текст, а она сама убирается', async () => {
    mocks.widget.mockResolvedValue('failed');

    await click('s:0', { text: undefined, widget: { is_copy: false } });

    expect(mocks.edit).not.toHaveBeenCalled();
    expect(mocks.send.mock.calls[0][1]).toContain('Студенты');
    expect(mocks.remove).toHaveBeenCalledWith(42, 100);
  });

  it('галочки предметов под карточкой меняются на месте, без новой карточки', async () => {
    await click('wt:0:1:0', { text: undefined, widget: { is_copy: false } });

    expect(mocks.markup).toHaveBeenCalledTimes(1);
    const buttons = buttonTexts(mocks.markup.mock.calls[0][2]);
    expect(buttons).toContain('✅ Математика');
    expect(mocks.widget).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();

    // Тот же переключатель на старом текстовом меню приводит карточку на его место.
    await click('wt:0:1:0');
    expect(mocks.widget).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith(42, 100);
  });

  it('каждый чат может выключить карточки кнопкой в меню', async () => {
    await say('/start');
    expect(mocks.widget.mock.calls[0][1].caption).toContain('Электронный журнал');
    const start = mocks.widget.mock.calls[0][2] as Button[][];
    expect(start.flat().find((button) => button.callback_data === 'wx|grp')?.text).toBe('🎨 Анимированные карточки: вкл');

    await click('wx|grp');
    expect(settings.values.get('chat:42')).toBe(false);
    expect(buttonTexts(mocks.edit.mock.calls[0][3])).toContain('🎨 Анимированные карточки: выкл');

    mocks.edit.mockClear();
    mocks.widget.mockClear();
    await click('c:0:1');
    expect(mocks.widget).not.toHaveBeenCalled();
    expect(mocks.edit.mock.calls[0][2]).toContain('👤 <b>Абрамов Пётр Ильич</b>');

    await click('wx|g:1');
    expect(settings.values.get('chat:42')).toBe(true);
    expect(mocks.widget.mock.lastCall?.[1].caption).toContain('ИСиП-24/1');
  });

  it('владелец выключает и включает карточки для всех командой /widgets', async () => {
    process.env.TELEGRAM_BROADCAST_ADMIN_ID = '42';

    await say('/widgets off');
    expect(settings.values.get('global')).toBe(false);
    expect(mocks.send.mock.calls[0][1]).toContain('выключены для всех');

    await click('c:0:1');
    expect(mocks.widget).not.toHaveBeenCalled();

    await say('/start');
    expect(buttonTexts(mocks.send.mock.lastCall?.[2])).not.toContain('🎨 Анимированные карточки: вкл');

    await say('/widgets on');
    expect(settings.values.get('global')).toBe(true);
    expect(mocks.send.mock.lastCall?.[1]).toContain('включены для всех');

    await say('/widgets');
    expect(mocks.send.mock.lastCall?.[1]).toContain('Выключить: /widgets off');
  });

  it('/widgets test присылает владельцу тестовую карточку и говорит, принял ли её Telegram', async () => {
    process.env.TELEGRAM_BROADCAST_ADMIN_ID = '42';

    await say('/widgets test');
    expect(mocks.widget).toHaveBeenCalledWith(42, expect.objectContaining({ caption: expect.stringContaining('Тестовая карточка') }), undefined, { ignorePause: true });
    expect(mocks.send.mock.lastCall?.[1]).toContain('✅ Telegram принял тестовую карточку');

    mocks.widget.mockResolvedValue('failed');
    await say('/widgets test');
    expect(mocks.send.mock.lastCall?.[1]).toContain('❌ Telegram не принял тестовую карточку');

    await say('/widgets');
    expect(mocks.send.mock.lastCall?.[1]).toContain('Проверить сейчас: /widgets test');
  });

  it('чужая команда /widgets ничего не меняет', async () => {
    process.env.TELEGRAM_BROADCAST_ADMIN_ID = '7';

    await say('/widgets off');

    expect(settings.values.has('global')).toBe(false);
    expect(mocks.widget.mock.calls[0][1].caption).toContain('Электронный журнал');
  });

  it('переменная TELEGRAM_WIDGETS=off возвращает бота к обычным сообщениям', async () => {
    process.env.TELEGRAM_WIDGETS = 'off';
    process.env.TELEGRAM_BROADCAST_ADMIN_ID = '42';

    await click('c:0:1');
    expect(mocks.widget).not.toHaveBeenCalled();
    expect(mocks.edit.mock.calls[0][2]).toContain('👤 <b>Абрамов Пётр Ильич</b>');

    await click('k:0:1');
    expect(mocks.edit.mock.lastCall?.[2]).toContain('👤 <b>Абрамов Пётр Ильич</b>');

    await say('/start');
    expect(buttonTexts(mocks.send.mock.lastCall?.[2]).some((text) => text.startsWith('🎨'))).toBe(false);

    await say('/widgets');
    expect(mocks.send.mock.lastCall?.[1]).toContain('TELEGRAM_WIDGETS');
  });
});
