import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { parseJournalWorkbook } from '@/lib/parseJournal';
import type { JournalFileResult } from '@/lib/types';

/**
 * Форма журнала колледжа: подписи «Месяц» и «Число» стоят во втором столбце,
 * в первом — номер группы. Оба случая ниже встретились в настоящих файлах и
 * раньше отменяли разбор всего журнала целиком.
 */
function build(sheets: Array<{ name: string; rows: string[][] }>): Buffer {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const width = sheet.rows.reduce((max, row) => Math.max(max, row.length), 0);
    const normalized = sheet.rows.map((row) => [...row, ...Array<string>(width - row.length).fill('')]);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(normalized), sheet.name);
  }
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function parse(buffer: Buffer) {
  const info = { buffer, source: 'local', sourceDetails: '/tmp/test.xlsx', fileName: 'ИСиП-25-9.xlsx' } as JournalFileResult;
  return parseJournalWorkbook(buffer, info);
}

const withLessons = {
  name: 'Математика',
  rows: [
    ['Наименование предмета', '', 'Математика'],
    ['ФИО преподавателя', '', 'Петрова А. В.'],
    ['ИСиП 25/9', 'Месяц', 'Сентябрь', 'Сентябрь', 'Средний', 'Уваж.', 'Неуваж.'],
    ['', 'Число', '2', '4', '', '', ''],
    ['1.', 'Иванов Иван Иванович', '5', 'н', '5', '', '1'],
    ['2.', 'Петров Пётр Петрович', '4', '4', '4', '', ''],
  ],
};

describe('журнал в форме колледжа', () => {
  it('предмет без единого занятия не ломает весь журнал', () => {
    const empty = {
      name: 'Физика',
      rows: [
        ['Наименование предмета', '', 'Физика'],
        ['ФИО преподавателя', '', 'Волков Р. Н.'],
        ['ИСиП 25/9', 'Месяц', '', '', 'Средний', 'Уваж.', 'Неуваж.'],
        ['', 'Число', '', '', '', '', ''],
        ['1.', 'Иванов Иван Иванович', '', '', '', '', ''],
        ['2.', 'Петров Пётр Петрович', '', '', '', '', ''],
      ],
    };

    const data = parse(build([withLessons, empty]));

    expect(data.studentCount).toBe(2);
    expect(data.subjects.map((subject) => subject.subjectName)).toEqual(['Математика', 'Физика']);
    // Занятий по физике ещё не было — предмет виден, но пустой.
    expect(data.students[0].subjects[1].grades).toHaveLength(0);
    // Оценки по математике при этом на месте.
    expect(data.students[0].subjects[0].grades.map((grade) => grade.value.toLowerCase())).toEqual(['5', 'н']);
  });

  it('студент, записанный в журнале дважды, показывается один раз', () => {
    const duplicated = {
      name: 'Математика',
      rows: [
        ...withLessons.rows,
        ['3.', 'Иванов Иван Иванович', '3', '3', '3', '', ''],
      ],
    };

    const data = parse(build([duplicated]));

    expect(data.students.map((student) => student.name)).toEqual(['Иванов Иван Иванович', 'Петров Пётр Петрович']);
    // Берётся первая строка студента: оценки из неё, а не из повтора.
    expect(data.students[0].subjects[0].grades.map((grade) => grade.value.toLowerCase())).toEqual(['5', 'н']);
  });
});
