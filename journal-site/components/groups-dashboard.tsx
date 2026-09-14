'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { IconChevronRight, IconGroups, IconMoon, IconSearch, IconSend, IconSun } from '@/components/icons';
import { EmptyState } from '@/components/ui';
import type { JournalGroupRef } from '@/lib/types';
import { useTheme } from '@/lib/use-theme';

interface GroupsDashboardProps {
  groups: JournalGroupRef[];
}

// Начиная с этого количества групп показываем поиск по списку.
const SEARCH_THRESHOLD = 8;

function normalize(value: string): string {
  return value.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

function groupsWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) return 'группа';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'группы';
  return 'групп';
}

export default function GroupsDashboard({ groups }: GroupsDashboardProps) {
  const { theme, toggleTheme } = useTheme();
  const [query, setQuery] = useState('');

  const showSearch = groups.length >= SEARCH_THRESHOLD;

  const visibleGroups = useMemo(() => {
    const needle = normalize(query);
    if (!needle) {
      return groups;
    }

    return groups.filter(
      (group) => normalize(group.groupName).includes(needle) || normalize(group.fileName).includes(needle),
    );
  }, [groups, query]);

  return (
    <div className="pickshell">
      <header className="pickshell__bar">
        <div className="pickshell__bar-inner">
        <span className="pickshell__brand">
          <span className="sidebar__logo" aria-hidden>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
              <path d="M12 3 2 8l10 5 10-5-10-5Z" />
              <path d="M5 10.5V16c0 1.7 3.1 3 7 3s7-1.3 7-3v-5.5" />
            </svg>
          </span>
          <span className="sidebar__brand-text">
            <span className="sidebar__brand-name">Электронный журнал</span>
            <span className="sidebar__brand-sub">Выбор группы</span>
          </span>
        </span>

        <span className="topbar__right">
          <a className="btn" href="https://t.me/SKIBJOURNAL_BOT" target="_blank" rel="noopener noreferrer">
            <IconSend size={16} />
            Телеграм-бот
          </a>
          <button
            type="button"
            className="btn btn--icon"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
          >
            {theme === 'dark' ? <IconSun size={17} /> : <IconMoon size={17} />}
          </button>
        </span>
        </div>
      </header>

      <main className="pickshell__body">
        <header className="page-head">
          <div>
            <h1 className="page-head__title">Журналы групп</h1>
            <p className="page-head__sub">
              {groups.length} {groupsWord(groups.length)} · выбери группу, чтобы открыть оценки, пропуски и темы
              занятий
            </p>
          </div>

          {showSearch ? (
            <div className="page-head__actions">
              <label className="field" htmlFor="group-search" style={{ minWidth: 260 }}>
                <span className="sr-only">Поиск группы</span>
                <span className="inputwrap">
                  <IconSearch size={16} />
                  <input
                    id="group-search"
                    className="input"
                    type="search"
                    placeholder="Название группы"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </span>
              </label>
            </div>
          ) : null}
        </header>

        {visibleGroups.length ? (
          <div className="grouplist">
            {visibleGroups.map((group) => (
              <Link key={group.id} href={`/group/${group.id}`} className="groupcard" title={group.fileName}>
                <span className="groupcard__icon" aria-hidden>
                  <IconGroups size={19} />
                </span>
                <span className="groupcard__text">
                  <span className="groupcard__name">{group.groupName}</span>
                  {group.fileName && group.fileName !== group.groupName ? (
                    <span className="groupcard__meta">{group.fileName}</span>
                  ) : null}
                </span>
                <span className="groupcard__arrow" aria-hidden>
                  <IconChevronRight size={18} />
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="card">
            <EmptyState
              title={groups.length ? 'Ничего не нашлось' : 'Список групп пуст'}
              text={
                groups.length
                  ? 'Проверь написание — поиск не учитывает регистр и букву «ё».'
                  : 'Проверь публичные ссылки на Яндекс.Диск в настройках сервера.'
              }
            />
          </div>
        )}
      </main>
    </div>
  );
}
