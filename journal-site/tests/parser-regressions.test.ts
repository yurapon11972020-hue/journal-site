import { afterEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseJournalWorkbook } from '@/lib/parseJournal';
import { buildJournalWorkbook } from './helpers/journal-fixture';
import { journalDate } from '@/lib/journal-dates';
import { compareJournals } from '@/lib/journal-changes';
import { readValidatedJournal } from '@/lib/validated-journal';

function parse(buffer: Buffer) { return parseJournalWorkbook(buffer, { buffer, source: 'local', sourceDetails: '/private/test.xlsx' }); }
function modified(change: (book: XLSX.WorkBook) => void, options: Parameters<typeof buildJournalWorkbook>[0] = {}) {
  const book = XLSX.read(buildJournalWorkbook(options), { type: 'buffer', cellNF: true });
  change(book);
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
afterEach(() => { delete process.env.JOURNAL_ACADEMIC_YEAR_START; globalThis.__validatedJournalCache = undefined; });

describe('даты и структура реального XLSX адаптера', () => {
  it('пустые занятия сохраняются отдельно от отметок', () => {
    const data = parse(buildJournalWorkbook({ students: ['Тестовый Студент'], marks: [[]] }));
    expect(data.subjects[0].lessons).toHaveLength(6);
    expect(data.students[0].subjects[0].grades).toEqual([]);
    expect(data.students[0].overallAverage).toBeNull();
  });

  it('не выдумывает год, разделяет две пары в один день', () => {
    const data = parse(buildJournalWorkbook({ lessonDays: ['8', '8'], marks: [['4', '5']] }));
    const grades = data.students[0].subjects[0].grades;
    expect(grades.map((mark) => mark.date)).toEqual([null, null]);
    expect(grades.map((mark) => mark.dateKey)).toEqual(['--09-08', '--09-08']);
    expect(grades[0].id).not.toBe(grades[1].id);
  });

  it('переход декабря в январь относится к одному учебному году', () => {
    process.env.JOURNAL_ACADEMIC_YEAR_START = '2026';
    const data = parse(modified((book) => {
      for (const name of book.SheetNames) {
        const sheet = book.Sheets[name];
        sheet.C3 = { t: 's', v: 'Декабрь' }; sheet.D3 = { t: 's', v: 'Январь' };
      }
    }, { lessonDays: ['31', '1'] }));
    expect(data.subjects[0].lessons.map((lesson) => lesson.date)).toEqual(['2026-12-31', '2027-01-01']);
  });

  it('явный год источника имеет приоритет над настройкой', () => {
    process.env.JOURNAL_ACADEMIC_YEAR_START = '2026';
    expect(journalDate('Сентябрь', '08.09.2025', 2026).date).toBe('2025-09-08');
    expect(journalDate(null, '2026-09-08').date).toBe('2026-09-08');
    expect(journalDate('01.09.2026', '8').date).toBe('2026-09-08');
  });

  it.each(['31.04.2026', '29.02.2025', '00.09.2026', '99.99.2026'])('отвергает некорректную дату %s', (date) => {
    expect(journalDate(null, date).dateKey).toBeNull();
    expect(() => parse(modified((book) => { book.Sheets[book.SheetNames[0]].C4 = { t: 's', v: date }; }))).toThrow();
  });

  it('Excel serial 1900 и 1904 даёт одну календарную дату без timezone', () => {
    for (const date1904 of [false, true]) {
      const data = parse(modified((book) => {
        book.Workbook ??= {}; book.Workbook.WBProps = { date1904 };
        const serial = (Date.UTC(2026, 8, 8) - Date.UTC(1899, 11, 30)) / 86400000 - (date1904 ? 1462 : 0);
        book.Sheets[book.SheetNames[0]].C4 = { t: 'n', v: serial, z: 'dd.mm.yyyy' };
      }));
      expect(data.subjects[0].lessons[0].date).toBe('2026-09-08');
    }
  });

  it('дополнительная служебная колонка не становится оценкой и не сдвигает дату', () => {
    const data = parse(modified((book) => {
      for (const name of book.SheetNames) {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, defval: '' });
        rows.forEach((row) => row.splice(3, 0, ''));
        rows[2][3] = 'Служебный уровень'; rows[4][3] = 2;
        book.Sheets[name] = XLSX.utils.aoa_to_sheet(rows);
      }
    }, { students: ['Студент Тест'], marks: [['5', '4']] }));
    expect(data.students[0].subjects[0].grades.map((grade) => grade.value)).toEqual(['5', '4']);
    expect(data.students[0].subjects[0].average).toBe(4.5);
    expect(data.students[0].subjects[0].grades[1].dateKey).toBe('--09-11');
  });

  it('сдвиг шапки вниз не теряет предмет', () => {
    const data = parse(modified((book) => {
      for (const name of book.SheetNames) {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, defval: '' });
        rows.splice(2, 0, []);
        book.Sheets[name] = XLSX.utils.aoa_to_sheet(rows);
      }
    }));
    expect(data.subjectCount).toBe(2);
    expect(data.subjects[0].lessons).toHaveLength(6);
  });

  it('предмет без колонки среднего остаётся предметом', () => {
    expect(parse(modified((book) => { for (const name of book.SheetNames) book.Sheets[name].I3 = { t: 's', v: 'Итог' }; })).subjectCount).toBe(2);
  });

  it('объединённая оценка учитывается один раз', () => {
    const data = parse(modified((book) => {
      const sheet = book.Sheets[book.SheetNames[0]];
      sheet['!merges'] = [XLSX.utils.decode_range('C5:D5')]; delete sheet.D5;
    }, { students: ['Тест Студент'], marks: [['5', '']] }));
    expect(data.students[0].subjects[0].grades.map((grade) => grade.value)).toEqual(['5']);
  });

  // Дубль ФИО встречается в настоящих журналах колледжа. Раньше он отменял
  // разбор всего файла, и группа не открывалась целиком. Теперь студент
  // показывается один раз, а отметки берутся из первой его строки —
  // строки не складываются и не смешиваются.
  it('одинаковые ФИО не смешиваются и не ломают журнал', () => {
    const single = parse(buildJournalWorkbook({ students: ['Тест Студент'] }));
    const doubled = parse(buildJournalWorkbook({ students: ['Тест Студент', 'Тест Студент'] }));

    expect(doubled.studentCount).toBe(1);
    expect(doubled.students[0].subjects[0].grades).toHaveLength(single.students[0].subjects[0].grades.length);
  });

  it('студенты разных предметов объединяются без потери', () => {
    const data = parse(modified((book) => { book.Sheets[book.SheetNames[1]].B5 = { t: 's', v: 'Новый Студент' }; }));
    expect(data.studentCount).toBe(4);
    expect(data.students.find((student) => student.name === 'Новый Студент')?.subjects[0].grades).toHaveLength(0);
  });

  it('при исчезновении номеров строки связываются по имени, не позиции', () => {
    const data = parse(modified((book) => {
      const name = book.SheetNames[1];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, defval: '' });
      rows[4][0] = ''; rows[5][0] = ''; [rows[4], rows[5]] = [rows[5], rows[4]];
      book.Sheets[name] = XLSX.utils.aoa_to_sheet(rows);
    }, { students: ['Первый Студент', 'Второй Студент'], marks: [['5'], ['2']], withTopics: false }));
    expect(data.students[0].subjects[1].grades[0].value).toBe('5');
    expect(data.students[1].subjects[1].grades[0].value).toBe('2');
  });

  it('неполный лист табелей не удаляет остальных студентов', () => {
    const data = parse(modified((book) => {
      const name = book.Sheets[book.SheetNames[0]].B5.v;
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[name], [], ['', 'Дисциплина', 'Сессия', 'Средний'], [1, 'Математика', '5', 4]]), 'Табели');
    }));
    expect(data.reportCards).toHaveLength(data.studentCount);
    expect(data.reportCards[0].origin).toBe('source');
    expect(data.reportCards[1].origin).toBe('calculated');
  });

  it('единая трактовка чисел и пропусков', () => {
    const subject = parse(buildJournalWorkbook({ students: ['Студент Тест'], marks: [['4/5', 'H', 'H/y', 'НУ', '4,5', 'Н/ОТР']] })).students[0].subjects[0];
    expect(subject.average).toBe(4.5);
    expect(subject.gradeCount).toBe(3);
    expect(subject.absences).toEqual({ valid: 2, invalid: 1 });
  });

  it('добавление, исправление и удаление различаются без дублей', () => {
    const before = parse(buildJournalWorkbook({ marks: [['4', '', '5']] }));
    const after = parse(buildJournalWorkbook({ marks: [['5', '3', '']] }));
    const kinds = compareJournals(before, after).map((change) => change.kind);
    expect(kinds.filter((kind) => kind === 'changed')).toHaveLength(2);
    expect(kinds.filter((kind) => kind === 'added')).toHaveLength(2);
    expect(kinds.filter((kind) => kind === 'removed')).toHaveLength(2);
    expect(compareJournals(after, after)).toEqual([]);
  });

  it('одинаковый путь с новым содержимым инвалидирует parsed cache', () => {
    const first = buildJournalWorkbook({ marks: [['4']] });
    const second = buildJournalWorkbook({ marks: [['5']] });
    const info = { source: 'local' as const, sourceDetails: '/same/path.xlsx', fetchedAt: '2026-09-08T12:00:00.000Z' };
    expect(readValidatedJournal({ ...info, buffer: first }).students[0].subjects[0].grades[0].value).toBe('4');
    const next = readValidatedJournal({ ...info, buffer: second });
    expect(next.students[0].subjects[0].grades[0].value).toBe('5');
    expect(next.updatedAt).toBe(info.fetchedAt);
  });
});
