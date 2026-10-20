export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
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
