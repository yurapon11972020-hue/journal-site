'use client';

import { useEffect, useRef, type CSSProperties } from 'react';

import { AbsenceBadge, GradeBadge } from '@/components/ui';
import type { GradeEntry } from '@/lib/types';

/** Ниже этого клетка превращается в полоску — дальше ужимать нет смысла. */
const MIN_DATE_WIDTH = 6;

/** Уже этого в клетку не влезают ни месяц, ни плашка с отступами. */
const TIGHT_DATE_WIDTH = 30;

/**
 * Подбирает ширину клетки занятия так, чтобы таблица всегда помещалась
 * в свою колонку и её не приходилось листать вбок.
 *
 * Клетка не шире базовой: когда занятий мало, лишнее место уходит не в неё
 * и не в фамилии, а в разлинованный «хвост» справа. Когда занятий много,
 * клетки сжимаются — мелкое читается щипком-увеличением.
 *
 * Считается в коде, а не в CSS: проценты внутри min()/calc() в ширине
 * ячейки таблицы Chromium отбрасывает, и столбец молча уезжает в auto.
 */
function useFittedColumns(
  tableRef: React.RefObject<HTMLTableElement | null>,
  boxRef: React.RefObject<HTMLDivElement | null>,
  columnCount: number,
): void {
  useEffect(() => {
    const table = tableRef.current;
    const box = boxRef.current;
    if (!table || !box) {
      return;
    }

    const apply = () => {
      const styles = getComputedStyle(table);
      const px = (name: string) => Number.parseFloat(styles.getPropertyValue(name)) || 0;
      const base = px('--w-date-base');
      const free = box.clientWidth - px('--w-idx') - px('--w-name') - 3 * px('--w-sum');
      const perColumn = columnCount > 0 ? Math.floor(free / columnCount) : base;

      const width = Math.max(MIN_DATE_WIDTH, Math.min(base, perColumn));
      table.style.setProperty('--w-date', `${width}px`);
      table.classList.toggle('dtable--journal--tight', width < TIGHT_DATE_WIDTH);
    };

    // ResizeObserver зовёт обработчик сразу после подписки, поэтому
    // первое значение считается без отдельного вызова в теле эффекта.
    const observer = new ResizeObserver(apply);
    observer.observe(box);
    return () => observer.disconnect();
  }, [tableRef, boxRef, columnCount]);
}

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
  const boxRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);

  useFittedColumns(tableRef, boxRef, columns.length);

  return (
    <div className="tablebox">
      <div className="tablebox__scroll" ref={boxRef}>
        <table
          ref={tableRef}
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
                <span className="head-full">Обучающийся</span>
                <span className="head-short">Студент</span>
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
              {/* Пустой столбец продолжает разлиновку до края таблицы. */}
              <th className="col-grid" aria-hidden />
              <th scope="col" className="col-sum col-sum--first" title="Средний балл">
                <span className="head-full">Ср.</span>
                <span className="head-short">Ср</span>
              </th>
              <th scope="col" className="col-sum" title="Пропуски по уважительной причине">
                <span className="head-full">Ув.</span>
                <span className="head-short">У</span>
              </th>
              <th scope="col" className="col-sum" title="Пропуски без уважительной причины">
                <span className="head-full">Неув.</span>
                <span className="head-short">Н</span>
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
                <td className="col-grid" />
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
