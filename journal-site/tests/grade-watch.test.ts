import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSnapshot, diffSnapshots, matchesSubscription, resetMessageQueueForTests, watchGroup } from '@/lib/grade-watch';
import { describeChange } from '@/lib/notify-messages';
import {
  setSubscriptionStoreForTests,
  type MarksSnapshot,
  type PendingMessage,
  type Subscription,
  type SubscriptionStore,
} from '@/lib/subscriptions';
import { TelegramApiError } from '@/lib/telegram';
import type { GradeEntry, JournalData, StudentRecord } from '@/lib/types';

const sent: { chatId: number; text: string }[] = [];
const sendMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/telegram', async () => {
  const actual = await vi.importActual<typeof import('@/lib/telegram')>('@/lib/telegram');
  return {
    ...actual,
    sendMessage: (chatId: number, text: string) => sendMock(chatId, text),
  };
});

/** Простое хранилище в памяти: подписки задаём заранее, снимок наблюдаем. */
class FakeStore implements SubscriptionStore {
  snapshots = new Map<string, MarksSnapshot>();
  pending = new Map<string, { groupId: string; message: PendingMessage }>();

  constructor(public subscriptions: Subscription[] = []) {}

  async listByGroup(groupId: string) {
    return this.subscriptions.filter((item) => item.groupId === groupId);
  }
  async listByChat(chatId: number) {
    return this.subscriptions.filter((item) => item.chatId === chatId);
  }
  async save(subscription: Subscription) {
    this.subscriptions = this.subscriptions.filter(
      (item) =>
        !(item.chatId === subscription.chatId && item.groupId === subscription.groupId && item.studentId === subscription.studentId),
    );
    this.subscriptions.push(subscription);
  }
  async remove(chatId: number, groupId: string, studentId: number) {
    this.subscriptions = this.subscriptions.filter(
      (item) => !(item.chatId === chatId && item.groupId === groupId && item.studentId === studentId),
    );
  }
  async readSnapshot(groupId: string) {
    return this.snapshots.get(groupId) ?? null;
  }
  async writeSnapshot(groupId: string, marks: MarksSnapshot) {
    this.snapshots.set(groupId, marks);
  }
  async stageNotificationsAndSnapshot(groupId: string, marks: MarksSnapshot, messages: PendingMessage[]) {
    for (const message of messages) {
      if (!this.pending.has(message.id)) {
        this.pending.set(message.id, { groupId, message });
      }
    }
    this.snapshots.set(groupId, marks);
  }
  async listPendingMessages(groupId: string) {
    return [...this.pending.values()]
      .filter((item) => item.groupId === groupId)
      .map((item) => item.message);
  }
  async ackPendingMessage(id: string) {
    this.pending.delete(id);
  }
}

function grade(label: string, value: string): GradeEntry {
  return { column: 'C', monthLabel: 'сен', dayLabel: label, label, value };
}

function student(id: number, name: string, grades: GradeEntry[], subjectName = 'Алгебра'): StudentRecord {
  return {
    id,
    name,
    overallAverage: null,
    totalAbsences: { valid: 0, invalid: 0 },
    subjects: [
      {
        sheetName: subjectName,
        subjectName,
        teacherName: null,
        average: null,
        absences: { valid: 0, invalid: 0 },
        grades,
        lessonTopics: [],
      },
    ],
  };
}

function journal(students: StudentRecord[], subjectName = 'Алгебра'): JournalData {
  return {
    groupName: 'ИСиП-24-1',
    source: 'local',
    sourceDetails: 'тест',
    updatedAt: new Date().toISOString(),
    studentCount: students.length,
    subjectCount: 1,
    subjects: [{ sheetName: subjectName, subjectName, teacherName: null }],
    students,
    reportCards: [],
  };
}

describe('уведомления об оценках', () => {
  let store: FakeStore;

  beforeEach(() => {
    sent.length = 0;
    sendMock.mockReset();
    sendMock.mockImplementation(async (chatId: number, text: string) => {
      sent.push({ chatId, text });
    });
    store = new FakeStore();
    setSubscriptionStoreForTests(store);
  });

  afterEach(() => {
    resetMessageQueueForTests();
    setSubscriptionStoreForTests(null);
  });

  it('первый проход только запоминает журнал и никому не пишет', async () => {
    store.subscriptions = [
      { chatId: 1, groupId: 'g1', studentId: 1, studentName: 'Иванов Иван', subjects: [] },
    ];

    const data = journal([student(1, 'Иванов Иван', [grade('3 сен', '5')])]);
    const result = await watchGroup('g1', 'ИСиП-24-1', data);

    expect(result.baseline).toBe(true);
    expect(sent).toHaveLength(0);
    expect(store.snapshots.get('g1')).toBeTruthy();
  });

  it('новая оценка доходит до подписчика', async () => {
    store.subscriptions = [
      { chatId: 77, groupId: 'g1', studentId: 1, studentName: 'Иванов Иван', subjects: [] },
    ];

    await watchGroup('g1', 'ИСиП-24-1', journal([student(1, 'Иванов Иван', [])]));
    const result = await watchGroup(
      'g1',
      'ИСиП-24-1',
      journal([student(1, 'Иванов Иван', [grade('3 сен', '5')])]),
    );

    expect(result.messages).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].chatId).toBe(77);
    expect(sent[0].text).toContain('5 по «Алгебра»');
  });

  it('чужие оценки подписчику не приходят', async () => {
    store.subscriptions = [
      { chatId: 77, groupId: 'g1', studentId: 1, studentName: 'Иванов Иван', subjects: [] },
    ];

    await watchGroup('g1', 'ИСиП-24-1', journal([student(1, 'Иванов Иван', []), student(2, 'Петров Пётр', [])]));
    await watchGroup(
      'g1',
      'ИСиП-24-1',
      journal([student(1, 'Иванов Иван', []), student(2, 'Петров Пётр', [grade('3 сен', '2')])]),
    );

    expect(sent).toHaveLength(0);
  });

  it('подписка на один предмет отсекает остальные', () => {
    const subscription: Subscription = {
      chatId: 1,
      groupId: 'g1',
      studentId: 1,
      studentName: 'Иванов Иван',
      subjects: ['Физика'],
    };

    const base = { studentId: 1, studentName: 'Иванов Иван', columnLabel: '3 сен', before: '', after: '5' };

    expect(matchesSubscription(subscription, { ...base, subject: 'Физика' })).toBe(true);
    expect(matchesSubscription(subscription, { ...base, subject: 'Алгебра' })).toBe(false);
  });

  it('одно и то же изменение не приходит дважды', async () => {
    store.subscriptions = [
      { chatId: 77, groupId: 'g1', studentId: 1, studentName: 'Иванов Иван', subjects: [] },
    ];

    await watchGroup('g1', 'ИСиП-24-1', journal([student(1, 'Иванов Иван', [])]));
    const withGrade = journal([student(1, 'Иванов Иван', [grade('3 сен', '4')])]);

    await watchGroup('g1', 'ИСиП-24-1', withGrade);
    await watchGroup('g1', 'ИСиП-24-1', withGrade);

    expect(sent).toHaveLength(1);
  });

  it('разным чатам отправляет параллельно, но не больше четырёх за раз', async () => {
    store.subscriptions = Array.from({ length: 6 }, (_, index) => ({
      chatId: index + 1,
      groupId: 'g1',
      studentId: 1,
      studentName: 'Иванов Иван',
      subjects: [],
    }));
    await watchGroup('g1', 'ИСиП-24-1', journal([student(1, 'Иванов Иван', [])]));

    let active = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    sendMock.mockImplementation(() => {
      active += 1;
      peak = Math.max(peak, active);
      return new Promise<void>((resolve) => {
        release.push(() => {
          active -= 1;
          resolve();
        });
      });
    });

    const run = watchGroup('g1', 'ИСиП-24-1', journal([student(1, 'Иванов Иван', [grade('3 сен', '5')])]));
    await vi.waitFor(() => expect(release).toHaveLength(4));
    expect(peak).toBe(4);

    release.splice(0, 4).forEach((finish) => finish());
    await vi.waitFor(() => expect(release).toHaveLength(2));
    release.splice(0).forEach((finish) => finish());

    const result = await run;
    expect(result.messages).toBe(6);
    expect(result.failedMessages).toBe(0);
    expect(peak).toBe(4);
  });

  it('ограничивает общую частоту запросов к Telegram', async () => {
    store.subscriptions = Array.from({ length: 10 }, (_, index) => ({
      chatId: index + 1,
      groupId: 'g1',
      studentId: 1,
      studentName: 'Иванов Иван',
      subjects: [],
    }));
    await watchGroup('g1', 'ИСиП-24-1', journal([student(1, 'Иванов Иван', [])]));

    const startedAt: number[] = [];
    sendMock.mockImplementation(async () => {
      startedAt.push(Date.now());
    });
    const result = await watchGroup('g1', 'ИСиП-24-1', journal([student(1, 'Иванов Иван', [grade('3 сен', '5')])]));

    expect(result.messages).toBe(10);
    expect(startedAt).toHaveLength(10);
    expect(startedAt[9] - startedAt[0]).toBeGreaterThanOrEqual(300);
  });

  it('объединяет изменения одного чата по порядку, пока отправляет другим', async () => {
    store.subscriptions = [1, 2].map((chatId) => ({
      chatId,
      groupId: 'g1',
      studentId: 1,
      studentName: 'Иванов Иван',
      subjects: [],
    }));
    await watchGroup('g1', 'ИСиП-24-1', journal([student(1, 'Иванов Иван', [])]));

    const started: Array<{ chatId: number; text: string }> = [];
    const releaseFirstChat: Array<() => void> = [];
    sendMock.mockImplementation((chatId: number, text: string) => {
      started.push({ chatId, text });
      if (chatId === 2) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => releaseFirstChat.push(resolve));
    });

    const data = journal([student(1, 'Иванов Иван', [
      grade('3 сен', '5'), grade('5 сен', '4'), grade('7 сен', '3'),
    ])]);
    const run = watchGroup('g1', 'ИСиП-24-1', data);

    await vi.waitFor(() => expect(started.filter((item) => item.chatId === 2)).toHaveLength(1));
    expect(started.filter((item) => item.chatId === 1)).toHaveLength(1);

    releaseFirstChat.shift()?.();
    expect((await run).messages).toBe(2);
    const firstChatText = started.find((item) => item.chatId === 1)!.text;
    expect(firstChatText.indexOf('5 по «Алгебра»')).toBeLessThan(firstChatText.indexOf('4 по «Алгебра»'));
    expect(firstChatText.indexOf('4 по «Алгебра»')).toBeLessThan(firstChatText.indexOf('3 по «Алгебра»'));
  });

  it('не отправляет сообщения одному чату одновременно из разных групп', async () => {
    store.subscriptions = ['g1', 'g2'].map((groupId) => ({
      chatId: 77,
      groupId,
      studentId: 1,
      studentName: 'Иванов Иван',
      subjects: [],
    }));
    await watchGroup('g1', 'Группа 1', journal([student(1, 'Иванов Иван', [])]));
    await watchGroup('g2', 'Группа 2', journal([student(1, 'Иванов Иван', [])]));

    const release: Array<() => void> = [];
    sendMock.mockImplementation(() => new Promise<void>((resolve) => release.push(resolve)));

    const first = watchGroup('g1', 'Группа 1', journal([student(1, 'Иванов Иван', [grade('3 сен', '5')])]));
    await vi.waitFor(() => expect(release).toHaveLength(1), { timeout: 3_000 });
    const second = watchGroup('g2', 'Группа 2', journal([student(1, 'Иванов Иван', [grade('3 сен', '4')])]));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(release).toHaveLength(1);
    release.shift()?.();
    await vi.waitFor(() => expect(release).toHaveLength(1), { timeout: 3_000 });
    release.shift()?.();

    expect((await first).messages).toBe(1);
    expect((await second).messages).toBe(1);
  });

  it('выдерживает секунду между сообщениями одному чату из разных групп, не задерживая другой чат', async () => {
    store.subscriptions = [
      { chatId: 1, groupId: 'g1', studentId: 1, studentName: 'Иванов Иван', subjects: [] },
      { chatId: 1, groupId: 'g2', studentId: 1, studentName: 'Иванов Иван', subjects: [] },
      { chatId: 2, groupId: 'g2', studentId: 1, studentName: 'Иванов Иван', subjects: [] },
    ];
    await watchGroup('g1', 'Группа 1', journal([student(1, 'Иванов Иван', [])]));
    await watchGroup('g2', 'Группа 2', journal([student(1, 'Иванов Иван', [])]));

    const started: Array<{ chatId: number; at: number }> = [];
    sendMock.mockImplementation(async (chatId: number) => {
      started.push({ chatId, at: Date.now() });
    });

    const first = watchGroup('g1', 'Группа 1', journal([student(1, 'Иванов Иван', [grade('3 сен', '5')])]));
    await vi.waitFor(() => expect(started.filter((item) => item.chatId === 1)).toHaveLength(1));
    const second = watchGroup('g2', 'Группа 2', journal([student(1, 'Иванов Иван', [grade('3 сен', '4')])]));
    await vi.waitFor(() => expect(started.filter((item) => item.chatId === 2)).toHaveLength(1));
    expect(started.filter((item) => item.chatId === 1)).toHaveLength(1);

    expect((await first).messages).toBe(1);
    expect((await second).messages).toBe(2);
    const firstChat = started.filter((item) => item.chatId === 1);
    expect(firstChat[1].at - firstChat[0].at).toBeGreaterThanOrEqual(900);
    expect(started.find((item) => item.chatId === 2)!.at - firstChat[0].at).toBeLessThan(900);
  });

  it('обрабатывает больше шестидесяти уведомлений без потери хвоста', async () => {
    store.subscriptions = Array.from({ length: 61 }, (_, index) => ({
      chatId: index + 1,
      groupId: 'g1',
      studentId: 1,
      studentName: 'Иванов Иван',
      subjects: [],
    }));
    await watchGroup('g1', 'ИСиП-24-1', journal([student(1, 'Иванов Иван', [])]));

    const result = await watchGroup('g1', 'ИСиП-24-1', journal([student(1, 'Иванов Иван', [grade('3 сен', '5')])]));

    expect(result.messages).toBe(61);
    expect(result.failedMessages).toBe(0);
    expect(sendMock).toHaveBeenCalledTimes(61);
  });

  it('отправляет шестьдесят новых оценок одному чату одним сообщением', async () => {
    store.subscriptions = [
      { chatId: 77, groupId: 'g1', studentId: 1, studentName: 'Иванов Иван', subjects: [] },
    ];
    await watchGroup('g1', 'ИСиП-24-1', journal([student(1, 'Иванов Иван', [])]));

    const grades = Array.from({ length: 60 }, (_, index) => grade(`${index + 1} сен`, '5'));
    const result = await watchGroup('g1', 'ИСиП-24-1', journal([student(1, 'Иванов Иван', grades)]));
    const expected = grades.map((item) => describeChange({
      studentId: 1,
      studentName: 'Иванов Иван',
      subject: 'Алгебра',
      columnLabel: item.label,
      before: '',
      after: item.value,
    }));

    expect(result.changes).toBe(60);
    expect(result.messages).toBe(1);
    expect(sent).toEqual([{ chatId: 77, text: expected.join('\n\n') }]);
    expect(sent[0].text.length).toBeLessThanOrEqual(3_500);
  });

  it('разбивает длинную пачку одного чата на сообщения до 3500 символов без потерь', async () => {
    store.subscriptions = [
      { chatId: 77, groupId: 'g1', studentId: 1, studentName: 'Иванов Иван', subjects: [] },
    ];
    await watchGroup('g1', 'ИСиП-24-1', journal([student(1, 'Иванов Иван', [])]));

    const grades = Array.from({ length: 160 }, (_, index) => grade(`${index + 1} сен`, '5'));
    const result = await watchGroup('g1', 'ИСиП-24-1', journal([student(1, 'Иванов Иван', grades)]));
    const expected = grades.map((item) => describeChange({
      studentId: 1,
      studentName: 'Иванов Иван',
      subject: 'Алгебра',
      columnLabel: item.label,
      before: '',
      after: item.value,
    }));

    expect(result.changes).toBe(160);
    expect(result.messages).toBeGreaterThan(1);
    expect(result.messages).toBeLessThan(160);
    expect(sent.every((item) => item.text.length <= 3_500)).toBe(true);
    expect(sent.flatMap((item) => item.text.split('\n\n'))).toEqual(expected);
  });

  it('сохраняет неотправленное сообщение и повторяет его при следующей проверке', async () => {
    store.subscriptions = [
      { chatId: 77, groupId: 'g1', studentId: 1, studentName: 'Иванов Иван', subjects: [] },
    ];
    await watchGroup('g1', 'ИСиП-24-1', journal([student(1, 'Иванов Иван', [])]));
    sendMock.mockRejectedValue(new Error('Telegram sendMessage: Forbidden'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const data = journal([student(1, 'Иванов Иван', [grade('3 сен', '5')])]);

    const result = await watchGroup('g1', 'ИСиП-24-1', data);
    expect(result.messages).toBe(0);
    expect(result.failedMessages).toBe(1);
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('Telegram sendMessage: Forbidden'));
    expect(store.snapshots.get('g1')).toEqual(buildSnapshot(data));
    expect(store.pending.size).toBe(1);

    sendMock.mockResolvedValue(undefined);
    const retried = await watchGroup('g1', 'ИСиП-24-1', data);
    expect(retried.changes).toBe(0);
    expect(retried.messages).toBe(1);
    expect(retried.failedMessages).toBe(0);
    expect(store.pending.size).toBe(0);
    expect(sendMock).toHaveBeenCalledTimes(2);
    errorLog.mockRestore();
  });

  it('не повторяет успешную доставку соседнему чату при ошибке другого', async () => {
    store.subscriptions = [77, 88].map((chatId) => ({
      chatId,
      groupId: 'g1',
      studentId: 1,
      studentName: 'Иванов Иван',
      subjects: [],
    }));
    await watchGroup('g1', 'ИСиП-24-1', journal([student(1, 'Иванов Иван', [])]));
    sendMock.mockImplementation((chatId: number) => chatId === 77
      ? Promise.reject(new Error('connection reset'))
      : Promise.resolve());
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const data = journal([student(1, 'Иванов Иван', [grade('3 сен', '5')])]);

    const first = await watchGroup('g1', 'ИСиП-24-1', data);
    expect(first.messages).toBe(1);
    expect(first.failedMessages).toBe(1);
    expect(store.pending.size).toBe(1);

    sendMock.mockResolvedValue(undefined);
    const retry = await watchGroup('g1', 'ИСиП-24-1', data);
    expect(retry.changes).toBe(0);
    expect(retry.messages).toBe(1);
    expect(store.pending.size).toBe(0);
    expect(sendMock.mock.calls.filter(([chatId]) => chatId === 88)).toHaveLength(1);
    errorLog.mockRestore();
  });

  it('хранит два одинаковых перехода оценки как отдельные ожидающие события', async () => {
    store.subscriptions = [
      { chatId: 77, groupId: 'g1', studentId: 1, studentName: 'Иванов Иван', subjects: [] },
    ];
    const withoutGrade = journal([student(1, 'Иванов Иван', [])]);
    const withGrade = journal([student(1, 'Иванов Иван', [grade('3 сен', '5')])]);
    await watchGroup('g1', 'ИСиП-24-1', withoutGrade);
    sendMock.mockRejectedValue(new Error('connection reset'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await watchGroup('g1', 'ИСиП-24-1', withGrade);
    await watchGroup('g1', 'ИСиП-24-1', withoutGrade);
    await watchGroup('g1', 'ИСиП-24-1', withGrade);
    expect(store.pending.size).toBe(2);

    sendMock.mockResolvedValue(undefined);
    const retry = await watchGroup('g1', 'ИСиП-24-1', withGrade);
    expect(retry.changes).toBe(0);
    expect(retry.messages).toBe(2);
    expect(store.pending.size).toBe(0);
    errorLog.mockRestore();
  }, 15_000);

  it('повторяет явный 429 с retry_after и не задерживает другой чат', async () => {
    store.subscriptions = [77, 88].map((chatId) => ({
      chatId,
      groupId: 'g1',
      studentId: 1,
      studentName: 'Иванов Иван',
      subjects: [],
    }));
    await watchGroup('g1', 'ИСиП-24-1', journal([student(1, 'Иванов Иван', [])]));
    const started: Array<{ chatId: number; at: number }> = [];
    sendMock.mockImplementation((chatId: number) => {
      started.push({ chatId, at: Date.now() });
      if (chatId === 77 && started.filter((item) => item.chatId === 77).length === 1) {
        return Promise.reject(new TelegramApiError('sendMessage', 429, 'Too Many Requests', 1));
      }
      return Promise.resolve();
    });

    const result = await watchGroup('g1', 'ИСиП-24-1', journal([student(1, 'Иванов Иван', [grade('3 сен', '5')])]));
    expect(result.messages).toBe(2);
    expect(result.failedMessages).toBe(0);
    expect(store.pending.size).toBe(0);
    const firstChat = started.filter((item) => item.chatId === 77);
    expect(firstChat).toHaveLength(2);
    expect(firstChat[1].at - firstChat[0].at).toBeGreaterThanOrEqual(900);
    expect(started.find((item) => item.chatId === 88)!.at - firstChat[0].at).toBeLessThan(900);
  });

  it('снимок собирает только заполненные клетки', () => {
    const data = journal([student(1, 'Иванов Иван', [grade('3 сен', '5'), grade('5 сен', '   ')])]);
    expect(Object.keys(buildSnapshot(data))).toHaveLength(1);
  });

  it('разбор ключа переживает предмет со спецсимволами', () => {
    const subjectName = 'Физ-ра «А» | 1/2';
    const data = journal([student(1, 'Иванов Иван', [grade('3 сен', '5')], subjectName)], subjectName);

    const changes = diffSnapshots({}, buildSnapshot(data), new Map([[1, 'Иванов Иван']]));

    expect(changes).toHaveLength(1);
    expect(changes[0].subject).toBe(subjectName);
  });
});

describe('тексты уведомлений', () => {
  const base = { studentId: 1, studentName: 'Иванов Иван', subject: 'Алгебра', columnLabel: '3 сен' };

  it.each([
    ['5', '5 по «Алгебра»'],
    ['4', '4 по «Алгебра»'],
    ['3', '3 по «Алгебра»'],
    ['2', '2 по «Алгебра»'],
    ['н', 'н по «Алгебра»'],
  ])('оценка %s описывается словами', (value, expected) => {
    const text = describeChange({ ...base, before: '', after: value });
    expect(text).toContain(expected);
    expect(text!.length).toBeGreaterThan(expected.length + 3);
  });

  it('отработанный пропуск отмечается отдельно', () => {
    const text = describeChange({ ...base, before: 'н', after: '' });
    expect(text).toContain('Отработал');
  });

  it('исправленная оценка отмечается отдельно', () => {
    const text = describeChange({ ...base, before: '2', after: '5' });
    expect(text).toContain('Исправил');
  });

  it('стёртая оценка поводом для сообщения не становится', () => {
    expect(describeChange({ ...base, before: '5', after: '' })).toBeNull();
  });

  it('один и тот же случай всегда даёт один и тот же текст', () => {
    const change = { ...base, before: '', after: '5' };
    expect(describeChange(change)).toBe(describeChange(change));
  });
});
