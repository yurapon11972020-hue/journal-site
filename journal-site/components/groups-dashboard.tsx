'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

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

  if (mod10 === 1 && mod100 !== 11) {
    return 'группа';
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return 'группы';
  }
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
    <main className="page-shell">
      <header className="hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/hero.jpg" alt="Зимний вид города" className="hero__img" />
        <div className="hero__top">
          <span className="hero__badge">❄️ Электронный журнал</span>
          <div className="hero__actions">
            <a
              href="https://t.me/SKIBJOURNAL_BOT"
              target="_blank"
              rel="noopener noreferrer"
              className="hero__btn"
            >
              ✈️ Бот
            </a>
            <button
              type="button"
              className="hero__btn"
              onClick={toggleTheme}
            >
              {theme === 'dark' ? '☀️ Светлая' : '🌙 Тёмная'}
            </button>
          </div>
        </div>
        <div className="hero__content">
          <h1 className="hero__title">{groups.length === 1 ? 'Журнал группы' : 'Журналы групп'}</h1>
          <p className="hero__subtitle">
            Выбери группу — откроется журнал с оценками, пропусками и темами занятий.
          </p>
        </div>
      </header>

      <div className="groups-toolbar">
        <span className="groups-count">
          {groups.length} {groupsWord(groups.length)}
        </span>
        {showSearch ? (
          <input
            type="search"
            className="groups-search"
            placeholder="Поиск группы"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Поиск группы"
          />
        ) : null}
      </div>

      {visibleGroups.length ? (
        <section className="tab-grid">
          {visibleGroups.map((group) => (
            <Link
              key={group.id}
              href={`/group/${group.id}`}
              className="tab-chip tab-chip--link group-card"
              title={group.fileName}
            >
              <span className="group-card__name">{group.groupName}</span>
              {group.fileName && group.fileName !== group.groupName ? (
                <span className="group-card__meta">{group.fileName}</span>
              ) : null}
            </Link>
          ))}
        </section>
      ) : (
        <section className="groups-empty">
          {groups.length ? 'Ничего не нашлось. Проверь написание.' : 'Список групп пуст — проверь ссылки на Яндекс.Диск.'}
        </section>
      )}
    </main>
  );
}
