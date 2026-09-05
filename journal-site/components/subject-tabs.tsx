'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface SubjectTabItem {
  id: string;
  label: string;
  title?: string;
}

interface SubjectTabsProps {
  items: SubjectTabItem[];
  activeId: string;
  onSelect: (id: string) => void;
  label?: string;
}

/**
 * Вкладки разделов журнала.
 *
 * На широком экране это сетка крупных плиток. На узком (телефон и окно
 * мини-приложения Telegram) плитки выстраиваются в ленту с прокруткой вбок.
 * В мини-приложении на компьютере ленту нечем листать: пальца нет, а обычное
 * колесо мыши крутит страницу вниз. Поэтому здесь есть и стрелки по краям,
 * и превращение вертикального колеса в горизонтальную прокрутку.
 */
export default function SubjectTabs({ items, activeId, onSelect, label = 'Разделы журнала' }: SubjectTabsProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [moreLeft, setMoreLeft] = useState(false);
  const [moreRight, setMoreRight] = useState(false);

  const syncOverflow = useCallback(() => {
    const track = trackRef.current;
    if (!track) {
      return;
    }

    const maxScroll = track.scrollWidth - track.clientWidth;
    setMoreLeft(track.scrollLeft > 4);
    setMoreRight(maxScroll - track.scrollLeft > 4);
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) {
      return;
    }

    // ResizeObserver вызывает обработчик сам сразу после подписки,
    // поэтому первое состояние считается без синхронного setState в эффекте.
    const observer = new ResizeObserver(syncOverflow);
    observer.observe(track);
    track.addEventListener('scroll', syncOverflow, { passive: true });

    return () => {
      observer.disconnect();
      track.removeEventListener('scroll', syncOverflow);
    };
  }, [syncOverflow]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      if (track.scrollWidth <= track.clientWidth) {
        return;
      }
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        return;
      }

      track.scrollLeft += event.deltaY;
      event.preventDefault();
    };

    track.addEventListener('wheel', handleWheel, { passive: false });
    return () => track.removeEventListener('wheel', handleWheel);
  }, []);

  const scrollBy = (direction: -1 | 1) => {
    const track = trackRef.current;
    if (!track) {
      return;
    }

    track.scrollBy({ left: direction * Math.max(track.clientWidth * 0.8, 160), behavior: 'smooth' });
  };

  const selectTab = (id: string) => {
    onSelect(id);

    const track = trackRef.current;
    const target = track?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  };

  const className = [
    'subject-tabs',
    moreLeft ? 'subject-tabs--more-left' : '',
    moreRight ? 'subject-tabs--more-right' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={className} aria-label={label}>
      <button
        type="button"
        className="subject-tabs__arrow subject-tabs__arrow--left"
        onClick={() => scrollBy(-1)}
        aria-label="Предыдущие разделы"
        tabIndex={moreLeft ? 0 : -1}
      >
        ‹
      </button>

      <div className="subject-tabs__track" ref={trackRef}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            data-tab-id={item.id}
            className={`tab-chip ${activeId === item.id ? 'tab-chip--active' : ''}`}
            onClick={() => selectTab(item.id)}
            title={item.title ?? item.label}
            aria-pressed={activeId === item.id}
          >
            {item.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="subject-tabs__arrow subject-tabs__arrow--right"
        onClick={() => scrollBy(1)}
        aria-label="Следующие разделы"
        tabIndex={moreRight ? 0 : -1}
      >
        ›
      </button>
    </section>
  );
}
