'use client';

import { useEffect, useRef, useState } from 'react';

import { IconAlert } from '@/components/icons';
import styles from '@/components/browser-journal-recovery.module.css';
import { downloadYandexJournalInBrowser, sendJournalFileToSite } from '@/lib/browser-journal-download';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

interface BrowserJournalRecoveryProps {
  groupId: string;
  groupName: string;
  publicUrl: string;
  publicPath?: string;
}

export default function BrowserJournalRecovery({
  groupId,
  groupName,
  publicUrl,
  publicPath,
}: BrowserJournalRecoveryProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Пробуем получить журнал через твой браузер…');
  const autoStarted = useRef(false);

  async function sendFile(buffer: ArrayBuffer): Promise<void> {
    setMessage('Проверяем файл и открываем журнал…');
    await sendJournalFileToSite(groupId, buffer);

    setMessage('Журнал получен. Открываем группу…');
    window.location.reload();
  }

  async function fetchFromBrowser(): Promise<void> {
    setBusy(true);
    setMessage('Пробуем получить журнал через твой браузер…');

    try {
      await sendFile(await downloadYandexJournalInBrowser({ publicUrl, publicPath }));
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Неизвестная ошибка';
      setMessage(`Не удалось получить файл через браузер: ${reason}`);
      setBusy(false);
    }
  }

  async function submitLocalFile(file: File | undefined): Promise<void> {
    if (!file) {
      return;
    }

    setBusy(true);
    setMessage('Проверяем выбранный Excel-файл…');
    try {
      if (!file.size || file.size > MAX_FILE_BYTES) {
        throw new Error('Файл пустой или больше 20 МБ.');
      }
      await sendFile(await file.arrayBuffer());
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Неизвестная ошибка';
      setMessage(`Не удалось открыть файл: ${reason}`);
      setBusy(false);
    }
  }

  useEffect(() => {
    if (autoStarted.current) {
      return;
    }
    autoStarted.current = true;
    void fetchFromBrowser();
    // Запускаем только при первом открытии экрана ошибки; повтор — по кнопке.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="errorpage">
      <section className="errorpage__card">
        <div className="errorpage__icon" aria-hidden>
          <IconAlert size={20} />
        </div>
        <div className="errorpage__kicker">Восстановление журнала</div>
        <h1 className="errorpage__title">{groupName}</h1>
        <p className="errorpage__text">
          Серверу не удалось скачать файл с Яндекс.Диска. Сайт пробует получить его через твой браузер.
        </p>
        <p className={styles.status} role="status" aria-live="polite">{message}</p>
        <div className={styles.actions}>
          <button className="btn btn--primary" type="button" disabled={busy} onClick={() => void fetchFromBrowser()}>
            Повторить загрузку
          </button>
          <a className="btn" href={publicUrl} target="_blank" rel="noopener noreferrer">
            Открыть на Яндекс.Диске
          </a>
        </div>
        <label className={styles.fileLabel}>
          Если файл скачивается на Яндекс.Диске, выбери скачанный Excel здесь:
          <input
            className={styles.fileInput}
            type="file"
            accept=".xlsx,.xlsm,.xls"
            disabled={busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              void submitLocalFile(file);
            }}
          />
        </label>
        <p className={styles.note}>
          Сайт сверяет файл с текущей версией на Яндекс.Диске и сохраняет проверенную копию для группы и бота.
        </p>
      </section>
    </main>
  );
}
