import { runPendingBroadcasts } from '@/lib/broadcast-delivery';

const BATCH_SIZE = 40;
const MAX_BATCHES_PER_RUN = 100;
const RETRY_CHECK_MS = 60_000;

declare global {
  var __broadcastInterval: NodeJS.Timeout | undefined;
  var __broadcastDrain: Promise<void> | undefined;
}

/** Быстро осушает очередь партиями, не создавая параллельных отправителей. */
export function kickBroadcastDrain(): Promise<void> {
  if (!globalThis.__broadcastDrain) {
    globalThis.__broadcastDrain = (async () => {
      for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
        const result = await runPendingBroadcasts();
        if (result.claimed < BATCH_SIZE) break;
      }
    })().finally(() => { globalThis.__broadcastDrain = undefined; });
  }
  return globalThis.__broadcastDrain;
}

/** Восстанавливает незавершённые рассылки после перезапуска сервера. */
export function startBroadcastDrainLoop(): void {
  if (!process.env.TELEGRAM_BOT_TOKEN?.trim() || globalThis.__broadcastInterval) return;
  const check = () => {
    void kickBroadcastDrain().catch((error) => {
      console.error('[broadcast] Не удалось обработать очередь:', error);
    });
  };
  globalThis.__broadcastInterval = setInterval(check, RETRY_CHECK_MS);
  globalThis.__broadcastInterval.unref?.();
  check();
}
