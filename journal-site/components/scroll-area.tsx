'use client';

import type { ReactNode } from 'react';

import { useHorizontalScroll } from '@/lib/use-horizontal-scroll';

interface ScrollAreaProps {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  prevLabel?: string;
  nextLabel?: string;
}

/**
 * Обёртка для широкого содержимого: показывает затемнение у краёв,
 * когда есть продолжение, и даёт кнопки листания. На телефоне таблицу
 * предмета неудобно возить пальцем — кнопкой понятнее и точнее.
 */
export default function ScrollArea({
  children,
  className = '',
  innerClassName = '',
  prevLabel = 'Показать предыдущие',
  nextLabel = 'Показать следующие',
}: ScrollAreaProps) {
  const { ref, moreLeft, moreRight, scrollByStep } = useHorizontalScroll();

  const wrapperClassName = [
    'scroll-area',
    moreLeft ? 'scroll-area--more-left' : '',
    moreRight ? 'scroll-area--more-right' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={wrapperClassName}>
      {/* Кнопки стоят над содержимым, а не поверх него: поверх они закрывали
          фамилии и оценки. Показываются только когда есть что листать. */}
      <div className="scroll-area__controls" aria-hidden={!moreLeft && !moreRight}>
        <span className="scroll-area__hint">Листать даты</span>
        <button
          type="button"
          className="scroll-area__arrow"
          onClick={() => scrollByStep(-1)}
          aria-label={prevLabel}
          disabled={!moreLeft}
        >
          ‹
        </button>
        <button
          type="button"
          className="scroll-area__arrow"
          onClick={() => scrollByStep(1)}
          aria-label={nextLabel}
          disabled={!moreRight}
        >
          ›
        </button>
      </div>

      <div className={`scroll-area__viewport ${innerClassName}`.trim()} ref={ref}>
        {children}
      </div>
    </div>
  );
}
