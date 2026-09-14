'use client';

import type { CSSProperties } from 'react';

import { AbsenceBadge, GradeBadge } from '@/components/ui';
import { useHorizontalScroll } from '@/lib/use-horizontal-scroll';
import type { GradeEntry } from '@/lib/types';

export interface JournalColumn {
  key: string;
  dayLabel: string | null;
  monthLabel: string | null;
  label: string;
  topicCount: number;
}

export interface JournalRow {
  studentId: number;
  studentName: string;
  shortName: string;
  average: number | null;
  absences: { valid: number; invalid: number };
  gradeByColumn: Map<string, GradeEntry>;
}

/**
 * Основная таблица журнала: студенты по строкам, даты занятий по столбцам.
 *
 * Шапка и первые два столбца закреплены, поэтому при прокрутке вбок видно,
 * чья это строка, а при прокрутке вниз — какое это число.
 */
export default function JournalTable({
  columns,
  rows,
  caption,
}: {
  columns: JournalColumn[];
  rows: JournalRow[];
  caption: string;
}) {
  const { ref, moreRight } = useHorizontalScroll();

  return (
    <div className={`tablebox${moreRight ? ' tablebox--more' : ''}`}>
      <div className="tablebox__scroll" ref={ref}>
        <table
          className="dtable dtable--journal"
          style={{ ['--cols' as string]: String(Math.max(columns.length, 1)) } as CSSProperties}
        >
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className="stick col-idx">
                №
              </th>
              <th scope="col" className="stick col-name">
                Обучающийся
              </th>
              {columns.map((column) => (
                <th scope="col" className="col-date" key={column.key}>
                  <span className="datehead">
                    <span className="datehead__day">{column.dayLabel || '—'}</span>
                    <span className="datehead__month">{column.monthLabel || column.label}</span>
                    {column.topicCount ? (
                      <span className="datehead__mark" title={`Есть тема занятия (${column.topicCount})`} />
                    ) : null}
                  </span>
                </th>
              ))}
              <th scope="col" className="col-sum col-sum--first" title="Средний балл">
                Ср.
              </th>
              <th scope="col" className="col-sum" title="Пропуски по уважительной причине">
                Ув.
              </th>
              <th scope="col" className="col-sum" title="Пропуски без уважительной причины">
                Неув.
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.studentId}>
                <td className="stick col-idx">{index + 1}</td>
                <th scope="row" className="stick col-name">
                  <span className="name-full">{row.studentName}</span>
                  <span className="name-short">{row.shortName}</span>
                </th>
                {columns.map((column) => {
                  const grade = row.gradeByColumn.get(column.key);
                  return (
                    <td className="col-date" key={`${row.studentId}-${column.key}`}>
                      {grade ? (
                        <GradeBadge value={grade.value} title={`${row.studentName} · ${column.label}`} />
                      ) : (
                        <span className="grade grade--empty">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="col-sum col-sum--first">
                  <GradeBadge value={row.average} />
                </td>
                <td className="col-sum">
                  <AbsenceBadge value={row.absences.valid} kind="valid" />
                </td>
                <td className="col-sum">
                  <AbsenceBadge value={row.absences.invalid} kind="invalid" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Подпись под таблицей: что означает цвет. Дублирует цвет словами. */
export function JournalLegend() {
  return (
    <div className="legend">
      <span className="legend__item">
        <span className="grade grade--excellent">5</span> отлично
      </span>
      <span className="legend__item">
        <span className="grade grade--good">4</span> хорошо
      </span>
      <span className="legend__item">
        <span className="grade grade--ok">3</span> удовлетворительно
      </span>
      <span className="legend__item">
        <span className="grade grade--bad">2</span> неудовлетворительно
      </span>
      <span className="legend__item">
        <span className="grade grade--absence">н</span> пропуск
      </span>
      <span className="legend__item">
        <span className="datehead__mark" style={{ marginTop: 0 }} /> есть тема занятия
      </span>
    </div>
  );
}
