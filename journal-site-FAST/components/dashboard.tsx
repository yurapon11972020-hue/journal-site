'use client';

import Link from 'next/link';
import { CSSProperties, useEffect, useMemo, useState } from 'react';

import type { GradeEntry, JournalData, LessonTopic, ReportCard } from '@/lib/types';

interface DashboardProps {
  data: JournalData;
  backHref?: string;
  backLabel?: string;
}

interface SubjectStudentRow {
  studentId: number;
  studentName: string;
  average: number | null;
  absences: {
    valid: number;
    invalid: number;
  };
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

function formatAverage(value: number | null): string {
  if (value === null) {
    return '—';
  }

  return value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
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

function buildSubjectAggregates(data: JournalData): SubjectAggregate[] {
  const orderMap = new Map(data.subjects.map((subject, index) => [buildSubjectKey(subject.sheetName, subject.subjectName), index]));
  const map = new Map<string, SubjectAggregate>();

  for (const student of data.students) {
    for (const subject of student.subjects) {
      const key = buildSubjectKey(subject.sheetName, subject.subjectName);
      const current = map.get(key);

      if (!current) {
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

function getSubjectDensityClass(columnCount: number): string {
  if (columnCount >= 22) {
    return 'subject-table--dense';
  }

  if (columnCount >= 16) {
    return 'subject-table--compact';
  }

  return 'subject-table--regular';
}

function buildTopicDateMap(lessonTopics: LessonTopic[]): Map<string, LessonTopic[]> {
  const map = new Map<string, LessonTopic[]>();

  for (const topic of lessonTopics) {
    const normalizedKey = topic.dateLabel
      .toLowerCase()
      .replace(/\\/g, '.')
      .replace(/\//g, '.')
      .replace(/-/g, '.')
      .replace(/\s+/g, '');

    const current = map.get(normalizedKey) ?? [];
    current.push(topic);
    map.set(normalizedKey, current);
  }

  return map;
}

function normalizeSearchValue(value: string): string {
  return value.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

function getReportCardSubtitle(card: ReportCard): string {
  return `Средний балл: ${formatAverage(card.overallAverage)} · Уваж.: ${card.totalAbsences.valid || 0} · Неуваж.: ${card.totalAbsences.invalid || 0}`;
}

export default function Dashboard({ data, backHref, backLabel = 'Все группы' }: DashboardProps) {
  const subjectAggregates = useMemo(() => buildSubjectAggregates(data), [data]);
  const [activeTab, setActiveTab] = useState<string>('report-cards');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [reportSearch, setReportSearch] = useState('');
  const [expandedCards, setExpandedCards] = useState<number[]>([]);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem('journal-theme');
    if (savedTheme === 'light' || savedTheme === 'dark') {
      setTheme(savedTheme);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('journal-theme', theme);
  }, [theme]);

  const normalizedSearch = useMemo(() => normalizeSearchValue(reportSearch), [reportSearch]);

  const filteredReportCards = useMemo(() => {
    if (!normalizedSearch) {
      return data.reportCards;
    }

    return data.reportCards.filter((card) => normalizeSearchValue(card.studentName).includes(normalizedSearch));
  }, [data.reportCards, normalizedSearch]);

  const selectedSubject = subjectAggregates.find((subject) => subject.id === activeTab) ?? null;
  const selectedSubjectTopicMap = useMemo(
    () => (selectedSubject ? buildTopicDateMap(selectedSubject.lessonTopics) : new Map<string, LessonTopic[]>()),
    [selectedSubject],
  );

  const toggleReportCard = (studentId: number) => {
    setExpandedCards((current) =>
      current.includes(studentId) ? current.filter((id) => id !== studentId) : [...current, studentId],
    );
  };

  return (
    <main className="page-shell">
      <section className="page-header">
        <div>
          <div className="eyebrow">Электронный журнал</div>
          <h1 className="page-title">{data.groupName || 'Группа без названия'}</h1>
          {backHref ? (
            <div className="header-actions">
              <Link href={backHref} className="back-link">
                ← {backLabel}
              </Link>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="theme-toggle"
          onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
        >
          {theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
        </button>
      </section>

      <section className="tab-grid">
        <button
          type="button"
          className={`tab-chip ${activeTab === 'report-cards' ? 'tab-chip--active' : ''}`}
          onClick={() => setActiveTab('report-cards')}
        >
          Табели
        </button>
        {subjectAggregates.map((subject) => (
          <button
            type="button"
            key={subject.id}
            className={`tab-chip ${activeTab === subject.id ? 'tab-chip--active' : ''}`}
            onClick={() => setActiveTab(subject.id)}
            title={subject.subjectName}
          >
            {subject.subjectName}
          </button>
        ))}
      </section>

      {activeTab === 'report-cards' ? (
        <section className="cards-stack">
          <div className="toolbar-row">
            <label className="search-box" htmlFor="report-card-search">
              <span className="search-box__label">Поиск по имени</span>
              <input
                id="report-card-search"
                className="search-box__input"
                type="search"
                placeholder="Например, Иванов"
                value={reportSearch}
                onChange={(event) => setReportSearch(event.target.value)}
              />
            </label>
            <div className="toolbar-note">Найдено: {filteredReportCards.length}</div>
          </div>

          {filteredReportCards.map((card) => {
            const isExpanded = expandedCards.includes(card.studentId);

            return (
              <article className={`sheet-card ${isExpanded ? 'sheet-card--expanded' : ''}`} key={card.studentId}>
                <button
                  type="button"
                  className="sheet-toggle"
                  onClick={() => toggleReportCard(card.studentId)}
                  aria-expanded={isExpanded}
                >
                  <div className="sheet-toggle__main">
                    <span className={`sheet-toggle__arrow ${isExpanded ? 'sheet-toggle__arrow--open' : ''}`}>
                      ▸
                    </span>
                    <div>
                      <div className="sheet-card__title">{card.studentName}</div>
                      <div className="sheet-card__meta">{getReportCardSubtitle(card)}</div>
                    </div>
                  </div>
                  <div className="sheet-toggle__aside">Предметов: {card.rows.length}</div>
                </button>

                {isExpanded ? (
                  <div className="table-wrap">
                    <table className="journal-table report-table">
                      <thead>
                        <tr>
                          <th>№</th>
                          <th>Дисциплина</th>
                          <th>Сессия</th>
                          <th>Средний балл</th>
                          <th>Уваж.</th>
                          <th>Неуваж.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {card.rows.map((row) => (
                          <tr key={`${card.studentId}-${row.index}-${row.subjectName}`}>
                            <td className="center-cell">{row.index}</td>
                            <td>{row.subjectName}</td>
                            <td className="center-cell">{row.session || '—'}</td>
                            <td className="center-cell">{formatAverage(row.average)}</td>
                            <td className="center-cell">{row.absences.valid || ''}</td>
                            <td className="center-cell">{row.absences.invalid || ''}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={3}>Итог по табелю</td>
                          <td className="center-cell">{formatAverage(card.overallAverage)}</td>
                          <td className="center-cell">{card.totalAbsences.valid || ''}</td>
                          <td className="center-cell">{card.totalAbsences.invalid || ''}</td>
                        </tr>
                        <tr>
                          <td colSpan={5}>Общее количество пропусков</td>
                          <td className="center-cell">{card.totalAbsenceCount || 0}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ) : null}
              </article>
            );
          })}

          {filteredReportCards.length === 0 ? (
            <div className="empty-state">Ничего не найдено. Попробуй другое имя или часть фамилии.</div>
          ) : null}
        </section>
      ) : selectedSubject ? (
        <section className="subject-section">
          <div className="subject-header">
            <h2 className="subject-title">{selectedSubject.subjectName}</h2>
            {selectedSubject.teacherName ? <div className="subject-subtitle">Преподаватель: {selectedSubject.teacherName}</div> : null}
            {selectedSubject.lessonTopics.length ? (
              <div className="subject-subtitle">Темы и задания: {selectedSubject.lessonTopics.length}</div>
            ) : null}
          </div>

          <div className="table-wrap table-wrap--subject">
            <table
              className={`journal-table subject-table ${getSubjectDensityClass(selectedSubject.columns.length)}`}
              style={{ ['--lesson-count' as '--lesson-count']: String(Math.max(selectedSubject.columns.length, 1)) } as CSSProperties}
            >
              <thead>
                <tr>
                  <th className="sticky-col sticky-col--num">№</th>
                  <th className="sticky-col sticky-col--name">Обучающийся</th>
                  {selectedSubject.columns.map((column) => {
                    const topicKey = String(column.dayLabel || column.label || '')
                      .toLowerCase()
                      .replace(/[.,()]/g, '')
                      .replace(/\\/g, '.')
                      .replace(/\//g, '.')
                      .replace(/-/g, '.')
                      .replace(/\s+/g, '');
                    const relatedTopics = selectedSubjectTopicMap.get(topicKey) ?? [];

                    return (
                      <th key={column.key} className="lesson-head">
                        <div className="lesson-head__day">{column.dayLabel || '—'}</div>
                        <div className="lesson-head__month">{column.monthLabel || column.label}</div>
                        {relatedTopics.length ? (
                          <div className="lesson-head__topic-count">{relatedTopics.length} тема</div>
                        ) : null}
                      </th>
                    );
                  })}
                  <th>Средний</th>
                  <th>Уваж.</th>
                  <th>Неуваж.</th>
                </tr>
              </thead>
              <tbody>
                {selectedSubject.students.map((student, index) => {
                  const gradeMap = buildGradeMap(student.grades);

                  return (
                    <tr key={`${selectedSubject.id}-${student.studentId}`}>
                      <td className="sticky-col sticky-col--num center-cell">{index + 1}</td>
                      <td className="sticky-col sticky-col--name">{student.studentName}</td>
                      {selectedSubject.columns.map((column) => {
                        const grade = gradeMap.get(column.key);
                        return (
                          <td key={`${student.studentId}-${column.key}`} className="center-cell lesson-cell">
                            {grade ? grade.value : ''}
                          </td>
                        );
                      })}
                      <td className="center-cell">{formatAverage(student.average)}</td>
                      <td className="center-cell">{student.absences.valid || ''}</td>
                      <td className="center-cell">{student.absences.invalid || ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selectedSubject.lessonTopics.length ? (
            <section className="lesson-topics">
              <div className="lesson-topics__header">Темы и задания по занятиям</div>
              <div className="lesson-topics__list">
                {selectedSubject.lessonTopics.map((topic) => (
                  <article className="lesson-topic-card" key={`${selectedSubject.id}-topic-${topic.row}`}>
                    <div className="lesson-topic-card__date">{topic.dateLabel}</div>
                    <div className="lesson-topic-card__text">{topic.topic}</div>
                    {topic.extra ? <div className="lesson-topic-card__extra">{topic.extra}</div> : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
