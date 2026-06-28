'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { JournalGroupRef } from '@/lib/types';

interface GroupsDashboardProps {
  groups: JournalGroupRef[];
}

export default function GroupsDashboard({ groups }: GroupsDashboardProps) {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    const savedTheme = window.localStorage.getItem('journal-theme');
    if (savedTheme === 'light' || savedTheme === 'dark') {
      setTheme(savedTheme);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('journal-theme', theme);
  }, [theme]);

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
              onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            >
              {theme === 'dark' ? '☀️ Светлая' : '🌙 Тёмная'}
            </button>
          </div>
        </div>
        <div className="hero__content">
          <h1 className="hero__title">Журнал группы</h1>
          <p className="hero__subtitle">
            Выбери группу — откроется журнал с оценками, пропусками и темами занятий.
          </p>
        </div>
      </header>

      <section className="tab-grid">
        {groups.map((group) => (
          <Link key={group.id} href={`/group/${group.id}`} className="tab-chip tab-chip--link" title={group.groupName}>
            {group.groupName}
          </Link>
        ))}
      </section>
    </main>
  );
}
