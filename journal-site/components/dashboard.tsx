'use client';

import { useMemo, useState } from 'react';

import Link from 'next/link';

import AppShell, { type NavGroup } from '@/components/app-shell';
import JournalTable, { JournalLegend, type JournalColumn, type JournalRow } from '@/components/journal-table';
import { IconArrowLeft, IconJournal, IconTopics, IconChevronRight } from '@/components/icons';
import {
  AbsenceBadge,
  AverageBar,
  Card,
  EmptyState,
  GradeBadge,
  Metric,
  PageHead,
  StatusBadge,
} from '@/components/ui';
import type { GradeEntry, JournalData, LessonTopic, ReportCard } from '@/lib/types';

interface DashboardProps {
  data: JournalData;
  backHref?: string;
  backLabel?: string;
}

// Студент считается «требующим внимания», если его средний балл ниже этого порога.
const AT_RISK_AVERAGE = 3;

type SectionId = 'journal' | 'topics';
type JournalTab = 'reports' | 'subjects';
type StudentSort = 'name' | 'avg-desc' | 'avg-asc' | 'absences';
type SubjectSort = 'default' | 'name' | 'avg-desc' | 'avg-asc' | 'absences';

interface SubjectStudentRow {
  studentId: number;
  studentName: string;
  average: number | null;
  absences: { valid: number; invalid: number };
  grades: GradeEntry[];
}

interface SubjectColumn {
  key: string;
  column: string;
  label: string;
  monthLabel: string | null;
  dayLabel: string | null;
}

interface SubjectAggregate {
  id: string;
  sheetName: string;
  subjectName: string;
  teacherName: string | null;
  students: SubjectStudentRow[];
  columns: SubjectColumn[];
  lessonTopics: LessonTopic[];
}

/* ----------------------------- вычисления ----------------------------- */

/** «Иванов Иван Иванович» → «Иванов И. И.» — для узкого экрана. */
function shortStudentName(fullName: string): string {
  const parts = fullName.split(' ').filter(Boolean);
  if (parts.length < 2) {
    return fullName;
  }

  return `${parts[0]} ${parts.slice(1).map((part) => `${part[0]}.`).join(' ')}`;
}

function formatAverage(value: number | null): string {
  if (value === null) {
    return '—';
  }

  return value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function isAtRiskAverage(average: number | null): boolean {
  return average !== null && average < AT_RISK_AVERAGE;
}

function compareNullableNumber(a: number | null, b: number | null, direction: 'asc' | 'desc'): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction === 'asc' ? a - b : b - a;
}

function excelColumnToNumber(column: string): number {
  return column
    .toUpperCase()
    .split('')
    .reduce((sum, char) => sum * 26 + (char.charCodeAt(0) - 64), 0);
}

function buildSubjectKey(sheetName: string, subjectName: string): string {
  return `${sheetName}::${subjectName}`;
}

function buildGradeMap(grades: GradeEntry[]): Map<string, GradeEntry> {
  return new Map(grades.map((grade) => [`${grade.column}::${grade.label}`, grade]));
}

/** Разворачивает «студенты → предметы» в «предмет → студенты и даты занятий». */
function buildSubjectAggregates(data: JournalData): SubjectAggregate[] {
  const orderMap = new Map(
    data.subjects.map((subject, index) => [buildSubjectKey(subject.sheetName, subject.subjectName), index]),
  );
  const map = new Map<string, SubjectAggregate>();

  for (const student of data.students) {
    for (const subject of student.subjects) {
      const key = buildSubjectKey(subject.sheetName, subject.subjectName);

      if (!map.has(key)) {
        map.set(key, {
          id: key,
          sheetName: subject.sheetName,
          subjectName: subject.subjectName,
          teacherName: subject.teacherName,
          students: [],
          columns: [],
          lessonTopics: [],
        });
      }

      const aggregate = map.get(key)!;
      if (aggregate.lessonTopics.length === 0 && subject.lessonTopics.length > 0) {
        aggregate.lessonTopics = subject.lessonTopics;
      }

      aggregate.students.push({
        studentId: student.id,
        studentName: student.name,
        average: subject.average,
        absences: subject.absences,
        grades: subject.grades,
      });

      for (const grade of subject.grades) {
        const gradeKey = `${grade.column}::${grade.label}`;
        if (aggregate.columns.some((column) => column.key === gradeKey)) {
          continue;
        }

        aggregate.columns.push({
          key: gradeKey,
          column: grade.column,
          label: grade.label,
          monthLabel: grade.monthLabel,
          dayLabel: grade.dayLabel,
        });
      }
    }
  }

  return [...map.values()]
    .map((subject) => ({
      ...subject,
      students: [...subject.students].sort((a, b) => a.studentId - b.studentId),
      columns: [...subject.columns].sort((a, b) => excelColumnToNumber(a.column) - excelColumnToNumber(b.column)),
    }))
    .sort((a, b) => (orderMap.get(a.id) ?? 9999) - (orderMap.get(b.id) ?? 9999));
}

function normalizeDateKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,()]/g, '')
    .replace(/\\/g, '.')
    .replace(/\//g, '.')
    .replace(/-/g, '.')
    .replace(/\s+/g, '');
}

function buildTopicDateMap(lessonTopics: LessonTopic[]): Map<string, LessonTopic[]> {
  const map = new Map<string, LessonTopic[]>();

  for (const topic of lessonTopics) {
    const key = normalizeDateKey(topic.dateLabel);
    const current = map.get(key) ?? [];
    current.push(topic);
    map.set(key, current);
  }

  return map;
}

function normalizeSearchValue(value: string): string {
  return value.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

function averageOf(values: (number | null)[]): number | null {
  const numbers = values.filter((value): value is number => value !== null);
  if (!numbers.length) {
    return null;
  }
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function pluralize(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

/* ------------------------------- экран ------------------------------- */

export default function Dashboard({ data, backHref = '/', backLabel = 'Все группы' }: DashboardProps) {
  const subjects = useMemo(() => buildSubjectAggregates(data), [data]);
  const [section, setSection] = useState<SectionId>('journal');
  const [journalTab, setJournalTab] = useState<JournalTab>('reports');
  const [subjectId, setSubjectId] = useState<string>(() => subjects[0]?.id ?? '');
  const [subjectSort, setSubjectSort] = useState<SubjectSort>('default');
  const [studentSearch, setStudentSearch] = useState('');
  const [studentSort, setStudentSort] = useState<StudentSort>('name');
  const [openStudents, setOpenStudents] = useState<number[]>([]);

  const stats = useMemo(() => {
    let valid = 0;
    let invalid = 0;
    let atRisk = 0;

    for (const student of data.students) {
      valid += student.totalAbsences.valid;
      invalid += student.totalAbsences.invalid;
      if (isAtRiskAverage(student.overallAverage)) {
        atRisk += 1;
      }
    }

    return {
      studentCount: data.studentCount || data.students.length,
      subjectCount: data.subjectCount || data.subjects.length,
      averageGpa: averageOf(data.students.map((student) => student.overallAverage)),
      valid,
      invalid,
      atRisk,
    };
  }, [data]);

  /** Сводка по предмету: средний балл и пропуски по всей группе. */
  const subjectSummaries = useMemo(
    () =>
      subjects.map((subject) => {
        const valid = subject.students.reduce((sum, student) => sum + student.absences.valid, 0);
        const invalid = subject.students.reduce((sum, student) => sum + student.absences.invalid, 0);
        const gradeCount = subject.students.reduce(
          (sum, student) => sum + student.grades.filter((grade) => grade.value.trim()).length,
          0,
        );

        return {
          id: subject.id,
          name: subject.subjectName,
          teacherName: subject.teacherName,
          average: averageOf(subject.students.map((student) => student.average)),
          lessonCount: subject.columns.length,
          topicCount: subject.lessonTopics.length,
          gradeCount,
          valid,
          invalid,
        };
      }),
    [subjects],
  );

  const selectedSubject = subjects.find((subject) => subject.id === subjectId) ?? subjects[0] ?? null;

  const topicMap = useMemo(
    () => (selectedSubject ? buildTopicDateMap(selectedSubject.lessonTopics) : new Map<string, LessonTopic[]>()),
    [selectedSubject],
  );

  const journalColumns: JournalColumn[] = useMemo(() => {
    if (!selectedSubject) return [];
    return selectedSubject.columns.map((column) => ({
      key: column.key,
      dayLabel: column.dayLabel,
      monthLabel: column.monthLabel,
      label: column.label,
      topicCount: (topicMap.get(normalizeDateKey(column.dayLabel || column.label || '')) ?? []).length,
    }));
  }, [selectedSubject, topicMap]);

  const journalRows: JournalRow[] = useMemo(() => {
    if (!selectedSubject) return [];

    const list = [...selectedSubject.students];
    switch (subjectSort) {
      case 'name':
        list.sort((a, b) => a.studentName.localeCompare(b.studentName, 'ru'));
        break;
      case 'avg-desc':
        list.sort((a, b) => compareNullableNumber(a.average, b.average, 'desc'));
        break;
      case 'avg-asc':
        list.sort((a, b) => compareNullableNumber(a.average, b.average, 'asc'));
        break;
      case 'absences':
        list.sort(
          (a, b) => b.absences.valid + b.absences.invalid - (a.absences.valid + a.absences.invalid),
        );
        break;
      default:
        break;
    }

    return list.map((student) => ({
      studentId: student.studentId,
      studentName: student.studentName,
      shortName: shortStudentName(student.studentName),
      average: student.average,
      absences: student.absences,
      gradeByColumn: buildGradeMap(student.grades),
    }));
  }, [selectedSubject, subjectSort]);

  const visibleStudents = useMemo(() => {
    const needle = normalizeSearchValue(studentSearch);
    const list = needle
      ? data.reportCards.filter((card) => normalizeSearchValue(card.studentName).includes(needle))
      : [...data.reportCards];

    switch (studentSort) {
      case 'avg-desc':
        return list.sort((a, b) => compareNullableNumber(a.overallAverage, b.overallAverage, 'desc'));
      case 'avg-asc':
        return list.sort((a, b) => compareNullableNumber(a.overallAverage, b.overallAverage, 'asc'));
      case 'absences':
        return list.sort((a, b) => (b.totalAbsenceCount || 0) - (a.totalAbsenceCount || 0));
      default:
        return list.sort((a, b) => a.studentName.localeCompare(b.studentName, 'ru'));
    }
  }, [data.reportCards, studentSearch, studentSort]);

  const attendanceRows = useMemo(
    () =>
      [...data.students]
        .map((student) => ({
          id: student.id,
          name: student.name,
          valid: student.totalAbsences.valid,
          invalid: student.totalAbsences.invalid,
          total: student.totalAbsences.valid + student.totalAbsences.invalid,
          bySubject: student.subjects
            .filter((subject) => subject.absences.valid + subject.absences.invalid > 0)
            .map((subject) => ({
              name: subject.subjectName,
              valid: subject.absences.valid,
              invalid: subject.absences.invalid,
            })),
        }))
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'ru')),
    [data.students],
  );

  const subjectsWithTopics = useMemo(
    () => subjects.filter((subject) => subject.lessonTopics.length > 0),
    [subjects],
  );

  const toggleStudent = (id: number) => {
    setOpenStudents((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  const groupName = data.groupName || 'Группа без названия';
  const updatedLabel = formatUpdatedAt(data.updatedAt);

  const navGroups: NavGroup[] = [
    {
      items: [
        { id: 'journal', label: 'Журнал', icon: <IconJournal size={18} />, count: subjects.length },
        {
          id: 'topics',
          label: 'Темы занятий',
          shortLabel: 'Темы',
          icon: <IconTopics size={18} />,
          count: subjectsWithTopics.length || undefined,
        },
      ],
    },
  ];

  const sectionTitles: Record<SectionId, string> = {
    journal: 'Журнал',
    topics: 'Темы занятий',
  };

  const backButton = (
    <Link className="btn btn--quiet btn--back" href={backHref}>
      <IconArrowLeft size={17} />
      <span className="btn__text">{backLabel}</span>
    </Link>
  );

  return (
    <AppShell
      brandName={groupName}
      brandSub="Электронный журнал"
      groups={navGroups}
      activeId={section}
      onSelect={(id) => setSection(id as SectionId)}
      crumbs={[{ label: groupName }, { label: sectionTitles[section] }]}
      identName={groupName}
      identSub={`${stats.studentCount} ${pluralize(stats.studentCount, 'студент', 'студента', 'студентов')}`}
      mobileIds={['journal', 'topics']}
      back={backButton}
      wide
    >
      {section === 'journal' ? (
        <>
          <PageHead
            title="Журнал"
            subtitle={updatedLabel ? `Данные обновлены ${updatedLabel}` : undefined}
          />

          <div className="metrics" style={{ marginBottom: 18 }}>
            <Metric label="Студентов" value={String(stats.studentCount)} />
            <Metric label="Предметов" value={String(stats.subjectCount)} />
            <Metric label="Средний балл группы" value={formatAverage(stats.averageGpa)} />
            <Metric
              label="Пропусков всего"
              value={String(stats.valid + stats.invalid)}
              hint={`Уваж. ${stats.valid} · неуваж. ${stats.invalid}`}
            />
            <Metric
              label="Требуют внимания"
              value={String(stats.atRisk)}
              hint={`Средний балл ниже ${AT_RISK_AVERAGE}`}
            />
          </div>

          <div className="tabs" role="tablist" aria-label="Что показывать">
            <button
              type="button"
              role="tab"
              aria-selected={journalTab === 'reports'}
              className={`tabs__item${journalTab === 'reports' ? ' tabs__item--active' : ''}`}
              onClick={() => setJournalTab('reports')}
            >
              Табели
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={journalTab === 'subjects'}
              className={`tabs__item${journalTab === 'subjects' ? ' tabs__item--active' : ''}`}
              onClick={() => setJournalTab('subjects')}
            >
              Оценки по предметам
            </button>
          </div>

          {journalTab === 'reports' ? (
            <>
              <div className="filters">
                <label className="field filters__grow" htmlFor="student-search" style={{ maxWidth: 340 }}>
                  <span className="field__label">Поиск по фамилии</span>
                  <input
                    id="student-search"
                    className="input"
                    type="search"
                    placeholder="Например, Иванов"
                    value={studentSearch}
                    onChange={(event) => setStudentSearch(event.target.value)}
                  />
                </label>
                <label className="field" htmlFor="student-sort" style={{ minWidth: 240 }}>
                  <span className="field__label">Сортировка</span>
                  <select
                    id="student-sort"
                    className="select"
                    value={studentSort}
                    onChange={(event) => setStudentSort(event.target.value as StudentSort)}
                  >
                    <option value="name">По фамилии</option>
                    <option value="avg-desc">Средний балл: больше → меньше</option>
                    <option value="avg-asc">Средний балл: меньше → больше</option>
                    <option value="absences">Больше всего пропусков</option>
                  </select>
                </label>
                <div className="filters__note">Найдено: {visibleStudents.length}</div>
              </div>

              <section className="card">
                {visibleStudents.length ? (
                  <div className="rowlist">
                    {visibleStudents.map((card) => (
                      <StudentRow
                        key={card.studentId}
                        card={card}
                        open={openStudents.includes(card.studentId)}
                        onToggle={() => toggleStudent(card.studentId)}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="Никого не нашлось"
                    text="Попробуй другую фамилию или её часть — поиск не учитывает регистр и букву «ё»."
                  />
                )}
              </section>
            </>
          ) : null}

          {journalTab === 'subjects' ? (
            subjects.length ? (
              <>
                <div className="filters">
                  <label className="field filters__grow" htmlFor="journal-subject" style={{ maxWidth: 460 }}>
                    <span className="field__label">Предмет</span>
                    <select
                      id="journal-subject"
                      className="select"
                      value={selectedSubject?.id ?? ''}
                      onChange={(event) => setSubjectId(event.target.value)}
                    >
                      {subjects.map((subject) => (
                        <option key={subject.id} value={subject.id}>
                          {subject.subjectName}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field" htmlFor="journal-sort" style={{ minWidth: 220 }}>
                    <span className="field__label">Порядок студентов</span>
                    <select
                      id="journal-sort"
                      className="select"
                      value={subjectSort}
                      onChange={(event) => setSubjectSort(event.target.value as SubjectSort)}
                    >
                      <option value="default">Как в журнале</option>
                      <option value="name">По фамилии</option>
                      <option value="avg-desc">Средний балл: больше → меньше</option>
                      <option value="avg-asc">Средний балл: меньше → больше</option>
                      <option value="absences">Больше всего пропусков</option>
                    </select>
                  </label>

                  <div className="filters__note">
                    {journalColumns.length} {pluralize(journalColumns.length, 'занятие', 'занятия', 'занятий')} ·{' '}
                    {journalRows.length} {pluralize(journalRows.length, 'студент', 'студента', 'студентов')}
                  </div>
                </div>

                {/* Преподаватель подписан прямо у своего предмета. */}
                <div className="subjectbar">
                  <h2 className="subjectbar__name">{selectedSubject?.subjectName}</h2>
                  <p className="subjectbar__teacher">
                    {selectedSubject?.teacherName ? (
                      <>Преподаватель: {selectedSubject.teacherName}</>
                    ) : (
                      <span style={{ color: 'var(--text-3)' }}>Преподаватель не указан в журнале</span>
                    )}
                  </p>
                </div>

                {journalColumns.length ? (
                  <>
                    {/* Карточка ужата по таблице, легенда вынесена под неё:
                        иначе ширину карточки задавала бы длинная легенда. */}
                    <section className="card card--fit">
                      <JournalTable
                        columns={journalColumns}
                        rows={journalRows}
                        caption={`Журнал по предмету «${selectedSubject?.subjectName ?? ''}»`}
                      />
                    </section>
                    <JournalLegend />
                  </>
                ) : (
                  <section className="card">
                    <EmptyState
                      title="Занятий пока нет"
                      text="По этому предмету в журнале ещё не отмечено ни одной даты. Как только появятся — таблица заполнится сама."
                    />
                  </section>
                )}

                {selectedSubject?.lessonTopics.length ? (
                  <div style={{ marginTop: 18 }}>
                    <Card title="Темы и задания" subtitle={`${selectedSubject.lessonTopics.length} записей`}>
                      <div className="topics">
                        {selectedSubject.lessonTopics.map((topic) => (
                          <article className="topic" key={`${selectedSubject.id}-${topic.row}`}>
                            <div className="topic__date">{topic.dateLabel}</div>
                            <div className="topic__text">{topic.topic}</div>
                            {topic.extra ? <div className="topic__extra">{topic.extra}</div> : null}
                          </article>
                        ))}
                      </div>
                    </Card>
                  </div>
                ) : null}
              </>
            ) : (
              <section className="card">
                <EmptyState
                  title="Предметы не найдены"
                  text="В файле журнала нет листов с предметами. Проверь, что по ссылке лежит нужный файл."
                />
              </section>
            )
          ) : null}
        </>
      ) : null}

      {section === 'topics' ? (
        <>
          <PageHead title="Темы занятий" subtitle="То, что записано в журнале на каждую дату" />

          {subjectsWithTopics.length ? (
            <div style={{ display: 'grid', gap: 16 }}>
              {subjectsWithTopics.map((subject) => (
                <Card
                  key={subject.id}
                  title={subject.subjectName}
                  subtitle={subject.teacherName ?? 'Преподаватель не указан'}
                >
                  <div className="topics">
                    {subject.lessonTopics.map((topic) => (
                      <article className="topic" key={`${subject.id}-${topic.row}`}>
                        <div className="topic__date">{topic.dateLabel}</div>
                        <div className="topic__text">{topic.topic}</div>
                        {topic.extra ? <div className="topic__extra">{topic.extra}</div> : null}
                      </article>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <section className="card">
              <EmptyState
                title="Тем пока нет"
                text="В журнале ещё не заполнены темы занятий — они появятся здесь, как только преподаватели их запишут."
              />
            </section>
          )}
        </>
      ) : null}
    </AppShell>
  );
}


/* --------------------------- строка студента --------------------------- */

function StudentRow({
  card,
  open,
  onToggle,
}: {
  card: ReportCard;
  open: boolean;
  onToggle: () => void;
}) {
  const atRisk = isAtRiskAverage(card.overallAverage);

  return (
    <div>
      <button type="button" className="rowitem" onClick={onToggle} aria-expanded={open}>
        <span className={`rowitem__chev${open ? ' rowitem__chev--open' : ''}`}>
          <IconChevronRight size={16} />
        </span>
        <span className="rowitem__main">
          <span className="rowitem__name">{card.studentName}</span>
          <span className="rowitem__meta">
            {card.rows.length} {pluralize(card.rows.length, 'предмет', 'предмета', 'предметов')} · пропусков{' '}
            {card.totalAbsences.valid + card.totalAbsences.invalid}
          </span>
        </span>
        <span className="rowitem__aside">
          {atRisk ? <StatusBadge tone="warning">Внимание</StatusBadge> : null}
          <AverageBar value={card.overallAverage} />
          <GradeBadge value={card.overallAverage} />
        </span>
      </button>

      {open ? (
        <div className="rowpanel">
          <table className="dtable">
            <thead>
              <tr>
                <th scope="col" className="num">№</th>
                <th scope="col" className="wrap">Дисциплина</th>
                <th scope="col" className="num">Сессия</th>
                <th scope="col" className="num">Средний</th>
                <th scope="col" className="num">Уваж.</th>
                <th scope="col" className="num">Неуваж.</th>
              </tr>
            </thead>
            <tbody>
              {card.rows.map((row) => (
                <tr key={`${card.studentId}-${row.index}-${row.subjectName}`}>
                  <td className="num">{row.index}</td>
                  <th scope="row" className="wrap" style={{ fontWeight: 450 }}>
                    {row.subjectName}
                  </th>
                  <td className="num">{row.session ? <GradeBadge value={row.session} /> : '—'}</td>
                  <td className="num">
                    <GradeBadge value={row.averageLabel ?? row.average} />
                  </td>
                  <td className="num">
                    <ReportAbsence label={row.validAbsenceLabel} value={row.absences.valid} kind="valid" />
                  </td>
                  <td className="num">
                    <ReportAbsence label={row.invalidAbsenceLabel} value={row.absences.invalid} kind="invalid" />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} style={{ fontWeight: 550 }}>Итог по табелю</td>
                <td className="num">
                  <GradeBadge value={card.overallAverage} />
                </td>
                <td className="num">
                  <AbsenceBadge value={card.totalAbsences.valid} kind="valid" />
                </td>
                <td className="num">
                  <AbsenceBadge value={card.totalAbsences.invalid} kind="invalid" />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/** В табеле пропуск может быть записан текстом («8/2»), а не числом. */
function ReportAbsence({
  label,
  value,
  kind,
}: {
  label?: string | null;
  value: number;
  kind: 'valid' | 'invalid';
}) {
  const text = label && label.trim() ? label.trim() : value ? String(value) : '';

  if (!text || text === '0') {
    return <span className="grade grade--empty">—</span>;
  }

  if (Number.isFinite(Number(text.replace(',', '.')))) {
    return (
      <span className={`grade ${kind === 'valid' ? 'grade--valid-absence' : 'grade--absence'}`}>{text}</span>
    );
  }

  return <GradeBadge value={text} />;
}
