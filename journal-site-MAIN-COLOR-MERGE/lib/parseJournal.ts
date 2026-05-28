import * as XLSX from 'xlsx';

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

interface SheetLessonColumn {
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
    const day = String(value.getDate()).padStart(2, '0');
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const year = value.getFullYear();
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

function getWorkbookCellNumber(workbook: XLSX.WorkBook, sheet: XLSX.WorkSheet, row: number, col: number): number | null {
  const resolvedText = getWorkbookCellText(workbook, sheet, row, col);
  if (resolvedText) {
    return parseNumber(resolvedText);
  }

  const cell = getCell(sheet, row, col);
  const formula = typeof cell?.f === 'string' ? cell.f : '';
  const formulaBody = formula.trim().replace(/^=/, '').trim();

  const averageMatch = formulaBody.match(/^IFERROR\(AVERAGE\(([$]?[A-Z]+[$]?\d+):([$]?[A-Z]+[$]?\d+)\),\s*""\)$/i);
  if (averageMatch) {
    const start = XLSX.utils.decode_cell(averageMatch[1].replace(/\$/g, '').toUpperCase());
    const end = XLSX.utils.decode_cell(averageMatch[2].replace(/\$/g, '').toUpperCase());
    const values: number[] = [];
    for (let r = start.r; r <= end.r; r += 1) {
      const value = parseNumber(getWorkbookCellText(workbook, sheet, r + 1, start.c + 1));
      if (value !== null) {
        values.push(value);
      }
    }
    return values.length ? roundTo(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  }

  const sumMatch = formulaBody.match(/^SUM\(([$]?[A-Z]+[$]?\d+):([$]?[A-Z]+[$]?\d+)\)$/i);
  if (sumMatch) {
    const start = XLSX.utils.decode_cell(sumMatch[1].replace(/\$/g, '').toUpperCase());
    const end = XLSX.utils.decode_cell(sumMatch[2].replace(/\$/g, '').toUpperCase());
    let total = 0;
    let hasValue = false;
    for (let r = start.r; r <= end.r; r += 1) {
      for (let c = start.c; c <= end.c; c += 1) {
        const value = getWorkbookCellNumber(workbook, sheet, r + 1, c + 1);
        if (value !== null) {
          total += value;
          hasValue = true;
        }
      }
    }
    return hasValue ? total : null;
  }

  return parseNumber(getCellText(sheet, row, col));
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

function parseNumericGrade(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 1 && value <= 5) {
      return value;
    }

    return null;
  }

  const normalized = normalizeName(value);
  const match = normalized.match(/^([1-5])([+-])?$/);
  return match ? Number(match[1]) : null;
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

function isInvalidAbsence(value: unknown): boolean {
  return normalizeName(value) === 'н';
}

function isValidAbsence(value: unknown): boolean {
  return normalizeName(value) === 'н/у';
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
    throw new Error('Не удалось определить список студентов в журнале.');
  }

  return {
    groupName: detectGroupName(workbook),
    students: bestRows.map((entry) => entry.name),
  };
}

function findSummaryColumns(sheet: XLSX.WorkSheet, maxColumn: number): {
  averageCol: number | null;
  validCol: number | null;
  invalidCol: number | null;
} {
  let averageCol: number | null = null;
  let validCol: number | null = null;
  let invalidCol: number | null = null;

  for (const headerRow of [3, 4]) {
    for (let col = 1; col <= maxColumn; col += 1) {
      const header = normalizeName(getCellText(sheet, headerRow, col));

      if (!averageCol && header.includes('средний')) {
        averageCol = col;
      }

      if (!validCol && header.includes('уваж')) {
        validCol = col;
      }

      if (!invalidCol && header.includes('неуваж')) {
        invalidCol = col;
      }
    }
  }

  return { averageCol, validCol, invalidCol };
}

function detectSubjectName(sheet: XLSX.WorkSheet, fallback: string): string {
  const c1 = getCellText(sheet, 1, 3);
  if (c1 && !['наименование предмета', 'предмет'].includes(normalizeName(c1))) {
    return normalizeSubjectDisplayName(c1);
  }

  const a1 = getCellText(sheet, 1, 1);
  return normalizeSubjectDisplayName(a1 || fallback);
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
  averageCol: number,
  rosterRows: number[],
): SheetLessonColumn[] {
  const columns: SheetLessonColumn[] = [];
  let lastMonthLabel = '';

  for (let col = 3; col < averageCol; col += 1) {
    const rawMonthLabel = getCellText(sheet, 3, col);
    if (rawMonthLabel) {
      lastMonthLabel = rawMonthLabel;
    }

    const monthLabel = rawMonthLabel || lastMonthLabel || null;
    const dayLabel = getCellText(sheet, 4, col) || null;
    const headerText = normalizeName(`${monthLabel || ''} ${dayLabel || ''}`);

    if (headerText.includes('средний') || headerText.includes('уваж') || headerText.includes('неуваж')) {
      continue;
    }

    if (headerText.includes('пропуски')) {
      continue;
    }

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
    columns.push({
      index: col,
      column: columnLetter,
      monthLabel: monthLabel ? normalizeSpaces(monthLabel) : null,
      dayLabel: dayLabel ? normalizeSpaces(dayLabel) : null,
      label: buildLessonLabel(monthLabel || null, dayLabel || null, columnLetter),
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
    };
  }

  const grades: GradeEntry[] = [];
  const numericGrades: number[] = [];
  const absences: AbsenceSummary = { valid: 0, invalid: 0 };

  for (const lesson of lessonColumns) {
    const rawValue = getCellValue(sheet, row, lesson.index);
    const stringValue = getCellText(sheet, row, lesson.index);

    if (!stringValue) {
      continue;
    }

    if (isValidAbsence(rawValue)) {
      absences.valid += 1;
    }

    if (isInvalidAbsence(rawValue)) {
      absences.invalid += 1;
    }

    const numericGrade = parseNumericGrade(rawValue);
    if (numericGrade !== null) {
      numericGrades.push(numericGrade);
    }

    grades.push({
      column: lesson.column,
      monthLabel: lesson.monthLabel,
      dayLabel: lesson.dayLabel,
      label: lesson.label,
      value: stringValue,
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
  };
}

function buildRowResolver(sheet: XLSX.WorkSheet): (studentName: string, index: number) => number | null {
  const numberedRows = collectNumberedRows(sheet);

  if (numberedRows.length > 0) {
    const rowsByName = new Map<string, number>();

    for (const entry of numberedRows) {
      rowsByName.set(normalizeName(entry.name), entry.row);
    }

    return (studentName: string) => rowsByName.get(normalizeName(studentName)) ?? null;
  }

  const fallbackStartRow = 5;
  return (_studentName: string, index: number) => fallbackStartRow + index;
}

function isReportCardHeaderRow(sheet: XLSX.WorkSheet, row: number): boolean {
  const col2 = normalizeName(getCellText(sheet, row, 2));
  const col3 = normalizeName(getCellText(sheet, row, 3));
  const col4 = normalizeName(getCellText(sheet, row, 4));

  return col2 === 'дисциплина' && col3.includes('сесси') && col4.includes('средн');
}

function buildFallbackReportCards(students: StudentRecord[]): ReportCard[] {
  return students.map((student) => ({
    studentId: student.id,
    studentName: student.name,
    overallAverage: student.overallAverage,
    totalAbsences: student.totalAbsences,
    totalAbsenceCount: student.totalAbsences.valid + student.totalAbsences.invalid,
    rows: student.subjects.map((subject, index) => ({
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
  if (!normalized || normalized === '0') {
    return null;
  }
  return normalized;
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

      const sessionLabel = normalizeReportText(getWorkbookCellText(workbook, sheet, row, 3));
      const averageLabel = normalizeReportText(getWorkbookCellText(workbook, sheet, row, 4));
      const validAbsenceLabel = normalizeReportText(getWorkbookCellText(workbook, sheet, row, 5));
      const invalidAbsenceLabel = normalizeReportText(getWorkbookCellText(workbook, sheet, row, 6));

      rows.push({
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
      const summaryAverage = getWorkbookCellNumber(workbook, sheet, summaryRow, 4);
      const summaryValid = getWorkbookCellNumber(workbook, sheet, summaryRow, 5);
      const summaryInvalid = getWorkbookCellNumber(workbook, sheet, summaryRow, 6);

      if (summaryAverage !== null) {
        overallAverage = summaryAverage;
      }

      totalAbsences = {
        valid: summaryValid ?? 0,
        invalid: summaryInvalid ?? 0,
      };
    }

    if (totalMarkerRow && totalMarkerRow + 1 <= endRow) {
      const totalValue = getWorkbookCellNumber(workbook, sheet, totalMarkerRow + 1, 5);
      if (totalValue !== null) {
        totalAbsenceCount = totalValue;
      } else {
        totalAbsenceCount = totalAbsences.valid + totalAbsences.invalid;
      }
    } else {
      totalAbsenceCount = totalAbsences.valid + totalAbsences.invalid;
    }

    let normalizedRows = rows;

    if (matchedStudent) {
      const rowsBySubject = new Map(rows.map((row) => [normalizeSubjectKey(row.subjectName), row]));
      const mergedRows: ReportCardRow[] = matchedStudent.subjects.map((subject, subjectIndex) => {
        const existingRow = rowsBySubject.get(normalizeSubjectKey(subject.subjectName));
        if (existingRow) {
          return existingRow;
        }

        return {
          index: subjectIndex + 1,
          subjectName: subject.subjectName,
          session: null,
          average: subject.average,
          absences: {
            valid: subject.absences.valid,
            invalid: subject.absences.invalid,
          },
        };
      });

      const extraRows = rows.filter(
        (row) => !matchedStudent.subjects.some((subject) => normalizeSubjectKey(subject.subjectName) === normalizeSubjectKey(row.subjectName)),
      );

      normalizedRows = [...mergedRows, ...extraRows].map((row, rowIndex) => ({
        ...row,
        index: rowIndex + 1,
      }));
    }

    if (normalizedRows.length) {
      cards.push({
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

  return cards.sort((a, b) => a.studentId - b.studentId);
}

function parseWorkbook(buffer: Buffer, fileInfo: JournalFileResult): JournalData {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
    dense: false,
  });

  const roster = buildRoster(workbook);
  const students: StudentRecord[] = roster.students.map((name, index) => ({
    id: index + 1,
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
    const { averageCol } = findSummaryColumns(sheet, range.e.c + 1);

    if (!averageCol) {
      continue;
    }

    const subjectName = detectSubjectName(sheet, sheetName);
    const teacherName = detectTeacherName(sheet);
    const rowResolver = buildRowResolver(sheet);
    const resolvedRows = roster.students
      .map((studentName, index) => rowResolver(studentName, index))
      .filter((row): row is number => row !== null);
    const lessonColumns = buildLessonColumns(sheet, averageCol, resolvedRows);
    const lessonTopics = parseLessonTopics(sheet);

    subjectMeta.push({
      sheetName,
      subjectName,
      teacherName,
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
    const averages = student.subjects
      .map((subject) => subject.average)
      .filter((value): value is number => value !== null);

    student.overallAverage = averages.length
      ? roundTo(averages.reduce((sum, value) => sum + value, 0) / averages.length)
      : null;
  }

  const reportCards = parseReportCards(workbook, students);

  return {
    groupName: roster.groupName,
    source: fileInfo.source,
    sourceDetails: fileInfo.sourceDetails,
    updatedAt: new Date().toISOString(),
    studentCount: students.length,
    subjectCount: subjectMeta.length,
    subjects: subjectMeta,
    students,
    reportCards,
  };
}

export function parseJournalWorkbook(buffer: Buffer, fileInfo: JournalFileResult): JournalData {
  return parseWorkbook(buffer, fileInfo);
}
