import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSnapshot, diffSnapshots, matchesSubscription, watchGroup } from '@/lib/grade-watch';
import { describeChange } from '@/lib/notify-messages';
import { setSubscriptionStoreForTests, type MarksSnapshot, type Subscription, type SubscriptionStore } from '@/lib/subscriptions';
import type { GradeEntry, JournalData, StudentRecord } from '@/lib/types';

const sent: { chatId: number; text: string }[] = [];

vi.mock('@/lib/telegram', async () => {
  const actual = await vi.importActual<typeof import('@/lib/telegram')>('@/lib/telegram');
  return {
    ...actual,
    sendMessage: async (chatId: number, text: string) => {
      sent.push({ chatId, text });
    },
  };
});

/** Простое хранилище в памяти: подписки задаём заранее, снимок наблюдаем. */
class FakeStore implements SubscriptionStore {
  snapshots = new Map<string, MarksSnapshot>();

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
    store = new FakeStore();
    setSubscriptionStoreForTests(store);
  });

  afterEach(() => {
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
