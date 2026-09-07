import * as XLSX from 'xlsx';
import { createHash } from 'node:crypto';
import { journalDate, monthNumber } from '@/lib/journal-dates';
import { JournalError, logJournalEvent } from '@/lib/journal-errors';
import { parseMarkValue } from '@/lib/mark-values';
import type { LessonColumn } from '@/lib/types';
import { checkWorkbookArchive } from '@/lib/workbook-limits';

import type {
  AbsenceSummary,
  GradeEntry,
  JournalData,
  JournalFileResult,
  LessonTopic,
  ReportCard,
  ReportCardRow,
  StudentRecord,
  SubjectMeta,
  SubjectSummary,
} from '@/lib/types';

const EXCLUDED_SHEETS = new Set(['Табели', 'Н-ки']);
const GENERIC_HEADER_WORDS = ['месяц', 'число', 'дата', 'темы', 'тема', 'группа', 'здоровья'];

interface RosterInfo {
  groupName: string | null;
  students: string[];
}

interface SheetLessonColumn extends LessonColumn {
  index: number;
  column: string;
  monthLabel: string | null;
  dayLabel: string | null;
  label: string;
}


const SUBJECT_ALIASES: Record<string, string> = {
  'разработка кода ис': 'разработка программных модулей',
  'тестирование информационных систем': 'обеспечение качества функционирования компьютерных систем',
};

const SUBJECT_DISPLAY_ALIASES: Record<string, string> = {
  'Разработка кода ИС': 'Разработка программных модулей',
  'Тестирование информационных систем': 'Обеспечение качества функционирования компьютерных систем',
};

function normalizeSubjectKey(value: unknown): string {
  const normalized = normalizeName(value);
  return SUBJECT_ALIASES[normalized] ?? normalized;
}

function normalizeSubjectDisplayName(value: string): string {
  return SUBJECT_DISPLAY_ALIASES[value] ?? value;
}

function roundTo(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function isNil(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

function normalizeSpaces(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizeText(value: unknown): string {
  if (isNil(value)) {
    return '';
  }

  if (value instanceof Date) {
    const day = String(value.getUTCDate()).padStart(2, '0');
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const year = value.getUTCFullYear();
    return `${day}.${month}.${year}`;
  }

  return normalizeSpaces(String(value));
}

function normalizeName(value: unknown): string {
  return normalizeSpaces(value).toLowerCase().replace(/ё/g, 'е');
}

function isStudentNumber(value: unknown): boolean {
  return /^\d+\.?$/.test(normalizeText(value));
}

function getCellAddress(row: number, col: number): string {
  return XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
}

function getDirectCell(sheet: XLSX.WorkSheet, row: number, col: number): XLSX.CellObject | undefined {
  return sheet[getCellAddress(row, col)];
}

function getMergedOriginCell(sheet: XLSX.WorkSheet, row: number, col: number): XLSX.CellObject | undefined {
  const merges = sheet['!merges'];
  if (!merges?.length) {
    return undefined;
  }

  const target = { r: row - 1, c: col - 1 };

  for (const merge of merges) {
    const insideMerge =
      target.r >= merge.s.r &&
      target.r <= merge.e.r &&
      target.c >= merge.s.c &&
      target.c <= merge.e.c;

    if (!insideMerge) {
      continue;
    }

    return getDirectCell(sheet, merge.s.r + 1, merge.s.c + 1);
  }

  return undefined;
}

function getCell(sheet: XLSX.WorkSheet, row: number, col: number): XLSX.CellObject | undefined {
  return getDirectCell(sheet, row, col) ?? getMergedOriginCell(sheet, row, col);
}

function getCellValue(sheet: XLSX.WorkSheet, row: number, col: number): unknown {
  const cell = getCell(sheet, row, col);
  return cell?.v ?? null;
}

function getCellText(sheet: XLSX.WorkSheet, row: number, col: number): string {
  const cell = getCell(sheet, row, col);

  if (!cell) {
    return '';
  }

  if (typeof cell.v === 'number' && typeof cell.z === 'string' && XLSX.SSF.is_date(cell.z)) {
    const parsed = XLSX.SSF.parse_date_code(cell.v, { date1904: Boolean(sheet['!journalDate1904']) });
    if (parsed) return `${String(parsed.d).padStart(2, '0')}.${String(parsed.m).padStart(2, '0')}.${parsed.y}`;
  }

  if (cell.w) {
    return normalizeText(cell.w);
  }

  return normalizeText(cell.v);
}


function parseFormulaReference(reference: string): { sheetName: string; cellAddress: string } | null {
  const trimmed = reference.trim();
  const quotedMatch = trimmed.match(/^'((?:[^']|'')+)'!([$]?[A-Z]+[$]?\d+)$/i);
  if (quotedMatch) {
    return {
      sheetName: quotedMatch[1].replace(/''/g, "'"),
      cellAddress: quotedMatch[2].replace(/\$/g, '').toUpperCase(),
    };
  }

  const plainMatch = trimmed.match(/^([^!'()]+)!([$]?[A-Z]+[$]?\d+)$/i);
  if (plainMatch) {
    return {
      sheetName: plainMatch[1].trim(),
      cellAddress: plainMatch[2].replace(/\$/g, '').toUpperCase(),
    };
  }

  return null;
}

function getFormulaReference(formula: string): { sheetName: string; cellAddress: string } | null {
  const normalizedFormula = formula.trim().replace(/^=/, '').trim();
  const concatenateMatch = normalizedFormula.match(/^CONCATENATE\((.+)\)$/i);
  if (concatenateMatch) {
    return parseFormulaReference(concatenateMatch[1]);
  }

  return parseFormulaReference(normalizedFormula);
}

function getWorkbookCellText(workbook: XLSX.WorkBook, sheet: XLSX.WorkSheet, row: number, col: number): string {
  const cell = getCell(sheet, row, col);
  if (!cell) {
    return '';
  }

  const formula = typeof cell.f === 'string' ? cell.f : '';
  if (formula) {
    const reference = getFormulaReference(formula);
    if (reference) {
      const referencedSheet = workbook.Sheets[reference.sheetName];
      if (referencedSheet) {
        const decoded = XLSX.utils.decode_cell(reference.cellAddress);
        const referencedText = getCellText(referencedSheet, decoded.r + 1, decoded.c + 1);
        if (referencedText && referencedText !== '0') {
          return referencedText;
        }
      }
    }
  }

  return getCellText(sheet, row, col);
}

function isGenericHeader(value: string): boolean {
  const normalized = normalizeName(value);
  return GENERIC_HEADER_WORDS.some((word) => normalized === word || normalized.includes(word));
}

function isMonthLike(value: string): boolean {
  const normalized = normalizeName(value);
  if (/^\d{1,2}$/.test(normalized)) {
    const number = Number(normalized);
    return number >= 1 && number <= 12;
  }

  return [
    'январ',
    'феврал',
    'март',
    'апрел',
    'май',
    'июн',
    'июл',
    'август',
    'сентябр',
    'октябр',
    'ноябр',
    'декабр',
    'сен',
    'окт',
    'ноя',
    'дек',
  ].some((chunk) => normalized.includes(chunk));
}

function isSimpleDay(value: string): boolean {
  return /^\d{1,2}$/.test(normalizeName(value));
}

function isFullDate(value: string): boolean {
  return /^\d{1,2}[./-]\d{1,2}([./-]\d{2,4})?$/.test(normalizeName(value));
}

function buildLessonLabel(monthLabel: string | null, dayLabel: string | null, columnLetter: string): string {
  const month = monthLabel ? normalizeSpaces(monthLabel) : '';
  const day = dayLabel ? normalizeSpaces(dayLabel) : '';

  if (month && day) {
    if (isFullDate(month)) {
      return `${month} • ${day}`;
    }

    if (isMonthLike(month) && isSimpleDay(day)) {
      return `${day}.${month}`;
    }

    return `${day} • ${month}`;
  }

  if (day) {
    return day;
  }

  if (month) {
    return month;
  }

  return `Колонка ${columnLetter}`;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const normalized = normalizeText(value).replace(',', '.');
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function collectNumberedRows(sheet: XLSX.WorkSheet): Array<{ row: number; name: string }> {
  const ref = sheet['!ref'];
  if (!ref) {
    return [];
  }

  const range = XLSX.utils.decode_range(ref);
  const rows: Array<{ row: number; name: string }> = [];

  for (let row = 1; row <= range.e.r + 1; row += 1) {
    if (!isStudentNumber(getCellValue(sheet, row, 1))) {
      continue;
    }

    const name = getCellText(sheet, row, 2);
    if (!name) {
      continue;
    }

    rows.push({ row, name });
  }

  return rows;
}

function looksLikeGroupName(value: string): boolean {
  const normalized = normalizeSpaces(value);
  if (!normalized) {
    return false;
  }

  const hasDigits = /\d{2}\s*[/-]\s*\d/.test(normalized) || /\d{2}\s*\/\s*\d/.test(normalized);
  const hasLetters = /[А-Яа-яA-Za-z]/.test(normalized);
  return hasDigits && hasLetters;
}

function formatGroupName(value: string | null): string | null {
  if (!value) {
    return null;
  }

  let normalized = normalizeSpaces(value)
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s*\-\s*/g, '-')
    .replace(/([А-Яа-яA-Za-z\)]+)\s+(\d{2}\/\d)/, '$1-$2');

  normalized = normalized.replace(/^ИСиП\b/i, 'ИСиП');
  return normalized;
}

function detectGroupName(workbook: XLSX.WorkBook): string | null {
  for (const sheetName of workbook.SheetNames) {
    if (EXCLUDED_SHEETS.has(sheetName)) {
      continue;
    }

    const sheet = workbook.Sheets[sheetName];
    const candidates = [
      getCellText(sheet, 3, 1),
      getCellText(sheet, 3, 2),
      getCellText(sheet, 3, 3),
      getCellText(sheet, 2, 1),
      getCellText(sheet, 1, 1),
    ];

    const match = candidates.find((candidate) => looksLikeGroupName(candidate));
    if (match) {
      return formatGroupName(match);
    }
  }

  return null;
}

function buildRoster(workbook: XLSX.WorkBook): RosterInfo {
  let bestSheet: XLSX.WorkSheet | null = null;
  let bestRows: Array<{ row: number; name: string }> = [];

  for (const sheetName of workbook.SheetNames) {
    if (EXCLUDED_SHEETS.has(sheetName)) {
      continue;
    }

    const sheet = workbook.Sheets[sheetName];
    const rows = collectNumberedRows(sheet);

    if (rows.length > bestRows.length) {
      bestRows = rows;
      bestSheet = sheet;
    }
  }

  if (!bestSheet || bestRows.length === 0) {
    const sheetNames = workbook.SheetNames.filter((name) => !EXCLUDED_SHEETS.has(name));
    const seen = sheetNames.length ? `Просмотрены листы: ${sheetNames.join(', ')}.` : 'В файле нет ни одного листа с предметом.';

    throw new Error(
      'Не удалось определить список студентов в журнале. ' +
        'Номер студента должен стоять в первом столбце, фамилия — во втором. ' +
        seen,
    );
  }

  const names = new Map<string, string>();
  for (const sheetName of workbook.SheetNames) {
    if (EXCLUDED_SHEETS.has(sheetName)) continue;
    const sheet = workbook.Sheets[sheetName];
    if (!detectHeaderRows(sheet)) continue;
    const seen = new Set<string>();
    let duplicates = 0;
    for (const entry of collectNumberedRows(sheet)) {
      const key = normalizeName(entry.name);
      // В журнале колледжа студент иногда записан дважды. Раньше это отменяло
      // разбор всего файла, и группа переставала открываться целиком.
      // Берём первую строку студента, а о повторе сообщаем в лог без фамилий.
      if (seen.has(key)) {
        duplicates += 1;
        continue;
      }
      seen.add(key);
      names.set(key, entry.name);
    }
    if (duplicates) logJournalEvent('duplicate_students', { sheet: sheetName, count: duplicates });
  }
  if (!names.size) throw new JournalError('JOURNAL_STRUCTURE_CHANGED');
  return { groupName: detectGroupName(workbook), students: [...names.values()] };
}

/** Locate the adjacent month/day header rows before the first student block. */
function detectHeaderRows(sheet: XLSX.WorkSheet): { monthRow: number; dayRow: number } | null {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  const lastRow = Math.min(range.e.r + 1, 30);
  const lastColumn = Math.min(range.e.c + 1, 1024);

  for (let row = 2; row <= lastRow; row += 1) {
    const marker = normalizeName(getCellText(sheet, row, 1));
    if (/^(№|номер|n|no\.?)$/.test(marker)) return { monthRow: row - 1, dayRow: row };
    if (marker === 'число' || marker === 'дата') {
      if (!isTopicHeaderRow(sheet, row)) return { monthRow: row - 1, dayRow: row };
    }
  }

  // В журнале колледжа подписи «Месяц» и «Число» стоят во втором столбце,
  // а не в первом: там номер группы. Ищем их в начальных столбцах.
  // Без этого предмет, по которому ещё не было ни одного занятия, выглядел
  // как лист неизвестной структуры и ронял разбор всего журнала.
  for (let row = 2; row < lastRow; row += 1) {
    for (let col = 1; col <= Math.min(lastColumn, 4); col += 1) {
      if (normalizeName(getCellText(sheet, row, col)) !== 'месяц') continue;
      const below = normalizeName(getCellText(sheet, row + 1, col));
      if (below === 'число' || below === 'дата') return { monthRow: row, dayRow: row + 1 };
    }
  }

  // Original template may leave A4 blank. Require semantic month/day evidence.
  for (let col = 3; col <= lastColumn; col += 1) {
    if (journalDate(getCellText(sheet, 3, col), getCellText(sheet, 4, col)).dateKey) return { monthRow: 3, dayRow: 4 };
  }
  return null;
}

// Заголовки итоговых столбцов. В журнале такой блок может стоять
// не только в конце листа, но и после каждого месяца.
const SUMMARY_HEADER_WORDS = ['средний', 'уваж', 'неуваж', 'пропуск', 'итог', 'аттестац', 'экзамен'];

function isSummaryHeader(headerText: string): boolean {
  return SUMMARY_HEADER_WORDS.some((word) => headerText.includes(word));
}

function findSummaryColumns(
  sheet: XLSX.WorkSheet,
  maxColumn: number,
  headerRows: number[] = [3, 4],
): {
  averageCol: number | null;
  validCol: number | null;
  invalidCol: number | null;
  summaryColumns: Set<number>;
} {
  let averageCol: number | null = null;
  let validCol: number | null = null;
  let invalidCol: number | null = null;
  const summaryColumns = new Set<number>();

  for (const headerRow of headerRows) {
    for (let col = 1; col <= maxColumn; col += 1) {
      const header = normalizeName(getCellText(sheet, headerRow, col));

      if (!header) {
        continue;
      }

      if (isSummaryHeader(header)) {
        summaryColumns.add(col);
      }

      if (!averageCol && header.includes('средний')) {
        averageCol = col;
      }

      if (!validCol && header.includes('уваж') && !header.includes('неуваж')) {
        validCol = col;
      }

      if (!invalidCol && header.includes('неуваж')) {
        invalidCol = col;
      }
    }
  }

  return { averageCol, validCol, invalidCol, summaryColumns };
}

// Подписи из шапки бланка. Это не названия предметов, показывать их нельзя.
const SUBJECT_NAME_PLACEHOLDERS = new Set([
  'наименование предмета',
  'наименование дисциплины',
  'название предмета',
  'название дисциплины',
  'предмет',
  'дисциплина',
  'фио преподавателя',
  'преподаватель',
]);

function isPlaceholderSubjectName(value: string): boolean {
  return SUBJECT_NAME_PLACEHOLDERS.has(normalizeName(value));
}

function detectSubjectName(sheet: XLSX.WorkSheet, fallback: string): string {
  // Раньше подпись отсеивалась только в C1, а из A1 бралась как есть,
  // и вкладка предмета называлась «Наименование предмета».
  // Только первая строка: во второй стоит преподаватель, его брать нельзя.
  const candidates = [getCellText(sheet, 1, 3), getCellText(sheet, 1, 1)];

  for (const candidate of candidates) {
    if (candidate && !isPlaceholderSubjectName(candidate)) {
      return normalizeSubjectDisplayName(candidate);
    }
  }

  return normalizeSubjectDisplayName(fallback);
}

function detectTeacherName(sheet: XLSX.WorkSheet): string | null {
  const c2 = getCellText(sheet, 2, 3);
  if (c2 && normalizeName(c2) !== 'фио преподавателя') {
    return c2;
  }

  const a2 = getCellText(sheet, 2, 1);
  if (a2 && !normalizeName(a2).includes('преподавателя')) {
    return a2;
  }

  return null;
}

function buildLessonColumns(
  sheet: XLSX.WorkSheet,
  maxColumn: number,
  summaryColumns: Set<number>,
  rosterRows: number[],
  header: { monthRow: number; dayRow: number },
  sheetName: string,
  yearHint?: number,
): SheetLessonColumn[] {
  const columns: SheetLessonColumn[] = [];
  let lastMonthLabel = '';
  let currentYear = yearHint;
  let previousMonth: number | null = null;
  const occurrences = new Map<string, number>();

  // Идём по всей ширине листа, а не до первого столбца «Средний».
  // В журнале итоговый блок может повторяться после каждого месяца,
  // и всё, что стояло за первым таким блоком, раньше терялось.
  for (let col = 3; col <= maxColumn; col += 1) {
    if (summaryColumns.has(col)) {
      continue;
    }

    const rawMonthLabel = getCellText(sheet, header.monthRow, col);
    if (rawMonthLabel && (monthNumber(rawMonthLabel) || isFullDate(rawMonthLabel))) {
      lastMonthLabel = rawMonthLabel;
    }

    const monthLabel = rawMonthLabel || lastMonthLabel || null;
    const dayLabel = getCellText(sheet, header.dayRow, col) || null;
    const headerText = normalizeName(`${monthLabel || ''} ${dayLabel || ''}`);

    if (isSummaryHeader(headerText)) {
      continue;
    }

    // Unlabelled values and service columns are never silently treated as grades.
    const unhintedDate = journalDate(monthLabel, dayLabel);
    const month = unhintedDate.dateKey ? Number(unhintedDate.dateKey.slice(-5, -3)) : monthNumber(monthLabel || '');
    if (previousMonth === null && currentYear !== undefined && month && month < 9 && !unhintedDate.date) currentYear += 1;
    if (currentYear !== undefined && previousMonth === 12 && month === 1) currentYear += 1;
    const normalizedDate = journalDate(monthLabel, dayLabel, currentYear);
    if (!normalizedDate.dateKey) {
      const looksDated = /^\d{1,2}$/.test(dayLabel || '') && Boolean(month);
      if (looksDated || isFullDate(dayLabel || '') || /^\d{4}-\d{2}-\d{2}$/.test(dayLabel || '')) throw new JournalError('JOURNAL_VALIDATION_FAILED');
      continue;
    }
    if (normalizedDate.date) currentYear = Number(normalizedDate.date.slice(0, 4));
    previousMonth = Number(normalizedDate.dateKey.slice(-5, -3));

    const sampleValues = rosterRows
      .map((row) => getCellValue(sheet, row, col))
      .filter((value) => !isNil(value) && normalizeText(value) !== '');

    const hasMeaningfulValue = sampleValues.length > 0;

    if (!hasMeaningfulValue && (!monthLabel && !dayLabel)) {
      continue;
    }

    if (col === 3 && (headerText.includes('здоровья') || headerText.includes('группа'))) {
      continue;
    }

    if (!hasMeaningfulValue && (isGenericHeader(monthLabel || '') || isGenericHeader(dayLabel || ''))) {
      continue;
    }

    const columnLetter = XLSX.utils.encode_col(col - 1);
    const occurrence = (occurrences.get(normalizedDate.dateKey) ?? 0) + 1;
    occurrences.set(normalizedDate.dateKey, occurrence);
    columns.push({
      id: `${sheetName}::${normalizedDate.dateKey}::${occurrence}`,
      index: col,
      column: columnLetter,
      monthLabel: monthLabel ? normalizeSpaces(monthLabel) : null,
      dayLabel: dayLabel ? normalizeSpaces(dayLabel) : null,
      label: (normalizedDate.date ? normalizedDate.date.split('-').reverse().join('.') : normalizedDate.dateKey ? normalizedDate.dateKey.slice(-5).split('-').reverse().join('.') : buildLessonLabel(monthLabel || null, dayLabel || null, columnLetter)) + (occurrence > 1 ? ` · занятие ${occurrence}` : ''),
      ...normalizedDate,
    });
  }

  return columns;
}

function isTopicHeaderRow(sheet: XLSX.WorkSheet, row: number): boolean {
  const col1 = normalizeName(getCellText(sheet, row, 1));
  const col2 = normalizeName(getCellText(sheet, row, 2));
  return col1 === 'дата' && (col2.includes('тема') || col2.includes('дз'));
}

function parseLessonTopics(sheet: XLSX.WorkSheet): LessonTopic[] {
  const ref = sheet['!ref'];
  if (!ref) {
    return [];
  }

  const range = XLSX.utils.decode_range(ref);
  let headerRow: number | null = null;

  for (let row = 1; row <= range.e.r + 1; row += 1) {
    if (isTopicHeaderRow(sheet, row)) {
      headerRow = row;
      break;
    }
  }

  if (!headerRow) {
    return [];
  }

  const topics: LessonTopic[] = [];
  let blankStreak = 0;

  for (let row = headerRow + 1; row <= range.e.r + 1; row += 1) {
    const dateLabel = getCellText(sheet, row, 1);
    const topic = getCellText(sheet, row, 2);
    const extraParts = [getCellText(sheet, row, 3), getCellText(sheet, row, 4)].filter(Boolean);

    if (!dateLabel && !topic && extraParts.length === 0) {
      blankStreak += 1;
      if (blankStreak >= 3) {
        break;
      }
      continue;
    }

    blankStreak = 0;

    if (!dateLabel && !topic) {
      continue;
    }

    topics.push({
      row,
      dateLabel: dateLabel || `Строка ${row}`,
      topic: topic || '—',
      extra: extraParts.length ? extraParts.join(' • ') : null,
      ...journalDate(null, dateLabel),
    });
  }

  return topics;
}

function buildBlankSubject(sheetName: string, subjectName: string, teacherName: string | null): SubjectSummary {
  return {
    sheetName,
    subjectName,
    teacherName,
    average: null,
    absences: {
      valid: 0,
      invalid: 0,
    },
    grades: [],
    lessonTopics: [],
    lessons: [],
    gradeCount: 0,
  };
}

function parseStudentSubject(
  sheet: XLSX.WorkSheet,
  row: number | null,
  lessonColumns: SheetLessonColumn[],
  subjectName: string,
  teacherName: string | null,
  sheetName: string,
  lessonTopics: LessonTopic[],
): SubjectSummary {
  if (!row) {
    return {
      ...buildBlankSubject(sheetName, subjectName, teacherName),
      lessonTopics,
      lessons: lessonColumns.map(({ index: _index, ...lesson }) => { void _index; return lesson; }),
    };
  }

  const grades: GradeEntry[] = [];
  const numericGrades: number[] = [];
  const absences: AbsenceSummary = { valid: 0, invalid: 0 };

  for (const lesson of lessonColumns) {
    // A merged mark belongs only to its origin. Never copy it to adjacent dates/students.
    const direct = getDirectCell(sheet, row, lesson.index);
    const rawValue = direct?.v;
    const stringValue = direct ? normalizeText(direct.w ?? direct.v) : '';

    if (!stringValue) {
      continue;
    }

    const mark = parseMarkValue(rawValue);
    if (mark.attendance === 'valid') {
      absences.valid += 1;
    }

    if (mark.attendance === 'invalid') {
      absences.invalid += 1;
    }

    numericGrades.push(...mark.numbers);

    grades.push({
      id: lesson.id,
      column: lesson.column,
      monthLabel: lesson.monthLabel,
      dayLabel: lesson.dayLabel,
      label: lesson.label,
      value: stringValue,
      numericValues: mark.numbers,
      attendance: mark.attendance,
      date: lesson.date,
      dateKey: lesson.dateKey,
      datePrecision: lesson.datePrecision,
    });
  }

  return {
    sheetName,
    subjectName,
    teacherName,
    average: numericGrades.length ? roundTo(numericGrades.reduce((sum, value) => sum + value, 0) / numericGrades.length) : null,
    absences,
    grades,
    lessonTopics,
    lessons: lessonColumns.map(({ index: _index, ...lesson }) => { void _index; return lesson; }),
    gradeCount: numericGrades.length,
  };
}

function buildRowResolver(sheet: XLSX.WorkSheet): (studentName: string, index: number) => number | null {
  const numberedRows = collectNumberedRows(sheet);

  if (numberedRows.length > 0) {
    const rowsByName = new Map<string, number>();

    for (const entry of numberedRows) {
      const key = normalizeName(entry.name);
      // Повтор студента: оценки берём из первой его строки, как и список группы.
      if (rowsByName.has(key)) continue;
      rowsByName.set(key, entry.row);
    }

    return (studentName: string) => rowsByName.get(normalizeName(studentName)) ?? null;
  }

  // If numbers disappeared, use exact names; positional fallback can expose another student's marks.
  const rowsByName = new Map<string, number>();
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  for (let row = 1; row <= range.e.r + 1; row += 1) {
    const key = normalizeName(getCellText(sheet, row, 2));
    if (!key) continue;
    if (rowsByName.has(key)) continue;
    rowsByName.set(key, row);
  }
  return (studentName: string) => rowsByName.get(normalizeName(studentName)) ?? null;
}

function isReportCardHeaderRow(sheet: XLSX.WorkSheet, row: number): boolean {
  const col2 = normalizeName(getCellText(sheet, row, 2));
  const col3 = normalizeName(getCellText(sheet, row, 3));
  const col4 = normalizeName(getCellText(sheet, row, 4));

  return col2 === 'дисциплина' && col3.includes('сесси') && col4.includes('средн');
}

function buildFallbackReportCards(students: StudentRecord[]): ReportCard[] {
  return students.map((student) => ({
    origin: 'calculated',
    studentId: student.id,
    studentName: student.name,
    overallAverage: student.overallAverage,
    totalAbsences: student.totalAbsences,
    totalAbsenceCount: student.totalAbsences.valid + student.totalAbsences.invalid,
    rows: student.subjects.map((subject, index) => ({
      origin: 'calculated',
      index: index + 1,
      subjectName: subject.subjectName,
      session: null,
      average: subject.average,
      absences: subject.absences,
    })),
  }));
}

function normalizeReportText(value: string): string | null {
  const normalized = normalizeSpaces(value);
  if (!normalized) {
    return null;
  }
  return normalized;
}

function formatReportAverageText(value: string): string {
  const parsed = parseNumber(value);
  if (parsed === null) {
    return value;
  }

  return parsed.toFixed(2).replace('.', ',');
}

function formatReportAverageNumber(value: number | null): string | null {
  if (value === null) {
    return null;
  }

  return value.toFixed(2).replace('.', ',');
}

function appendMissingReportSubjects(rows: ReportCardRow[], matchedStudent: StudentRecord | undefined): ReportCardRow[] {
  if (!matchedStudent) {
    return rows;
  }

  const existingSubjects = new Set(rows.map((row) => normalizeSubjectKey(row.subjectName)));
  const completedRows = [...rows];

  for (const subject of matchedStudent.subjects) {
    const subjectKey = normalizeSubjectKey(subject.subjectName);

    if (!subjectKey || existingSubjects.has(subjectKey)) {
      continue;
    }

    existingSubjects.add(subjectKey);
    completedRows.push({
      origin: 'calculated',
      index: completedRows.length + 1,
      subjectName: subject.subjectName,
      session: null,
      average: subject.average,
      averageLabel: subject.average === null ? 'Нет оценок' : formatReportAverageNumber(subject.average),
      absences: subject.absences,
      validAbsenceLabel: String(subject.absences.valid ?? 0),
      invalidAbsenceLabel: String(subject.absences.invalid ?? 0),
    });
  }

  return completedRows;
}

function getReportCellText(sheet: XLSX.WorkSheet, row: number, col: number): string {
  const text = getCellText(sheet, row, col);

  if (col === 4 && text) {
    return formatReportAverageText(text);
  }

  return text;
}

function getReportCellNumber(sheet: XLSX.WorkSheet, row: number, col: number): number | null {
  return parseNumber(getReportCellText(sheet, row, col));
}

function parseReportCards(workbook: XLSX.WorkBook, students: StudentRecord[]): ReportCard[] {
  const sheet = workbook.Sheets['Табели'];
  if (!sheet || !sheet['!ref']) {
    return buildFallbackReportCards(students);
  }

  const range = XLSX.utils.decode_range(sheet['!ref']);
  const studentByName = new Map(students.map((student) => [normalizeName(student.name), student]));
  const cards: ReportCard[] = [];
  const blockStarts: number[] = [];

  for (let row = 1; row <= range.e.r + 1; row += 1) {
    const studentName = getWorkbookCellText(workbook, sheet, row, 1);
    if (!studentName) {
      continue;
    }

    if (isReportCardHeaderRow(sheet, row + 2)) {
      blockStarts.push(row);
    }
  }

  for (let index = 0; index < blockStarts.length; index += 1) {
    const startRow = blockStarts[index];
    const endRow = (blockStarts[index + 1] ?? (range.e.r + 2)) - 1;
    const studentName = getWorkbookCellText(workbook, sheet, startRow, 1) || `Студент ${cards.length + 1}`;
    const matchedStudent = studentByName.get(normalizeName(studentName));
    if (!matchedStudent) throw new JournalError('JOURNAL_VALIDATION_FAILED');
    const rows: ReportCardRow[] = [];
    let overallAverage = matchedStudent?.overallAverage ?? null;
    let totalAbsences = matchedStudent?.totalAbsences ?? { valid: 0, invalid: 0 };
    let totalAbsenceCount = totalAbsences.valid + totalAbsences.invalid;

    let totalMarkerRow: number | null = null;
    for (let row = startRow + 3; row <= endRow; row += 1) {
      const markerCol5 = normalizeName(getCellText(sheet, row, 5));
      if (markerCol5.includes('общее количество пропусков')) {
        totalMarkerRow = row;
        break;
      }
    }

    const summaryRow = totalMarkerRow ? totalMarkerRow - 1 : null;
    const subjectsEndRow = summaryRow ? summaryRow - 1 : endRow;

    for (let row = startRow + 3; row <= subjectsEndRow; row += 1) {
      const rowNumberText = normalizeText(getCellValue(sheet, row, 1));
      const subjectName = getCellText(sheet, row, 2);

      if (!isStudentNumber(rowNumberText) || !subjectName) {
        continue;
      }

      const normalizedSubject = normalizeName(subjectName);
      const normalizedSession = normalizeName(getCellText(sheet, row, 3));

      if (normalizedSubject === 'дисциплина' && normalizedSession.includes('сесси')) {
        continue;
      }

      const sessionLabel = normalizeReportText(getReportCellText(sheet, row, 3));
      const averageLabel = normalizeReportText(getReportCellText(sheet, row, 4));
      const validAbsenceLabel = normalizeReportText(getReportCellText(sheet, row, 5));
      const invalidAbsenceLabel = normalizeReportText(getReportCellText(sheet, row, 6));

      rows.push({
        origin: 'source',
        index: Number.parseInt(rowNumberText, 10),
        subjectName,
        session: sessionLabel,
        average: parseNumber(averageLabel),
        averageLabel,
        absences: {
          valid: parseNumber(validAbsenceLabel) ?? 0,
          invalid: parseNumber(invalidAbsenceLabel) ?? 0,
        },
        validAbsenceLabel,
        invalidAbsenceLabel,
      });
    }

    if (summaryRow && summaryRow >= startRow + 3) {
      const summaryAverage = getReportCellNumber(sheet, summaryRow, 4);
      const summaryValid = getReportCellNumber(sheet, summaryRow, 5);
      const summaryInvalid = getReportCellNumber(sheet, summaryRow, 6);

      if (summaryAverage !== null) {
        overallAverage = summaryAverage;
      }

      totalAbsences = {
        valid: summaryValid ?? 0,
        invalid: summaryInvalid ?? 0,
      };
    }

    if (totalMarkerRow && totalMarkerRow + 1 <= endRow) {
      const totalValue = getReportCellNumber(sheet, totalMarkerRow + 1, 5);
      if (totalValue !== null) {
        totalAbsenceCount = totalValue;
      } else {
        totalAbsenceCount = totalAbsences.valid + totalAbsences.invalid;
      }
    } else {
      totalAbsenceCount = totalAbsences.valid + totalAbsences.invalid;
    }

    const rowsWithMissingSubjects = appendMissingReportSubjects(rows, matchedStudent);

    const normalizedRows = rowsWithMissingSubjects.map((row, rowIndex) => ({
      ...row,
      index: rowIndex + 1,
    }));

    if (normalizedRows.length) {
      cards.push({
        origin: 'source',
        studentId: matchedStudent?.id ?? cards.length + 1,
        studentName: matchedStudent?.name ?? studentName,
        overallAverage,
        totalAbsences,
        totalAbsenceCount,
        rows: normalizedRows,
      });
    }
  }

  if (!cards.length) {
    return buildFallbackReportCards(students);
  }

  const known = new Set(cards.map((card) => card.studentId));
  cards.push(...buildFallbackReportCards(students.filter((student) => !known.has(student.id))));
  if (new Set(cards.map((card) => card.studentId)).size !== cards.length) throw new JournalError('JOURNAL_VALIDATION_FAILED');
  return cards.sort((a, b) => a.studentId - b.studentId);
}

function parseWorkbook(buffer: Buffer, fileInfo: JournalFileResult): JournalData {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: false,
    cellNF: true,
    dense: false,
  });

  if (workbook.SheetNames.length > 100) throw new JournalError('JOURNAL_TOO_LARGE');
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
    if (range.e.r > 10000 || range.e.c > 1024 || (range.e.r + 1) * (range.e.c + 1) > 1000000) throw new JournalError('JOURNAL_TOO_LARGE');
    sheet['!journalDate1904'] = Boolean(workbook.Workbook?.WBProps?.date1904);
  }

  const roster = buildRoster(workbook);
  const students: StudentRecord[] = roster.students.map((name, index) => ({
    id: index + 1,
    key: createHash('sha256').update(normalizeName(name)).digest('hex').slice(0, 24),
    name,
    overallAverage: null,
    totalAbsences: {
      valid: 0,
      invalid: 0,
    },
    subjects: [],
  }));

  const subjectMeta: SubjectMeta[] = [];

  for (const sheetName of workbook.SheetNames) {
    if (EXCLUDED_SHEETS.has(sheetName)) {
      continue;
    }

    const sheet = workbook.Sheets[sheetName];
    const ref = sheet['!ref'];
    if (!ref) {
      continue;
    }

    const range = XLSX.utils.decode_range(ref);
    const maxColumn = range.e.c + 1;
    const header = detectHeaderRows(sheet);
    if (!header) {
      if (collectNumberedRows(sheet).length) throw new JournalError('JOURNAL_STRUCTURE_CHANGED');
      continue;
    }
    const { summaryColumns } = findSummaryColumns(sheet, maxColumn, [header.monthRow, header.dayRow]);

    const subjectName = detectSubjectName(sheet, sheetName);
    const teacherName = detectTeacherName(sheet);
    const rowResolver = buildRowResolver(sheet);
    const resolvedRows = roster.students
      .map((studentName, index) => rowResolver(studentName, index))
      .filter((row): row is number => row !== null);
    const explicitAcademicYear = workbook.SheetNames.flatMap((name) => {
      const current = workbook.Sheets[name];
      return [1, 2, 3].flatMap((r) => [1, 2, 3, 4].map((c) => getCellText(current, r, c)));
    }).join(' ').match(/\b((?:19|20)\d{2})\s*[-/]\s*(?:19|20)\d{2}\b/);
    const configuredYear = Number(process.env.JOURNAL_ACADEMIC_YEAR_START);
    const yearHint = explicitAcademicYear ? Number(explicitAcademicYear[1]) : Number.isInteger(configuredYear) && configuredYear >= 1900 && configuredYear <= 2199 ? configuredYear : undefined;
    const lessonColumns = buildLessonColumns(sheet, maxColumn, summaryColumns, resolvedRows, header, sheetName, yearHint);
    const lessonTopics = parseLessonTopics(sheet);

    subjectMeta.push({
      sheetName,
      subjectName,
      teacherName,
      lessons: lessonColumns.map(({ index: _index, ...lesson }) => { void _index; return lesson; }),
    });

    students.forEach((student, index) => {
      const row = rowResolver(student.name, index);
      const subject = parseStudentSubject(sheet, row, lessonColumns, subjectName, teacherName, sheetName, lessonTopics);
      student.subjects.push(subject);
      student.totalAbsences.valid += subject.absences.valid;
      student.totalAbsences.invalid += subject.absences.invalid;
    });
  }

  for (const student of students) {
    const marks = student.subjects.flatMap((subject) => subject.grades.flatMap((grade) => grade.numericValues));
    student.overallAverage = marks.length
      ? roundTo(marks.reduce((sum, value) => sum + value, 0) / marks.length)
      : null;
  }

  if (!subjectMeta.length) throw new JournalError('JOURNAL_STRUCTURE_CHANGED');

  const reportCards = parseReportCards(workbook, students);

  return {
    groupName: roster.groupName,
    source: fileInfo.source,
    // Наружу отдаём только вид источника: внутренний путь кэша и публичная
    // ссылка на Яндекс.Диск не должны попадать в ответ /api/journal.
    sourceDetails: fileInfo.source === 'local' ? (fileInfo.fileName ?? 'локальный файл') : 'Яндекс.Диск',
    updatedAt: fileInfo.fetchedAt ?? new Date().toISOString(),
    sync: fileInfo.sync,
    studentCount: students.length,
    subjectCount: subjectMeta.length,
    subjects: subjectMeta,
    students,
    reportCards,
  };
}

export function parseJournalWorkbook(buffer: Buffer, fileInfo: JournalFileResult): JournalData {
  const started = Date.now();
  if (buffer.length > 20 * 1024 * 1024) throw new JournalError('JOURNAL_TOO_LARGE');
  if (buffer.subarray(0, 2).toString() !== 'PK' && buffer.subarray(0, 8).toString('hex') !== 'd0cf11e0a1b11ae1') {
    const preview = buffer.subarray(0, 2048).toString('utf8');
    if (/type\s*=\s*["']?password|sign.?in|вход|авторизац/i.test(preview)) throw new JournalError('JOURNAL_AUTH_REQUIRED', 401);
    throw new JournalError('JOURNAL_STRUCTURE_CHANGED');
  }
  try {
    checkWorkbookArchive(buffer);
    const data = parseWorkbook(buffer, fileInfo);
    logJournalEvent('parse', { durationMs: Date.now() - started, subjects: data.subjectCount, students: data.studentCount });
    return data;
  } catch (error) {
    if (error instanceof JournalError) throw error;
    throw new JournalError('JOURNAL_PARSE_FAILED');
  }
}
