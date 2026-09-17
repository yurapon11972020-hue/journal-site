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

export interface SubscriptionStore {
  listByGroup(groupId: string): Promise<Subscription[]>;
  listByChat(chatId: number): Promise<Subscription[]>;
  save(subscription: Subscription): Promise<void>;
  remove(chatId: number, groupId: string, studentId: number): Promise<void>;
  readSnapshot(groupId: string): Promise<MarksSnapshot | null>;
  writeSnapshot(groupId: string, marks: MarksSnapshot): Promise<void>;
}

/* ----------------------------- в памяти ----------------------------- */

/**
 * Запасной вариант, когда база не подключена: всё живёт в памяти процесса
 * и пропадает при перезапуске. Годится для локальной разработки и тестов.
 */
class MemoryStore implements SubscriptionStore {
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly snapshots = new Map<string, MarksSnapshot>();

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
