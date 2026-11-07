import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSnapshot, lastGradeWatchRun, looksRestructured, movedMarks, runGradeWatch, watchGroup } from '@/lib/grade-watch';
import type { JournalChange } from '@/lib/notify-messages';
import { setSubscriptionStoreForTests, type MarksSnapshot, type Subscription, type SubscriptionStore } from '@/lib/subscriptions';
import type { JournalData, StudentRecord } from '@/lib/types';
import { setWidgetSettingsStoreForTests, type WidgetSettingsStore } from '@/lib/widget-settings';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  widget: vi.fn(),
  groups: vi.fn(),
  data: vi.fn(),
}));

vi.mock('@/lib/telegram', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/telegram')>()),
  sendMessage: mocks.send,
  sendWidget: mocks.widget,
}));

vi.mock('@/lib/journal', () => ({
  getJournalGroups: mocks.groups,
  getJournalDataByPath: mocks.data,
}));

const ORIGINAL_WIDGETS = process.env.TELEGRAM_WIDGETS;

class MemorySettings implements WidgetSettingsStore {
  async get() { return null; }
  async set() { /* не нужно */ }
}

/** Хранилище с журналом отправленных, как у настоящей базы. */
class Store implements SubscriptionStore {
  snapshots = new Map<string, MarksSnapshot>();
  delivered = new Set<string>();
  claimFails = false;
  constructor(public subscriptions: Subscription[]) {}
  async listByGroup(groupId: string) { return this.subscriptions.filter((item) => item.groupId === groupId); }
  async listByChat(chatId: number) { return this.subscriptions.filter((item) => item.chatId === chatId); }
  async save() { /* не нужно */ }
  async remove() { /* не нужно */ }
  async readSnapshot(groupId: string) { return this.snapshots.get(groupId) ?? null; }
  async writeSnapshot(groupId: string, marks: MarksSnapshot) { this.snapshots.set(groupId, marks); }
  async claimNotification(chatId: number, fingerprint: string) {
    if (this.claimFails) throw new Error('база недоступна');
    const key = `${chatId}|${fingerprint}`;
    if (this.delivered.has(key)) return false;
    this.delivered.add(key);
    return true;
  }
}

const NAMES = ['Абрамов Пётр Ильич', 'Волкова Мария Ивановна', 'Гусев Артём Олегович', 'Данилова Ксения Сергеевна'];

/** marks[студент] — отметки по датам 1–6 сентября по «Математике». */
function journal(marks: string[][], names = NAMES): JournalData {
  const students: StudentRecord[] = names.map((name, index) => ({
    id: index + 1,
    name,
    overallAverage: 4,
    totalAbsences: { valid: 0, invalid: 0 },
    subjects: [{
      sheetName: 'Математика',
      subjectName: 'Математика',
      teacherName: null,
      average: 4,
      absences: { valid: 0, invalid: 0 },
      grades: (marks[index] ?? []).map((value, day) => ({ column: `C${day}`, monthLabel: 'сен', dayLabel: String(day + 1), label: `${day + 1} сен`, value })),
      lessonTopics: [],
    }],
  }));
  return {
    groupName: 'ИСиП-25/9', source: 'local', sourceDetails: '', updatedAt: '', studentCount: students.length, subjectCount: 1,
    subjects: [{ sheetName: 'Математика', subjectName: 'Математика', teacherName: null }], students, reportCards: [],
  };
}

const subscription: Subscription = { chatId: 42, groupId: 'g1', studentId: 1, studentName: NAMES[0], subjects: [] };
const before = [['5', '4', '', '', '', ''], ['4', '4', '3', '', '', ''], ['5', '5', '', '', '', ''], ['3', '', '', '', '', '']];
const withNewFive = [['5', '4', '5', '', '', ''], ...before.slice(1)];

let store: Store;

beforeEach(() => {
  process.env.TELEGRAM_WIDGETS = 'on';
  setWidgetSettingsStoreForTests(new MemorySettings());
  store = new Store([subscription]);
  store.snapshots.set('g1', buildSnapshot(journal(before)));
  setSubscriptionStoreForTests(store);
  mocks.send.mockReset().mockResolvedValue(undefined);
  mocks.widget.mockReset().mockResolvedValue('sent');
});

afterEach(() => {
  setWidgetSettingsStoreForTests(null);
  setSubscriptionStoreForTests(null);
  process.env.TELEGRAM_WIDGETS = ORIGINAL_WIDGETS;
});

const deliveries = () => mocks.widget.mock.calls.length + mocks.send.mock.calls.length;

describe('уведомления не повторяются', () => {
  it('если Яндекс отдал старую копию, а потом снова новую, оценку не присылают второй раз', async () => {
    expect((await watchGroup('g1', 'ИСиП-25/9', journal(withNewFive))).messages).toBe(1);
    // Старая копия: пятёрки «нет» — об этом не пишем.
    expect((await watchGroup('g1', 'ИСиП-25/9', journal(before))).messages).toBe(0);
    // Новая копия снова: та же пятёрка уже доставлена.
    const again = await watchGroup('g1', 'ИСиП-25/9', journal(withNewFive));
    expect(again.messages).toBe(0);
    expect(again.duplicates).toBe(1);
    expect(deliveries()).toBe(1);
  });

  it('два одновременных прохода сверяются одним, а не рассылают дважды', async () => {
    mocks.groups.mockResolvedValue([{ id: 'g1', groupName: 'ИСиП-25/9', fileName: 'a.xlsx', filePath: '/a', source: 'local', sourceDetails: '' }]);
    let release: () => void = () => undefined;
    mocks.data.mockImplementation(() => new Promise((resolve) => { release = () => resolve(journal(withNewFive)); }));

    const first = runGradeWatch();
    const second = runGradeWatch();
    expect(second).toBe(first);
    await vi.waitFor(() => expect(mocks.data).toHaveBeenCalledTimes(1));
    release();
    await Promise.all([first, second]);

    expect(deliveries()).toBe(1);
    expect(lastGradeWatchRun()?.results[0]).toMatchObject({ groupId: 'g1', messages: 1 });
  });

  it('вставленная строка сдвигает всех — это перестройка, а не новые оценки', async () => {
    // Снимок с отпечатком списка студентов, как после любого прохода.
    store.snapshots.clear();
    await watchGroup('g1', 'ИСиП-25/9', journal(before));
    const shifted = journal([['4', '5', '', '', '', ''], ...before], ['Новиков Олег Петрович', ...NAMES]);

    const result = await watchGroup('g1', 'ИСиП-25/9', shifted);

    expect(result.restructured).toBe(true);
    expect(deliveries()).toBe(0);
    // Следующая настоящая оценка после перестройки приходит как обычно.
    const next = journal([['4', '5', '5', '', '', ''], ...before], ['Новиков Олег Петрович', ...NAMES]);
    expect((await watchGroup('g1', 'ИСиП-25/9', next)).messages).toBe(1);
  });

  it('поправленная дата занятия не превращает отметку в новую', async () => {
    const changes: JournalChange[] = [
      { studentId: 1, studentName: NAMES[0], subject: 'Математика', columnLabel: '2 сен', before: '4', after: '' },
      { studentId: 1, studentName: NAMES[0], subject: 'Математика', columnLabel: '3 сен', before: '', after: '4' },
      { studentId: 1, studentName: NAMES[0], subject: 'Математика', columnLabel: '4 сен', before: '', after: '5' },
    ];
    expect([...movedMarks(changes)].map((change) => change.columnLabel)).toEqual(['3 сен']);

    const relabelled = [['5', '', '4', '', '', ''], ...before.slice(1)];
    const result = await watchGroup('g1', 'ИСиП-25/9', journal(relabelled));
    expect(result.moved).toBe(1);
    expect(deliveries()).toBe(0);
  });

  it('обычное добавление оценок перестройкой не считается, а сдвиг столбцов — считается', () => {
    const previous = buildSnapshot(journal(before));
    const fresh: JournalChange[] = Array.from({ length: 40 }, (_, index) => ({
      studentId: 1, studentName: NAMES[0], subject: 'Математика', columnLabel: `${index + 7} сен`, before: '', after: '5',
    }));
    expect(looksRestructured(previous, fresh)).toBe(false);

    const big: MarksSnapshot = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [JSON.stringify([1, 'Математика', `${index}`]), '5']));
    const shiftedDates: JournalChange[] = Array.from({ length: 30 }, (_, index) => ({
      studentId: 1, studentName: NAMES[0], subject: 'Математика', columnLabel: `${index}`, before: '5', after: '4',
    }));
    expect(looksRestructured(big, shiftedDates)).toBe(true);
  });

  it('старый снимок без отпечатка списка получает его без рассылки', async () => {
    expect((await watchGroup('g1', 'ИСиП-25/9', journal(before))).messages).toBe(0);
    expect(store.snapshots.get('g1')?.__roster__).toBeTruthy();
  });

  it('без ответа Telegram на карточку текст вдогонку не отправляется', async () => {
    mocks.widget.mockResolvedValue('unknown');

    expect((await watchGroup('g1', 'ИСиП-25/9', journal(withNewFive))).messages).toBe(1);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('если база с отправленными недоступна, уведомление всё равно уходит', async () => {
    store.claimFails = true;

    expect((await watchGroup('g1', 'ИСиП-25/9', journal(withNewFive))).messages).toBe(1);
    expect(deliveries()).toBe(1);
  });
});
