import { Pool } from 'pg';

/** A single validated workbook per configured public source survives Render's ephemeral filesystem. */
export interface PublicJournalBackup {
  sourceKey: string;
  publicKey: string;
  publicPath?: string;
  fileName: string;
  md5: string;
  downloadedAt: string;
  buffer: Buffer;
}

const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
const RETRY_AFTER_FAILURE_MS = 30_000;

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS public_journal_backups (
    source_key TEXT PRIMARY KEY,
    public_key TEXT NOT NULL,
    public_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    md5 CHAR(32) NOT NULL,
    downloaded_at TIMESTAMPTZ NOT NULL,
    workbook BYTEA NOT NULL,
    stored_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

interface BackupDatabase {
  url: string;
  pool: Pool;
  ready: Promise<void> | null;
  unavailableUntil: number;
}

let database: BackupDatabase | null = null;

function getDatabase(): BackupDatabase | null {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    return null;
  }

  if (database?.url === url) {
    return database;
  }

  if (database) {
    void database.pool.end().catch(() => undefined);
  }

  const pool = new Pool({
    connectionString: url,
    ssl: url.includes('sslmode=disable') ? undefined : { rejectUnauthorized: false },
    max: 2,
    connectionTimeoutMillis: 2_500,
    idleTimeoutMillis: 30_000,
    query_timeout: 3_000,
    statement_timeout: 3_000,
  });
  pool.on('error', (error) => {
    console.error('[journal-backup] Ошибка соединения с базой:', error.message);
  });
  database = { url, pool, ready: null, unavailableUntil: 0 };
  return database;
}

async function ensureReady(db: BackupDatabase): Promise<void> {
  db.ready ??= db.pool.query(CREATE_TABLE).then(() => undefined).catch((error: unknown) => {
    db.ready = null;
    throw error;
  });
  await db.ready;
}

function recordFailure(db: BackupDatabase, operation: string, error: unknown): void {
  db.unavailableUntil = Date.now() + RETRY_AFTER_FAILURE_MS;
  console.error(`[journal-backup] Не удалось ${operation}:`, error);
}

export async function readPublicJournalBackup(sourceKey: string): Promise<PublicJournalBackup | null> {
  const db = getDatabase();
  if (!db || Date.now() < db.unavailableUntil) {
    return null;
  }

  try {
    await ensureReady(db);
    const result = await db.pool.query<{
      source_key: string;
      public_key: string;
      public_path: string;
      file_name: string;
      md5: string;
      downloaded_at: Date;
      workbook: Buffer;
    }>(
      'SELECT source_key, public_key, public_path, file_name, md5, downloaded_at, workbook FROM public_journal_backups WHERE source_key = $1',
      [sourceKey],
    );
    const row = result.rows[0];
    if (!row || !Buffer.isBuffer(row.workbook) || row.workbook.length > MAX_BACKUP_BYTES) {
      return null;
    }
    return {
      sourceKey: row.source_key,
      publicKey: row.public_key,
      publicPath: row.public_path || undefined,
      fileName: row.file_name,
      md5: row.md5.trim(),
      downloadedAt: row.downloaded_at.toISOString(),
      buffer: row.workbook,
    };
  } catch (error) {
    recordFailure(db, 'прочитать запасную копию', error);
    return null;
  }
}

export async function writePublicJournalBackup(backup: PublicJournalBackup): Promise<void> {
  const db = getDatabase();
  if (!db || backup.buffer.length > MAX_BACKUP_BYTES) {
    return;
  }

  try {
    await ensureReady(db);
    await db.pool.query(
      `INSERT INTO public_journal_backups
         (source_key, public_key, public_path, file_name, md5, downloaded_at, workbook)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (source_key) DO UPDATE SET
         public_key = EXCLUDED.public_key,
         public_path = EXCLUDED.public_path,
         file_name = EXCLUDED.file_name,
         md5 = EXCLUDED.md5,
         downloaded_at = EXCLUDED.downloaded_at,
         workbook = EXCLUDED.workbook,
         stored_at = now()`,
      [backup.sourceKey, backup.publicKey, backup.publicPath || '', backup.fileName,
        backup.md5, backup.downloadedAt, backup.buffer],
    );
    db.unavailableUntil = 0;
  } catch (error) {
    recordFailure(db, 'сохранить запасную копию', error);
  }
}
