import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSnapshot, watchGroup } from '@/lib/grade-watch';
import { lectureEndAt, runLectureReminders } from '@/lib/lecture-reminders';
import type { ScheduleLesson } from '@/lib/lecture-sources';
import { setLectureStoreForTests, type LectureMode, type LectureStore, type LectureSubscription } from '@/lib/lecture-subscriptions';
import { setSubscriptionStoreForTests, type MarksSnapshot, type Subscription, type SubscriptionStore } from '@/lib/subscriptions';
import { setWidgetSettingsStoreForTests, type WidgetSettingsStore } from '@/lib/widget-settings';

import { widgetJournal } from './helpers/widget-fixture';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  sendChecked: vi.fn(),
  widget: vi.fn(),
  schedule: vi.fn(),
  rooms: vi.fn(),
}));

vi.mock('@/lib/telegram', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/telegram')>()),
  sendMessage: mocks.send,
  sendMessageChecked: mocks.sendChecked,
  sendWidget: mocks.widget,
}));

vi.mock('@/lib/lecture-sources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/lecture-sources')>()),
  getScheduleData: mocks.schedule,
  getTeacherRoomLinks: mocks.rooms,
}));

const ORIGINAL_WIDGETS = process.env.TELEGRAM_WIDGETS;

class MemorySettings implements WidgetSettingsStore {
  values = new Map<string, boolean>();
  async get(scope: string) { return this.values.get(scope) ?? null; }
  async set(scope: string, enabled: boolean) { this.values.set(scope, enabled); }
}

class FakeSubscriptions implements SubscriptionStore {
  snapshots = new Map<string, MarksSnapshot>();
  constructor(public subscriptions: Subscription[]) {}
  async listByGroup(groupId: string) { return this.subscriptions.filter((item) => item.groupId === groupId); }
  async listByChat(chatId: number) { return this.subscriptions.filter((item) => item.chatId === chatId); }
  async save() { /* не нужно */ }
  async remove() { /* не нужно */ }
  async readSnapshot(groupId: string) { return this.snapshots.get(groupId) ?? null; }
  async writeSnapshot(groupId: string, marks: MarksSnapshot) { this.snapshots.set(groupId, marks); }
}

class FakeLectures implements LectureStore {
  subscriptions: LectureSubscription[] = [];
  claimed = new Set<string>();
  async listByChat(chatId: number) { return this.subscriptions.filter((item) => item.chatId === chatId); }
  async get(chatId: number, groupName: string) {
    return this.subscriptions.find((item) => item.chatId === chatId && item.groupName === groupName) ?? null;
  }
  async setMode() { /* не нужно */ }
  async listChats(groupName: string, mode: LectureMode) {
    return this.subscriptions.filter((item) => item.groupName === groupName && item[mode]).map((item) => item.chatId);
  }
  async claim(key: string, chatId: number) {
    if (this.claimed.has(`${key}:${chatId}`)) return false;
    this.claimed.add(`${key}:${chatId}`);
    return true;
  }
  async markSent() { /* резерв остаётся */ }
  async release(key: string, chatId: number) { this.claimed.delete(`${key}:${chatId}`); }
}

let settings: MemorySettings;

beforeEach(() => {
  process.env.TELEGRAM_WIDGETS = 'on';
  settings = new MemorySettings();
  setWidgetSettingsStoreForTests(settings);
  mocks.widget.mockReset().mockResolvedValue('sent');
  mocks.send.mockReset().mockResolvedValue(undefined);
  mocks.sendChecked.mockReset().mockResolvedValue(true);
  mocks.rooms.mockReset().mockResolvedValue(new Map([['коваленко:др', 'https://eduskp-surgut.store/b/adm-pfh-00g-o3l']]));
});

afterEach(() => {
  setWidgetSettingsStoreForTests(null);
  setSubscriptionStoreForTests(null);
  setLectureStoreForTests(null);
  process.env.TELEGRAM_WIDGETS = ORIGINAL_WIDGETS;
});

describe('уведомления об оценках карточками', () => {
  const data = widgetJournal({ students: ['Абрамов Пётр Ильич'], subjects: ['Математика'] });
  const subscription: Subscription = { chatId: 42, groupId: 'g1', studentId: 1, studentName: 'Абрамов Пётр Ильич', subjects: [] };

  function storeWithNewFive(): FakeSubscriptions {
    const store = new FakeSubscriptions([subscription]);
    const previous = buildSnapshot(data);
    const fresh = Object.keys(previous).find((key) => previous[key] === '5')!;
    delete previous[fresh];
    store.snapshots.set('g1', previous);
    setSubscriptionStoreForTests(store);
    return store;
  }

  it('новая пятёрка приходит анимированной карточкой', async () => {
    storeWithNewFive();

    const result = await watchGroup('g1', 'ИСиП-24/1', data);

    expect(result.messages).toBe(1);
    expect(mocks.widget).toHaveBeenCalledTimes(1);
    expect(mocks.widget.mock.calls[0][1].caption).toMatch(/^🔥 5 по «Математика» — /);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('без карточек или при отказе Telegram приходит прежний текст', async () => {
    storeWithNewFive();
    mocks.widget.mockResolvedValue('failed');
    await watchGroup('g1', 'ИСиП-24/1', data);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0][1]).toMatch(/^🔥 5 по «Математика» — /);

    mocks.widget.mockClear();
    mocks.send.mockClear();
    settings.values.set('chat:42', false);
    storeWithNewFive();
    await watchGroup('g1', 'ИСиП-24/1', data);
    expect(mocks.widget).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});

describe('напоминания о лекциях карточками', () => {
  const NOW = new Date('2026-10-20T03:20:00.000Z'); // 08:20 в Сургуте
  const lesson: ScheduleLesson = {
    date: '20.10.2026', time: '08:30-10:00', group: 'ПД-24/1', subject: 'Информатика (Лек)',
    teacher: 'Коваленко Д.Р.', teachers: ['Коваленко Д.Р.'], format: 'Видео-лекция', room: null, room_label: null, pair: 1,
  };

  it('видеолекция приходит карточкой с отсчётом и ссылкой в подписи', async () => {
    const store = new FakeLectures();
    store.subscriptions = [{ chatId: 42, groupName: 'ПД-24/1', video: true, lecture: false }];
    setLectureStoreForTests(store);
    mocks.schedule.mockResolvedValue({ groups: ['ПД-24/1'], items: [lesson] });

    expect(await runLectureReminders(NOW)).toEqual({ due: 1, sent: 1, failed: 0 });
    expect(mocks.sendChecked).not.toHaveBeenCalled();
    const widget = mocks.widget.mock.calls[0][1];
    expect(widget.caption).toContain('<a href="https://eduskp-surgut.store/b/adm-pfh-00g-o3l">🎥 Подключиться</a>');
    expect(widget.html).toContain(String(Date.parse('2026-10-20T03:30:00.000Z')));
    expect(widget.html).toContain(String(Date.parse('2026-10-20T05:00:00.000Z')));
  });

  it('если карточку не приняли, напоминание уходит обычным текстом', async () => {
    const store = new FakeLectures();
    store.subscriptions = [{ chatId: 42, groupName: 'ПД-24/1', video: true, lecture: false }];
    setLectureStoreForTests(store);
    mocks.schedule.mockResolvedValue({ groups: ['ПД-24/1'], items: [lesson] });
    mocks.widget.mockResolvedValue('failed');

    expect((await runLectureReminders(NOW)).sent).toBe(1);
    expect(mocks.sendChecked).toHaveBeenCalledTimes(1);
    expect(mocks.sendChecked.mock.calls[0][1]).toContain('Видеолекция через 10 мин.');
  });

  it('конец пары берётся из строки расписания', () => {
    expect(lectureEndAt(lesson)?.toISOString()).toBe('2026-10-20T05:00:00.000Z');
    expect(lectureEndAt({ date: '20.10.2026', time: '08:30' })).toBeNull();
  });
});
