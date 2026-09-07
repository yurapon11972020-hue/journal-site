export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startJournalCache } = await import('./lib/yandex-disk');
    void startJournalCache().catch(() => {
      console.error('[journal-cache] Стартовая загрузка журнала не удалась.');
    });
  }
}
