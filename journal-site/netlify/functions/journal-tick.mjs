/** Минутный будильник для напоминаний, оценок и очереди рассылки. */
const journalTick = async () => {
  const baseUrl = process.env.URL;
  const secret = process.env.JOURNAL_CRON_SECRET;
  if (!baseUrl || !secret) return;

  const response = await fetch(new URL('/api/cron', baseUrl), {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(27_000),
  });
  if (!response.ok) {
    throw new Error(`Journal cron returned HTTP ${response.status}`);
  }
};

export default journalTick;
export const config = { schedule: '* * * * *' };
