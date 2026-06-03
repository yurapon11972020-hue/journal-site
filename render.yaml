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
      <section className="page-header">
        <div>
          <div className="eyebrow">Электронный журнал колледжа</div>
          <h1 className="page-title">Выбор группы</h1>
          <p className="page-subtitle">Выбери группу — сайт загрузит нужный Excel-файл с Яндекс Диска.</p>
        </div>
        <button
          type="button"
          className="theme-toggle"
          onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
        >
          {theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
        </button>
      </section>

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
