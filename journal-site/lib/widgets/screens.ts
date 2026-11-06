import type { LectureSubscription } from '@/lib/lecture-subscriptions';
import { classifyMarkValue, type MarkTone } from '@/lib/mark-classifier';
import type { Subscription } from '@/lib/subscriptions';
import { escapeHtml } from '@/lib/telegram';
import { describeSubscription } from '@/lib/telegram-notify-views';
import { shortName, studentDisplayStats, TOPICS_PER_PAGE } from '@/lib/telegram-views';
import type { JournalData, SubjectSummary } from '@/lib/types';

import { screenWidget } from './blocks';
import { countNumericMarks } from './calculator';
import { round2, truncate, type WidgetMessage } from './kit';

const MARK_CLASS: Partial<Record<MarkTone, string>> = {
  excellent: 'c5',
  good: 'c4',
  ok: 'c3',
  bad: 'c2',
  'valid-absence': 'cv',
  'electronic-absence': 'c3',
};

function avgClass(value: number | null): string {
  if (value === null) return 'cn';
  if (value >= 4.5) return 'c5';
  if (value >= 3.5) return 'c4';
  if (value >= 2.5) return 'c3';
  return 'c2';
}

function formatAvg(value: number | null): string {
  return value === null ? '—' : value.toFixed(2).replace('.', ',');
}

function mean(values: Array<number | null>): number | null {
  const numbers = values.filter((value): value is number => value !== null);
  return numbers.length ? round2(numbers.reduce((sum, value) => sum + value, 0) / numbers.length) : null;
}

function plural(count: number, forms: [string, string, string]): string {
  const tens = count % 100;
  const ones = count % 10;
  if (ones === 1 && tens !== 11) return forms[0];
  if (ones >= 2 && ones <= 4 && (tens < 10 || tens >= 20)) return forms[1];
  return forms[2];
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase() || '?';
}

function groupTitle(data: JournalData): string {
  return truncate(data.groupName || 'Группа', 40);
}

/* ------------------------------ журнал ------------------------------ */

export function homeWidget(groupCount: number): WidgetMessage | null {
  return screenWidget(['cards', 'foot'], () => ({
    e: '📖',
    t: 'Электронный журнал',
    s: `${groupCount} ${plural(groupCount, ['группа', 'группы', 'групп'])} колледжа`,
    cd: [
      ['🎓', 'Журналы групп', 'табели, рейтинг, темы занятий'],
      ['🔔', 'Уведомления', 'новая оценка или пропуск — сразу в чат'],
      ['📅', 'Напоминания о лекциях', 'за 10 минут, с таймером до начала'],
    ],
    f: 'Выбери группу кнопкой ниже 👇',
  }), '📖 <b>Электронный журнал</b>\nВыбери группу:');
}

export function groupWidget(data: JournalData): WidgetMessage | null {
  const stats = data.students.map((student) => studentDisplayStats(data, student));
  const groupAvg = mean(stats.map((item) => item.avg));
  const invalid = stats.reduce((sum, item) => sum + item.invalid, 0);
  const valid = stats.reduce((sum, item) => sum + item.valid, 0);
  const band = (min: number, max: number) => stats.filter((item) => item.avg !== null && item.avg >= min && item.avg < max).length;

  return screenWidget(['stats', 'dist', 'foot'], () => ({
    e: '🎓',
    t: groupTitle(data),
    s: 'Сводка группы',
    st: [
      ['студентов', data.studentCount],
      ['предметов', data.subjectCount],
      ['средний балл', groupAvg ?? '—', 'a'],
      ['пропуски Н • НУ', `${invalid} • ${valid}`],
    ],
    dt: 'Студенты по среднему баллу',
    ds: [
      ['от 4,5', band(4.5, 99), 'c5'],
      ['3,5–4,5', band(3.5, 4.5), 'c4'],
      ['2,5–3,5', band(2.5, 3.5), 'c3'],
      ['до 2,5', band(-1, 2.5), 'c2'],
    ],
    f: 'Меню — кнопками ниже 👇',
  }), `🎓 <b>${escapeHtml(groupTitle(data))}</b>\n👥 ${data.studentCount} · 📚 ${data.subjectCount} · средний ${formatAvg(groupAvg)}`);
}

export function studentsWidget(data: JournalData): WidgetMessage | null {
  const sorted = [...data.students].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return screenWidget(['grid', 'foot'], (level) => ({
    e: '👥',
    t: 'Студенты',
    s: `${groupTitle(data)} · ${sorted.length} ${plural(sorted.length, ['человек', 'человека', 'человек'])}`,
    gr: sorted.slice(0, level ? 42 : 60).map((student) => {
      const avg = studentDisplayStats(data, student).avg;
      return [initials(student.name), truncate(shortName(student.name), 28), formatAvg(avg), avgClass(avg)];
    }),
    f: 'Нажми на кружок — покажу балл · табель — кнопкой ниже 👇',
  }), `👥 <b>Студенты — ${escapeHtml(groupTitle(data))}</b>`, { levels: 2 });
}

/** Все отметки студента: по предметам, цветом по отметке, как в журнале. */
export function gradesWidget(data: JournalData, studentId: number): WidgetMessage | null {
  const student = data.students.find((item) => item.id === studentId);
  if (!student) return null;
  const subjects = student.subjects.filter((subject) => subject.grades.some((grade) => grade.value.trim()));

  return screenWidget(['chips'], (level) => ({
    e: '📝',
    t: 'Все оценки',
    s: truncate(student.name, 60),
    cs: subjects.map((subject) => {
      const marks = subject.grades.filter((grade) => grade.value.trim()).map((grade) => classifyMarkValue(grade.value));
      return [
        truncate(subject.subjectName, [60, 40, 28][level]),
        `${marks.length} ${plural(marks.length, ['отметка', 'отметки', 'отметок'])} · средний ${formatAvg(round2(subject.average))}`,
        marks.slice(-[400, 24, 14][level]).map((mark) => [truncate(mark.displayText, 4), MARK_CLASS[mark.tone] ?? 'cn']),
      ];
    }),
    cp: 3,
    ce: 'Записей в журнале пока нет',
  }), `📝 <b>Оценки — ${escapeHtml(truncate(student.name, 80))}</b>`, { levels: 3 });
}

const ABSENCE_KIND: Partial<Record<MarkTone, [string, string]>> = {
  absence: ['Н', 'cn'],
  'valid-absence': ['НУ', 'cv'],
  'electronic-absence': ['ЭН', 'c3'],
};

/** Пропуски по датам: на каждом кружке дата занятия, цвет — вид пропуска. */
export function absencesWidget(data: JournalData, studentId: number): WidgetMessage | null {
  const student = data.students.find((item) => item.id === studentId);
  if (!student) return null;

  const counts: Record<string, number> = { Н: 0, НУ: 0, ЭН: 0 };
  const sections = student.subjects.map((subject) => {
    const entries = subject.grades.flatMap((grade) => {
      const kind = ABSENCE_KIND[classifyMarkValue(grade.value).tone];
      if (!kind) return [];
      counts[kind[0]] += 1;
      return [[truncate(grade.label || grade.column, 8), kind[1]] as [string, string]];
    });
    return { subject, entries };
  }).filter((item) => item.entries.length);
  const none = !sections.length;

  return screenWidget(['stats', 'chips'], (level) => ({
    e: none ? '🎉' : '📅',
    t: 'Пропуски',
    s: truncate(student.name, 60),
    st: [['Н', counts.Н], ['НУ', counts.НУ], ['ЭН', counts.ЭН]],
    cs: sections.map(({ subject, entries }) => [
      truncate(subject.subjectName, [60, 40, 28][level]),
      null,
      entries.slice(-[400, 24, 12][level]),
    ]),
    cp: 4,
    ce: '🎉 Пропусков нет!',
  }), `📅 <b>Пропуски — ${escapeHtml(truncate(student.name, 80))}</b>\nН: ${counts.Н} • НУ: ${counts.НУ} • ЭН: ${counts.ЭН}`, {
    levels: 3,
    confetti: none,
  });
}

function subjectEntries(data: JournalData, sheetName: string): Array<{ name: string; subject: SubjectSummary }> {
  return data.students.flatMap((student) => {
    const subject = student.subjects.find((item) => item.sheetName === sheetName);
    return subject ? [{ name: student.name, subject }] : [];
  });
}

export function subjectsWidget(data: JournalData): WidgetMessage | null {
  const rows = data.subjects.map((meta) => {
    const avg = mean(subjectEntries(data, meta.sheetName).map((item) => item.subject.average));
    return { name: meta.subjectName, avg };
  });

  return screenWidget(['list', 'foot'], (level) => ({
    e: '📚',
    t: 'Предметы',
    s: `${groupTitle(data)} · средний по группе`,
    ls: rows.map((row) => [truncate(row.name, [60, 34][level]), null, formatAvg(row.avg), avgClass(row.avg), row.avg === null ? 0 : row.avg / 5]),
    pg: 8,
    le: 'Предметов пока нет',
    f: 'Подробности — кнопками ниже 👇',
  }), `📚 <b>Предметы — ${escapeHtml(groupTitle(data))}</b>`, { levels: 2 });
}

export function subjectDetailWidget(data: JournalData, subjectIndex: number): WidgetMessage | null {
  const meta = data.subjects[subjectIndex];
  if (!meta) return null;

  const entries = subjectEntries(data, meta.sheetName);
  const avg = mean(entries.map((item) => item.subject.average));
  const invalid = entries.reduce((sum, item) => sum + item.subject.absences.invalid, 0);
  const valid = entries.reduce((sum, item) => sum + item.subject.absences.valid, 0);
  const marks = entries.reduce<[number, number, number, number]>((sum, item) => {
    const counts = countNumericMarks(item.subject.grades);
    return [sum[0] + counts[0], sum[1] + counts[1], sum[2] + counts[2], sum[3] + counts[3]];
  }, [0, 0, 0, 0]);
  const ranked = [...entries].sort((a, b) => (b.subject.average ?? -1) - (a.subject.average ?? -1));

  return screenWidget(['stats', 'dist', 'list'], (level) => ({
    e: '📚',
    t: truncate(meta.subjectName, [70, 40][level]),
    s: meta.teacherName ? truncate(meta.teacherName, 50) : 'Преподаватель не указан',
    st: [['средний по группе', avg ?? '—', 'a'], ['пропуски Н • НУ', `${invalid} • ${valid}`]],
    dt: 'Отметки группы по предмету',
    ds: [['5', marks[0], 'c5'], ['4', marks[1], 'c4'], ['3', marks[2], 'c3'], ['2', marks[3], 'c2'], ['Н', invalid, 'cn']],
    ls: ranked.slice(0, level ? 40 : 80).map((item) => {
      const value = round2(item.subject.average);
      const absences = [item.subject.absences.invalid ? `Н:${item.subject.absences.invalid}` : '', item.subject.absences.valid ? `НУ:${item.subject.absences.valid}` : '']
        .filter(Boolean).join(' ');
      return [truncate(shortName(item.name), 28), absences || null, formatAvg(value), avgClass(value), value === null ? 0 : value / 5];
    }),
    pg: 5,
    le: 'Оценок по предмету пока нет',
  }), `📚 <b>${escapeHtml(truncate(meta.subjectName, 120))}</b>${meta.teacherName ? `\n👨‍🏫 ${escapeHtml(truncate(meta.teacherName, 80))}` : ''}`, { levels: 2 });
}

export function topicsWidget(data: JournalData, subjectIndex: number, page: number): WidgetMessage | null {
  const meta = data.subjects[subjectIndex];
  const subject = meta ? subjectEntries(data, meta.sheetName)[0]?.subject : undefined;
  const topics = subject?.lessonTopics ?? [];
  if (!meta || !topics.length) return null;

  const total = Math.max(1, Math.ceil(topics.length / TOPICS_PER_PAGE));
  const safePage = Math.min(Math.max(page, 0), total - 1);
  const slice = topics.slice(safePage * TOPICS_PER_PAGE, (safePage + 1) * TOPICS_PER_PAGE);

  return screenWidget(['cards'], (level) => ({
    e: '📖',
    t: 'Темы занятий',
    s: `${truncate(meta.subjectName, 50)} · ${safePage + 1}/${total}`,
    cd: slice.map((topic) => [
      truncate(topic.dateLabel, 12),
      truncate(topic.topic, [220, 120][level]),
      topic.extra ? truncate(topic.extra, [140, 70][level]) : null,
    ]),
  }), `📖 <b>Темы — ${escapeHtml(truncate(meta.subjectName, 120))}</b>`, { levels: 2 });
}

/* ------------------------------ уведомления ------------------------------ */

export function notifyMenuWidget(data: JournalData, subscriptions: Subscription[]): WidgetMessage | null {
  const total = data.subjects.length;
  return screenWidget(['cards', 'foot'], (level) => ({
    e: '🔔',
    t: 'Уведомления об оценках',
    s: subscriptions.length ? `Слежу за ${subscriptions.length}` : 'Пока ни за кем не слежу',
    cd: subscriptions.length
      ? subscriptions.slice(0, level ? 6 : 12).map((item) => ['🔔', truncate(item.studentName, 60), truncate(describeSubscription(item, total), 80)])
      : [['👇', 'Найди себя в списке ниже', 'напишу, как только появится оценка или пропуск']],
    f: subscriptions.length ? '⚙️ — настроить · 🔕 — отключить' : '',
  }), '🔔 <b>Уведомления об оценках</b>', { levels: 2 });
}

export function notifyStudentWidget(data: JournalData, studentId: number, subscription: Subscription | null): WidgetMessage | null {
  const student = data.students.find((item) => item.id === studentId);
  if (!student) return null;
  return screenWidget(['cards'], () => ({
    e: '🔔',
    t: truncate(student.name, 60),
    s: subscription ? `Сейчас: ${truncate(describeSubscription(subscription, data.subjects.length), 70)}` : 'Подписки пока нет',
    cd: [
      ['📚', 'Все предметы', 'любая новая оценка или пропуск'],
      ['🎯', 'Выбрать предметы', 'только то, что важно'],
      ...(subscription ? [['🔕', 'Отключить', 'больше не писать'] as [string, string, string]] : []),
    ],
  }), `🔔 <b>${escapeHtml(truncate(student.name, 80))}</b>`);
}

/** Экран галочек: состояние — в кнопках, их бот меняет на месте, карточка остаётся. */
export function notifySubjectsWidget(data: JournalData, studentId: number): WidgetMessage | null {
  const student = data.students.find((item) => item.id === studentId);
  return screenWidget(['cards'], () => ({
    e: '🎯',
    t: 'Выбери предметы',
    s: truncate(student?.name ?? '', 60),
    cd: [
      ['☝️', 'Нажимай на предметы ниже', '✅ — пришлю оценки по этому предмету'],
      ['🔁', 'Передумал — нажми ещё раз', 'сними все галочки, чтобы отписаться'],
    ],
  }), '🎯 <b>Выбери предметы</b>');
}

/* ------------------------------ лекции ------------------------------ */

export function lectureGroupsWidget(groups: string[], subscriptions: LectureSubscription[]): WidgetMessage | null {
  const active = subscriptions.filter((item) => (item.video || item.lecture) && groups.includes(item.groupName)).length;
  return screenWidget(['cards', 'foot'], () => ({
    e: '📅',
    t: 'Напоминания о лекциях',
    s: active ? `Включено для ${active} ${plural(active, ['группы', 'групп', 'групп'])}` : 'Пока выключены',
    cd: [
      ['📹', 'Видеолекции', 'время, предмет и ссылка на подключение'],
      ['🏫', 'Лекции в аудитории', 'время, аудитория и преподаватель'],
      ['⏰', 'За 10 минут', 'с живым таймером до начала'],
    ],
    f: 'Выбери группу кнопкой ниже 👇 · 🔔 — уже включено',
  }), '📅 <b>Напоминания о лекциях</b>');
}

/** Состояние переключателей — в кнопках; бот меняет их на месте, не присылая новую карточку. */
export function lectureSettingsWidget(groupName: string): WidgetMessage | null {
  return screenWidget(['cards', 'foot'], () => ({
    e: '🔔',
    t: 'Лекции',
    s: truncate(groupName, 40),
    cd: [
      ['📹', 'Видеолекции', 'ссылка на подключение и таймер до начала'],
      ['🏫', 'Обычные лекции', 'аудитория и преподаватель'],
    ],
    f: 'Включай кнопками ниже · ✅ — включено',
  }), `🔔 <b>Лекции — ${escapeHtml(truncate(groupName, 80))}</b>`);
}
