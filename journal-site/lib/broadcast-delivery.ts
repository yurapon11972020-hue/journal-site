import { getBroadcastStore, type BroadcastDelivery } from '@/lib/broadcast-store';
import { getBotToken } from '@/lib/telegram';

const TELEGRAM_API = 'https://api.telegram.org';
const BATCH_SIZE = 40;
const PARALLEL_SENDS = 4;
const WAVE_PAUSE_MS = 250;

export interface BroadcastRunResult {
  claimed: number;
  sent: number;
  failed: number;
}

interface CopyResult {
  ok: boolean;
  permanent: boolean;
  error?: string;
}

async function copyMessage(delivery: BroadcastDelivery): Promise<CopyResult> {
  let response: Response;
  try {
    response = await fetch(`${TELEGRAM_API}/bot${getBotToken()}/copyMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: delivery.chatId,
        from_chat_id: delivery.sourceChatId,
        message_id: delivery.sourceMessageId,
        disable_notification: false,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    return { ok: false, permanent: false, error: error instanceof Error ? error.message : 'network error' };
  }

  const body = (await response.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
  if (response.ok && body?.ok) return { ok: true, permanent: false };
  // A blocked bot, unknown private chat, or unsupported/deleted source message
  // cannot be repaired by a retry. Server/network/rate-limit errors can.
  return {
    ok: false,
    permanent: response.status === 400 || response.status === 403,
    error: body?.description || `HTTP ${response.status}`,
  };
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends one short, durable batch. The same lock is used by webhook, timer, and
 * GitHub heartbeat, so their combined send rate stays below Telegram's limit.
 * A job's recipient set is frozen when the admin submits its one message.
 */
export async function runPendingBroadcasts(): Promise<BroadcastRunResult> {
  const store = getBroadcastStore();
  const result = await store.withWorkerLock(async (): Promise<BroadcastRunResult> => {
    const deliveries = await store.claimPending(BATCH_SIZE);
    const counters = { claimed: deliveries.length, sent: 0, failed: 0 };
    for (let offset = 0; offset < deliveries.length; offset += PARALLEL_SENDS) {
      const wave = deliveries.slice(offset, offset + PARALLEL_SENDS);
      await Promise.all(wave.map(async (delivery) => {
        const outcome = await copyMessage(delivery);
        await store.markDelivery(delivery.jobId, delivery.chatId, outcome.ok, outcome.error, outcome.permanent);
        if (outcome.ok) {
          counters.sent += 1;
        } else {
          counters.failed += 1;
          console.error(`[рассылка] Чат ${delivery.chatId}, задание ${delivery.jobId}: ${outcome.error ?? 'отклонено Telegram'}`);
        }
      }));
      if (offset + PARALLEL_SENDS < deliveries.length) await pause(WAVE_PAUSE_MS);
    }
    return counters;
  });
  return result ?? { claimed: 0, sent: 0, failed: 0 };
}
