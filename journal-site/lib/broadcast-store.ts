import { Pool, type PoolClient } from 'pg';

const ARM_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;

export interface BroadcastEnqueueResult {
  jobId: number;
  recipientCount: number;
  /** false means Telegram delivered the same update again; no second job was made. */
  created: boolean;
}

export interface BroadcastStatus {
  jobId: number;
  recipientCount: number;
  sent: number;
  failed: number;
  pending: number;
  createdAt: Date;
}

export interface BroadcastDelivery {
  jobId: number;
  chatId: number;
  sourceChatId: number;
  sourceMessageId: number;
  attempts: number;
}

export interface BroadcastStore {
  /** Only private Telegram chats are eligible. */
  rememberChat(chatId: number, chatType?: string): Promise<void>;
  /** A password message authorizes only the next, newer message for five minutes. */
  /** false for a replay or an older password update. */
  arm(chatId: number, passwordMessageId: number): Promise<boolean>;
  /** Cancels the pending one-message authorization without removing users or jobs. */
  cancel(chatId: number): Promise<void>;
  /** Consumes authorization and snapshots the recipients in one transaction. */
  enqueueArmedMessage(chatId: number, messageId: number): Promise<BroadcastEnqueueResult | null>;
  latestStatus(chatId: number): Promise<BroadcastStatus | null>;
  /** Useful for read-only inspection; does not expose the password or message. */
  listRecipientChatIds(): Promise<number[]>;
  /** One worker globally sends at a time to stay below Telegram's bot-wide rate limit. */
  withWorkerLock<T>(work: () => Promise<T>): Promise<T | null>;
  claimPending(limit: number): Promise<BroadcastDelivery[]>;
  markDelivery(jobId: number, chatId: number, delivered: boolean, error?: string, permanent?: boolean): Promise<void>;
}

function isPrivate(chatId: number, chatType?: string): boolean {
  return Number.isSafeInteger(chatId) && chatId > 0 && chatType === 'private';
}

function statusFromCounts(
  jobId: number,
  recipientCount: number,
  sent: number,
  failed: number,
  createdAt: Date,
): BroadcastStatus {
  return { jobId, recipientCount, sent, failed, pending: recipientCount - sent - failed, createdAt };
}

class MemoryBroadcastStore implements BroadcastStore {
  private readonly chats = new Set<number>();
  private readonly arms = new Map<number, { afterMessageId: number; expiresAt: number; consumed: boolean }>();
  private readonly jobs = new Map<number, { chatId: number; messageId: number; createdAt: Date; recipients: Map<number, { attempts: number; state: 'pending' | 'sending' | 'sent' | 'failed'; claimedAt: number }> }>();
  private nextJobId = 1;
  private working = false;

  async rememberChat(chatId: number, chatType?: string): Promise<void> {
    if (isPrivate(chatId, chatType)) this.chats.add(chatId);
  }

  async arm(chatId: number, passwordMessageId: number): Promise<boolean> {
    const current = this.arms.get(chatId);
    if (current && current.afterMessageId >= passwordMessageId) return false;
    this.arms.set(chatId, { afterMessageId: passwordMessageId, expiresAt: Date.now() + ARM_TTL_MS, consumed: false });
    return true;
  }

  async cancel(chatId: number): Promise<void> {
    const arm = this.arms.get(chatId);
    if (arm) arm.consumed = true;
  }

  async enqueueArmedMessage(chatId: number, messageId: number): Promise<BroadcastEnqueueResult | null> {
    for (const [jobId, job] of this.jobs) {
      if (job.chatId === chatId && job.messageId === messageId) {
        return { jobId, recipientCount: job.recipients.size, created: false };
      }
    }
    const arm = this.arms.get(chatId);
    if (!arm || arm.consumed || arm.expiresAt <= Date.now() || messageId <= arm.afterMessageId) return null;
    arm.consumed = true;
    const jobId = this.nextJobId++;
    const recipients = new Map([...this.chats].map((id) => [id, { attempts: 0, state: 'pending' as const, claimedAt: 0 }]));
    this.jobs.set(jobId, { chatId, messageId, createdAt: new Date(), recipients });
    return { jobId, recipientCount: recipients.size, created: true };
  }

  async latestStatus(chatId: number): Promise<BroadcastStatus | null> {
    const [jobId, job] = [...this.jobs].reverse().find(([, item]) => item.chatId === chatId) ?? [];
    if (jobId === undefined || !job) return null;
    const recipients = [...job.recipients.values()];
    return statusFromCounts(
      jobId,
      recipients.length,
      recipients.filter((item) => item.state === 'sent').length,
      recipients.filter((item) => item.state === 'failed').length,
      job.createdAt,
    );
  }

  async listRecipientChatIds(): Promise<number[]> {
    return [...this.chats].sort((a, b) => a - b);
  }

  async withWorkerLock<T>(work: () => Promise<T>): Promise<T | null> {
    if (this.working) return null;
    this.working = true;
    try {
      return await work();
    } finally {
      this.working = false;
    }
  }

  async claimPending(limit: number): Promise<BroadcastDelivery[]> {
    const result: BroadcastDelivery[] = [];
    for (const [jobId, job] of this.jobs) {
      for (const [chatId, delivery] of job.recipients) {
        const expiredClaim = delivery.state === 'sending' && Date.now() - delivery.claimedAt > 2 * 60 * 1000;
        if (expiredClaim && delivery.attempts >= MAX_ATTEMPTS) {
          delivery.state = 'failed';
          continue;
        }
        const pendingReady = delivery.state === 'pending' && (!delivery.claimedAt || Date.now() - delivery.claimedAt >= 60_000);
        if ((!pendingReady && !expiredClaim) || delivery.attempts >= MAX_ATTEMPTS) continue;
        delivery.state = 'sending';
        delivery.claimedAt = Date.now();
        delivery.attempts += 1;
        result.push({ jobId, chatId, sourceChatId: job.chatId, sourceMessageId: job.messageId, attempts: delivery.attempts });
        if (result.length >= limit) return result;
      }
    }
    return result;
  }

  async markDelivery(jobId: number, chatId: number, delivered: boolean, _error?: string, permanent = false): Promise<void> {
    const row = this.jobs.get(jobId)?.recipients.get(chatId);
    if (row?.state === 'sending') row.state = delivered ? 'sent' : permanent || row.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
  }
}

const CREATE_TABLES = `
  CREATE TABLE IF NOT EXISTS bot_chats (
    chat_id BIGINT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS broadcast_arms (
    chat_id BIGINT PRIMARY KEY,
    after_message_id INTEGER NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
  );
  ALTER TABLE broadcast_arms ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;
  CREATE TABLE IF NOT EXISTS broadcast_jobs (
    id BIGSERIAL PRIMARY KEY,
    source_chat_id BIGINT NOT NULL,
    source_message_id INTEGER NOT NULL,
    recipient_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_chat_id, source_message_id)
  );
  CREATE TABLE IF NOT EXISTS broadcast_deliveries (
    job_id BIGINT NOT NULL REFERENCES broadcast_jobs(id),
    chat_id BIGINT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    claimed_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    last_error TEXT,
    PRIMARY KEY (job_id, chat_id)
  );
  CREATE INDEX IF NOT EXISTS broadcast_deliveries_pending_idx
    ON broadcast_deliveries (job_id, chat_id) WHERE state IN ('pending', 'sending');
`;

class PostgresBroadcastStore implements BroadcastStore {
  private ready: Promise<void> | null = null;

  constructor(private readonly pool: Pool) {}

  private ensureReady(): Promise<void> {
    this.ready ??= this.initialize().catch((error: unknown) => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }

  private async initialize(): Promise<void> {
    await this.pool.query(CREATE_TABLES);
    // Before this feature existed, only subscribers had durable chat IDs.
    // Telegram cannot enumerate users, so import those private IDs once.
    const known = await this.pool.query<{ grade_table: string | null; lecture_table: string | null }>(
      "SELECT to_regclass('subscriptions')::text AS grade_table, to_regclass('lecture_subscriptions')::text AS lecture_table",
    );
    if (known.rows[0]?.grade_table) {
      await this.pool.query(`INSERT INTO bot_chats (chat_id)
        SELECT DISTINCT chat_id FROM subscriptions WHERE chat_id > 0
        ON CONFLICT (chat_id) DO NOTHING`);
    }
    if (known.rows[0]?.lecture_table) {
      await this.pool.query(`INSERT INTO bot_chats (chat_id)
        SELECT DISTINCT chat_id FROM lecture_subscriptions WHERE chat_id > 0
        ON CONFLICT (chat_id) DO NOTHING`);
    }
  }

  async rememberChat(chatId: number, chatType?: string): Promise<void> {
    if (!isPrivate(chatId, chatType)) return;
    await this.ensureReady();
    await this.pool.query(`INSERT INTO bot_chats (chat_id) VALUES ($1)
      ON CONFLICT (chat_id) DO UPDATE SET last_seen_at = now()`, [chatId]);
  }

  async arm(chatId: number, passwordMessageId: number): Promise<boolean> {
    await this.ensureReady();
    const result = await this.pool.query(`INSERT INTO broadcast_arms (chat_id, after_message_id, expires_at, consumed_at)
      VALUES ($1, $2, now() + interval '5 minutes', NULL)
      ON CONFLICT (chat_id) DO UPDATE
      SET after_message_id = EXCLUDED.after_message_id, expires_at = EXCLUDED.expires_at, consumed_at = NULL
      WHERE broadcast_arms.after_message_id < EXCLUDED.after_message_id`,
    [chatId, passwordMessageId]);
    return result.rowCount === 1;
  }

  async cancel(chatId: number): Promise<void> {
    await this.ensureReady();
    await this.pool.query('UPDATE broadcast_arms SET consumed_at = now() WHERE chat_id = $1 AND consumed_at IS NULL', [chatId]);
  }

  async enqueueArmedMessage(chatId: number, messageId: number): Promise<BroadcastEnqueueResult | null> {
    await this.ensureReady();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ id: string; recipient_count: number }>(
        'SELECT id, recipient_count FROM broadcast_jobs WHERE source_chat_id = $1 AND source_message_id = $2',
        [chatId, messageId],
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return { jobId: Number(existing.rows[0].id), recipientCount: existing.rows[0].recipient_count, created: false };
      }

      const consumed = await client.query(
        `UPDATE broadcast_arms SET consumed_at = now()
         WHERE chat_id = $1 AND after_message_id < $2 AND expires_at > now() AND consumed_at IS NULL
         RETURNING chat_id`,
        [chatId, messageId],
      );
      if (consumed.rowCount !== 1) {
        await client.query('COMMIT');
        return null;
      }

      const inserted = await client.query<{ id: string }>(
        'INSERT INTO broadcast_jobs (source_chat_id, source_message_id) VALUES ($1, $2) RETURNING id',
        [chatId, messageId],
      );
      const jobId = Number(inserted.rows[0].id);
      const recipients = await client.query(
        `INSERT INTO broadcast_deliveries (job_id, chat_id)
         SELECT $1, chat_id FROM bot_chats WHERE chat_id > 0`,
        [jobId],
      );
      const recipientCount = recipients.rowCount ?? 0;
      await client.query('UPDATE broadcast_jobs SET recipient_count = $2 WHERE id = $1', [jobId, recipientCount]);
      await client.query('COMMIT');
      return { jobId, recipientCount, created: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async latestStatus(chatId: number): Promise<BroadcastStatus | null> {
    await this.ensureReady();
    const result = await this.pool.query<{
      id: string; recipient_count: number; created_at: Date; sent: string; failed: string;
    }>(`SELECT j.id, j.recipient_count, j.created_at,
          count(d.chat_id) FILTER (WHERE d.state = 'sent') AS sent,
          count(d.chat_id) FILTER (WHERE d.state = 'failed') AS failed
        FROM broadcast_jobs j
        LEFT JOIN broadcast_deliveries d ON d.job_id = j.id
        WHERE j.source_chat_id = $1
        GROUP BY j.id
        ORDER BY j.id DESC LIMIT 1`, [chatId]);
    const row = result.rows[0];
    return row ? statusFromCounts(Number(row.id), row.recipient_count, Number(row.sent), Number(row.failed), row.created_at) : null;
  }

  async listRecipientChatIds(): Promise<number[]> {
    await this.ensureReady();
    const result = await this.pool.query<{ chat_id: string }>('SELECT chat_id FROM bot_chats ORDER BY chat_id');
    return result.rows.map((row) => Number(row.chat_id));
  }

  async withWorkerLock<T>(work: () => Promise<T>): Promise<T | null> {
    await this.ensureReady();
    const client: PoolClient = await this.pool.connect();
    let locked = false;
    try {
      const result = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(73052106) AS locked');
      locked = result.rows[0]?.locked === true;
      if (!locked) return null;
      return await work();
    } finally {
      if (locked) await client.query('SELECT pg_advisory_unlock(73052106)').catch(() => undefined);
      client.release();
    }
  }

  async claimPending(limit: number): Promise<BroadcastDelivery[]> {
    await this.ensureReady();
    await this.pool.query(`UPDATE broadcast_deliveries
      SET state = 'failed', last_error = 'Доставка прервана на последней попытке'
      WHERE state = 'sending' AND attempts >= $1 AND claimed_at < now() - interval '2 minutes'`, [MAX_ATTEMPTS]);
    const result = await this.pool.query<{
      job_id: string; chat_id: string; source_chat_id: string; source_message_id: number; attempts: number;
    }>(`WITH claim AS (
          SELECT job_id, chat_id FROM broadcast_deliveries
          WHERE attempts < $1 AND (
            (state = 'pending' AND (claimed_at IS NULL OR claimed_at < now() - interval '1 minute'))
            OR (state = 'sending' AND claimed_at < now() - interval '2 minutes')
          )
          ORDER BY job_id, chat_id
          FOR UPDATE SKIP LOCKED
          LIMIT $2
        )
        UPDATE broadcast_deliveries d
        SET state = 'sending', attempts = d.attempts + 1, claimed_at = now()
        FROM claim c, broadcast_jobs j
        WHERE d.job_id = c.job_id AND d.chat_id = c.chat_id AND j.id = d.job_id
        RETURNING d.job_id, d.chat_id, j.source_chat_id, j.source_message_id, d.attempts`,
    [MAX_ATTEMPTS, Math.max(1, Math.min(40, Math.floor(limit)))]);
    return result.rows.map((row) => ({
      jobId: Number(row.job_id), chatId: Number(row.chat_id), sourceChatId: Number(row.source_chat_id),
      sourceMessageId: row.source_message_id, attempts: row.attempts,
    }));
  }

  async markDelivery(jobId: number, chatId: number, delivered: boolean, error?: string, permanent = false): Promise<void> {
    await this.ensureReady();
    await this.pool.query(`UPDATE broadcast_deliveries
      SET state = CASE WHEN $3 THEN 'sent' WHEN $6 OR attempts >= $4 THEN 'failed' ELSE 'pending' END,
          sent_at = CASE WHEN $3 THEN now() ELSE sent_at END,
          last_error = CASE WHEN $3 THEN NULL ELSE left($5, 200) END
      WHERE job_id = $1 AND chat_id = $2 AND state = 'sending'`,
    [jobId, chatId, delivered, MAX_ATTEMPTS, error ?? 'Telegram не принял сообщение', permanent]);
  }
}

let store: BroadcastStore | null = null;
let warnedAboutMemory = false;

export function getBroadcastStore(): BroadcastStore {
  if (store) return store;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    if (!warnedAboutMemory) {
      warnedAboutMemory = true;
      console.warn('[рассылка] DATABASE_URL не задан — адресаты и очередь хранятся только в памяти.');
    }
    store = new MemoryBroadcastStore();
    return store;
  }
  const pool = new Pool({
    connectionString: url,
    ssl: url.includes('sslmode=disable') ? undefined : { rejectUnauthorized: false },
    max: 3,
  });
  pool.on('error', (error) => console.error('[рассылка] Ошибка соединения с базой:', error.message));
  store = new PostgresBroadcastStore(pool);
  return store;
}

export function setBroadcastStoreForTests(next: BroadcastStore | null): void {
  store = next;
}
