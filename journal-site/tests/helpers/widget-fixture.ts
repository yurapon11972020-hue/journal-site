import type { GradeEntry, JournalData, StudentRecord } from '@/lib/types';

/** Вымышленная группа для проверки карточек: длинные названия предметов, оценки и пропуски. */
export const WIDGET_SUBJECTS = [
  'Математика',
  'Информатика',
  'Элементы высшей математики',
  'Операционные системы и среды',
  'Архитектура аппаратных средств',
  'Иностранный язык в профессиональной деятельности',
  'Физическая культура',
  'Основы алгоритмизации и программирования',
  'Дискретная математика с элементами математической логики',
  'Компьютерные сети',
  'Безопасность жизнедеятельности',
  'История России',
  'Основы философии',
  'Психология общения',
  'Экономика отрасли',
];

export const WIDGET_STUDENTS = [
  'Абрамов Пётр Ильич', 'Волкова Мария Ивановна', 'Гусев Артём Олегович', 'Данилова Ксения Сергеевна',
  'Егоров Максим Андреевич', 'Жукова Алина Дмитриевна', 'Зайцев Кирилл Павлович', 'Ильина Софья Романовна',
  'Комаров Глеб Викторович', 'Лебедева Ева Алексеевна', 'Морозов Тимур Ильич', 'Никитина Дарья Олеговна',
  'Орлов Арсений Петрович', 'Павлова Вера Николаевна', 'Романов Лев Максимович', 'Соколова Ульяна Юрьевна',
  'Тихонов Марк Денисович', 'Устинова Варвара Глебовна', 'Фёдоров Ярослав Ильич', 'Харитонова Злата Артёмовна',
  'Цветков Богдан Олегович', 'Чернова Милана Игоревна', 'Шаров Фёдор Антонович', 'Щукина Полина Степановна',
  'Юдин Роман Евгеньевич',
];

const MARKS = ['5', '4', '5', '3', 'н', '5', '4', '4', '2', '5', 'н/у', '5', '4', '3', '5', '5', '4', '5', '', '4'];

function grades(seed: number): GradeEntry[] {
  return MARKS.map((_, index) => ({
    column: `C${index}`,
    monthLabel: 'Сентябрь',
    dayLabel: String(index + 1),
    label: `${index + 1} сен`,
    value: MARKS[(index + seed) % MARKS.length],
  }));
}

function student(id: number, name: string, subjectNames: string[]): StudentRecord {
  const subjects = subjectNames.map((subjectName, index) => {
    const list = grades(index + id);
    const numbers = list.map((item) => Number(item.value)).filter((value) => value >= 2);
    return {
      sheetName: subjectName,
      subjectName,
      teacherName: 'Петрова А. В.',
      average: numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : null,
      absences: {
        invalid: list.filter((item) => item.value === 'н').length,
        valid: list.filter((item) => item.value === 'н/у').length,
      },
      grades: list,
      lessonTopics: [],
    };
  });
  const averages = subjects.map((item) => item.average).filter((value): value is number => value !== null);
  return {
    id,
    name,
    overallAverage: Math.min(5, averages.reduce((a, b) => a + b, 0) / averages.length + (id === 1 ? 0.6 : 0) - id * 0.04),
    totalAbsences: {
      invalid: subjects.reduce((sum, item) => sum + item.absences.invalid, 0),
      valid: subjects.reduce((sum, item) => sum + item.absences.valid, 0),
    },
    subjects,
  };
}

export function widgetJournal(options: { students?: string[]; subjects?: string[]; reportCards?: boolean } = {}): JournalData {
  const subjectNames = options.subjects ?? WIDGET_SUBJECTS;
  const students = (options.students ?? WIDGET_STUDENTS).map((name, index) => student(index + 1, name, subjectNames));
  return {
    groupName: 'ИСиП-24/1',
    source: 'local',
    sourceDetails: '',
    updatedAt: '2026-11-06T09:00:00.000Z',
    studentCount: students.length,
    subjectCount: subjectNames.length,
    subjects: subjectNames.map((name) => ({ sheetName: name, subjectName: name, teacherName: null })),
    students,
    reportCards: options.reportCards === false ? [] : students.map((item) => ({
      studentId: item.id,
      studentName: item.name,
      overallAverage: item.overallAverage,
      totalAbsences: item.totalAbsences,
      totalAbsenceCount: item.totalAbsences.invalid + item.totalAbsences.valid,
      rows: item.subjects.map((subject, index) => ({
        index,
        subjectName: subject.subjectName,
        session: null,
        average: subject.average,
        averageLabel: index === 6 ? 'зач' : null,
        absences: subject.absences,
      })),
    })),
  };
}
