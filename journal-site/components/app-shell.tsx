'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

import {
  IconClose,
  IconMenu,
  IconMoon,
  IconSend,
  IconSun,
} from '@/components/icons';
import { useTheme } from '@/lib/use-theme';

export interface NavSection {
  id: string;
  label: string;
  shortLabel?: string;
  icon: ReactNode;
  count?: number;
}

export interface NavGroup {
  label?: string;
  items: NavSection[];
}

interface AppShellProps {
  brandName: string;
  brandSub?: string;
  groups: NavGroup[];
  activeId: string;
  onSelect: (id: string) => void;
  crumbs: { label: string; href?: string }[];
  identName: string;
  /** Разделы в нижней панели на телефоне: основные + «Ещё». */
  mobileIds?: string[];
  /** Кнопка возврата к списку групп. Стоит слева в верхней панели. */
  back?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}

const TELEGRAM_BOT_URL = 'https://t.me/SKIBJOURNAL_BOT';


// Дата считается только на клиенте: у сервера свой часовой пояс, и если
// отрисовать её на обеих сторонах, React пожалуется на расхождение разметки.
const subscribeNothing = () => () => undefined;
const dateOnClient = () => new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
const dateOnServer = () => '';

export default function AppShell({
  brandName,
  brandSub,
  groups,
  activeId,
  onSelect,
  crumbs,
  identName,
  mobileIds,
  back,
  children,
  wide = false,
}: AppShellProps) {
  const { theme, toggleTheme } = useTheme();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const dateLabel = useSyncExternalStore(subscribeNothing, dateOnClient, dateOnServer);

  useEffect(() => {
    if (!drawerOpen) {
      return;
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawerOpen(false);
      }
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const allItems = groups.flatMap((group) => group.items);
  const mobileItems = (mobileIds ?? allItems.slice(0, 3).map((item) => item.id))
    .map((id) => allItems.find((item) => item.id === id))
    .filter((item): item is NavSection => Boolean(item));

  const pick = (id: string) => {
    onSelect(id);
    setDrawerOpen(false);
  };

  return (
    <div className="shell">
      <button
        type="button"
        className={`drawer-backdrop${drawerOpen ? ' drawer-backdrop--open' : ''}`}
        onClick={() => setDrawerOpen(false)}
        tabIndex={drawerOpen ? 0 : -1}
        aria-label="Закрыть меню"
      />

      <nav className={`sidebar${drawerOpen ? ' sidebar--open' : ''}`} aria-label="Разделы журнала">
        <div className="sidebar__brand">
          <Image className="sidebar__logo" src="/logo.png" alt="" width={160} height={155} priority />
          <span className="sidebar__brand-text">
            <span className="sidebar__brand-name">{brandName}</span>
            {brandSub ? <span className="sidebar__brand-sub">{brandSub}</span> : null}
          </span>
        </div>

        <div className="sidebar__scroll">
          {groups.map((group, index) => (
            <div className="sidebar__group" key={group.label ?? `group-${index}`}>
              {group.label ? <div className="sidebar__group-label">{group.label}</div> : null}
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`navitem${item.id === activeId ? ' navitem--active' : ''}`}
                  onClick={() => pick(item.id)}
                  aria-current={item.id === activeId ? 'page' : undefined}
                >
                  <span className="navitem__icon">{item.icon}</span>
                  <span className="navitem__label">{item.label}</span>
                  {typeof item.count === 'number' ? <span className="navitem__count">{item.count}</span> : null}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="sidebar__foot">
          <button type="button" className="navitem" onClick={toggleTheme}>
            <span className="navitem__icon">{theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}</span>
            <span className="navitem__label">{theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}</span>
          </button>
          <a className="navitem" href={TELEGRAM_BOT_URL} target="_blank" rel="noopener noreferrer">
            <span className="navitem__icon">
              <IconSend size={18} />
            </span>
            <span className="navitem__label">Телеграм-бот</span>
          </a>
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="btn btn--quiet btn--icon topbar__burger"
            onClick={() => setDrawerOpen((open) => !open)}
            aria-label={drawerOpen ? 'Закрыть меню' : 'Открыть меню'}
            aria-expanded={drawerOpen}
          >
            {drawerOpen ? <IconClose /> : <IconMenu />}
          </button>

          {back}

          <nav className="topbar__crumbs" aria-label="Навигационная цепочка">
            {crumbs.map((crumb, index) => {
              const last = index === crumbs.length - 1;
              return (
                <span className="topbar__crumbs" key={`${crumb.label}-${index}`}>
                  {index > 0 ? (
                    <span className="topbar__sep" aria-hidden>
                      /
                    </span>
                  ) : null}
                  {crumb.href && !last ? (
                    <Link className="topbar__crumb-link" href={crumb.href}>
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="topbar__crumb-current" aria-current={last ? 'page' : undefined}>
                      {crumb.label}
                    </span>
                  )}
                </span>
              );
            })}
          </nav>

          <div className="topbar__right">
            <span className="topbar__date">{dateLabel || ' '}</span>
            {/* В правом верхнем углу — только название группы. */}
            <span className="topbar__ident">
              <span className="topbar__ident-name">{identName}</span>
            </span>
          </div>
        </header>

        <main className={`content ${wide ? 'content--wide' : 'content--narrow'}`}>{children}</main>
      </div>

      <nav className="mobilenav" aria-label="Основные разделы">
        {mobileItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`mobilenav__item${item.id === activeId ? ' mobilenav__item--active' : ''}`}
            onClick={() => pick(item.id)}
            aria-current={item.id === activeId ? 'page' : undefined}
          >
            {item.icon}
            {item.shortLabel ?? item.label}
          </button>
        ))}
        <button
          type="button"
          className={`mobilenav__item${drawerOpen ? ' mobilenav__item--active' : ''}`}
          onClick={() => setDrawerOpen((open) => !open)}
          aria-expanded={drawerOpen}
        >
          <IconMenu size={18} />
          Ещё
        </button>
      </nav>
    </div>
  );
}
