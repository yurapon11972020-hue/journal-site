export interface JournalDate {
  date: string | null;
  dateKey: string | null;
  datePrecision: 'day' | 'month-day' | 'unknown';
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'ма', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

export function monthNumber(label: string): number | null {
  const text = label.toLowerCase().trim();
  const numeric = /^(\d{1,2})(?:\s+(?:19|20)\d{2})?$/.exec(text);
  if (numeric) return Number(numeric[1]) >= 1 && Number(numeric[1]) <= 12 ? Number(numeric[1]) : null;
  const index = MONTHS.findIndex((month) => text.startsWith(month));
  return index < 0 ? null : index + 1;
}

export function journalDate(monthLabel: string | null, dayLabel: string | null, yearHint?: number): JournalDate {
  const unknown: JournalDate = { date: null, dateKey: null, datePrecision: 'unknown' };
  const dayText = (dayLabel || '').trim();
  const monthText = (monthLabel || '').trim();
  let day: number;
  let month: number;
  let year: number | undefined;
  const full = [dayText, monthText].map((text) => /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2}|\d{4}))?$/.exec(text)).find(Boolean);
  const iso = [dayText, monthText].map((text) => /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)).find(Boolean);
  if (iso) {
    year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]);
  } else if (full) {
    day = /^\d{1,2}$/.test(dayText) && full.input === monthText ? Number(dayText) : Number(full[1]); month = Number(full[2]);
    year = full[3] ? Number(full[3]) + (full[3].length === 2 ? 2000 : 0) : yearHint;
  } else {
    if (!/^\d{1,2}$/.test(dayText)) return unknown;
    day = Number(dayText); month = monthNumber(monthText) ?? 0;
    const explicitYear = /\b((?:19|20)\d{2})\b/.exec(monthText);
    year = explicitYear ? Number(explicitYear[1]) : yearHint;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || (year !== undefined && (year < 1900 || year > 2199))) return unknown;
  // Unknown year allows Feb 29, but never assigns the current year.
  const check = new Date(Date.UTC(year ?? 2000, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return unknown;
  const md = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const date = year === undefined ? null : `${year}-${md}`;
  return { date, dateKey: date ?? `--${md}`, datePrecision: date ? 'day' : 'month-day' };
}
