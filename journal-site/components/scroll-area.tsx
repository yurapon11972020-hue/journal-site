'use client';

import type { ReactNode } from 'react';

import { useHorizontalScroll } from '@/lib/use-horizontal-scroll';

interface ScrollAreaProps {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
}

/**
 * Обёртка для широкого содержимого: таблица возится пальцем, как привычно
 * на телефоне, а у края появляется затемнение — видно, что есть продолжение.
 * Кнопок листания нарочно нет: они занимали место и мешали.
 */
export default function ScrollArea({ children, className = '', innerClassName = '' }: ScrollAreaProps) {
  const { ref, moreLeft, moreRight } = useHorizontalScroll();

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
      <div className={`scroll-area__viewport ${innerClassName}`.trim()} ref={ref}>
        {children}
      </div>
    </div>
  );
}
