import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { parseJournalWorkbook } from '@/lib/parseJournal';
import type { JournalFileResult } from '@/lib/types';

import { buildJournalWorkbook, buildMonthBlockWorkbook } from './helpers/journal-fixture';

function fileInfo(buffer: Buffer): JournalFileResult {
  return {
    buffer,
    source: 'local',
    sourceDetails: '/tmp/test.xlsx',
    fileName: 'ИСиП-25-9.xlsx',
  };
}

function parse(options?: Parameters<typeof buildJournalWorkbook>[0]) {
  const buffer = buildJournalWorkbook(options);
  return parseJournalWorkbook(buffer, fileInfo(buffer));
}

describe('parseJournalWorkbook', () => {
  const marks = [
    ['5', '5', '4', 'н', '', 'н/у'],
    ['3', '3', 'н', 'н', '2', ''],
  ];
  const students = ['Иванов Иван Иванович', 'Петров Пётр Петрович'];

  it('находит группу, студентов и предметы', () => {
    const data = parse({ students, marks });

    expect(data.groupName).toBe('ИСиП-25/9');
    expect(data.studentCount).toBe(2);
    expect(data.subjectCount).toBe(2);
    expect(data.students.map((student) => student.name)).toEqual(students);
    expect(data.subjects.map((subject) => subject.subjectName)).toEqual(['Математика', 'Информатика']);
    expect(data.subjects[0].teacherName).toBe('Петрова А. В.');
  });

  it('считает средний балл по предмету', () => {
    const data = parse({ students, marks });

    // У первого студента настоящие оценки 5, 5, 4 → 4.67.
    expect(data.students[0].subjects[0].average).toBeCloseTo(4.67, 2);
    // У второго 3, 3, 2 → 2.67.
    expect(data.students[1].subjects[0].average).toBeCloseTo(2.67, 2);
  });

  it('считает пропуски: н — неуважительный, н/у — уважительный', () => {
    const data = parse({ students, marks });

    expect(data.students[0].subjects[0].absences).toEqual({ valid: 1, invalid: 1 });
    expect(data.students[1].subjects[0].absences).toEqual({ valid: 0, invalid: 2 });

    // Итог по студенту складывается из всех предметов, здесь их два одинаковых.
    expect(data.students[0].totalAbsences).toEqual({ valid: 2, invalid: 2 });
    expect(data.students[1].totalAbsences).toEqual({ valid: 0, invalid: 4 });
  });

  it('собирает оценки по датам занятий', () => {
    const data = parse({ students, marks });
    const grades = data.students[0].subjects[0].grades;

    // Пустые клетки в список оценок не попадают: у студента 6 занятий, но 5 отметок.
    expect(grades).toHaveLength(5);
    expect(grades.map((grade) => grade.value.toLowerCase())).toEqual(['5', '5', '4', 'н', 'н/у']);
    expect(grades[0].dayLabel).toBe('4');
    expect(grades[0].monthLabel).toBe('Сентябрь');
    expect(grades.at(-1)?.monthLabel).toBe('Октябрь');
  });

  it('читает темы занятий', () => {
    const data = parse({ students, marks });
    const topics = data.students[0].subjects[0].lessonTopics;

    expect(topics).toHaveLength(6);
    expect(topics[0].topic).toBe('Математика: тема 1');
    expect(topics[0].extra).toBe('Задание 1');
  });

  it('без листа «Табели» строит табели из самих предметов', () => {
    const data = parse({ students, marks });

    expect(data.reportCards).toHaveLength(2);
    expect(data.reportCards[0].studentName).toBe(students[0]);
    expect(data.reportCards[0].rows.map((row) => row.subjectName)).toEqual(['Математика', 'Информатика']);
  });

  it('переименовывает предметы по справочнику', () => {
    const data = parse({
      students,
      marks,
      subjects: [{ name: 'Разработка кода ИС', teacher: 'Кузнецов Д. С.' }],
    });

    expect(data.subjects[0].subjectName).toBe('Разработка программных модулей');
  });

  it('на файле без списка студентов объясняет, что не так', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['совсем', 'не', 'журнал']]), 'Лист1');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    expect(() => parseJournalWorkbook(buffer, fileInfo(buffer))).toThrowError(/первом столбце[\s\S]*Просмотрены листы: Лист1/);
  });
});

describe('итоговые столбцы после каждого месяца', () => {
  // В журнале колледжа блок «Средний / Уваж. / Неуваж.» повторяется после
  // каждого месяца. Раньше разбор останавливался на первом таком блоке,
  // и все занятия следующих месяцев пропадали: клетки оставались пустыми.
  const students = ['Иванов Иван Иванович', 'Петров Пётр Петрович'];
  const marks = [
    [
      ['5', 'н', '4'],
      ['3', '5', 'н/у'],
    ],
    [
      ['н', 'н', '3'],
      ['4', '4', '5'],
    ],
  ];

  function parseBlocks(extra?: Partial<Parameters<typeof buildMonthBlockWorkbook>[0]>) {
    const buffer = buildMonthBlockWorkbook({ students, marks, ...extra });
    return parseJournalWorkbook(buffer, fileInfo(buffer));
  }

  it('оценки второго месяца больше не теряются', () => {
    const data = parseBlocks();
    const subject = data.students[0].subjects[0];

    // Три занятия в сентябре и три в октябре, пустых клеток нет.
    expect(subject.grades).toHaveLength(6);
    expect(subject.grades.map((grade) => grade.value.toLowerCase())).toEqual(['5', 'н', '4', '3', '5', 'н/у']);
    expect(subject.grades.map((grade) => grade.monthLabel)).toEqual([
      'Сентябрь',
      'Сентябрь',
      'Сентябрь',
      'Октябрь',
      'Октябрь',
      'Октябрь',
    ]);
  });

  it('средний балл считается по всем месяцам, а не по первому', () => {
    const data = parseBlocks();

    // Иванов: 5, 4 в сентябре и 3, 5 в октябре → 4.25.
    expect(data.students[0].subjects[0].average).toBeCloseTo(4.25, 2);
    // Петров: 3 в сентябре и 4, 4, 5 в октябре → 4.
    expect(data.students[1].subjects[0].average).toBeCloseTo(4, 2);
  });

  it('пропуски считаются по всем месяцам', () => {
    const data = parseBlocks();

    expect(data.students[0].subjects[0].absences).toEqual({ valid: 1, invalid: 1 });
    expect(data.students[1].subjects[0].absences).toEqual({ valid: 0, invalid: 2 });
  });

  it('в занятия не попадают сами итоговые столбцы', () => {
    const data = parseBlocks();
    const labels = data.students[0].subjects[0].grades.map((grade) => `${grade.monthLabel} ${grade.dayLabel}`);

    expect(labels.join(' ').toLowerCase()).not.toContain('средний');
    expect(labels.join(' ').toLowerCase()).not.toContain('уваж');
  });

  it('подпись из шапки бланка не становится названием предмета', () => {
    const data = parseBlocks({
      firstCellText: 'Наименование предмета',
      subjectName: 'Наименование предмета',
      sheetName: 'Физика',
    });

    expect(data.subjects[0].subjectName).toBe('Физика');
  });

  it('настоящее название предмета из бланка сохраняется', () => {
    const data = parseBlocks({ subjectName: 'Введение в специальность', sheetName: 'Лист7' });

    expect(data.subjects[0].subjectName).toBe('Введение в специальность');
  });
});
