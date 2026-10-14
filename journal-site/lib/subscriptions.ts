import { Pool } from 'pg';

/** Подписка одного телеграм-чата на оценки одного студента. */
export interface Subscription {
  chatId: number;
  /** Опознаватель группы — тот же, что в ссылках сайта. */
  groupId: string;
  studentId: number;
  studentName: string;
  /** Список предметов; пустой массив означает «все предметы». */
  subjects: string[];
}

/** Снимок журнала: «студент|предмет|занятие» → значение клетки. */
export type MarksSnapshot = Record<string, string>;

/** Сообщение, ожидающее подтверждённой отправки в Telegram. */
export interface PendingMessage {
  /** Уникальный ID одного события для подтверждения конкретного сообщения. */
  id: string;
  chatId: number;
  text: string;
}

export interface SubscriptionStore {
  listByGroup(groupId: string): Promise<Subscription[]>;
  listByChat(chatId: number): Promise<Subscription[]>;
  save(subscription: Subscription): Promise<void>;
  remove(chatId: number, groupId: string, studentId: number): Promise<void>;
  readSnapshot(groupId: string): Promise<MarksSnapshot | null>;
  writeSnapshot(groupId: string, marks: MarksSnapshot): Promise<void>;
  stageNotificationsAndSnapshot(groupId: string, marks: MarksSnapshot, messages: PendingMessage[]): Promise<void>;
  listPendingMessages(groupId: string): Promise<PendingMessage[]>;
  ackPendingMessage(id: string): Promise<void>;
}

/* ----------------------------- в памяти ----------------------------- */

/**
 * Запасной вариант, когда база не подключена: всё живёт в памяти процесса
 * и пропадает при перезапуске. Годится для локальной разработки и тестов.
 */
class MemoryStore implements SubscriptionStore {
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly snapshots = new Map<string, MarksSnapshot>();
  private readonly messages = new Map<string, { groupId: string; message: PendingMessage }>();

  private static key(chatId: number, groupId: string, studentId: number): string {
    return `${chatId}|${groupId}|${studentId}`;
  }

  async listByGroup(groupId: string): Promise<Subscription[]> {
    return [...this.subscriptions.values()].filter((item) => item.groupId === groupId);
  }

  async listByChat(chatId: number): Promise<Subscription[]> {
    return [...this.subscriptions.values()].filter((item) => item.chatId === chatId);
  }

  async save(subscription: Subscription): Promise<void> {
    this.subscriptions.set(
      MemoryStore.key(subscription.chatId, subscription.groupId, subscription.studentId),
      subscription,
    );
  }

  async remove(chatId: number, groupId: string, studentId: number): Promise<void> {
    this.subscriptions.delete(MemoryStore.key(chatId, groupId, studentId));
  }

  async readSnapshot(groupId: string): Promise<MarksSnapshot | null> {
    return this.snapshots.get(groupId) ?? null;
  }

  async writeSnapshot(groupId: string, marks: MarksSnapshot): Promise<void> {
    this.snapshots.set(groupId, marks);
  }

  async stageNotificationsAndSnapshot(groupId: string, marks: MarksSnapshot, messages: PendingMessage[]): Promise<void> {
    for (const message of messages) {
      if (!this.messages.has(message.id)) {
        this.messages.set(message.id, { groupId, message: { ...message } });
      }
    }
    this.snapshots.set(groupId, marks);
  }

  async listPendingMessages(groupId: string): Promise<PendingMessage[]> {
    return [...this.messages.values()]
      .filter((entry) => entry.groupId === groupId)
      .map((entry) => ({ ...entry.message }));
  }

  async ackPendingMessage(id: string): Promise<void> {
    this.messages.delete(id);
  }
}

/* ----------------------------- Postgres ----------------------------- */

const CREATE_TABLES = `
  CREATE TABLE IF NOT EXISTS subscriptions (
    chat_id      BIGINT  NOT NULL,
    group_id     TEXT    NOT NULL,
    student_id   INTEGER NOT NULL,
    student_name TEXT    NOT NULL,
    subjects     TEXT[]  NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chat_id, group_id, student_id)
  );

  CREATE INDEX IF NOT EXISTS subscriptions_group_idx ON subscriptions (group_id);

  CREATE TABLE IF NOT EXISTS journal_snapshots (
    group_id TEXT PRIMARY KEY,
    taken_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    marks    JSONB NOT NULL
  );

  CREATE TABLE IF NOT EXISTS telegram_outbox (
    id           TEXT PRIMARY KEY,
    group_id     TEXT NOT NULL,
    chat_id      BIGINT NOT NULL,
    message_text TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS telegram_outbox_pending_group_idx
    ON telegram_outbox (group_id, created_at, id);
`;

class PostgresStore implements SubscriptionStore {
  private ready: Promise<void> | null = null;

  constructor(private readonly pool: Pool) {}

  /** Таблицы создаются один раз при первом обращении. */
  private ensureReady(): Promise<void> {
    this.ready ??= this.pool.query(CREATE_TABLES).then(() => undefined);
    return this.ready;
  }

  private static toSubscription(row: {
    chat_id: string | number;
    group_id: string;
    student_id: number;
    student_name: string;
    subjects: string[] | null;
  }): Subscription {
    return {
      chatId: Number(row.chat_id),
      groupId: row.group_id,
      studentId: row.student_id,
      studentName: row.student_name,
      subjects: row.subjects ?? [],
    };
  }

  async listByGroup(groupId: string): Promise<Subscription[]> {
    await this.ensureReady();
    const result = await this.pool.query('SELECT * FROM subscriptions WHERE group_id = $1', [groupId]);
    return result.rows.map(PostgresStore.toSubscription);
  }

  async listByChat(chatId: number): Promise<Subscription[]> {
    await this.ensureReady();
    const result = await this.pool.query('SELECT * FROM subscriptions WHERE chat_id = $1', [chatId]);
    return result.rows.map(PostgresStore.toSubscription);
  }

  async save(subscription: Subscription): Promise<void> {
    await this.ensureReady();
    await this.pool.query(
      `INSERT INTO subscriptions (chat_id, group_id, student_id, student_name, subjects)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (chat_id, group_id, student_id)
       DO UPDATE SET student_name = EXCLUDED.student_name, subjects = EXCLUDED.subjects`,
      [subscription.chatId, subscription.groupId, subscription.studentId, subscription.studentName, subscription.subjects],
    );
  }

  async remove(chatId: number, groupId: string, studentId: number): Promise<void> {
    await this.ensureReady();
    await this.pool.query(
      'DELETE FROM subscriptions WHERE chat_id = $1 AND group_id = $2 AND student_id = $3',
      [chatId, groupId, studentId],
    );
  }

  async readSnapshot(groupId: string): Promise<MarksSnapshot | null> {
    await this.ensureReady();
    const result = await this.pool.query('SELECT marks FROM journal_snapshots WHERE group_id = $1', [groupId]);
    return (result.rows[0]?.marks as MarksSnapshot | undefined) ?? null;
  }

  async writeSnapshot(groupId: string, marks: MarksSnapshot): Promise<void> {
    await this.ensureReady();
    await this.pool.query(
      `INSERT INTO journal_snapshots (group_id, taken_at, marks)
       VALUES ($1, now(), $2)
       ON CONFLICT (group_id) DO UPDATE SET taken_at = now(), marks = EXCLUDED.marks`,
      [groupId, JSON.stringify(marks)],
    );
  }

  async stageNotificationsAndSnapshot(groupId: string, marks: MarksSnapshot, messages: PendingMessage[]): Promise<void> {
    await this.ensureReady();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (messages.length) {
        await client.query(
          `INSERT INTO telegram_outbox (id, group_id, chat_id, message_text)
           SELECT pending.id, $1, pending.chat_id, pending.message_text
           FROM UNNEST($2::text[], $3::bigint[], $4::text[])
             AS pending(id, chat_id, message_text)
           ON CONFLICT (id) DO NOTHING`,
          [groupId, messages.map((message) => message.id), messages.map((message) => message.chatId), messages.map((message) => message.text)],
        );
      }
      await client.query(
        `INSERT INTO journal_snapshots (group_id, taken_at, marks)
         VALUES ($1, now(), $2)
         ON CONFLICT (group_id) DO UPDATE SET taken_at = now(), marks = EXCLUDED.marks`,
        [groupId, JSON.stringify(marks)],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listPendingMessages(groupId: string): Promise<PendingMessage[]> {
    await this.ensureReady();
    const result = await this.pool.query(
      `SELECT id, chat_id, message_text FROM telegram_outbox
       WHERE group_id = $1 ORDER BY created_at, id`,
      [groupId],
    );
    return result.rows.map((row: { id: string; chat_id: string | number; message_text: string }) => ({
      id: row.id,
      chatId: Number(row.chat_id),
      text: row.message_text,
    }));
  }

  async ackPendingMessage(id: string): Promise<void> {
    await this.ensureReady();
    await this.pool.query('DELETE FROM telegram_outbox WHERE id = $1', [id]);
  }
}

/* ----------------------------- выбор хранилища ----------------------------- */

let store: SubscriptionStore | null = null;
let warnedAboutMemory = false;

/**
 * Хранилище подписок. Если задан DATABASE_URL — берём базу, иначе память.
 * В памяти подписки пропадают при перезапуске, поэтому на боевом сервере
 * переменная должна быть задана.
 */
export function getSubscriptionStore(): SubscriptionStore {
  if (store) {
    return store;
  }

  const url = process.env.DATABASE_URL?.trim();

  if (!url) {
    if (!warnedAboutMemory) {
      warnedAboutMemory = true;
      console.warn(
        '[подписки] DATABASE_URL не задан — подписки хранятся в памяти и пропадут при перезапуске.',
      );
    }
    store = new MemoryStore();
    return store;
  }

  const pool = new Pool({
    connectionString: url,
    // Бесплатные Postgres (Neon, Supabase) требуют TLS, но отдают сертификат,
    // которого нет в системном списке доверенных.
    ssl: url.includes('sslmode=disable') ? undefined : { rejectUnauthorized: false },
    max: 3,
  });

  pool.on('error', (error) => {
    console.error('[подписки] Ошибка соединения с базой:', error.message);
  });

  store = new PostgresStore(pool);
  return store;
}

/** Только для тестов: подменить хранилище. */
export function setSubscriptionStoreForTests(next: SubscriptionStore | null): void {
  store = next;
}
