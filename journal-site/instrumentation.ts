export async function register() {
  // В serverless и на временном бесплатном хостинге журнал читается по запросу:
  // фоновые циклы не должны удерживать инстанс активным и расходовать квоту.
  if (process.env.VERCEL === '1' || process.env.SITE_ID || process.env.JOURNAL_DISABLE_BACKGROUND === '1') {
    return;
  }

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { startBroadcastDrainLoop } = await import('./lib/broadcast-scheduler');
      startBroadcastDrainLoop();
    } catch (error) {
      console.error('[broadcast] Не удалось запустить очередь:', error);
    }

    try {
      const { startLectureReminderLoop } = await import('./lib/lecture-reminders');
      startLectureReminderLoop();
    } catch (error) {
      console.error('[лекции] Не удалось запустить проверку расписания:', error);
    }

    const { startJournalCache } = await import('./lib/yandex-disk');
    void startJournalCache().catch((error) => {
      console.error('[journal-cache] Стартовая загрузка журнала не удалась:', error);
    });
  }
}
