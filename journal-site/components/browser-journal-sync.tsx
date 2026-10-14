'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  downloadYandexJournalInBrowser,
  readYandexJournalMd5,
  sendJournalFileToSite,
} from '@/lib/browser-journal-download';
import styles from '@/components/browser-journal-sync.module.css';

interface BrowserJournalSyncProps {
  groupId: string;
  publicUrl: string;
  publicPath?: string;
  cachedMd5: string;
}

/** Открытая группа помогает серверу получить обновление, когда Яндекс отказывает Render. */
export default function BrowserJournalSync({ groupId, publicUrl, publicPath, cachedMd5 }: BrowserJournalSyncProps) {
  const router = useRouter();
  const working = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(buffer: ArrayBuffer): Promise<void> {
    await sendJournalFileToSite(groupId, buffer);
    setError(null);
    router.refresh();
  }

  useEffect(() => {
    let mounted = true;

    async function checkForUpdate() {
      if (working.current || document.visibilityState !== 'visible') {
        return;
      }
      working.current = true;
      try {
        let currentMd5: string;
        try {
          currentMd5 = await readYandexJournalMd5({ publicUrl, publicPath });
        } catch {
          // Недоступность метаданных не означает, что открытая копия устарела.
          return;
        }
        if (currentMd5 === cachedMd5.toLowerCase()) {
          if (mounted) setError(null);
          return;
        }
        if (mounted) setBusy(true);
        const buffer = await downloadYandexJournalInBrowser({ publicUrl, publicPath });
        await upload(buffer);
      } catch (cause) {
        if (mounted) {
          setError(cause instanceof Error ? cause.message : 'Не удалось скачать обновление.');
        }
      } finally {
        working.current = false;
        if (mounted) setBusy(false);
      }
    }

    void checkForUpdate();
    const interval = window.setInterval(() => void checkForUpdate(), 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkForUpdate();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      mounted = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // При изменении серверной версии запускаем проверку заново.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, publicUrl, publicPath, cachedMd5]);

  async function uploadLocalFile(file: File | undefined) {
    if (!file || working.current) return;
    working.current = true;
    setBusy(true);
    try {
      await upload(await file.arrayBuffer());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось открыть выбранный файл.');
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  if (!error && !busy) return null;

  return (
    <aside className={styles.notice} role="status" aria-live="polite">
      <strong>{busy ? 'Обновляем журнал…' : 'Яндекс не отдал обновление автоматически'}</strong>
      {error && (
        <>
          <p>{error}</p>
          <p>Текущая копия журнала открыта. Если новый файл скачивается у тебя, выбери его здесь:</p>
          <input
            type="file"
            accept=".xlsx,.xlsm,.xls"
            disabled={busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              void uploadLocalFile(file);
            }}
          />
          <a href={publicUrl} target="_blank" rel="noopener noreferrer">Открыть файл на Яндекс.Диске</a>
        </>
      )}
    </aside>
  );
}
