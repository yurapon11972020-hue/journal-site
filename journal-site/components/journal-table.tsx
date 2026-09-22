'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { AbsenceBadge, GradeBadge } from '@/components/ui';
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

/** Больше пустых клеток рисовать незачем — строка и так уходит за экран. */
const MAX_BLANK_COLUMNS = 40;

interface Layout {
  /** Сколько пустых клеток дорисовать справа до края. */
  blanks: number;
  /** Во сколько раз уменьшить таблицу, чтобы она поместилась целиком. */
  zoom: number;
  /** Точная ширина таблицы в пикселях; null — пока не измерили. */
  width: number | null;
}

/**
 * Подгоняет таблицу под ширину колонки.
 *
 * Ничего не растягивается: фамилии и клетки занятий всегда своей ширины.
 * Если места больше, чем нужно, справа дорисовываются пустые клетки —
 * те, куда со временем встанут оценки. Если места меньше, таблица не
 * сжимается по столбцам, а уменьшается целиком: пропорции сохраняются,
 * таблица видна полностью, а разглядеть её можно щипком-увеличением.
 */
function useJournalLayout(
  tableRef: React.RefObject<HTMLTableElement | null>,
  boxRef: React.RefObject<HTMLDivElement | null>,
  columnCount: number,
): Layout {
  const [layout, setLayout] = useState<Layout>({ blanks: 0, zoom: 1, width: null });

  useEffect(() => {
    const table = tableRef.current;
    const box = boxRef.current;
    if (!table || !box) {
      return;
    }

    const measure = () => {
      const styles = getComputedStyle(table);
      const px = (name: string) => Number.parseFloat(styles.getPropertyValue(name)) || 0;
      const dateWidth = px('--w-date');
      if (!dateWidth) {
        return;
      }

      const fixed = px('--w-idx') + px('--w-name') + 3 * px('--w-sum');
      const natural = fixed + columnCount * dateWidth;
      const available = box.clientWidth;

      if (natural > available) {
        setLayout({ blanks: 0, zoom: available / natural, width: natural });
        return;
      }

      const blanks = Math.min(MAX_BLANK_COLUMNS, Math.floor((available - natural) / dateWidth));
      setLayout({ blanks, zoom: 1, width: natural + blanks * dateWidth });
    };

    // ResizeObserver зовёт обработчик сразу после подписки, поэтому первое
    // измерение делается без отдельного вызова в теле эффекта.
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [tableRef, boxRef, columnCount]);

  return layout;
}

/**
 * Сколько столбцов нужно таблице.
 *
 * Объединённая пометка занимает столько дат, сколько их накрыто в Excel,
 * даже если оценок по этим датам ещё нет и своих столбцов у них нет.
 * Без этого широкой клетке некуда развернуться, и на телефоне приказ
 * о переводе снова ужимался бы в одну клетку шириной в 40 пикселей.
 */
function countRequiredColumns(rows: JournalRow[], columns: JournalColumn[]): number {
  let required = columns.length;

  for (const row of rows) {
    for (const [index, column] of columns.entries()) {
      const span = row.gradeByColumn.get(column.key)?.span ?? 1;
      required = Math.max(required, index + span);
    }
  }

  return required;
}

/**
 * Клетки одной строки студента с учётом объединений из Excel.
 *
 * Обычная оценка занимает одну клетку. Если преподаватель объединил
 * несколько дат и написал поверх них пометку — приказ о переводе,
 * практику, — на сайте это тоже одна широкая клетка: раньше пометка
 * либо повторялась в каждом столбце, либо ютилась в одном узком,
 * а рядом стояли прочерки.
 *
 * Пометка растягивается и на пустые клетки справа: в журнале под неё
 * отведены даты, которых ещё не было, и столбцов с оценками там нет —
 * иначе широкой клетке было бы некуда развернуться.
 */
function buildRowCells(row: JournalRow, columns: JournalColumn[], blanks: number) {
  const cells = [];
  const total = columns.length + blanks;

  for (let index = 0; index < total; ) {
    const column = columns[index];

    if (!column) {
      cells.push(<td className="col-date col-date--blank" key={`${row.studentId}-blank-${index}`} />);
      index += 1;
      continue;
    }

    const grade = row.gradeByColumn.get(column.key);
    const span = Math.min(Math.max(grade?.span ?? 1, 1), total - index);
    const merged = span > 1;

    cells.push(
      <td
        className={merged ? 'col-date col-date--merged' : 'col-date'}
        colSpan={merged ? span : undefined}
        key={`${row.studentId}-${column.key}`}
      >
        {!grade ? (
          <span className="grade grade--empty">—</span>
        ) : merged ? (
          <span className="mergednote" title={`${row.studentName} · ${column.label}`}>
            {grade.value}
          </span>
        ) : (
          <GradeBadge value={grade.value} title={`${row.studentName} · ${column.label}`} />
        )}
      </td>,
    );

    index += span;
  }

  return cells;
}

/**
 * Основная таблица журнала: студенты по строкам, даты занятий по столбцам.
 *
 * Шапка и первые два столбца закреплены, поэтому видно, чья это строка
 * и какое это число.
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
  const requiredColumns = useMemo(() => countRequiredColumns(rows, columns), [rows, columns]);
  const { blanks, zoom, width } = useJournalLayout(tableRef, boxRef, requiredColumns);

  // Пустые клетки: и те, что зарезервированы под объединения,
  // и те, которыми таблица добирается до края экрана.
  const filler = requiredColumns - columns.length + blanks;
  const blankKeys = Array.from({ length: filler }, (_, index) => `blank-${index}`);

  return (
    <div className="tablebox">
      <div className="tablebox__scroll" ref={boxRef}>
        {/* Ширина задаётся явно: при width:auto браузер игнорирует
            table-layout:fixed, уходит в автоподбор — и столбец с фамилиями
            снова растягивается по самой длинной из них.

            Уменьшаем через zoom, а не transform: zoom сокращает и занимаемую
            высоту, поэтому под таблицей не остаётся пустого места. */}
        <table
          ref={tableRef}
          className="dtable dtable--journal"
          style={{ zoom, width: width ?? undefined } as CSSProperties}
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
              {blankKeys.map((key) => (
                <th className="col-date col-date--blank" key={key} aria-hidden />
              ))}
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
                {buildRowCells(row, columns, filler)}
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
