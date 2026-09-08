'use client';

import { useHorizontalScroll } from '@/lib/use-horizontal-scroll';

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
  const { ref: trackRef, moreLeft, moreRight, scrollByStep } = useHorizontalScroll();

  const selectTab = (id: string) => {
    onSelect(id);

    const target = trackRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`);
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
        onClick={() => scrollByStep(-1)}
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
        onClick={() => scrollByStep(1)}
        aria-label="Следующие разделы"
        tabIndex={moreRight ? 0 : -1}
      >
        ›
      </button>
    </section>
  );
}
