import crypto from 'node:crypto';

import {
  getScheduleData,
  getTeacherRoomLinks,
  matchTeacherRoom,
  TEACHER_ROOMS_DIRECTORY_URL,
  type ScheduleLesson,
} from '@/lib/lecture-sources';
import { getLectureStore, type LectureMode } from '@/lib/lecture-subscriptions';
import { escapeHtml, sendMessageChecked } from '@/lib/telegram';

const LOCAL_UTC_OFFSET_HOURS = 5;
const REMINDER_LEAD_MS = 10 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 1000;

interface DueLecture {
  lesson: ScheduleLesson;
  mode: LectureMode;
  startsAt: Date;
}

export interface LectureReminderRunResult {
  due: number;
  sent: number;
  failed: number;
}

declare global {
  var __lectureReminderInterval: NodeJS.Timeout | undefined;
}

let running: Promise<LectureReminderRunResult> | null = null;

/** У видеозанятия приоритет формата расписания, даже если предмет помечен «(Пр)». */
export function lectureModeOf(lesson: ScheduleLesson): LectureMode | null {
  if (lesson.format?.trim().toLowerCase() === 'видео-лекция') return 'video';
  if (/\((?:лек|л)\)/iu.test(lesson.subject)) return 'lecture';
  return null;
}

/** Время сайта расписания — местное время Сургута (UTC+5). */
export function lectureStartAt(lesson: Pick<ScheduleLesson, 'date' | 'time'>): Date | null {
  const date = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(lesson.date);
  const time = /^(\d{1,2}):(\d{2})(?:-|$)/.exec(lesson.time);
  if (!date || !time) return null;

  const day = Number(date[1]);
  const month = Number(date[2]);
  const year = Number(date[3]);
  const hour = Number(time[1]);
  const minute = Number(time[2]);
  if (hour > 23 || minute > 59) return null;

  const utc = new Date(Date.UTC(year, month - 1, day, hour - LOCAL_UTC_OFFSET_HOURS, minute));
  const local = new Date(utc.getTime() + LOCAL_UTC_OFFSET_HOURS * 60 * 60 * 1000);
  if (local.getUTCFullYear() !== year || local.getUTCMonth() + 1 !== month || local.getUTCDate() !== day) return null;
  return utc;
}

export function dueLectures(items: ScheduleLesson[], now: Date): DueLecture[] {
  const due: DueLecture[] = [];
  for (const lesson of items) {
    const mode = lectureModeOf(lesson);
    if (!mode) continue;
    const startsAt = lectureStartAt(lesson);
    if (!startsAt) continue;
    const remaining = startsAt.getTime() - now.getTime();
    if (remaining > 0 && remaining <= REMINDER_LEAD_MS) {
      due.push({ lesson, mode, startsAt });
    }
  }
  return due;
}

function teacherNames(lesson: ScheduleLesson): string[] {
  return [...new Set((lesson.teachers.length ? lesson.teachers : lesson.teacher ? [lesson.teacher] : [])
    .map((name) => name.trim()).filter(Boolean))];
}

function eventKey(item: DueLecture): string {
  const start = item.lesson.time.match(/^\d{1,2}:\d{2}/)?.[0] ?? item.lesson.time;
  return crypto.createHash('sha256').update(JSON.stringify([
    item.mode,
    item.lesson.date,
    item.lesson.group,
    start,
    item.lesson.subject,
  ])).digest('hex');
}

export function lectureReminderText(item: DueLecture, now: Date, rooms: Map<string, string>): string {
  const lesson = item.lesson;
  const minutes = Math.max(1, Math.ceil((item.startsAt.getTime() - now.getTime()) / 60_000));
  const names = teacherNames(lesson);
  const lines = [
    item.mode === 'video'
      ? `🎥 <b>Видеолекция через ${minutes} мин.</b>`
      : `📚 <b>Лекция через ${minutes} мин.</b>`,
    `Группа: ${escapeHtml(lesson.group)}`,
    `Время: ${escapeHtml(lesson.time.replace('-', '–'))}`,
    `Предмет: ${escapeHtml(lesson.subject)}`,
    `Преподаватель: ${names.length ? escapeHtml(names.join(', ')) : 'не указан'}`,
  ];

  if (item.mode === 'video') {
    const directLinks = names.map((name) => ({ name, url: matchTeacherRoom(name, rooms) }))
      .filter((entry): entry is { name: string; url: string } => Boolean(entry.url));
    if (directLinks.length === 1 && names.length === 1) {
      lines.push(`Подключение: ${escapeHtml(directLinks[0].url)}`);
    } else if (directLinks.length) {
      lines.push(`Комнаты преподавателей:\n${directLinks.map(({ name, url }) => `${escapeHtml(name)} — ${escapeHtml(url)}`).join('\n')}`);
    }
    if (directLinks.length < names.length || !directLinks.length) {
      lines.push(`Все комнаты преподавателей: ${TEACHER_ROOMS_DIRECTORY_URL}`);
    }
  } else {
    const room = [lesson.room_label, lesson.room].filter(Boolean).join(' ');
    lines.push(`Аудитория: ${room ? escapeHtml(room) : 'не указана'}`);
  }

  return lines.join('\n');
}

async function executeLectureReminders(now: Date, currentTime: () => Date): Promise<LectureReminderRunResult> {
  const schedule = await getScheduleData();
  const due = dueLectures(schedule.items, now);
  const result: LectureReminderRunResult = { due: due.length, sent: 0, failed: 0 };
  if (!due.length) return result;

  const store = getLectureStore();
  let rooms = new Map<string, string>();
  if (due.some((item) => item.mode === 'video')) {
    try {
      rooms = await getTeacherRoomLinks();
    } catch (error) {
      console.error('[лекции] Не удалось обновить ссылки комнат:', error);
    }
  }

  for (const item of due) {
    const chats = [...new Set(await store.listChats(item.lesson.group, item.mode))];
    if (!chats.length) continue;
    const key = eventKey(item);

    for (const chatId of chats) {
      const sendAt = currentTime();
      if (item.startsAt.getTime() <= sendAt.getTime()) break;
      if (!(await store.claim(key, chatId))) continue;
      let accepted = false;
      try {
        accepted = await sendMessageChecked(chatId, lectureReminderText(item, sendAt, rooms));
      } catch (error) {
        console.error(`[лекции] Не удалось отправить напоминание в чат ${chatId}:`, error);
      }

      if (!accepted) {
        result.failed += 1;
        await store.release(key, chatId).catch(() => undefined);
        continue;
      }

      result.sent += 1;
      try {
        await store.markSent(key, chatId);
      } catch (error) {
        // Telegram уже принял сообщение. Резервирование оставляем до конца
        // окна напоминания, чтобы следующий тик не прислал его повторно.
        console.error(`[лекции] Сообщение отправлено, но отметка в базе не сохранилась для чата ${chatId}:`, error);
      }
    }
  }

  return result;
}

/** Один проход на процесс; база отдельно защищает от совпавших вызовов cron и таймера. */
export function runLectureReminders(now?: Date): Promise<LectureReminderRunResult> {
  if (!running) {
    running = executeLectureReminders(now ?? new Date(), now ? () => now : () => new Date())
      .finally(() => { running = null; });
  }
  return running;
}

/** Самостоятельный минутный таймер, не ожидающий скачивания журналов. */
export function startLectureReminderLoop(): void {
  if (!process.env.TELEGRAM_BOT_TOKEN?.trim() || globalThis.__lectureReminderInterval) return;

  const check = () => {
    void runLectureReminders().catch((error) => {
      console.error('[лекции] Проверка расписания не удалась:', error);
    });
  };
  globalThis.__lectureReminderInterval = setInterval(check, CHECK_INTERVAL_MS);
  globalThis.__lectureReminderInterval.unref?.();
  check();
}
