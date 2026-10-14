import { randomUUID } from 'node:crypto';

import { getJournalDataByPath, getJournalGroups } from '@/lib/journal';
import { describeChange, type JournalChange } from '@/lib/notify-messages';
import {
  getSubscriptionStore,
  type MarksSnapshot,
  type PendingMessage,
  type Subscription,
  type SubscriptionStore,
} from '@/lib/subscriptions';
import { sendMessage, TelegramApiError } from '@/lib/telegram';
import type { JournalData } from '@/lib/types';

/** Число одновременно выполняющихся запросов Telegram для всех групп. */
const MAX_PARALLEL_SENDS = 4;
/** Не превышаем общий лимит Telegram для одного бота даже при быстрых ответах API. */
const GLOBAL_SEND_INTERVAL_MS = 40;
/** Telegram ограничивает частоту отправки в один чат. */
const PER_CHAT_SEND_INTERVAL_MS = 1_000;
/** Размер батча: после него даём завершиться запросам перед следующим батчем. */
const MAX_MESSAGES_PER_BATCH = 60;
/** Telegram принимает до 4096 символов; оставляем запас для текста и разметки. */
const MAX_MESSAGE_LENGTH = 3_500;
const MAX_429_RETRIES = 2;
const MAX_RETRY_AFTER_SECONDS = 5;

interface QueuedTelegramMessage {
  chatId: number;
  text: string;
  readyAt: number;
  retries: number;
  resolve: () => void;
  reject: (error: unknown) => void;
}

const pendingMessages: QueuedTelegramMessage[] = [];
const activeChats = new Set<number>();
const nextSendAtByChat = new Map<number, number>();
let activeSends = 0;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;
let nextGlobalSendAt = 0;

/** Общая очередь ускоряет рассылку разным чатам и сохраняет порядок в каждом чате. */
function drainMessageQueue(): void {
  if (wakeTimer) {
    clearTimeout(wakeTimer);
    wakeTimer = null;
  }

  while (activeSends < MAX_PARALLEL_SENDS) {
    const now = Date.now();
    let index = -1;
    let earliestReadyAt = Number.POSITIVE_INFINITY;
    const seenPendingChats = new Set<number>();

    for (let pendingIndex = 0; pendingIndex < pendingMessages.length; pendingIndex += 1) {
      const message = pendingMessages[pendingIndex];
      if (seenPendingChats.has(message.chatId)) {
        continue;
      }
      seenPendingChats.add(message.chatId);
      if (activeChats.has(message.chatId)) {
        continue;
      }

      const readyAt = Math.max(message.readyAt, nextGlobalSendAt, nextSendAtByChat.get(message.chatId) ?? 0);
      if (readyAt <= now) {
        index = pendingIndex;
        break;
      }
      earliestReadyAt = Math.min(earliestReadyAt, readyAt);
    }

    if (index < 0) {
      if (Number.isFinite(earliestReadyAt)) {
        wakeTimer = setTimeout(drainMessageQueue, Math.max(1, earliestReadyAt - Date.now()));
      }
      return;
    }

    const [message] = pendingMessages.splice(index, 1);
    activeSends += 1;
    activeChats.add(message.chatId);
    nextGlobalSendAt = now + GLOBAL_SEND_INTERVAL_MS;
    nextSendAtByChat.set(message.chatId, now + PER_CHAT_SEND_INTERVAL_MS);

    void Promise.resolve()
      .then(() => sendMessage(message.chatId, message.text))
      .then(message.resolve, (error: unknown) => {
        if (error instanceof TelegramApiError && error.status === 429 && message.retries < MAX_429_RETRIES) {
          const retryAfter = error.retryAfterSeconds ?? 1;
          if (retryAfter > 0 && retryAfter <= MAX_RETRY_AFTER_SECONDS) {
            message.retries += 1;
            message.readyAt = Date.now() + retryAfter * 1_000;
            pendingMessages.unshift(message);
            return;
          }
        }
        message.reject(error);
      })
      .finally(() => {
        activeSends -= 1;
        activeChats.delete(message.chatId);
        drainMessageQueue();
      });
  }
}

/** Сбрасывает только ограничения времени между независимыми тестами. */
export function resetMessageQueueForTests(): void {
  if (activeSends || pendingMessages.length) {
    throw new Error('Нельзя сбросить очередь, пока отправка уведомлений не закончилась.');
  }
  if (wakeTimer) {
    clearTimeout(wakeTimer);
    wakeTimer = null;
  }
  nextSendAtByChat.clear();
  nextGlobalSendAt = 0;
}

function queueMessage(chatId: number, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    pendingMessages.push({ chatId, text, readyAt: 0, retries: 0, resolve, reject });
    drainMessageQueue();
  });
}

/** Объединяет изменения одного чата, не меняя текст одиночного изменения. */
function packChatMessages(changes: string[]): string[] {
  const messages: string[] = [];
  let current = '';

  function flush(): void {
    if (current) {
      messages.push(current);
      current = '';
    }
  }

  for (const change of changes) {
    if (change.length > MAX_MESSAGE_LENGTH) {
      flush();
      // Один необычно длинный текст тоже ограничиваем. Не разрываем пару UTF-16.
      for (let start = 0; start < change.length;) {
        let end = Math.min(start + MAX_MESSAGE_LENGTH, change.length);
        if (end < change.length && /[\uD800-\uDBFF]/.test(change[end - 1])) {
          end -= 1;
        }
        messages.push(change.slice(start, end));
        start = end;
      }
      continue;
    }

    const next = current ? `${current}\n\n${change}` : change;
    if (next.length > MAX_MESSAGE_LENGTH) {
      flush();
      current = change;
    } else {
      current = next;
    }
  }

  flush();
  return messages;
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
  failedMessages: number;
}

/** Ставит сначала по одному сообщению от каждого чата, не меняя порядок внутри чата. */
function interleaveByChat<T extends { chatId: number }>(messages: T[]): T[] {
  const groups = new Map<number, T[]>();
  for (const message of messages) {
    const group = groups.get(message.chatId) ?? [];
    group.push(message);
    groups.set(message.chatId, group);
  }

  const result: T[] = [];
  const positions = new Map<number, number>();
  let remaining = true;
  while (remaining) {
    remaining = false;
    for (const [chatId, group] of groups) {
      const position = positions.get(chatId) ?? 0;
      if (position >= group.length) {
        continue;
      }
      result.push(group[position]);
      positions.set(chatId, position + 1);
      remaining = true;
    }
  }
  return result;
}

/** Отправляет ранее сохранённые сообщения. Неотправленные остаются в хранилище. */
async function deliverPendingMessages(store: SubscriptionStore, groupId: string): Promise<{ sent: number; failed: number }> {
  const pending = interleaveByChat(await store.listPendingMessages(groupId));
  let sent = 0;
  let failed = 0;

  for (let start = 0; start < pending.length; start += MAX_MESSAGES_PER_BATCH) {
    const batch = pending.slice(start, start + MAX_MESSAGES_PER_BATCH);
    const outcomes = await Promise.allSettled(batch.map(async (message) => {
      await queueMessage(message.chatId, message.text);
      await store.ackPendingMessage(message.id);
    }));

    outcomes.forEach((outcome, index) => {
      if (outcome.status === 'fulfilled') {
        sent += 1;
        return;
      }

      failed += 1;
      const reason = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      console.error(`[уведомления] Не отправилось в чат ${batch[index].chatId}: ${reason}`);
    });
  }

  return { sent, failed };
}

const groupRuns = new Map<string, Promise<WatchResult>>();

/**
 * Сверяет журнал одной группы с прошлым снимком и рассылает уведомления.
 *
 * Первый проход, когда прошлого снимка ещё нет, только запоминает состояние:
 * иначе подписчику прилетели бы разом все оценки за семестр.
 */
async function watchGroupOnce(groupId: string, groupName: string, data: JournalData): Promise<WatchResult> {
  const store = getSubscriptionStore();
  const current = buildSnapshot(data);
  const previous = await store.readSnapshot(groupId);

  if (!previous) {
    await store.writeSnapshot(groupId, current);
    const delivered = await deliverPendingMessages(store, groupId);
    return { groupId, groupName, baseline: true, changes: 0, messages: delivered.sent, failedMessages: delivered.failed };
  }

  const studentNames = new Map(data.students.map((student) => [student.id, student.name]));
  const changes = diffSnapshots(previous, current, studentNames);

  if (!changes.length) {
    const delivered = await deliverPendingMessages(store, groupId);
    return { groupId, groupName, baseline: false, changes: 0, messages: delivered.sent, failedMessages: delivered.failed };
  }

  const subscriptions = await store.listByGroup(groupId);
  const changesByChat = new Map<number, string[]>();

  for (const change of changes) {
    const text = describeChange(change);
    if (!text) {
      continue;
    }

    for (const subscription of subscriptions) {
      if (!matchesSubscription(subscription, change)) {
        continue;
      }

      const chatChanges = changesByChat.get(subscription.chatId) ?? [];
      chatChanges.push(text);
      changesByChat.set(subscription.chatId, chatChanges);
    }
  }

  const texts = interleaveByChat([...changesByChat].flatMap(([chatId, chatChanges]) =>
    packChatMessages(chatChanges).map((text) => ({ chatId, text })),
  ));
  // Постановка и снимок атомарны: случайный ID позволяет сохранить отдельными
  // событиями одинаковые переходы A→B, если первое ещё ждёт отправки.
  const batchId = randomUUID();
  const staged: PendingMessage[] = texts.map(({ chatId, text }, index) => ({
    id: `${batchId}:${String(index).padStart(6, '0')}`,
    chatId,
    text,
  }));

  // Сообщения и снимок записываются одной транзакцией: после перезапуска
  // неподтверждённые сообщения остаются, а уже подтверждённые не повторяются.
  await store.stageNotificationsAndSnapshot(groupId, current, staged);
  const delivered = await deliverPendingMessages(store, groupId);

  return { groupId, groupName, baseline: false, changes: changes.length, messages: delivered.sent, failedMessages: delivered.failed };
}

export function watchGroup(groupId: string, groupName: string, data: JournalData): Promise<WatchResult> {
  const previousRun = groupRuns.get(groupId);
  const run = (previousRun ?? Promise.resolve()).catch(() => undefined)
    .then(() => watchGroupOnce(groupId, groupName, data));
  groupRuns.set(groupId, run);
  void run.finally(() => {
    if (groupRuns.get(groupId) === run) {
      groupRuns.delete(groupId);
    }
  }).catch(() => undefined);
  return run;
}

/** Ручной полный проход; планировщик проверяет группы по мере обновления. */
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
