import crypto from 'node:crypto';

import { getJournalDataByPath, getJournalGroups } from '@/lib/journal';
import { describeChange, type JournalChange } from '@/lib/notify-messages';
import { getSubscriptionStore, type MarksSnapshot, type Subscription, type SubscriptionStore } from '@/lib/subscriptions';
import { sendMessage, sendWidget } from '@/lib/telegram';
import type { JournalData } from '@/lib/types';
import { widgetsEnabledFor } from '@/lib/widget-settings';
import { gradeAlertWidget } from '@/lib/widgets/grade-alert';
import type { WidgetMessage } from '@/lib/widgets/kit';

/** Больше этого за один проход не шлём — защита от лавины после сбоя. */
const MAX_MESSAGES_PER_RUN = 60;

/** Прежний ID группы сохраняется при замене недоступного файла Яндекс.Диска. */
const REPLACED_ISIP_R_GROUP_ID = 'X0p3qpi4K5zZhKZU';
const REPLACED_ISIP_R_SOURCE = 'https://disk.yandex.ru/d/AHWThZMsG2LgWw';
/** Не является ключом оценки: diffSnapshots пропускает его при сравнении. */
const ISIP_R_SOURCE_MARKER = '__journal_source_and_roster__';
/** Отпечаток списка студентов: номер строки и имя. Тоже не ключ оценки. */
const ROSTER_MARKER = '__roster__';

function normalizedStudentName(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru').replace(/ё/g, 'е');
}

/** Перестановка строк или переименование листов требует нового исходного снимка. */
function isipRSourceVersion(data: JournalData): string {
  return crypto.createHash('sha256').update(JSON.stringify([
    REPLACED_ISIP_R_SOURCE,
    data.students.map((student) => [student.id, normalizedStudentName(student.name)]),
    data.subjects.map((subject) => [subject.sheetName, subject.subjectName]),
  ])).digest('hex');
}

/**
 * Подписки и снимок держатся за номер строки в Excel. Если строки сдвинулись
 * (вставили или убрали студента), под тем же номером теперь другой человек.
 */
function rosterVersion(data: JournalData): string {
  return crypto.createHash('sha256').update(JSON.stringify(
    data.students.map((student) => [student.id, normalizedStudentName(student.name)]),
  )).digest('hex');
}

/** Числовой ID — позиция в Excel; после замены файла подписчика сверяем по имени. */
function subscriptionsForCurrentRoster(subscriptions: Subscription[], data: JournalData): Subscription[] {
  const idsByName = new Map<string, number[]>();
  for (const student of data.students) {
    const name = normalizedStudentName(student.name);
    if (!name) continue;
    const ids = idsByName.get(name) ?? [];
    ids.push(student.id);
    idsByName.set(name, ids);
  }

  const resolved = new Map<string, Subscription>();
  for (const subscription of subscriptions) {
    const ids = idsByName.get(normalizedStudentName(subscription.studentName));
    // Пустое или неоднозначное имя нельзя безопасно привязать к чужой строке.
    if (ids?.length !== 1) continue;

    const studentId = ids[0];
    const key = JSON.stringify([subscription.chatId, studentId]);
    const previous = resolved.get(key);
    if (!previous) {
      resolved.set(key, { ...subscription, studentId });
      continue;
    }

    // Старый и новый ID одной подписки могут сосуществовать после смены файла.
    // Объединяем предметы, чтобы не отправлять два одинаковых сообщения в чат.
    previous.subjects = previous.subjects.length && subscription.subjects.length
      ? [...new Set([...previous.subjects, ...subscription.subjects])]
      : [];
  }
  return [...resolved.values()];
}

/**
 * Ключ клетки журнала. Собирается через JSON, а не через разделитель:
 * в названии предмета может встретиться что угодно, и любой символ-разделитель
 * рано или поздно ломает разбор обратно.
 */
function snapshotKey(studentId: number, subject: string, column: string): string {
  return JSON.stringify([studentId, subject, column]);
}

function parseSnapshotKey(key: string): { studentId: number; subject: string; column: string } | null {
  try {
    const parsed = JSON.parse(key) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 3) {
      return null;
    }

    const [studentId, subject, column] = parsed;
    if (typeof studentId !== 'number' || typeof subject !== 'string' || typeof column !== 'string') {
      return null;
    }

    return { studentId, subject, column };
  } catch {
    return null;
  }
}

/** Собирает все заполненные клетки журнала в плоскую карту для сравнения. */
export function buildSnapshot(data: JournalData): MarksSnapshot {
  const marks: MarksSnapshot = {};

  for (const student of data.students) {
    for (const subject of student.subjects) {
      for (const grade of subject.grades) {
        const value = grade.value.trim();
        if (!value) {
          continue;
        }
        marks[snapshotKey(student.id, subject.subjectName, grade.label)] = value;
      }
    }
  }

  return marks;
}

/** Ищет, что изменилось между двумя снимками. */
export function diffSnapshots(
  previous: MarksSnapshot,
  current: MarksSnapshot,
  studentNames: Map<number, string>,
): JournalChange[] {
  const changes: JournalChange[] = [];
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);

  for (const key of keys) {
    const before = previous[key] ?? '';
    const after = current[key] ?? '';
    if (before === after) {
      continue;
    }

    const parsed = parseSnapshotKey(key);
    if (!parsed) {
      continue;
    }

    changes.push({
      studentId: parsed.studentId,
      studentName: studentNames.get(parsed.studentId) ?? 'Студент',
      subject: parsed.subject,
      columnLabel: parsed.column,
      before,
      after,
    });
  }

  return changes;
}

/** Подходит ли изменение под подписку: все предметы или конкретный список. */
export function matchesSubscription(subscription: Subscription, change: JournalChange): boolean {
  if (subscription.studentId !== change.studentId) {
    return false;
  }
  if (!subscription.subjects.length) {
    return true;
  }
  return subscription.subjects.includes(change.subject);
}

export interface WatchResult {
  groupId: string;
  groupName: string;
  /** Первый проход после запуска: снимок сохранён, сообщения не слались. */
  baseline: boolean;
  changes: number;
  messages: number;
  /** Сколько сообщений не отправили, потому что этот чат уже получал то же самое. */
  duplicates?: number;
  /** Сколько отметок только «переехали» в соседний столбец (поправили дату занятия). */
  moved?: number;
  /** Журнал перестроили (вставили строки, поменяли даты): снимок обновлён молча. */
  restructured?: boolean;
}

/** Если за проход изменилась такая доля уже стоявших отметок, журнал перестроили, а не заполняли. */
const RESTRUCTURE_SHARE = 0.2;
const RESTRUCTURE_MIN_CHANGES = 10;

function markKey(value: string): string {
  return value.replace(/ /g, ' ').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, '');
}

/**
 * Отпечаток уведомления: группа, студент по имени, предмет, занятие и новая отметка.
 * Одно и то же событие один чат получает один раз, даже если журнал «мигнул»
 * старой копией или два прохода совпали по времени.
 */
export function notificationFingerprint(groupId: string, change: JournalChange): string {
  return crypto.createHash('sha256').update(JSON.stringify([
    groupId,
    normalizedStudentName(change.studentName),
    change.subject.trim(),
    change.columnLabel.trim(),
    markKey(change.after),
  ])).digest('hex').slice(0, 40);
}

/**
 * Отметка ушла из одного столбца и такая же появилась в другом у того же
 * студента по тому же предмету: поправили дату занятия, новой оценки нет.
 */
export function movedMarks(changes: JournalChange[]): Set<JournalChange> {
  const removed = new Map<string, number>();
  for (const change of changes) {
    if (change.before.trim() && !change.after.trim()) {
      const key = JSON.stringify([change.studentId, change.subject, markKey(change.before)]);
      removed.set(key, (removed.get(key) ?? 0) + 1);
    }
  }

  const moved = new Set<JournalChange>();
  for (const change of changes) {
    if (change.before.trim() || !change.after.trim()) continue;
    const key = JSON.stringify([change.studentId, change.subject, markKey(change.after)]);
    const left = removed.get(key) ?? 0;
    if (left > 0) {
      removed.set(key, left - 1);
      moved.add(change);
    }
  }
  return moved;
}

/** Изменились или пропали многие из уже стоявших отметок — значит, журнал перестроили. */
export function looksRestructured(previous: MarksSnapshot, changes: JournalChange[]): boolean {
  const existing = Object.entries(previous).filter(([key, value]) => !key.startsWith('__') && value.trim()).length;
  const disturbed = changes.filter((change) => change.before.trim()).length;
  return disturbed >= RESTRUCTURE_MIN_CHANGES && disturbed >= existing * RESTRUCTURE_SHARE;
}

/** Помечает событие отправленным; false — этот чат его уже получал. Ошибка базы не глушит уведомление. */
async function firstDelivery(store: SubscriptionStore, chatId: number, fingerprint: string): Promise<boolean> {
  if (!store.claimNotification) return true;
  try {
    return await store.claimNotification(chatId, fingerprint);
  } catch (error) {
    console.error(`[уведомления] Не удалось сверить с отправленными для чата ${chatId}:`, error);
    return true;
  }
}

/**
 * Сверяет журнал одной группы с прошлым снимком и рассылает уведомления.
 *
 * Первый проход, когда прошлого снимка ещё нет, только запоминает состояние:
 * иначе подписчику прилетели бы разом все оценки за семестр.
 */
export async function watchGroup(groupId: string, groupName: string, data: JournalData): Promise<WatchResult> {
  const store = getSubscriptionStore();
  const current = buildSnapshot(data);
  current[ROSTER_MARKER] = rosterVersion(data);
  if (groupId === REPLACED_ISIP_R_GROUP_ID) {
    current[ISIP_R_SOURCE_MARKER] = isipRSourceVersion(data);
  }
  const previous = await store.readSnapshot(groupId);

  if (!previous || (groupId === REPLACED_ISIP_R_GROUP_ID &&
      previous[ISIP_R_SOURCE_MARKER] !== current[ISIP_R_SOURCE_MARKER])) {
    await store.writeSnapshot(groupId, current);
    return { groupId, groupName, baseline: true, changes: 0, messages: 0 };
  }

  const studentNames = new Map(data.students.map((student) => [student.id, student.name]));
  const changes = diffSnapshots(previous, current, studentNames);
  // Старый снимок без отпечатка списка просто его получит.
  const rosterMoved = Boolean(previous[ROSTER_MARKER]) && previous[ROSTER_MARKER] !== current[ROSTER_MARKER];

  if (!changes.length && !rosterMoved) {
    if (!previous[ROSTER_MARKER]) await store.writeSnapshot(groupId, current);
    return { groupId, groupName, baseline: false, changes: 0, messages: 0 };
  }

  // Вставленная строка или поправленные даты сдвигают отметки: это не новые
  // оценки, и рассылать их заново нельзя. Снимок просто становится новым.
  if (rosterMoved || looksRestructured(previous, changes)) {
    console.warn(`[уведомления] Журнал «${groupName}» перестроен (${changes.length} изменений) — снимок обновлён без рассылки.`);
    await store.writeSnapshot(groupId, current);
    return { groupId, groupName, baseline: true, changes: changes.length, messages: 0, restructured: true };
  }

  const moved = movedMarks(changes);
  const savedSubscriptions = await store.listByGroup(groupId);
  const subscriptions = groupId === REPLACED_ISIP_R_GROUP_ID
    ? subscriptionsForCurrentRoster(savedSubscriptions, data)
    : savedSubscriptions;
  let sent = 0;
  let duplicates = 0;

  for (const change of changes) {
    if (sent >= MAX_MESSAGES_PER_RUN) {
      break;
    }
    if (moved.has(change)) {
      continue;
    }

    const text = describeChange(change);
    if (!text) {
      continue;
    }
    const fingerprint = notificationFingerprint(groupId, change);
    // Карточка одна на изменение: собирается при первом подписчике, которому она нужна.
    let widget: WidgetMessage | null | undefined;

    for (const subscription of subscriptions) {
      if (sent >= MAX_MESSAGES_PER_RUN) {
        break;
      }
      if (!matchesSubscription(subscription, change)) {
        continue;
      }
      if (!(await firstDelivery(store, subscription.chatId, fingerprint))) {
        duplicates += 1;
        continue;
      }

      try {
        let delivered = false;
        if (await widgetsEnabledFor(subscription.chatId)) {
          if (widget === undefined) widget = gradeAlertWidget(change, data);
          // «Нет ответа» считаем доставкой: карточка могла дойти, и текст стал бы повтором.
          delivered = widget !== null && (await sendWidget(subscription.chatId, widget)) !== 'failed';
        }
        if (!delivered) {
          await sendMessage(subscription.chatId, text);
        }
        sent += 1;
      } catch (error) {
        // Чат мог быть удалён или бот заблокирован — это не повод ронять проход.
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[уведомления] Не отправилось в чат ${subscription.chatId}: ${message}`);
      }
    }
  }

  // Снимок обновляем в любом случае: иначе то же изменение придёт повторно.
  await store.writeSnapshot(groupId, current);

  return { groupId, groupName, baseline: false, changes: changes.length, messages: sent, duplicates, moved: moved.size };
}

interface GradeWatchRuntime {
  running: Promise<WatchResult[]> | null;
  /** Последний проход — для владельца бота (команда /notify_status). */
  lastRun: { at: number; results: WatchResult[] } | null;
}

/** Общее на процесс: таймер обновления и бот могут жить в разных сборках Next.js. */
function gradeWatchRuntime(): GradeWatchRuntime {
  const store = globalThis as typeof globalThis & { [key: symbol]: GradeWatchRuntime | undefined };
  const key = Symbol.for('journal.gradeWatch.runtime');
  store[key] ??= { running: null, lastRun: null };
  return store[key];
}

export function lastGradeWatchRun(): { at: number; results: WatchResult[] } | null {
  return gradeWatchRuntime().lastRun;
}

async function executeGradeWatch(): Promise<WatchResult[]> {
  const groups = await getJournalGroups();
  const results: WatchResult[] = [];

  for (const group of groups) {
    try {
      const data = await getJournalDataByPath(group.filePath);
      results.push(await watchGroup(group.id, group.groupName, data));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[уведомления] Группа «${group.groupName}» пропущена: ${message}`);
    }
  }

  gradeWatchRuntime().lastRun = { at: Date.now(), results };
  return results;
}

/**
 * Проходит по всем группам. Вызывается после обновления журналов.
 * Пока идёт проход, второй не начинается: оба сверились бы с одним и тем же
 * старым снимком и разослали бы одни и те же оценки дважды.
 */
export function runGradeWatch(): Promise<WatchResult[]> {
  const state = gradeWatchRuntime();
  state.running ??= executeGradeWatch().finally(() => {
    state.running = null;
  });
  return state.running;
}
