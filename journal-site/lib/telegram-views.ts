import { escapeHtml, type InlineButton } from '@/lib/telegram';
import type { JournalData, JournalGroupRef, ReportCard, StudentRecord, SubjectSummary } from '@/lib/types';

const MAX_TEXT_LENGTH = 3800;
const TOPICS_PER_PAGE = 6;

export interface BotScreen {
  text: string;
  buttons: InlineButton[][];
}

function getSiteBaseUrl(): string | null {
  const raw = process.env.RENDER_EXTERNAL_URL?.trim() || process.env.PUBLIC_SITE_URL?.trim() || '';
  if (!raw) {
    return null;
  }
  const withProto = raw.startsWith('http') ? raw : `https://${raw}`;
  return withProto.replace(/\/+$/, '');
}

function groupWebAppUrl(group: JournalGroupRef | undefined): string | null {
  const base = getSiteBaseUrl();
  if (!base) {
    return null;
  }
  if (!group) {
    return base;
  }
  return `${base}/group/${group.id}`;
}

function formatAvg(value: number | null): string {
  if (value === null) {
    return '—';
  }
  return value.toFixed(2).replace('.', ',');
}

function avgEmoji(value: number | null): string {
  if (value === null) return '⚪';
  if (value >= 4) return '🟢';
  if (value >= 3) return '🟡';
  return '🔴';
}

function shortName(fullName: string): string {
  const parts = fullName.split(' ').filter(Boolean);
  if (parts.length <= 1) {
    return fullName;
  }
  const initials = parts.slice(1).map((part) => `${part[0]}.`).join('');
  return `${parts[0]} ${initials}`;
}

function clampText(text: string): string {
  if (text.length <= MAX_TEXT_LENGTH) {
    return text;
  }
  return `${text.slice(0, MAX_TEXT_LENGTH)}\n…\n<i>Список сокращён — всё целиком есть на сайте.</i>`;
}

function absencePair(invalid: number, valid: number): string {
  const parts: string[] = [];
  if (invalid > 0) parts.push(`Н:${invalid}`);
  if (valid > 0) parts.push(`НУ:${valid}`);
  return parts.join(' ');
}

function normalizedMark(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, '');
}

function absenceKind(value: string): 'Н' | 'НУ' | 'ЭН' | null {
  const key = normalizedMark(value);
  if (key === 'н') return 'Н';
  if (key === 'н/у' || key === 'ну') return 'НУ';
  if (key === 'эн' || key === 'э/н') return 'ЭН';
  return null;
}

// Средний балл и пропуски берём из листа «Табели» — как в основном журнале.
// Табель ищем по фамилии (номера могут не совпадать, если имя в табеле записано иначе).
function normName(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}

function cardForStudent(data: JournalData, student: StudentRecord): ReportCard | null {
  const target = normName(student.name);
  const byName = data.reportCards.find((card) => normName(card.studentName) === target);
  if (byName) {
    return byName;
  }
  return data.reportCards.find((card) => card.studentId === student.id) ?? null;
}

function studentDisplayStats(data: JournalData, student: StudentRecord): { avg: number | null; invalid: number; valid: number } {
  const card = cardForStudent(data, student);
  return {
    avg: card?.overallAverage ?? student.overallAverage,
    invalid: card?.totalAbsences.invalid ?? student.totalAbsences.invalid,
    valid: card?.totalAbsences.valid ?? student.totalAbsences.valid,
  };
}

export function groupsScreen(groups: JournalGroupRef[]): BotScreen {
  const buttons: InlineButton[][] = groups.map((group, index) => [
    { text: `🎓 ${group.groupName}`, callback_data: `g:${index}` },
  ]);

  return { text: '📖 <b>Электронный журнал</b>\n\nВыбери группу:', buttons };
}

export function groupMenuScreen(data: JournalData, gi: number, totalGroups: number, group?: JournalGroupRef): BotScreen {
  const stats = data.students.map((student) => studentDisplayStats(data, student));
  const averages = stats.map((s) => s.avg).filter((v): v is number => v !== null);
  const groupAvg = averages.length ? Math.round((averages.reduce((sum, v) => sum + v, 0) / averages.length) * 100) / 100 : null;
  const totalValid = stats.reduce((sum, s) => sum + s.valid, 0);
  const totalInvalid = stats.reduce((sum, s) => sum + s.invalid, 0);

  const text = [
    `🎓 <b>${escapeHtml(data.groupName || 'Группа')}</b>`,
    '━━━━━━━━━━━━━━━',
    `👥 Студентов: <b>${data.studentCount}</b>`,
    `📚 Предметов: <b>${data.subjectCount}</b>`,
    `${avgEmoji(groupAvg)} Средний балл: <b>${formatAvg(groupAvg)}</b>`,
    `🚫 Пропуски: <b>Н:${totalInvalid}</b> • <b>НУ:${totalValid}</b>`,
  ].join('\n');

  const buttons: InlineButton[][] = [];

  const webAppUrl = groupWebAppUrl(group);
  if (webAppUrl) {
    buttons.push([{ text: '🌐 Открыть полный журнал', web_app: { url: webAppUrl } }]);
  }

  buttons.push([{ text: '👥 Студенты', callback_data: `s:${gi}` }]);
  buttons.push([
    { text: '🏆 Рейтинг', callback_data: `r:${gi}` },
    { text: '📚 Предметы', callback_data: `p:${gi}` },
  ]);

  if (totalGroups > 1) {
    buttons.push([{ text: '⬅️ К группам', callback_data: 'grp' }]);
  }

  return { text, buttons };
}

export function studentsScreen(data: JournalData, gi: number): BotScreen {
  const sorted = [...data.students].sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  const buttons: InlineButton[][] = sorted.map((student) => {
    const stats = studentDisplayStats(data, student);
    const abs = absencePair(stats.invalid, stats.valid);
    const absPart = abs ? ` • ${abs}` : '';
    return [
      {
        text: `${avgEmoji(stats.avg)} ${shortName(student.name)} • ${formatAvg(stats.avg)}${absPart}`,
        callback_data: `c:${gi}:${student.id}`,
      },
    ];
  });

  buttons.push([{ text: '⬅️ Назад', callback_data: `g:${gi}` }]);

  const text = [
    `👥 <b>Студенты — ${escapeHtml(data.groupName || 'группа')}</b>`,
    '━━━━━━━━━━━━━━━',
    '<i>средний балл • Н (неуваж.) • НУ (уваж.)</i>',
  ].join('\n');

  return { text, buttons };
}

function findCard(data: JournalData, studentId: number): ReportCard | null {
  return data.reportCards.find((card) => card.studentId === studentId) ?? null;
}

function findStudent(data: JournalData, studentId: number): StudentRecord | null {
  return data.students.find((student) => student.id === studentId) ?? null;
}

export function studentCardScreen(data: JournalData, gi: number, studentId: number): BotScreen {
  const student = findStudent(data, studentId);
  const card = student ? cardForStudent(data, student) : findCard(data, studentId);
  const name = student?.name || card?.studentName || 'Студент';

  const lines: string[] = [`👤 <b>${escapeHtml(name)}</b>`, '━━━━━━━━━━━━━━━'];

  if (card?.rows.length) {
    for (const row of card.rows) {
      const avgLabel = row.averageLabel || formatAvg(row.average);
      const abs = absencePair(row.absences.invalid, row.absences.valid);
      const absPart = abs ? ` • ${abs}` : '';
      lines.push(`${avgEmoji(row.average)} ${escapeHtml(row.subjectName)} — <b>${escapeHtml(avgLabel || '—')}</b>${absPart}`);
    }
  } else if (student) {
    for (const subject of student.subjects) {
      const abs = absencePair(subject.absences.invalid, subject.absences.valid);
      const absPart = abs ? ` • ${abs}` : '';
      lines.push(`${avgEmoji(subject.average)} ${escapeHtml(subject.subjectName)} — <b>${formatAvg(subject.average)}</b>${absPart}`);
    }
  } else {
    lines.push('Не удалось найти данные этого студента.');
  }

  const overall = card?.overallAverage ?? student?.overallAverage ?? null;
  const totalInvalid = card?.totalAbsences.invalid ?? student?.totalAbsences.invalid ?? 0;
  const totalValid = card?.totalAbsences.valid ?? student?.totalAbsences.valid ?? 0;

  lines.push('━━━━━━━━━━━━━━━');
  lines.push(`${avgEmoji(overall)} Общий средний балл: <b>${formatAvg(overall)}</b>`);
  lines.push(`🚫 Пропуски: <b>Н:${totalInvalid}</b> • <b>НУ:${totalValid}</b>`);

  const buttons: InlineButton[][] = [
    [{ text: '📝 Все оценки', callback_data: `m:${gi}:${studentId}` }],
    [{ text: '📅 Пропуски по датам', callback_data: `n:${gi}:${studentId}` }],
    [{ text: '⬅️ К студентам', callback_data: `s:${gi}` }],
  ];

  return { text: clampText(lines.join('\n')), buttons };
}

export function studentGradesScreen(data: JournalData, gi: number, studentId: number): BotScreen {
  const student = findStudent(data, studentId);
  const name = student?.name || 'Студент';
  const lines: string[] = [`📝 <b>Оценки — ${escapeHtml(name)}</b>`, '━━━━━━━━━━━━━━━'];

  let found = false;

  if (student) {
    for (const subject of student.subjects) {
      if (!subject.grades.length) {
        continue;
      }

      found = true;
      // Показываем отметки ровно так, как они стоят в Excel-журнале.
      const marks = subject.grades.map((grade) => grade.value).join(' · ');
      lines.push('');
      lines.push(`📕 <b>${escapeHtml(subject.subjectName)}</b>`);
      lines.push(escapeHtml(marks));
    }
  }

  if (!found) {
    lines.push('');
    lines.push('Записей в журнале пока нет.');
  }

  const buttons: InlineButton[][] = [[{ text: '⬅️ К табелю', callback_data: `c:${gi}:${studentId}` }]];

  return { text: clampText(lines.join('\n')), buttons };
}

export function studentAbsencesScreen(data: JournalData, gi: number, studentId: number): BotScreen {
  const student = findStudent(data, studentId);
  const name = student?.name || 'Студент';
  const lines: string[] = [`📅 <b>Пропуски — ${escapeHtml(name)}</b>`, '━━━━━━━━━━━━━━━'];

  let found = false;

  if (student) {
    for (const subject of student.subjects) {
      const entries = subject.grades
        .map((grade) => ({ grade, kind: absenceKind(grade.value) }))
        .filter((entry) => entry.kind !== null);

      if (!entries.length) {
        continue;
      }

      found = true;
      const dates = entries
        .map((entry) => `${entry.grade.label || entry.grade.column} — ${entry.kind}`)
        .join('\n   ');

      lines.push('');
      lines.push(`📕 <b>${escapeHtml(subject.subjectName)}</b>`);
      lines.push(`   ${escapeHtml(dates)}`);
    }
  }

  if (!found) {
    lines.push('');
    lines.push('🎉 Пропусков не найдено!');
  }

  const buttons: InlineButton[][] = [[{ text: '⬅️ К табелю', callback_data: `c:${gi}:${studentId}` }]];

  return { text: clampText(lines.join('\n')), buttons };
}

export function ratingScreen(data: JournalData, gi: number): BotScreen {
  const rated = data.students
    .map((student) => ({ student, stats: studentDisplayStats(data, student) }))
    .sort((a, b) => (b.stats.avg ?? -1) - (a.stats.avg ?? -1));

  const medals = ['🥇', '🥈', '🥉'];
  const lines: string[] = [`🏆 <b>Рейтинг — ${escapeHtml(data.groupName || 'группа')}</b>`, '━━━━━━━━━━━━━━━'];

  rated.forEach(({ student, stats }, index) => {
    const place = medals[index] || `${index + 1}.`;
    const abs = absencePair(stats.invalid, stats.valid);
    const absPart = abs ? ` • ${abs}` : '';
    lines.push(`${place} ${escapeHtml(shortName(student.name))} — <b>${formatAvg(stats.avg)}</b>${absPart}`);
  });

  const buttons: InlineButton[][] = [[{ text: '⬅️ Назад', callback_data: `g:${gi}` }]];
  return { text: clampText(lines.join('\n')), buttons };
}

export function subjectsScreen(data: JournalData, gi: number): BotScreen {
  const buttons: InlineButton[][] = data.subjects.map((subject, index) => [
    { text: `📚 ${subject.subjectName.slice(0, 50)}`, callback_data: `ps:${gi}:${index}` },
  ]);
  buttons.push([{ text: '⬅️ Назад', callback_data: `g:${gi}` }]);

  const text = [`📚 <b>Предметы — ${escapeHtml(data.groupName || 'группа')}</b>`, '━━━━━━━━━━━━━━━', 'Выбери предмет:'].join('\n');
  return { text, buttons };
}

function findSubjectSummary(data: JournalData, sheetName: string): SubjectSummary | null {
  for (const student of data.students) {
    const subject = student.subjects.find((item) => item.sheetName === sheetName);
    if (subject) {
      return subject;
    }
  }
  return null;
}

export function subjectDetailScreen(data: JournalData, gi: number, si: number): BotScreen {
  const meta = data.subjects[si];
  if (!meta) {
    return {
      text: 'Предмет не найден.',
      buttons: [[{ text: '⬅️ Назад', callback_data: `p:${gi}` }]],
    };
  }

  const perStudent: Array<{ name: string; subject: SubjectSummary }> = [];
  for (const student of data.students) {
    const subject = student.subjects.find((item) => item.sheetName === meta.sheetName);
    if (subject) {
      perStudent.push({ name: student.name, subject });
    }
  }

  const averages = perStudent.map((item) => item.subject.average).filter((v): v is number => v !== null);
  const subjectAvg = averages.length ? Math.round((averages.reduce((sum, v) => sum + v, 0) / averages.length) * 100) / 100 : null;
  const totalInvalid = perStudent.reduce((sum, item) => sum + item.subject.absences.invalid, 0);
  const totalValid = perStudent.reduce((sum, item) => sum + item.subject.absences.valid, 0);

  const lines: string[] = [`📚 <b>${escapeHtml(meta.subjectName)}</b>`];
  if (meta.teacherName) {
    lines.push(`👨‍🏫 ${escapeHtml(meta.teacherName)}`);
  }
  lines.push('━━━━━━━━━━━━━━━');
  lines.push(`${avgEmoji(subjectAvg)} Средний балл: <b>${formatAvg(subjectAvg)}</b>`);
  lines.push(`🚫 Пропуски: <b>Н:${totalInvalid}</b> • <b>НУ:${totalValid}</b>`);
  lines.push('');
  lines.push('<b>Рейтинг по предмету:</b>');

  const sorted = [...perStudent].sort((a, b) => (b.subject.average ?? -1) - (a.subject.average ?? -1));
  sorted.forEach((item, index) => {
    const abs = absencePair(item.subject.absences.invalid, item.subject.absences.valid);
    const absPart = abs ? ` • ${abs}` : '';
    lines.push(`${index + 1}. ${escapeHtml(shortName(item.name))} — <b>${formatAvg(item.subject.average)}</b>${absPart}`);
  });

  const subjectInfo = findSubjectSummary(data, meta.sheetName);
  const buttons: InlineButton[][] = [];
  if (subjectInfo?.lessonTopics.length) {
    buttons.push([{ text: '📖 Темы занятий', callback_data: `t:${gi}:${si}:0` }]);
  }
  buttons.push([{ text: '⬅️ К предметам', callback_data: `p:${gi}` }]);

  return { text: clampText(lines.join('\n')), buttons };
}

export function subjectTopicsScreen(data: JournalData, gi: number, si: number, page: number): BotScreen {
  const meta = data.subjects[si];
  const subjectInfo = meta ? findSubjectSummary(data, meta.sheetName) : null;
  const topics = subjectInfo?.lessonTopics ?? [];

  if (!meta || !topics.length) {
    return {
      text: 'Темы занятий для этого предмета не найдены в журнале.',
      buttons: [[{ text: '⬅️ Назад', callback_data: `ps:${gi}:${si}` }]],
    };
  }

  const totalPages = Math.max(1, Math.ceil(topics.length / TOPICS_PER_PAGE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const slice = topics.slice(safePage * TOPICS_PER_PAGE, (safePage + 1) * TOPICS_PER_PAGE);

  const lines: string[] = [
    `📖 <b>Темы — ${escapeHtml(meta.subjectName)}</b>`,
    '━━━━━━━━━━━━━━━',
  ];

  for (const topic of slice) {
    lines.push('');
    lines.push(`📅 <b>${escapeHtml(topic.dateLabel)}</b>`);
    lines.push(escapeHtml(topic.topic));
    if (topic.extra) {
      lines.push(`<i>${escapeHtml(topic.extra)}</i>`);
    }
  }

  const buttons: InlineButton[][] = [];
  const nav: InlineButton[] = [];
  if (safePage > 0) {
    nav.push({ text: '◀️', callback_data: `t:${gi}:${si}:${safePage - 1}` });
  }
  nav.push({ text: `${safePage + 1}/${totalPages}`, callback_data: `t:${gi}:${si}:${safePage}` });
  if (safePage < totalPages - 1) {
    nav.push({ text: '▶️', callback_data: `t:${gi}:${si}:${safePage + 1}` });
  }
  if (nav.length > 1) {
    buttons.push(nav);
  }
  buttons.push([{ text: '⬅️ К предмету', callback_data: `ps:${gi}:${si}` }]);

  return { text: clampText(lines.join('\n')), buttons };
}

export function errorScreen(message: string): BotScreen {
  return {
    text: `⚠️ <b>Не получилось загрузить журнал</b>\n\n<code>${escapeHtml(message)}</code>\n\nПопробуй ещё раз через минуту.`,
    buttons: [[{ text: '🔄 Попробовать снова', callback_data: 'grp' }]],
  };
}
