import { Pool } from 'pg';

/**
 * Выключатели анимированных карточек (виджетов HTMLBubbles).
 *
 * Карточки идут, только если включены на всех трёх уровнях:
 * 1. переменная окружения TELEGRAM_WIDGETS (off, 0, false, no — выключено);
 * 2. общий выключатель владельца бота: команда /widgets off;
 * 3. кнопка «🎨 Анимированные карточки» в меню конкретного чата.
 * По умолчанию всё включено. Без базы данных выбор живёт до перезапуска.
 */

const OFF_VALUES = new Set(['off', '0', 'false', 'no', 'нет', 'выкл']);
const GLOBAL_SCOPE = 'global';
const GLOBAL_CACHE_MS = 30_000;

export interface WidgetSettingsStore {
  /** null — значение не задавали, действует «включено». */
  get(scope: string): Promise<boolean | null>;
  set(scope: string, enabled: boolean): Promise<void>;
}

class MemoryWidgetSettings implements WidgetSettingsStore {
  private readonly values = new Map<string, boolean>();

  async get(scope: string): Promise<boolean | null> {
    return this.values.get(scope) ?? null;
  }

  async set(scope: string, enabled: boolean): Promise<void> {
    this.values.set(scope, enabled);
  }
}

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS telegram_widget_settings (
    scope      TEXT PRIMARY KEY,
    enabled    BOOLEAN NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

class PostgresWidgetSettings implements WidgetSettingsStore {
  private ready: Promise<void> | null = null;

  constructor(private readonly pool: Pool) {}

  private ensureReady(): Promise<void> {
    this.ready ??= this.pool.query(CREATE_TABLE).then(() => undefined);
    return this.ready;
  }

  async get(scope: string): Promise<boolean | null> {
    await this.ensureReady();
    const result = await this.pool.query('SELECT enabled FROM telegram_widget_settings WHERE scope = $1', [scope]);
    const value = result.rows[0]?.enabled;
    return typeof value === 'boolean' ? value : null;
  }

  async set(scope: string, enabled: boolean): Promise<void> {
    await this.ensureReady();
    await this.pool.query(
      `INSERT INTO telegram_widget_settings (scope, enabled, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (scope) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`,
      [scope, enabled],
    );
  }
}

let store: WidgetSettingsStore | null = null;
let globalCache: { value: boolean | null; at: number } | null = null;

export function getWidgetSettingsStore(): WidgetSettingsStore {
  if (store) return store;

  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    store = new MemoryWidgetSettings();
    return store;
  }

  // Подключение как у остальных хранилищ проекта: Neon требует TLS.
  const pool = new Pool({
    connectionString: url,
    ssl: url.includes('sslmode=disable') ? undefined : { rejectUnauthorized: false },
    max: 1,
  });
  pool.on('error', (error) => {
    console.error('[карточки] Ошибка соединения с базой:', error.message);
  });
  store = new PostgresWidgetSettings(pool);
  return store;
}

/** Только для тестов: подменить хранилище. */
export function setWidgetSettingsStoreForTests(next: WidgetSettingsStore | null): void {
  store = next;
  globalCache = null;
}

export function widgetsAllowedByEnv(): boolean {
  const raw = process.env.TELEGRAM_WIDGETS?.trim().toLowerCase();
  return !raw || !OFF_VALUES.has(raw);
}

async function globalSetting(): Promise<boolean | null> {
  if (globalCache && Date.now() - globalCache.at < GLOBAL_CACHE_MS) return globalCache.value;
  const value = await getWidgetSettingsStore().get(GLOBAL_SCOPE);
  globalCache = { value, at: Date.now() };
  return value;
}

/** Включены ли карточки для всех: переменная окружения и выключатель владельца. */
export async function widgetsEnabledGlobally(): Promise<boolean> {
  if (!widgetsAllowedByEnv()) return false;
  try {
    return (await globalSetting()) !== false;
  } catch (error) {
    console.error('[карточки] Не удалось прочитать общий выключатель:', error);
    return true;
  }
}

/** Выбор этого чата; null — карточки выключены для всех и кнопку показывать незачем. */
export async function chatWidgetsState(chatId: number): Promise<boolean | null> {
  if (!(await widgetsEnabledGlobally())) return null;
  try {
    return (await getWidgetSettingsStore().get(`chat:${chatId}`)) !== false;
  } catch (error) {
    console.error(`[карточки] Не удалось прочитать выбор чата ${chatId}:`, error);
    return true;
  }
}

export async function widgetsEnabledFor(chatId: number): Promise<boolean> {
  return (await chatWidgetsState(chatId)) === true;
}

export async function setChatWidgets(chatId: number, enabled: boolean): Promise<void> {
  await getWidgetSettingsStore().set(`chat:${chatId}`, enabled);
}

export async function setGlobalWidgets(enabled: boolean): Promise<void> {
  await getWidgetSettingsStore().set(GLOBAL_SCOPE, enabled);
  globalCache = { value: enabled, at: Date.now() };
}
