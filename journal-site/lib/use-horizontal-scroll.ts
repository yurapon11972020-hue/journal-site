'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface HorizontalScroll {
  ref: React.RefObject<HTMLDivElement | null>;
  moreLeft: boolean;
  moreRight: boolean;
  scrollByStep: (direction: -1 | 1) => void;
}

/**
 * Горизонтальная прокрутка для лент и широких таблиц.
 *
 * Считает, есть ли продолжение слева и справа (чтобы показать затемнение и
 * стрелки), и превращает вертикальное колесо мыши в прокрутку вбок — в окне
 * мини-приложения Telegram на компьютере иначе прокрутить нечем.
 */
export function useHorizontalScroll(stepRatio = 0.8): HorizontalScroll {
  const ref = useRef<HTMLDivElement | null>(null);
  const [moreLeft, setMoreLeft] = useState(false);
  const [moreRight, setMoreRight] = useState(false);

  const sync = useCallback(() => {
    const node = ref.current;
    if (!node) {
      return;
    }

    const maxScroll = node.scrollWidth - node.clientWidth;
    setMoreLeft(node.scrollLeft > 4);
    setMoreRight(maxScroll - node.scrollLeft > 4);
  }, []);

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }

    // ResizeObserver сам вызывает обработчик сразу после подписки,
    // поэтому первое состояние считается без setState в теле эффекта.
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    node.addEventListener('scroll', sync, { passive: true });

    return () => {
      observer.disconnect();
      node.removeEventListener('scroll', sync);
    };
  }, [sync]);

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      if (node.scrollWidth <= node.clientWidth) {
        return;
      }
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        return;
      }

      node.scrollLeft += event.deltaY;
      event.preventDefault();
    };

    node.addEventListener('wheel', handleWheel, { passive: false });
    return () => node.removeEventListener('wheel', handleWheel);
  }, []);

  const scrollByStep = useCallback(
    (direction: -1 | 1) => {
      const node = ref.current;
      if (!node) {
        return;
      }

      node.scrollBy({ left: direction * Math.max(node.clientWidth * stepRatio, 140), behavior: 'smooth' });
    },
    [stepRatio],
  );

  return { ref, moreLeft, moreRight, scrollByStep };
}
