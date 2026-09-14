'use client';

import type { ReactNode } from 'react';

import { IconInbox } from '@/components/icons';
import { classifyMarkValue, markToneToClass } from '@/lib/mark-classifier';

/** Оценка, «н», зачёт — компактная плашка вместо заливки всей ячейки. */
export function GradeBadge({ value, title }: { value: string | number | null | undefined; title?: string }) {
  const classified = classifyMarkValue(value);
  const tone = markToneToClass(classified.tone).replace('mark--', '');

  return (
    <span className={`grade grade--${tone}`} title={title}>
      {classified.displayText}
    </span>
  );
}

/** Пропуски: ноль показываем прочерком, чтобы таблица не рябила нулями. */
export function AbsenceBadge({ value, kind }: { value: number; kind: 'valid' | 'invalid' }) {
  if (!value) {
    return <span className="grade grade--empty">—</span>;
  }

  return (
    <span
      className={`grade ${kind === 'valid' ? 'grade--valid-absence' : 'grade--absence'}`}
      title={kind === 'valid' ? 'Пропуски по уважительной причине' : 'Пропуски без уважительной причины'}
    >
      {value}
    </span>
  );
}

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/** Статус. Рядом с цветом всегда есть точка и текст — цвет не единственный признак. */
export function StatusBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span className={`badge badge--${tone}`}>
      <span className="badge__dot" aria-hidden />
      {children}
    </span>
  );
}

export function Metric({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="metric">
      <div className="metric__label">
        {icon}
        {label}
      </div>
      <div className="metric__value">{value}</div>
      {hint ? <div className="metric__hint">{hint}</div> : null}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  flush = false,
  children,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="card">
      {title ? (
        <header className="card__head">
          <div>
            <h2 className="card__title">{title}</h2>
            {subtitle ? <div className="card__sub">{subtitle}</div> : null}
          </div>
          {actions}
        </header>
      ) : null}
      <div className={`card__body${flush ? ' card__body--flush' : ''}`}>{children}</div>
    </section>
  );
}

export function EmptyState({ title, text, icon }: { title: string; text?: string; icon?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__icon">{icon ?? <IconInbox size={20} />}</div>
      <div className="empty__title">{title}</div>
      {text ? <p className="empty__text">{text}</p> : null}
    </div>
  );
}

/** Полоска среднего балла. Значение всегда рядом цифрой — полоса лишь помогает сравнить. */
export function AverageBar({ value }: { value: number | null }) {
  if (value === null) {
    return null;
  }

  const ratio = Math.max(0, Math.min(1, (value - 2) / 3));
  const modifier = value >= 4.5 ? ' bar__fill--good' : value < 3 ? ' bar__fill--low' : '';

  return (
    <div className="bar" aria-hidden>
      <div className={`bar__fill${modifier}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
    </div>
  );
}

export function PageHead({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <h1 className="page-head__title">{title}</h1>
        {subtitle ? <p className="page-head__sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-head__actions">{actions}</div> : null}
    </header>
  );
}
