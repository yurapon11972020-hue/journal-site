import { Pool } from 'pg';

/** Напоминания о видеозанятиях и обычных лекциях включаются независимо. */
export type LectureMode = 'video' | 'lecture';

export interface LectureSubscription {
  chatId: number;
  /** Название группы в расписании skp-rasp.ru. */
  groupName: string;
  video: boolean;
  lecture: boolean;
}

export interface LectureStore {
  listByChat(chatId: number): Promise<LectureSubscription[]>;
  get(chatId: number, groupName: string): Promise<LectureSubscription | null>;
  setMode(chatId: number, groupName: string, mode: LectureMode, enabled: boolean): Promise<void>;
  listChats(groupName: string, mode: LectureMode): Promise<number[]>;
  /** Атомарно резервирует отправку одной пары одному чату. */
  claim(eventKey: string, chatId: number): Promise<boolean>;
  markSent(eventKey: string, chatId: number): Promise<void>;
  /** Возвращает резервирование после явной ошибки Telegram, чтобы повторить попытку. */
  release(eventKey: string, chatId: number): Promise<void>;
}

// Дольше десятиминутного окна напоминания: если Telegram принял сообщение,
// а запись sent_at временно не удалась, другой запуск не отправит дубль.
const CLAIM_LEASE_MS = 15 * 60 * 1000;

class MemoryLectureStore implements LectureStore {
  private readonly subscriptions = new Map<string, LectureSubscription>();
  private readonly deliveries = new Map<string, { claimedAt: number; sent: boolean }>();

  private static key(chatId: number, groupName: string): string {
    return JSON.stringify([chatId, groupName]);
  }

  private static deliveryKey(eventKey: string, chatId: number): string {
    return JSON.stringify([eventKey, chatId]);
  }

  async listByChat(chatId: number): Promise<LectureSubscription[]> {
    return [...this.subscriptions.values()]
      .filter((item) => item.chatId === chatId)
      .map((item) => ({ ...item }))
      .sort((a, b) => a.groupName.localeCompare(b.groupName, 'ru'));
  }

  async get(chatId: number, groupName: string): Promise<LectureSubscription | null> {
    const item = this.subscriptions.get(MemoryLectureStore.key(chatId, groupName));
    return item ? { ...item } : null;
  }

  async setMode(chatId: number, groupName: string, mode: LectureMode, enabled: boolean): Promise<void> {
    const key = MemoryLectureStore.key(chatId, groupName);
    const current = this.subscriptions.get(key) ?? { chatId, groupName, video: false, lecture: false };
    const next = { ...current, [mode]: enabled };
    if (next.video || next.lecture) {
      this.subscriptions.set(key, next);
    } else {
      this.subscriptions.delete(key);
    }
  }

  async listChats(groupName: string, mode: LectureMode): Promise<number[]> {
    return [...this.subscriptions.values()]
      .filter((item) => item.groupName === groupName && item[mode])
      .map((item) => item.chatId);
  }

  async claim(eventKey: string, chatId: number): Promise<boolean> {
    const key = MemoryLectureStore.deliveryKey(eventKey, chatId);
    const previous = this.deliveries.get(key);
    if (previous?.sent || (previous && Date.now() - previous.claimedAt < CLAIM_LEASE_MS)) {
      return false;
    }
    this.deliveries.set(key, { claimedAt: Date.now(), sent: false });
    return true;
  }

  async markSent(eventKey: string, chatId: number): Promise<void> {
    const key = MemoryLectureStore.deliveryKey(eventKey, chatId);
    const previous = this.deliveries.get(key);
    if (previous) {
      this.deliveries.set(key, { ...previous, sent: true });
    }
  }

  async release(eventKey: string, chatId: number): Promise<void> {
    const key = MemoryLectureStore.deliveryKey(eventKey, chatId);
    if (!this.deliveries.get(key)?.sent) {
      this.deliveries.delete(key);
    }
  }
}

const CREATE_TABLES = `
  CREATE TABLE IF NOT EXISTS lecture_subscriptions (
    chat_id      BIGINT NOT NULL,
    group_name   TEXT NOT NULL,
    video        BOOLEAN NOT NULL DEFAULT false,
    lecture      BOOLEAN NOT NULL DEFAULT false,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chat_id, group_name)
  );

  CREATE INDEX IF NOT EXISTS lecture_subscriptions_group_idx ON lecture_subscriptions (group_name);

  CREATE TABLE IF NOT EXISTS lecture_deliveries (
    event_key    TEXT NOT NULL,
    chat_id      BIGINT NOT NULL,
    claimed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at      TIMESTAMPTZ,
    PRIMARY KEY (event_key, chat_id)
  );
`;

class PostgresLectureStore implements LectureStore {
  private ready: Promise<void> | null = null;

  constructor(private readonly pool: Pool) {}

  private ensureReady(): Promise<void> {
    this.ready ??= this.pool.query(CREATE_TABLES).then(() => undefined).catch((error: unknown) => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }

  private static toSubscription(row: {
    chat_id: string | number;
    group_name: string;
    video: boolean;
    lecture: boolean;
  }): LectureSubscription {
    return {
      chatId: Number(row.chat_id),
      groupName: row.group_name,
      video: row.video,
      lecture: row.lecture,
    };
  }

  async listByChat(chatId: number): Promise<LectureSubscription[]> {
    await this.ensureReady();
    const result = await this.pool.query(
      'SELECT chat_id, group_name, video, lecture FROM lecture_subscriptions WHERE chat_id = $1 ORDER BY group_name',
      [chatId],
    );
    return result.rows.map(PostgresLectureStore.toSubscription);
  }

  async get(chatId: number, groupName: string): Promise<LectureSubscription | null> {
    await this.ensureReady();
    const result = await this.pool.query(
      'SELECT chat_id, group_name, video, lecture FROM lecture_subscriptions WHERE chat_id = $1 AND group_name = $2',
      [chatId, groupName],
    );
    return result.rows[0] ? PostgresLectureStore.toSubscription(result.rows[0]) : null;
  }

  async setMode(chatId: number, groupName: string, mode: LectureMode, enabled: boolean): Promise<void> {
    await this.ensureReady();
    // Название столбца берётся только из закрытого объединения LectureMode.
    const column = mode === 'video' ? 'video' : 'lecture';
    await this.pool.query(
      `INSERT INTO lecture_subscriptions (chat_id, group_name, video, lecture)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (chat_id, group_name)
       DO UPDATE SET ${column} = EXCLUDED.${column}`,
      [chatId, groupName, mode === 'video' && enabled, mode === 'lecture' && enabled],
    );
    await this.pool.query(
      'DELETE FROM lecture_subscriptions WHERE chat_id = $1 AND group_name = $2 AND video = false AND lecture = false',
      [chatId, groupName],
    );
  }

  async listChats(groupName: string, mode: LectureMode): Promise<number[]> {
    await this.ensureReady();
    const column = mode === 'video' ? 'video' : 'lecture';
    const result = await this.pool.query(
      `SELECT chat_id FROM lecture_subscriptions WHERE group_name = $1 AND ${column} = true`,
      [groupName],
    );
    return result.rows.map((row: { chat_id: string | number }) => Number(row.chat_id));
  }

  async claim(eventKey: string, chatId: number): Promise<boolean> {
    await this.ensureReady();
    const result = await this.pool.query(
      `INSERT INTO lecture_deliveries (event_key, chat_id, claimed_at)
       VALUES ($1, $2, now())
       ON CONFLICT (event_key, chat_id)
       DO UPDATE SET claimed_at = now()
       WHERE lecture_deliveries.sent_at IS NULL
         AND lecture_deliveries.claimed_at < now() - interval '15 minutes'
       RETURNING event_key`,
      [eventKey, chatId],
    );
    return result.rowCount === 1;
  }

  async markSent(eventKey: string, chatId: number): Promise<void> {
    await this.ensureReady();
    await this.pool.query(
      'UPDATE lecture_deliveries SET sent_at = now() WHERE event_key = $1 AND chat_id = $2 AND sent_at IS NULL',
      [eventKey, chatId],
    );
  }

  async release(eventKey: string, chatId: number): Promise<void> {
    await this.ensureReady();
    await this.pool.query(
      'DELETE FROM lecture_deliveries WHERE event_key = $1 AND chat_id = $2 AND sent_at IS NULL',
      [eventKey, chatId],
    );
  }
}

let store: LectureStore | null = null;
let warnedAboutMemory = false;

export function getLectureStore(): LectureStore {
  if (store) {
    return store;
  }

  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    if (!warnedAboutMemory) {
      warnedAboutMemory = true;
      console.warn('[лекции] DATABASE_URL не задан — подписки на лекции пропадут при перезапуске.');
    }
    store = new MemoryLectureStore();
    return store;
  }

  const pool = new Pool({
    connectionString: url,
    ssl: url.includes('sslmode=disable') ? undefined : { rejectUnauthorized: false },
    max: 2,
  });
  pool.on('error', (error) => {
    console.error('[лекции] Ошибка соединения с базой:', error.message);
  });

  store = new PostgresLectureStore(pool);
  return store;
}

/** Только для тестов: подменить хранилище. */
export function setLectureStoreForTests(next: LectureStore | null): void {
  store = next;
}
