import { parseMarkValue } from '@/lib/mark-values';

export type MarkTone =
  | 'excellent'
  | 'good'
  | 'ok'
  | 'bad'
  | 'absence'
  | 'valid-absence'
  | 'electronic-absence'
  | 'empty'
  | 'plain';

export interface ClassifiedMark {
  tone: MarkTone;
  displayText: string;
  isColored: boolean;
}

const LATIN_TO_CYRILLIC: Record<string, string> = {
  a: 'а',
  c: 'с',
  e: 'е',
  h: 'н',
  k: 'к',
  m: 'м',
  n: 'н',
  o: 'о',
  p: 'р',
  r: 'р',
  t: 'т',
  u: 'у',
  x: 'х',
  y: 'у',
};

function normalizeVisibleText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKey(value: string): string {
  const normalized = normalizeVisibleText(value)
    .replace(/[\\|]/g, '/')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, '')
    .replace(/[.。]+$/g, '');

  return normalized.replace(/[a-z]/g, (char) => LATIN_TO_CYRILLIC[char] ?? char);
}

function cleanDisplayText(value: string): string {
  return normalizeVisibleText(value);
}

function formatNumberMark(value: number): string {
  if (!Number.isFinite(value)) {
    return '—';
  }

  return value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function toneFromNumericValue(value: number): MarkTone {
  if (!Number.isFinite(value) || value <= 0) {
    return 'empty';
  }
  if (value < 1 || value > 5) return 'plain';

  if (value >= 4.5) {
    return 'excellent';
  }

  if (value >= 3.8) {
    return 'good';
  }

  if (value >= 3) {
    return 'ok';
  }

  return 'bad';
}

function toneFromGrades(grades: number[]): MarkTone {
  if (!grades.length) {
    return 'plain';
  }

  const min = Math.min(...grades);
  const max = Math.max(...grades);

  if (min <= 2) {
    return 'bad';
  }

  if (min >= 5 && max <= 5) {
    return 'excellent';
  }

  if (min >= 4) {
    return 'good';
  }

  return 'ok';
}

export function markToneToClass(tone: MarkTone): string {
  switch (tone) {
    case 'excellent':
      return 'mark--excellent';
    case 'good':
      return 'mark--good';
    case 'ok':
      return 'mark--ok';
    case 'bad':
      return 'mark--bad';
    case 'absence':
      return 'mark--absence';
    case 'valid-absence':
      return 'mark--valid-absence';
    case 'electronic-absence':
      return 'mark--electronic-absence';
    case 'empty':
      return 'mark--empty';
    case 'plain':
    default:
      return 'mark--plain';
  }
}

export function classifyMarkValue(value: string | number | null | undefined): ClassifiedMark {
  if (value === null || value === undefined || value === '') {
    return { tone: 'empty', displayText: '—', isColored: false };
  }

  if (typeof value === 'number') {
    const tone = toneFromNumericValue(value);
    return { tone, displayText: tone === 'empty' ? '—' : formatNumberMark(value), isColored: tone !== 'empty' && tone !== 'plain' };
  }

  const displayText = cleanDisplayText(value);
  const key = normalizeKey(displayText);

  if (!key || key === '-' || key === '—') {
    return { tone: 'empty', displayText: '—', isColored: false };
  }

  // Values such as \1, \2, \13 are service markers from the Excel journal.
  // They are not grades and must be displayed exactly as in Excel, without recoloring.
  if (/^[\\/]\d+$/.test(displayText.trim())) {
    const trimmed = displayText.trim();
    const exactText = trimmed.startsWith('/') ? `\\${trimmed.slice(1)}` : trimmed;
    return { tone: 'plain', displayText: exactText, isColored: false };
  }

  // These are service notes, not marks/absence marks. They must stay uncolored.
  const explicitlyPlain = new Set([
    'н/отр',
    'н/у/отр',
    'ну/отр',
    'н/уотр',
    'н/отработка',
    'н/у/отработка',
    'нетоценок',
    'нет',
    'зач',
    'зачет',
    'незачет',
    'осв',
    'освобожден',
    'освобождена',
    'б/о',
    'бо',
    'оп',
  ]);

  if (explicitlyPlain.has(key)) {
    return { tone: 'plain', displayText, isColored: false };
  }

  // Color only exact absence markers. Strings such as Н/ОТР and Н/У/ОТР are handled above as plain.
  if (key === 'эн' || key === 'э/н') {
    return { tone: 'electronic-absence', displayText, isColored: true };
  }

  if (key === 'н/у' || key === 'ну') {
    return { tone: 'valid-absence', displayText, isColored: true };
  }

  if (key === 'н') {
    return { tone: 'absence', displayText, isColored: true };
  }

  const marks = parseMarkValue(displayText).numbers;
  if (marks.length) {
    const tone = marks.length === 1 ? toneFromNumericValue(marks[0]) : toneFromGrades(marks);
    return { tone, displayText, isColored: tone !== 'plain' };
  }

  return { tone: 'plain', displayText, isColored: false };
}
