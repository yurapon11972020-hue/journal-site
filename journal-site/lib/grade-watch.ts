import crypto from 'node:crypto';

import { getJournalDataByPath, getJournalGroups } from '@/lib/journal';
import { describeChange, type JournalChange } from '@/lib/notify-messages';
import { getSubscriptionStore, type MarksSnapshot, type Subscription } from '@/lib/subscriptions';
import { sendMessage } from '@/lib/telegram';
import type { JournalData } from '@/lib/types';

/** Больше этого за один проход не шлём — защита от лавины после сбоя. */
const MAX_MESSAGES_PER_RUN = 60;

/** Прежний ID группы сохраняется при замене недоступного файла Яндекс.Диска. */
const REPLACED_ISIP_R_GROUP_ID = 'X0p3qpi4K5zZhKZU';
const REPLACED_ISIP_R_SOURCE = 'https://disk.yandex.ru/d/AHWThZMsG2LgWw';
/** Не является ключом оценки: diffSnapshots пропускает его при сравнении. */
const ISIP_R_SOURCE_MARKER = '__journal_source_and_roster__';

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

  if (!changes.length) {
    return { groupId, groupName, baseline: false, changes: 0, messages: 0 };
  }

  const savedSubscriptions = await store.listByGroup(groupId);
  const subscriptions = groupId === REPLACED_ISIP_R_GROUP_ID
    ? subscriptionsForCurrentRoster(savedSubscriptions, data)
    : savedSubscriptions;
  let sent = 0;

  for (const change of changes) {
    if (sent >= MAX_MESSAGES_PER_RUN) {
      break;
    }

    const text = describeChange(change);
    if (!text) {
      continue;
    }

    for (const subscription of subscriptions) {
      if (sent >= MAX_MESSAGES_PER_RUN) {
        break;
      }
      if (!matchesSubscription(subscription, change)) {
        continue;
      }

      try {
        await sendMessage(subscription.chatId, text);
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

  return { groupId, groupName, baseline: false, changes: changes.length, messages: sent };
}

/** Проходит по всем группам. Вызывается после обновления журналов. */
export async function runGradeWatch(): Promise<WatchResult[]> {
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

  return results;
}
