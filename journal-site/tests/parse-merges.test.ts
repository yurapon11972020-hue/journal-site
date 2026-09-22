import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { parseJournalWorkbook } from '@/lib/parseJournal';
import type { JournalFileResult } from '@/lib/types';

interface SheetOptions {
  rows: string[][];
  /** Объединения в виде «C5:H5». */
  merges?: string[];
}

function buildWorkbook(sheets: Record<string, SheetOptions>): Buffer {
  const workbook = XLSX.utils.book_new();

  for (const [name, options] of Object.entries(sheets)) {
    const width = options.rows.reduce((max, row) => Math.max(max, row.length), 0);
    const normalized = options.rows.map((row) => [...row, ...Array<string>(width - row.length).fill('')]);
    const sheet = XLSX.utils.aoa_to_sheet(normalized);
    const merges = (options.merges ?? []).map((range) => XLSX.utils.decode_range(range));
    sheet['!merges'] = merges;

    // В настоящем файле объединённая область хранит значение только
    // в левой верхней клетке, остальных клеток там просто нет.
    // aoa_to_sheet же создаёт пустышки — убираем их, иначе объединение
    // ведёт себя не так, как в журнале от колледжа.
    for (const merge of merges) {
      for (let r = merge.s.r; r <= merge.e.r; r += 1) {
        for (let c = merge.s.c; c <= merge.e.c; c += 1) {
          if (r === merge.s.r && c === merge.s.c) {
            continue;
          }
          delete sheet[XLSX.utils.encode_cell({ r, c })];
        }
      }
    }

    XLSX.utils.book_append_sheet(workbook, sheet, name);
  }

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function fileInfo(buffer: Buffer, fileName = 'ИСиП-25-9.xlsx'): JournalFileResult {
  return { buffer, source: 'local', sourceDetails: '/tmp/merges.xlsx', fileName };
}

/** Обычный лист предмета: предмет в C1, преподаватель в C2, группа в A3. */
function subjectRows(groupName: string, studentMarks: string[][]): string[][] {
  const days = ['4', '11', '18', '25'];
  const rows: string[][] = [
    ['', '', 'Математика'],
    ['', '', 'Петрова А. В.'],
    [groupName, 'ФИО', 'Сентябрь', '', '', '', 'Средний балл', 'Уваж.', 'Неуваж.'],
    ['№', '', ...days, '', '', ''],
  ];

  studentMarks.forEach((marks, index) => {
    rows.push([`${index + 1}.`, `Студент ${index + 1} Тестович`, ...marks, '', '0', '0']);
  });

  return rows;
}

describe('объединённые клетки', () => {
  it('объединение внутри строки студента не размножается по всем оценкам', () => {
    // Преподаватель объединил хвост строки и написал там пометку:
    // C5:F5. Значение лежит только в C5, остальные клетки пусты.
    const buffer = buildWorkbook({
      Математика: {
        rows: subjectRows('ИСиП-25/9', [
          ['26/27-Д', '', '', ''],
          ['5', '4', '', 'н'],
        ]),
        merges: ['C5:F5'],
      },
    });

    const data = parseJournalWorkbook(buffer, fileInfo(buffer));
    const first = data.students[0].subjects[0];
    const values = first.grades.map((grade) => grade.value);

    expect(values.filter((value) => value === '26/27-Д')).toHaveLength(1);
    expect(data.students[1].subjects[0].grades.map((grade) => grade.value)).toEqual(['5', '4', 'н']);
  });

  it('объединённая клетка помнит, сколько столбцов занимает', () => {
    const buffer = buildWorkbook({
      Математика: {
        rows: subjectRows('ИСиП-25/9', [
          ['Контрольная работа', '', '', '5'],
          ['5', '4', '3', '4'],
        ]),
        merges: ['C5:E5'],
      },
    });

    const data = parseJournalWorkbook(buffer, fileInfo(buffer));
    const grades = data.students[0].subjects[0].grades;

    // Объединение накрыло три даты, четвёртая осталась своей клеткой.
    expect(grades.map((grade) => [grade.value, grade.span ?? 1])).toEqual([
      ['Контрольная работа', 3],
      ['5', 1],
    ]);

    // У соседа объединения нет — все четыре клетки обычные.
    expect(data.students[1].subjects[0].grades.every((grade) => (grade.span ?? 1) === 1)).toBe(true);
  });

  it('объединение не вылезает за последний столбец занятий', () => {
    const buffer = buildWorkbook({
      Математика: {
        // Объединение тянется до итоговых столбцов, но занятий всего четыре.
        rows: subjectRows('ИСиП-25/9', [['Практика', '', '', '']]),
        merges: ['C5:H5'],
      },
    });

    const data = parseJournalWorkbook(buffer, fileInfo(buffer));
    const grades = data.students[0].subjects[0].grades;

    expect(grades).toHaveLength(1);
    expect(grades[0].span).toBe(4);
  });

  it('широкая подпись под таблицей не превращается в оценки', () => {
    const rows = subjectRows('ИСиП-25/9', [['5', '4', '3', '5']]);
    rows.push([], ['ПЛАН', '', '', '', '', '']);

    const buffer = buildWorkbook({
      Математика: { rows, merges: ['A7:F7'] },
    });

    const data = parseJournalWorkbook(buffer, fileInfo(buffer));

    expect(data.students).toHaveLength(1);
    expect(data.students[0].subjects[0].grades.map((grade) => grade.value)).toEqual(['5', '4', '3', '5']);
  });

  it('темы занятий не попадают в список студентов', () => {
    const rows = subjectRows('ИСиП-25/9', [['5', '4', '3', '5'], ['4', '4', '4', '4']]);
    // Блок тем ниже таблицы: строки там тоже пронумерованы.
    rows.push([], ['Дата', 'Тема занятия', 'Домашнее задание'], ['1.', 'Значение информации'], [
      '2.',
      'Свойства и виды информации',
    ]);

    const buffer = buildWorkbook({ Математика: { rows } });
    const data = parseJournalWorkbook(buffer, fileInfo(buffer));

    expect(data.students.map((student) => student.name)).toEqual(['Студент 1 Тестович', 'Студент 2 Тестович']);
  });

  it('учебный год в объединённой шапке не становится названием группы', () => {
    const rows = subjectRows('', [['5', '4', '3', '5']]);
    rows[0] = ['2026/2027 учебный год', '', 'Математика'];

    const buffer = buildWorkbook({
      Математика: { rows, merges: ['A1:B1'] },
    });

    const data = parseJournalWorkbook(buffer, fileInfo(buffer, 'ИБ-26-2.xlsx'));

    expect(data.groupName).toBe('ИБ-26/2');
  });

  it('название группы берётся из шапки, а не из имени файла', () => {
    const buffer = buildWorkbook({
      Математика: { rows: subjectRows('ИБ 26/2', [['5', '4', '3', '5']]) },
    });

    expect(parseJournalWorkbook(buffer, fileInfo(buffer, 'n2Ldf1ar5jbjJg.xlsx')).groupName).toBe('ИБ-26/2');
    expect(parseJournalWorkbook(buffer, fileInfo(buffer, 'ИСиП-26-2.xlsx')).groupName).toBe('ИБ-26/2');
  });
});
