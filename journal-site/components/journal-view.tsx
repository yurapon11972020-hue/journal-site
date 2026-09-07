'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Dashboard from '@/components/dashboard';
import type { JournalData } from '@/lib/types';
import { compareJournals, type JournalChange } from '@/lib/journal-changes';

export default function JournalView({
  initialData,
  groupId,
  showLogout = false,
}: {
  initialData: JournalData;
  groupId: string;
  showLogout?: boolean;
}) {
  const [data, setData] = useState(initialData);
  const current = useRef(initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [warning, setWarning] = useState('');
  const [expired, setExpired] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const [changes, setChanges] = useState<JournalChange[]>([]);
  const inflight = useRef<AbortController | null>(null);
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async (manual: boolean) => {
    if (inflight.current) return;
    const controller = new AbortController();
    inflight.current = controller;
    setRefreshing(true);
    if (manual) {
      setCooldown(true);
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
      cooldownTimer.current = setTimeout(() => setCooldown(false), 30000);
    }
    try {
      const response = await fetch('/api/journal?group=' + encodeURIComponent(groupId), { method: manual ? 'POST' : 'GET', cache: 'no-store', signal: controller.signal });
      const result = await response.json();
      if (response.status === 401) { setExpired(true); return; }
      if (!response.ok) throw new Error(result.error || 'Не удалось обновить журнал.');
      if (!Array.isArray(result.students) || !Array.isArray(result.subjects) || !result.updatedAt) throw new Error('Получен неполный ответ журнала.');
      const next = result as JournalData;
      const diff = compareJournals(current.current, next);
      if (diff.length) setChanges(diff);
      current.current = next;
      setData(next);
      setWarning('');
    } catch (error) {
      if (!controller.signal.aborted) setWarning(error instanceof Error ? error.message : 'Не удалось обновить журнал.');
    } finally {
      if (inflight.current === controller) inflight.current = null;
      if (!controller.signal.aborted) setRefreshing(false);
    }
  }, [groupId]);

  useEffect(() => {
    const first = setTimeout(() => void refresh(false), 100);
    const interval = setInterval(() => { if (document.visibilityState === 'visible') void refresh(false); }, 60000);
    return () => { clearTimeout(first); clearInterval(interval); inflight.current?.abort(); inflight.current = null; if (cooldownTimer.current) clearTimeout(cooldownTimer.current); };
  }, [refresh]);

  if (expired) return <main className="error-page"><section className="error-card"><h1>Сессия закончилась</h1><p>Войдите по коду своей группы, чтобы продолжить.</p><Link href={'/login?next=' + encodeURIComponent('/group/' + groupId)}>Войти</Link></section></main>;
  const stale = warning || data.sync?.error || (data.sync?.stale ? 'Показана сохранённая версия. Обновление выполняется по расписанию источника.' : '');
  return <>
    <div className="sync-bar" aria-live="polite">
      <span className="sync-bar__time">
        Данные на{' '}
        <time dateTime={data.updatedAt}>
          {new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(data.updatedAt))}
        </time>
      </span>
      <button type="button" className="sync-bar__refresh" disabled={refreshing || cooldown} onClick={() => void refresh(true)}>{refreshing ? 'Обновляем…' : cooldown ? 'Подождите 30 с' : 'Обновить'}</button>
      {stale ? <p role="status" className="sync-warning">{stale}</p> : null}
    </div>
    {changes.length ? <details className="changes-panel"><summary>Изменения после обновления: {changes.length}</summary><ul>{changes.slice(0, 50).map((change, index) => <li key={index}>{change.student} · {change.subject} · {change.dateLabel}: {change.kind === 'added' ? 'добавлена отметка ' + change.after : change.kind === 'removed' ? 'удалена отметка ' + change.before : change.before + ' → ' + change.after}</li>)}</ul>{changes.length > 50 ? <p>Показаны первые 50 изменений.</p> : null}</details> : null}
    <Dashboard data={data} backHref="/" backLabel="Мои группы" showLogout={showLogout} />
  </>;
}
