import type { JournalData, JournalGroupRef, ReportCard, StudentRecord, SubjectSummary } from '@/lib/types';
import { escapeHtml, type InlineButton } from '@/lib/telegram';

const STUDENTS_PER_PAGE = 10;
const MAX_TEXT_LENGTH = 3800;

export interface BotScreen {
  text: string;
  buttons: InlineButton[][];
}

function formatAvg(value: number | null): string {
  if (value === null) {
    return '—';
  }
  return value.toFixed(2).replace('.', ',');
}

function avgEmoji(value: number | null): string {
  if (value === null) return '⚪';
  if (value >= 4.5) return '🟢';
  if (value >= 3.8) return '🔵';
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

function normalizedMark(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, '');
}

function isAbsenceValue(value: string): 'н' | 'н/у' | 'эн' | null {
  const key = normalizedMark(value);
  if (key === 'н') return 'н';
  if (key === 'н/у' || key === 'ну') return 'н/у';
  if (key === 'эн' || key === 'э/н') return 'эн';
  return null;
}

export function groupsScreen(groups: JournalGroupRef[]): BotScreen {
  const buttons: InlineButton[][] = groups.map((group, index) => [
    { text: `🎓 ${group.groupName}`, callback_data: `g:${index}` },
  ]);

  const text =
    groups.length === 1
      ? '📖 <b>Электронный журнал</b>\n\nСейчас доступна одна группа. Выбери её, чтобы открыть журнал:'
      : '📖 <b>Электронный журнал</b>\n\nВыбери группу:';

  return { text, buttons };
}

export function groupMenuScreen(data: JournalData, gi: number): BotScreen {
  const averages = data.students.map((s) => s.overallAverage).filter((v): v is number => v !== null);
  const groupAvg = averages.length ? averages.reduce((sum, v) => sum + v, 0) / averages.length : null;
  const totalValid = data.students.reduce((sum, s) => sum + s.totalAbsences.valid, 0);
  const totalInvalid = data.students.reduce((sum, s) => sum + s.totalAbsences.invalid, 0);

  const text = [
    `🎓 <b>${escapeHtml(data.groupName || 'Группа')}</b>`,
    '',
    `👥 Студентов: <b>${data.studentCount}</b>`,
    `📚 Предметов: <b>${data.subjectCount}</b>`,
    `${avgEmoji(groupAvg)} Средний балл группы: <b>${formatAvg(groupAvg === null ? null : Math.round(groupAvg * 100) / 100)}</b>`,
    `🚫 Пропусков всего: <b>${totalValid + totalInvalid}</b> (уваж.: ${totalValid}, неуваж.: ${totalInvalid})`,
  ].join('\n');

  const buttons: InlineButton[][] = [
    [{ text: '👥 Студенты', callback_data: `s:${gi}:0` }],
    [
      { text: '🏆 Рейтинг', callback_data: `r:${gi}` },
      { text: '📚 Предметы', callback_data: `p:${gi}` },
    ],
    [{ text: '⬅️ К группам', callback_data: 'grp' }],
  ];

  return { text, buttons };
}

export function studentsScreen(data: JournalData, gi: number, page: number): BotScreen {
  const sorted = [...data.students].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const totalPages = Math.max(1, Math.ceil(sorted.length / STUDENTS_PER_PAGE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const slice = sorted.slice(safePage * STUDENTS_PER_PAGE, (safePage + 1) * STUDENTS_PER_PAGE);

  const buttons: InlineButton[][] = slice.map((student) => {
    const absences = student.totalAbsences.valid + student.totalAbsences.invalid;
    return [
      {
        text: `${avgEmoji(student.overallAverage)} ${shortName(student.name)} • ${formatAvg(student.overallAverage)} • Н:${absences}`,
        callback_data: `c:${gi}:${student.id}`,
      },
    ];
  });

  const nav: InlineButton[] = [];
  if (safePage > 0) {
    nav.push({ text: '◀️', callback_data: `s:${gi}:${safePage - 1}` });
  }
  nav.push({ text: `${safePage + 1}/${totalPages}`, callback_data: `s:${gi}:${safePage}` });
  if (safePage < totalPages - 1) {
    nav.push({ text: '▶️', callback_data: `s:${gi}:${safePage + 1}` });
  }
  buttons.push(nav);
  buttons.push([{ text: '⬅️ Назад', callback_data: `g:${gi}` }]);

  const text = [
    `👥 <b>Студенты — ${escapeHtml(data.groupName || 'группа')}</b>`,
    '',
    'Нажми на студента, чтобы открыть его табель.',
    '<i>Формат: средний балл • всего пропусков</i>',
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
  const card = findCard(data, studentId);
  const student = findStudent(data, studentId);
  const name = card?.studentName || student?.name || 'Студент';

  const lines: string[] = [`👤 <b>${escapeHtml(name)}</b>`, ''];

  if (card?.rows.length) {
    for (const row of card.rows) {
      const avgLabel = row.averageLabel || formatAvg(row.average);
      const nTotal = row.absences.valid + row.absences.invalid;
      const nPart = nTotal > 0 ? ` • Н:${row.absences.invalid} НУ:${row.absences.valid}` : '';
      lines.push(`${avgEmoji(row.average)} ${escapeHtml(row.subjectName)} — <b>${escapeHtml(avgLabel || '—')}</b>${nPart}`);
    }
  } else if (student) {
    for (const subject of student.subjects) {
      const nTotal = subject.absences.valid + subject.absences.invalid;
      const nPart = nTotal > 0 ? ` • Н:${subject.absences.invalid} НУ:${subject.absences.valid}` : '';
      lines.push(`${avgEmoji(subject.average)} ${escapeHtml(subject.subjectName)} — <b>${formatAvg(subject.average)}</b>${nPart}`);
    }
  } else {
    lines.push('Не удалось найти данные этого студента.');
  }

  const overall = card?.overallAverage ?? student?.overallAverage ?? null;
  const totalAbs = card
    ? card.totalAbsenceCount
    : student
      ? student.totalAbsences.valid + student.totalAbsences.invalid
      : 0;

  lines.push('');
  lines.push(`${avgEmoji(overall)} Общий средний балл: <b>${formatAvg(overall)}</b>`);
  lines.push(`🚫 Пропусков всего: <b>${totalAbs}</b>`);

  const buttons: InlineButton[][] = [
    [{ text: '📅 Энки по датам', callback_data: `n:${gi}:${studentId}` }],
    [{ text: '⬅️ К студентам', callback_data: `s:${gi}:0` }],
  ];

  return { text: clampText(lines.join('\n')), buttons };
}

export function studentAbsencesScreen(data: JournalData, gi: number, studentId: number): BotScreen {
  const student = findStudent(data, studentId);
  const name = student?.name || 'Студент';
  const lines: string[] = [`📅 <b>Пропуски — ${escapeHtml(name)}</b>`, ''];

  let found = false;

  if (student) {
    for (const subject of student.subjects) {
      const entries = subject.grades
        .map((grade) => ({ grade, kind: isAbsenceValue(grade.value) }))
        .filter((entry) => entry.kind !== null);

      if (!entries.length) {
        continue;
      }

      found = true;
      const dates = entries
        .map((entry) => {
          const label = entry.grade.label || entry.grade.column;
          const suffix = entry.kind === 'н' ? '' : ` (${entry.kind!.toUpperCase()})`;
          return `${label}${suffix}`;
        })
        .join(', ');

      lines.push(`📕 <b>${escapeHtml(subject.subjectName)}</b>`);
      lines.push(`   ${escapeHtml(dates)}`);
    }
  }

  if (!found) {
    lines.push('🎉 Пропусков не найдено!');
  } else {
    lines.push('');
    lines.push('<i>Без пометки — Н (неуваж.), НУ — уважительная, ЭН — электронная.</i>');
  }

  const buttons: InlineButton[][] = [[{ text: '⬅️ К табелю', callback_data: `c:${gi}:${studentId}` }]];

  return { text: clampText(lines.join('\n')), buttons };
}

export function ratingScreen(data: JournalData, gi: number): BotScreen {
  const rated = [...data.students].sort((a, b) => {
    const aAvg = a.overallAverage ?? -1;
    const bAvg = b.overallAverage ?? -1;
    return bAvg - aAvg;
  });

  const medals = ['🥇', '🥈', '🥉'];
  const lines: string[] = [`🏆 <b>Рейтинг — ${escapeHtml(data.groupName || 'группа')}</b>`, ''];

  rated.forEach((student, index) => {
    const place = medals[index] || `${index + 1}.`;
    const absences = student.totalAbsences.valid + student.totalAbsences.invalid;
    lines.push(`${place} ${escapeHtml(shortName(student.name))} — <b>${formatAvg(student.overallAverage)}</b> • Н:${absences}`);
  });

  const buttons: InlineButton[][] = [[{ text: '⬅️ Назад', callback_data: `g:${gi}` }]];
  return { text: clampText(lines.join('\n')), buttons };
}

export function subjectsScreen(data: JournalData, gi: number): BotScreen {
  const buttons: InlineButton[][] = data.subjects.map((subject, index) => [
    { text: `📚 ${subject.subjectName.slice(0, 50)}`, callback_data: `ps:${gi}:${index}` },
  ]);
  buttons.push([{ text: '⬅️ Назад', callback_data: `g:${gi}` }]);

  const text = [`📚 <b>Предметы — ${escapeHtml(data.groupName || 'группа')}</b>`, '', 'Выбери предмет:'].join('\n');
  return { text, buttons };
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

  const lines: string[] = [
    `📚 <b>${escapeHtml(meta.subjectName)}</b>`,
    meta.teacherName ? `👨‍🏫 ${escapeHtml(meta.teacherName)}` : '',
    '',
    `${avgEmoji(subjectAvg)} Средний балл по предмету: <b>${formatAvg(subjectAvg)}</b>`,
    `🚫 Пропусков: <b>${totalInvalid + totalValid}</b> (Н:${totalInvalid}, НУ:${totalValid})`,
    '',
    '<b>Рейтинг по предмету:</b>',
  ].filter((line, index) => line !== '' || index > 0);

  const sorted = [...perStudent].sort((a, b) => (b.subject.average ?? -1) - (a.subject.average ?? -1));
  sorted.forEach((item, index) => {
    const nTotal = item.subject.absences.valid + item.subject.absences.invalid;
    const nPart = nTotal > 0 ? ` • Н:${nTotal}` : '';
    lines.push(`${index + 1}. ${escapeHtml(shortName(item.name))} — <b>${formatAvg(item.subject.average)}</b>${nPart}`);
  });

  const buttons: InlineButton[][] = [[{ text: '⬅️ К предметам', callback_data: `p:${gi}` }]];
  return { text: clampText(lines.join('\n')), buttons };
}

export function errorScreen(message: string): BotScreen {
  return {
    text: `⚠️ <b>Не получилось загрузить журнал</b>\n\n<code>${escapeHtml(message)}</code>\n\nПопробуй ещё раз через минуту.`,
    buttons: [[{ text: '🔄 Попробовать снова', callback_data: 'grp' }]],
  };
}
