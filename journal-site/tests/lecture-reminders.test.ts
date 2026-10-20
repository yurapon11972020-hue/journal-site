import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  dueLectures,
  lectureModeOf,
  lectureReminderText,
  lectureStartAt,
  runLectureReminders,
} from '@/lib/lecture-reminders';
import { setLectureStoreForTests, type LectureMode, type LectureStore, type LectureSubscription } from '@/lib/lecture-subscriptions';
import type { ScheduleLesson } from '@/lib/lecture-sources';

const mocks = vi.hoisted(() => ({
  schedule: vi.fn(),
  rooms: vi.fn(),
  send: vi.fn(),
}));

vi.mock('@/lib/lecture-sources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/lecture-sources')>()),
  getScheduleData: mocks.schedule,
  getTeacherRoomLinks: mocks.rooms,
}));

vi.mock('@/lib/telegram', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/telegram')>()),
  sendMessageChecked: mocks.send,
}));

class FakeLectureStore implements LectureStore {
  subscriptions: LectureSubscription[] = [];
  deliveries = new Set<string>();

  async listByChat(chatId: number) { return this.subscriptions.filter((item) => item.chatId === chatId); }
  async get(chatId: number, groupName: string) {
    return this.subscriptions.find((item) => item.chatId === chatId && item.groupName === groupName) ?? null;
  }
  async setMode(chatId: number, groupName: string, mode: LectureMode, enabled: boolean) {
    const item = await this.get(chatId, groupName) ?? { chatId, groupName, video: false, lecture: false };
    item[mode] = enabled;
    if (!this.subscriptions.includes(item)) this.subscriptions.push(item);
  }
  async listChats(groupName: string, mode: LectureMode) {
    return this.subscriptions.filter((item) => item.groupName === groupName && item[mode]).map((item) => item.chatId);
  }
  async claim(eventKey: string, chatId: number) {
    const key = `${eventKey}:${chatId}`;
    if (this.deliveries.has(key)) return false;
    this.deliveries.add(key);
    return true;
  }
  async markSent() { /* claim stays reserved */ }
  async release(eventKey: string, chatId: number) { this.deliveries.delete(`${eventKey}:${chatId}`); }
}

function lesson(overrides: Partial<ScheduleLesson> = {}): ScheduleLesson {
  return {
    date: '20.10.2026',
    time: '08:30-10:00',
    group: 'ПД-24/1',
    subject: 'Информатика (Лек)',
    teacher: 'Коваленко Д.Р.',
    teachers: ['Коваленко Д.Р.'],
    format: 'Видео-лекция',
    room: null,
    room_label: null,
    pair: 1,
    ...overrides,
  };
}

const NOW = new Date('2026-10-20T03:20:00.000Z'); // 08:20 в Сургуте

describe('напоминания о лекциях', () => {
  let store: FakeLectureStore;

  beforeEach(() => {
    store = new FakeLectureStore();
    setLectureStoreForTests(store);
    mocks.schedule.mockReset().mockResolvedValue({ groups: ['ПД-24/1'], items: [] });
    mocks.rooms.mockReset().mockResolvedValue(new Map([['коваленко:др', 'https://eduskp-surgut.store/b/adm-pfh-00g-o3l']]));
    mocks.send.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    setLectureStoreForTests(null);
    vi.useRealTimers();
  });

  it('различает видео, обычную лекцию и практику', () => {
    expect(lectureModeOf(lesson({ subject: 'Физкультура (Пр)' }))).toBe('video');
    expect(lectureModeOf(lesson({ format: null }))).toBe('lecture');
    expect(lectureModeOf(lesson({ format: null, subject: 'Физкультура (Пр)' }))).toBeNull();
  });

  it('считает десять минут по местному времени и отбрасывает ошибочные даты', () => {
    expect(lectureStartAt(lesson())?.toISOString()).toBe('2026-10-20T03:30:00.000Z');
    expect(dueLectures([lesson()], NOW)).toHaveLength(1);
    expect(dueLectures([lesson()], new Date('2026-10-20T03:19:59.000Z'))).toHaveLength(0);
    expect(dueLectures([lesson()], new Date('2026-10-20T03:30:00.000Z'))).toHaveLength(0);
    expect(lectureStartAt(lesson({ date: '32.10.2026' }))).toBeNull();
  });

  it('посылает оба выбранных режима одному чату с нужной ссылкой и аудиторией ровно один раз', async () => {
    store.subscriptions = [{ chatId: 42, groupName: 'ПД-24/1', video: true, lecture: true }];
    mocks.schedule.mockResolvedValue({ groups: ['ПД-24/1'], items: [
      lesson(),
      lesson({ subject: 'Математика (Лек)', format: null, room: '8', room_label: 'Аудитория', teacher: 'Алпаева В.В.', teachers: ['Алпаева В.В.'] }),
    ] });

    const first = await runLectureReminders(NOW);
    const second = await runLectureReminders(NOW);

    expect(first).toEqual({ due: 2, sent: 2, failed: 0 });
    expect(second).toEqual({ due: 2, sent: 0, failed: 0 });
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send.mock.calls[0][1]).toContain('Видеолекция через 10 мин.');
    expect(mocks.send.mock.calls[0][1]).toContain('https://eduskp-surgut.store/b/adm-pfh-00g-o3l');
    expect(mocks.send.mock.calls[1][1]).toContain('Аудитория: Аудитория 8');
    expect(mocks.send.mock.calls[1][1]).not.toContain('Подключение:');
  });

  it('после ошибки Telegram освобождает напоминание для повторной попытки', async () => {
    store.subscriptions = [{ chatId: 42, groupName: 'ПД-24/1', video: true, lecture: false }];
    mocks.schedule.mockResolvedValue({ groups: ['ПД-24/1'], items: [lesson()] });
    mocks.send.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    expect(await runLectureReminders(NOW)).toEqual({ due: 1, sent: 0, failed: 1 });
    expect(await runLectureReminders(NOW)).toEqual({ due: 1, sent: 1, failed: 0 });
  });

  it('не дублирует уже принятое Telegram сообщение, если отметка в базе не сохранилась', async () => {
    store.subscriptions = [{ chatId: 42, groupName: 'ПД-24/1', video: true, lecture: false }];
    store.markSent = async () => { throw new Error('База временно недоступна'); };
    mocks.schedule.mockResolvedValue({ groups: ['ПД-24/1'], items: [lesson()] });

    expect((await runLectureReminders(NOW)).sent).toBe(1);
    expect((await runLectureReminders(NOW)).sent).toBe(0);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('не отправляет опоздавшее напоминание, если пара началась во время загрузки расписания', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    store.subscriptions = [{ chatId: 42, groupName: 'ПД-24/1', video: true, lecture: false }];
    mocks.schedule.mockImplementation(async () => {
      vi.setSystemTime(new Date('2026-10-20T03:30:01.000Z'));
      return { groups: ['ПД-24/1'], items: [lesson()] };
    });

    expect((await runLectureReminders()).sent).toBe(0);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('подписывает отдельные ссылки, если видеопару ведут два преподавателя', () => {
    const item = dueLectures([lesson({ teachers: ['Коваленко Д.Р.', 'Иванов В.Б.'] })], NOW)[0];
    const rooms = new Map([
      ['коваленко:др', 'https://eduskp-surgut.store/b/adm-pfh-00g-o3l'],
      ['иванов:вб', 'https://eduskp-surgut.store/b/vam-sba-jrj-so7'],
    ]);

    const text = lectureReminderText(item, NOW, rooms);
    expect(text).toContain('Коваленко Д.Р. — https://eduskp-surgut.store/b/adm-pfh-00g-o3l');
    expect(text).toContain('Иванов В.Б. — https://eduskp-surgut.store/b/vam-sba-jrj-so7');
  });

  it('экранирует текст расписания и даёт ссылку на общий список комнат при отсутствии прямой', () => {
    const item = dueLectures([lesson({ subject: '<Задачи> & (Лек)' })], NOW)[0];
    const text = lectureReminderText(item, NOW, new Map());

    expect(text).toContain('&lt;Задачи&gt; &amp; (Лек)');
    expect(text).toContain('https://skp-surgut.ru/');
  });
});
