import * as XLSX from 'xlsx';

export interface FixtureOptions {
  groupName?: string;
  students?: string[];
  subjects?: Array<{ name: string; teacher: string }>;
  /** Оценки по строкам студентов: marks[индекс студента][индекс занятия]. */
  marks?: string[][];
  lessonDays?: string[];
  withTopics?: boolean;
}

const DEFAULT_STUDENTS = ['Абрамов Пётр Ильич', 'Волкова Мария Ивановна', 'Гусев Артём Олегович'];
const DEFAULT_SUBJECTS = [
  { name: 'Математика', teacher: 'Петрова А. В.' },
  { name: 'Информатика', teacher: 'Сидоров И. И.' },
];

/**
 * Собирает Excel-журнал такой же формы, какую присылает колледж:
 * лист на предмет, предмет в C1, преподаватель в C2, группа в A3,
 * месяцы в строке 3, числа в строке 4, студенты с 5-й строки,
 * затем три итоговых столбца и блок тем занятий.
 */
export function buildJournalWorkbook(options: FixtureOptions = {}): Buffer {
  const groupName = options.groupName ?? 'ИСиП-25/9';
  const students = options.students ?? DEFAULT_STUDENTS;
  const subjects = options.subjects ?? DEFAULT_SUBJECTS;
  const lessonDays = options.lessonDays ?? ['4', '11', '18', '25', '2', '9'];
  const workbook = XLSX.utils.book_new();

  for (const [subjectIndex, subject] of subjects.entries()) {
    const rows: string[][] = [];
    rows[0] = ['', '', subject.name];
    rows[1] = ['', '', subject.teacher];
    rows[2] = [
      groupName,
      'ФИО',
      ...lessonDays.map((_, index) => (index < 4 ? 'Сентябрь' : 'Октябрь')),
      'Средний балл',
      'Уваж. пропуски',
      'Неуваж. пропуски',
    ];
    rows[3] = ['№', '', ...lessonDays, '', '', ''];

    students.forEach((student, studentIndex) => {
      const values =
        options.marks?.[studentIndex] ??
        lessonDays.map((_, dayIndex) => ['5', '4', '3', 'н', 'н/у', ''][(studentIndex + dayIndex + subjectIndex) % 6]);

      const numeric = values.map(Number).filter((value) => Number.isFinite(value) && value > 0);
      const average = numeric.length ? Math.round((numeric.reduce((a, b) => a + b, 0) / numeric.length) * 100) / 100 : '';
      const valid = values.filter((value) => value === 'н/у').length;
      const invalid = values.filter((value) => value === 'н').length;

      rows[4 + studentIndex] = [`${studentIndex + 1}.`, student, ...values, String(average), String(valid), String(invalid)];
    });

    if (options.withTopics !== false) {
      const topicsStart = 4 + students.length + 2;
      rows[topicsStart] = ['Дата', 'Тема занятия', 'Домашнее задание'];
      lessonDays.forEach((day, index) => {
        rows[topicsStart + 1 + index] = [`0${index + 1}.09`, `${subject.name}: тема ${index + 1}`, `Задание ${index + 1}`];
      });
    }

    const width = rows.reduce((max, row) => Math.max(max, row?.length ?? 0), 0);
    const normalized: string[][] = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index] ?? [];
      normalized.push([...row, ...Array<string>(width - row.length).fill('')]);
    }

    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(normalized), subject.name);
  }

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
