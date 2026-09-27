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
  average: number | null;
  absences: { valid: number; invalid: number };
  gradeByColumn: Map<string, GradeEntry>;
}

/** Больше пустых клеток рисовать незачем — строка и так уходит за экран. */
const MAX_BLANK_COLUMNS = 40;

/** Сколько раз примерять ширину столбца с именами, прежде чем сдаться. */
const MAX_FIT_ATTEMPTS = 5;

interface Layout {
  /** Сколько пустых клеток дорисовать справа до края. */
  blanks: number;
  /** Во сколько раз уменьшить таблицу, чтобы она поместилась целиком. */
  zoom: number;
  /** Точная ширина таблицы в пикселях; null — пока не измерили. */
  width: number | null;
  /** Ширина столбца с именами; null — пока не измерили. */
  nameWidth: number | null;
}

/** Подпись столбца с фамилиями: она тоже должна помещаться целиком. */
const NAME_HEADER = 'Обучающийся';

/** Один холст на всё приложение: нужен только для замера текста. */
let measuringCanvas: HTMLCanvasElement | null = null;

/** Ширина текста в клетке: считаем её же шрифтом и с её же отступами. */
function measureInCell(cell: Element, texts: string[]): number {
  measuringCanvas ??= document.createElement('canvas');
  const context = measuringCanvas.getContext('2d');
  if (!context) {
    return 0;
  }

  const styles = getComputedStyle(cell);
  context.font = `${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`;

  let longest = 0;
  for (const text of texts) {
    longest = Math.max(longest, context.measureText(text).width);
  }

  const padding = (Number.parseFloat(styles.paddingLeft) || 0) + (Number.parseFloat(styles.paddingRight) || 0);
  return longest + padding;
}

/**
 * Ширина столбца с именами — по самому длинному имени.
 *
 * Имена не сокращаются и не переносятся, поэтому столбцу нужна ровно та
 * ширина, в которую все они влезают в одну строку. Меряем текст на холсте,
 * а не по свёрстанным клеткам: клетка уже ограничена текущей шириной
 * столбца, и по ней настоящую длину имени не узнать.
 *
 * Шапка и строки меряются порознь: шрифт у них разный, и по шапке имена
 * выходили уже, чем на самом деле, — как раз настолько, чтобы обрезаться.
 */
function measureNameWidth(table: HTMLTableElement, names: string[]): number | null {
  const headCell = table.querySelector('thead .col-name');
  const bodyCell = table.querySelector('tbody .col-name');

  if (!headCell && !bodyCell) {
    return null;
  }

  const needed = Math.max(
    headCell ? measureInCell(headCell, [NAME_HEADER]) : 0,
    bodyCell ? measureInCell(bodyCell, names) : 0,
  );

  // Лишний пиксель — на округление подпиксельной ширины текста.
  return Math.ceil(needed + 1);
}

/**
 * Во сколько раз самое длинное имя шире своей клетки.
 *
 * Меряется уже свёрстанная таблица: `zoom` не растягивает готовую
 * картинку, а заставляет браузер перерисовать текст в меньшем размере,
 * и округление ширины букв делает строку шире, чем считает холст.
 * Предсказать это формулой нельзя — поэтому сверяемся с результатом.
 */
function worstNameOverflow(table: HTMLTableElement): number {
  const range = document.createRange();
  let worst = 1;

  for (const cell of table.querySelectorAll('tbody .col-name, thead .col-name')) {
    const node = [...cell.childNodes].find(
      (child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim(),
    );
    if (!node) {
      continue;
    }

    range.selectNodeContents(node);
    const textWidth = range.getBoundingClientRect().width;
    const cellWidth = cell.getBoundingClientRect().width;

    if (textWidth > 0 && cellWidth > 0) {
      worst = Math.max(worst, textWidth / cellWidth);
    }
  }

  return worst;
}

/**
 * Подгоняет таблицу под ширину колонки./**
 * Подгоняет таблицу под ширину колонки./**
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
  names: string[],
): Layout {
  const [layout, setLayout] = useState<Layout>({ blanks: 0, zoom: 1, width: null, nameWidth: null });

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

      const available = box.clientWidth;
      const fixedExceptName = px('--w-idx') + 3 * px('--w-sum') + columnCount * dateWidth;

      const plan = (nameWidth: number): Layout & { nameWidth: number } => {
        const natural = fixedExceptName + nameWidth;

        if (natural > available) {
          return { blanks: 0, zoom: available / natural, width: natural, nameWidth };
        }

        const blanks = Math.min(MAX_BLANK_COLUMNS, Math.floor((available - natural) / dateWidth));
        return { blanks, zoom: 1, width: natural + blanks * dateWidth, nameWidth };
      };

      let next = plan(measureNameWidth(table, names) ?? px('--w-name'));

      // Примеряем результат на месте и, если имя всё же не влезло,
      // расширяем столбец. Каждый шаг уменьшает промах в разы, так что
      // хватает пары попыток; предел — чтобы не крутиться бесконечно,
      // если шрифт по какой-то причине так и не сойдётся.
      for (let attempt = 0; attempt < MAX_FIT_ATTEMPTS; attempt += 1) {
        table.style.setProperty('--w-name', `${next.nameWidth}px`);
        table.style.width = `${next.width}px`;
        table.style.zoom = String(next.zoom);

        const overflow = worstNameOverflow(table);
        if (overflow <= 1.002) {
          break;
        }

        next = plan(Math.ceil(next.nameWidth * overflow));
      }

      setLayout(next);
    };

    // ResizeObserver зовёт обработчик сразу после подписки, поэтому первое
    // измерение делается без отдельного вызова в теле эффекта.
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [tableRef, boxRef, columnCount, names]);

  return layout;
}

/**
 * Длинная запись поверх нескольких дат — приказ о переводе, практика.
 *
 * Это не оценка, а пометка из журнала. Отличаем по виду: у оценки и
 * у отметки о пропуске нет пробелов и они короткие, даже самые
 * многословные вроде «н/у/отработка».
 */
function isNote(value: string): boolean {
  const text = value.trim();
  return text.length > 12 && /\s/.test(text);
}

/** Пометки из журнала: кто и что. Показываются списком под таблицей. */
function collectNotes(rows: JournalRow[], columns: JournalColumn[]): Array<{ id: string; name: string; text: string }> {
  const notes: Array<{ id: string; name: string; text: string }> = [];

  for (const row of rows) {
    for (const column of columns) {
      const grade = row.gradeByColumn.get(column.key);
      if (grade && isNote(grade.value)) {
        notes.push({ id: `${row.studentId}-${column.key}`, name: row.studentName, text: grade.value.trim() });
      }
    }
  }

  return notes;
}

/**
 * Клетки одной строки студента с учётом объединений из Excel.
 *
 * Обычная оценка занимает одну клетку. Объединение в журнале —
 * одну широкую, как в самом файле.
 *
 * Ширину таблицы пометка при этом не задаёт. В журнале приказ о переводе
 * растянут на все даты семестра вперёд, и если отводить под него столько
 * же места, настоящие оценки сжимаются в нечитаемую полоску ради одной
 * строки. Поэтому пометка занимает столько столбцов, сколько их в таблице
 * есть, а целиком её текст стоит списком под таблицей.
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
        ) : merged || isNote(grade.value) ? (
          <span className="mergednote" title={`${row.studentName}: ${grade.value.trim()}`}>
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
  const names = useMemo(() => rows.map((row) => row.studentName), [rows]);
  const notes = useMemo(() => collectNotes(rows, columns), [rows, columns]);
  const { blanks, zoom, width, nameWidth } = useJournalLayout(tableRef, boxRef, columns.length, names);

  const blankKeys = Array.from({ length: blanks }, (_, index) => `blank-${index}`);

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
          style={
            {
              zoom,
              width: width ?? undefined,
              ...(nameWidth ? { '--w-name': `${nameWidth}px` } : {}),
            } as CSSProperties
          }
        >
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className="stick col-idx">
                №
              </th>
              <th scope="col" className="stick col-name">
                {NAME_HEADER}
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
                  {row.studentName}
                </th>
                {buildRowCells(row, columns, blanks)}
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

      {notes.length ? (
        <ul className="tablenotes">
          {notes.map((note) => (
            <li className="tablenotes__item" key={note.id}>
              <span className="tablenotes__name">{note.name}</span>
              <span className="tablenotes__text">{note.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
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
