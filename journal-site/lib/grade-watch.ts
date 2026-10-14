import { getJournalDataByPath, getJournalGroups } from '@/lib/journal';
import { describeChange, type JournalChange } from '@/lib/notify-messages';
import { getSubscriptionStore, type MarksSnapshot, type Subscription } from '@/lib/subscriptions';
import { sendMessage } from '@/lib/telegram';
import type { JournalData } from '@/lib/types';

/** Больше этого за один проход не шлём — защита от лавины после сбоя. */
const MAX_MESSAGES_PER_RUN = 60;

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
  const previous = await store.readSnapshot(groupId);

  if (!previous) {
    await store.writeSnapshot(groupId, current);
    return { groupId, groupName, baseline: true, changes: 0, messages: 0 };
  }

  const studentNames = new Map(data.students.map((student) => [student.id, student.name]));
  const changes = diffSnapshots(previous, current, studentNames);

  if (!changes.length) {
    return { groupId, groupName, baseline: false, changes: 0, messages: 0 };
  }

  const subscriptions = await store.listByGroup(groupId);
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
