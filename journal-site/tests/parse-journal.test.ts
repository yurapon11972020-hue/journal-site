import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { parseJournalWorkbook } from '@/lib/parseJournal';
import type { JournalFileResult } from '@/lib/types';

import { buildJournalWorkbook } from './helpers/journal-fixture';

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
