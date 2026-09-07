'use client';
import { useMemo, useState } from 'react';
import type { JournalData } from '@/lib/types';
import { classifyMarkValue, markToneToClass } from '@/lib/mark-classifier';

export default function GradeTimeline({ data }: { data: JournalData }) {
  const [studentKey, setStudentKey] = useState('');
  const [subjectName, setSubjectName] = useState('');
  const [day, setDay] = useState('');
  const [limit, setLimit] = useState(60);
  const records = useMemo(() => data.students.filter((student) => !studentKey || student.key === studentKey).flatMap((student) => student.subjects.filter((subject) => !subjectName || subject.sheetName === subjectName).flatMap((subject) => subject.grades.map((grade, order) => ({ student, subject, grade, order })))).filter(({ grade }) => !day || grade.dateKey?.slice(-5).split('-').reverse().join('.') === day).sort((a, b) => a.grade.date && b.grade.date ? b.grade.date.localeCompare(a.grade.date) || b.order - a.order : b.order - a.order), [data, studentKey, subjectName, day]);
  return <section className="timeline-section">
    <div className="toolbar-row">
      <label className="search-box">Студент<select className="search-box__input" value={studentKey} onChange={(e) => setStudentKey(e.target.value)}><option value="">Все студенты</option>{data.students.map((student) => <option key={student.key} value={student.key}>{student.name}</option>)}</select></label>
      <label className="search-box">Предмет<select className="search-box__input" value={subjectName} onChange={(e) => setSubjectName(e.target.value)}><option value="">Все предметы</option>{data.subjects.map((subject) => <option key={subject.sheetName} value={subject.sheetName}>{subject.subjectName}</option>)}</select></label>
      <label className="search-box">День и месяц<input className="search-box__input" type="text" placeholder="Например, 08.09" value={day} onChange={(e) => setDay(e.target.value)} /></label>
    </div>
    <p className="toolbar-note">Отметки из журнала: {records.length}. Если источник не указал год, показаны день и месяц в порядке занятий.</p>
    <div className="grade-feed">{records.slice(0, limit).map(({ student, subject, grade }) => {
      const mark = classifyMarkValue(grade.value);
      return <article className="grade-card" key={student.key + grade.id}>
        <span className={'mark ' + markToneToClass(mark.tone)}>{mark.displayText}</span>
        <div><h3>{subject.subjectName}</h3><p>{student.name}</p><span>{grade.label}{!grade.date ? ' · год не указан' : ''}</span></div>
      </article>;
    })}</div>
    {!records.length ? <p className="empty-state">По этим условиям отметок нет.</p> : null}
    {records.length > limit ? <button className="theme-toggle" onClick={() => setLimit((value) => value + 60)}>Показать ещё</button> : null}
  </section>;
}
