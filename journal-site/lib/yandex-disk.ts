import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { basenameFromFilePath, filenameToGroupName, groupPathToId } from '@/lib/group-files';
import type { JournalFileResult, JournalGroupRef, JournalSource } from '@/lib/types';

const PRIVATE_DOWNLOAD_ENDPOINT = 'https://cloud-api.yandex.net/v1/disk/resources/download';
const PRIVATE_RESOURCE_ENDPOINT = 'https://cloud-api.yandex.net/v1/disk/resources';
const PUBLIC_DOWNLOAD_ENDPOINT = 'https://cloud-api.yandex.net/v1/disk/public/resources/download';
const PUBLIC_RESOURCE_ENDPOINT = 'https://cloud-api.yandex.net/v1/disk/public/resources';

const PUBLIC_CACHE_PATH_PREFIX = '__yandex_public_cache__::';
const PUBLIC_CACHE_META_FILE = 'latest.json';
const PUBLIC_CACHE_GROUPS_FILE = 'groups.json';
const DEFAULT_PUBLIC_CACHE_INTERVAL_MINUTES = 30;
const DEFAULT_PUBLIC_CACHE_MAX_FILES = 2;
const MAX_PUBLIC_FOLDER_DEPTH = 3;
const MAX_PUBLIC_GROUPS = 60;

interface YandexListItem {
  name?: string;
  path?: string;
  type?: string;
}

interface PublicResourceMeta {
  name?: string;
  path?: string;
  type?: string;
  _embedded?: {
    items?: YandexListItem[];
  };
}

/** Одна запись из переменной окружения: ссылка + необязательные имя и путь внутри публичной папки. */
interface PublicSourceConfig {
  publicKey: string;
  publicPath?: string;
  label?: string;
}

/** Конкретный файл-журнал, найденный по публичной ссылке. Одна такая запись = одна группа. */
interface PublicGroupSource {
  publicKey: string;
  publicPath?: string;
  label?: string;
  fileName: string;
}

interface CachedJournalVersion {
  fileName: string;
  filePath: string;
  displayName: string;
  downloadedAt: string;
  publicKey: string;
  publicPath?: string;
}

interface PublicJournalCacheMeta {
  latestFileName: string;
  latestFilePath: string;
  displayName: string;
  publicKey: string;
  publicPath?: string;
  checkedAt: string;
  downloadedAt: string;
  versions: CachedJournalVersion[];
}

interface PublicGroupsCacheMeta {
  configKey: string;
  fetchedAt: string;
  groups: PublicGroupSource[];
}

interface PublicJournalCacheRuntime {
  refreshPromises?: Map<string, Promise<CachedJournalVersion>>;
  groupsPromise?: Promise<PublicGroupSource[]>;
  interval?: NodeJS.Timeout;
}

declare global {
  // eslint-disable-next-line no-var
  var __journalPublicCacheRuntime: PublicJournalCacheRuntime | undefined;
}

function getCacheRuntime(): PublicJournalCacheRuntime {
  globalThis.__journalPublicCacheRuntime ??= {};
  const runtime = globalThis.__journalPublicCacheRuntime;
  runtime.refreshPromises ??= new Map<string, Promise<CachedJournalVersion>>();
  return runtime;
}

function getSourceMode(): JournalSource {
  const source = process.env.JOURNAL_SOURCE?.trim();

  if (source === 'yandex-private' || source === 'yandex-public' || source === 'yandex-public-cache' || source === 'local') {
    return source;
  }

  return 'local';
}

function isSpreadsheetFile(fileName: string): boolean {
  return /\.(xlsx|xlsm|xls)$/i.test(fileName) && !fileName.startsWith('~$');
}

function buildGroupRef(source: JournalSource, filePath: string, fileName?: string, groupName?: string): JournalGroupRef {
  const resolvedFileName = fileName || basenameFromFilePath(filePath);
  return {
    id: groupPathToId(filePath),
    groupName: groupName?.trim() || filenameToGroupName(resolvedFileName),
    fileName: resolvedFileName,
    filePath,
    source,
    sourceDetails: filePath,
  };
}

function getPositiveNumberFromEnv(name: string, fallback: number): number {
  const value = process.env[name]?.trim();
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getPublicCacheIntervalMs(): number {
  return getPositiveNumberFromEnv('JOURNAL_CACHE_INTERVAL_MINUTES', DEFAULT_PUBLIC_CACHE_INTERVAL_MINUTES) * 60 * 1000;
}

function getPublicCacheMaxFiles(): number {
  return Math.max(1, Math.floor(getPositiveNumberFromEnv('JOURNAL_CACHE_MAX_FILES', DEFAULT_PUBLIC_CACHE_MAX_FILES)));
}

function getHourFromEnv(name: string, fallback: number): number {
  const value = process.env[name]?.trim();
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Окно, в которое журнал обновляется с Яндекс.Диска (по местному времени).
// Вне окна сайт и бот отдают последнюю скачанную копию.
function isWithinRefreshWindow(date = new Date()): boolean {
  const from = Math.min(23, Math.max(0, Math.floor(getHourFromEnv('JOURNAL_REFRESH_FROM_HOUR', 5))));
  const to = Math.min(24, Math.max(1, Math.floor(getHourFromEnv('JOURNAL_REFRESH_TO_HOUR', 24))));
  const offsetHours = getHourFromEnv('JOURNAL_TIMEZONE_OFFSET_HOURS', 5);

  const localHour = (((date.getUTCHours() + offsetHours) % 24) + 24) % 24;

  if (from === to) {
    return true;
  }
  if (from < to) {
    return localHour >= from && localHour < to;
  }
  return localHour >= from || localHour < to;
}

function getPublicCacheDir(): string {
  const configuredDir = process.env.JOURNAL_CACHE_DIR?.trim() || './.journal-cache';
  return path.isAbsolute(configuredDir) ? configuredDir : path.join(process.cwd(), configuredDir);
}

function getPublicPath(): string | undefined {
  return process.env.YANDEX_DISK_PUBLIC_PATH?.trim() || undefined;
}

/**
 * Разбирает одну запись списка ссылок.
 * Поддерживаются форматы:
 *   https://disk.yandex.ru/i/xxxx
 *   ИСиП-23/9 = https://disk.yandex.ru/i/xxxx
 *   https://disk.yandex.ru/d/xxxx#/Журналы/ИСиП-23-9.xlsx
 */
function parsePublicSourceEntry(raw: string): PublicSourceConfig | null {
  let entry = raw.trim();

  if (!entry || entry.startsWith('#') || entry.startsWith('//')) {
    return null;
  }

  let label: string | undefined;
  const equalsIndex = entry.indexOf('=');
  if (equalsIndex > 0) {
    const head = entry.slice(0, equalsIndex).trim();
    const tail = entry.slice(equalsIndex + 1).trim();
    // Имя группы слева от «=» — только если слева не кусок самой ссылки.
    if (tail && head && !head.includes('://')) {
      label = head;
      entry = tail;
    }
  }

  let publicPath: string | undefined;
  const hashIndex = entry.indexOf('#');
  if (hashIndex >= 0) {
    publicPath = entry.slice(hashIndex + 1).trim() || undefined;
    entry = entry.slice(0, hashIndex).trim();
  }

  if (!entry) {
    return null;
  }

  return { publicKey: entry, publicPath, label };
}

function dedupePublicSources(sources: PublicSourceConfig[]): PublicSourceConfig[] {
  const seen = new Set<string>();
  const result: PublicSourceConfig[] = [];

  for (const source of sources) {
    const key = `${source.publicKey}::${source.publicPath || ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(source);
  }

  return result;
}

/**
 * Список публичных ссылок из переменных окружения.
 * Приоритет: YANDEX_DISK_PUBLIC_URLS (много ссылок) → YANDEX_DISK_PUBLIC_URL (одна ссылка).
 */
/** Из какой переменной окружения реально взяты ссылки — нужно для понятных сообщений об ошибках. */
function getActivePublicSourceEnvName(): string {
  if (process.env.YANDEX_DISK_PUBLIC_URLS?.trim() || process.env.YANDEX_DISK_PUBLIC_KEYS?.trim()) {
    return 'YANDEX_DISK_PUBLIC_URLS';
  }
  if (process.env.YANDEX_DISK_PUBLIC_URL?.trim() || process.env.YANDEX_DISK_PUBLIC_KEY?.trim()) {
    return 'YANDEX_DISK_PUBLIC_URL';
  }
  return 'YANDEX_DISK_PUBLIC_URLS';
}

export function getPublicSourcesInfo(): { variable: string; linkCount: number } {
  try {
    return { variable: getActivePublicSourceEnvName(), linkCount: getPublicSources().length };
  } catch {
    return { variable: getActivePublicSourceEnvName(), linkCount: 0 };
  }
}

/** Хвост публичной ссылки — чтобы в списке было видно, какая именно ссылка не открылась. */
function publicKeyHint(publicKey: string): string {
  const cleaned = publicKey.replace(/[?#].*$/, '').replace(/\/+$/, '');
  const tail = cleaned.split('/').filter(Boolean).at(-1);
  return tail || 'journal';
}

function describePublicTarget(group: Pick<PublicGroupSource, 'publicKey' | 'publicPath'>): string {
  const where = group.publicPath ? ` (файл ${group.publicPath} внутри папки)` : '';
  return `${group.publicKey}${where}`;
}

function parsePublicSourceList(raw: string): PublicSourceConfig[] {
  return raw
    .split(/[\n\r,;]+/)
    .map((entry) => parsePublicSourceEntry(entry))
    .filter((entry): entry is PublicSourceConfig => Boolean(entry));
}

/**
 * Список публичных ссылок из переменных окружения.
 * Приоритет: YANDEX_DISK_PUBLIC_URLS → YANDEX_DISK_PUBLIC_URL.
 * Список ссылок понимается в обеих переменных: если в старую одиночную
 * переменную вписали несколько ссылок через запятую, это тоже сработает.
 */
function getPublicSources(): PublicSourceConfig[] {
  const many = process.env.YANDEX_DISK_PUBLIC_URLS?.trim() || process.env.YANDEX_DISK_PUBLIC_KEYS?.trim();
  const single = process.env.YANDEX_DISK_PUBLIC_URL?.trim() || process.env.YANDEX_DISK_PUBLIC_KEY?.trim();
  const raw = many || single;

  if (!raw) {
    throw new Error(
      'Не задана ни одна публичная ссылка. Укажи YANDEX_DISK_PUBLIC_URLS — одна ссылка на группу, несколько ссылок через запятую.',
    );
  }

  const sources = parsePublicSourceList(raw);

  if (!sources.length) {
    throw new Error(
      `Переменная ${getActivePublicSourceEnvName()} задана, но в ней не нашлось ни одной ссылки. Проверь её значение.`,
    );
  }

  // Старый режим одной ссылки: путь внутри публичной папки и имя группы
  // задаются отдельными переменными. Для списка ссылок они не применяются.
  if (sources.length === 1) {
    sources[0].publicPath ||= getPublicPath();
    sources[0].label ||= process.env.YANDEX_DISK_PUBLIC_LABEL?.trim() || undefined;
  }

  return dedupePublicSources(sources);
}

function getSourcesConfigKey(sources: PublicSourceConfig[]): string {
  return crypto
    .createHash('sha1')
    .update(sources.map((source) => `${source.publicKey}::${source.publicPath || ''}::${source.label || ''}`).join('|'))
    .digest('hex');
}

function getGroupCacheKey(group: Pick<PublicGroupSource, 'publicKey' | 'publicPath'>): string {
  return crypto.createHash('sha1').update(`${group.publicKey}::${group.publicPath || ''}`).digest('hex').slice(0, 16);
}

function getGroupCacheDir(group: Pick<PublicGroupSource, 'publicKey' | 'publicPath'>): string {
  return path.join(getPublicCacheDir(), getGroupCacheKey(group));
}

/** Виртуальный путь группы. Из него всегда можно восстановить ссылку без обращения к сети. */
function encodePublicGroupPath(group: PublicGroupSource): string {
  const payload = JSON.stringify({
    k: group.publicKey,
    p: group.publicPath || '',
    n: group.fileName,
    l: group.label || '',
  });

  return `${PUBLIC_CACHE_PATH_PREFIX}${Buffer.from(payload, 'utf8').toString('base64url')}`;
}

function decodePublicGroupPath(filePath?: string): PublicGroupSource | null {
  if (!filePath || !filePath.startsWith(PUBLIC_CACHE_PATH_PREFIX)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(filePath.slice(PUBLIC_CACHE_PATH_PREFIX.length), 'base64url').toString('utf8'),
    ) as { k?: string; p?: string; n?: string; l?: string };

    if (!payload.k) {
      return null;
    }

    return {
      publicKey: payload.k,
      publicPath: payload.p || undefined,
      fileName: payload.n || 'journal.xlsx',
      label: payload.l || undefined,
    };
  } catch {
    return null;
  }
}

function sanitizeFileName(fileName: string): string {
  return fileName
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'journal.xlsx';
}

function timestampForFileName(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readLocalFile(filePath?: string): Promise<JournalFileResult> {
  const configuredPath = filePath || process.env.JOURNAL_LOCAL_PATH?.trim() || './data/journal.xlsx';
  const absolutePath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(process.cwd(), configuredPath);

  const buffer = await fs.readFile(absolutePath);

  return {
    buffer,
    source: 'local',
    sourceDetails: absolutePath,
    fileName: path.basename(absolutePath),
    groupNameHint: filenameToGroupName(path.basename(absolutePath)),
  };
}

async function listLocalJournalFiles(): Promise<JournalGroupRef[]> {
  const configuredFolder = process.env.JOURNAL_LOCAL_FOLDER?.trim();
  const configuredPath = process.env.JOURNAL_LOCAL_PATH?.trim();

  if (configuredFolder) {
    const absoluteFolder = path.isAbsolute(configuredFolder)
      ? configuredFolder
      : path.join(process.cwd(), configuredFolder);

    const entries = await fs.readdir(absoluteFolder, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && isSpreadsheetFile(entry.name))
      .map((entry) => buildGroupRef('local', path.join(absoluteFolder, entry.name), entry.name))
      .sort((a, b) => a.groupName.localeCompare(b.groupName, 'ru'));
  }

  if (configuredPath) {
    const absolutePath = path.isAbsolute(configuredPath)
      ? configuredPath
      : path.join(process.cwd(), configuredPath);

    return [buildGroupRef('local', absolutePath, path.basename(absolutePath))];
  }

  const defaultPath = path.join(process.cwd(), 'data', 'journal.xlsx');
  return [buildGroupRef('local', defaultPath, 'journal.xlsx')];
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
  });

  const payload = (await response.json().catch(() => ({}))) as T & {
    message?: string;
    error?: string;
    description?: string;
  };

  if (!response.ok) {
    const message = payload.description || payload.message || payload.error || 'Unknown Yandex Disk error';
    throw new Error(`Ошибка Yandex Disk API: ${response.status} ${message}`);
  }

  return payload;
}

async function fetchDownloadUrl(url: string, init?: RequestInit): Promise<string> {
  const payload = await fetchJson<{
    href?: string;
    message?: string;
    error?: string;
    description?: string;
  }>(url, init);

  if (!payload.href) {
    throw new Error('Yandex Disk API не вернул ссылку на скачивание файла.');
  }

  return payload.href;
}

async function fetchFileBuffer(downloadUrl: string): Promise<Buffer> {
  const response = await fetch(downloadUrl, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`Не удалось скачать файл журнала: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function getPrivateToken(): string {
  const token = process.env.YANDEX_DISK_OAUTH_TOKEN?.trim();
  if (!token) {
    throw new Error('Для режима yandex-private нужно указать YANDEX_DISK_OAUTH_TOKEN.');
  }
  return token;
}

async function readFromPrivateYandexDisk(filePath?: string): Promise<JournalFileResult> {
  const token = getPrivateToken();
  const diskPath = filePath || process.env.YANDEX_DISK_PATH?.trim();

  if (!diskPath) {
    throw new Error('Для режима yandex-private нужно указать YANDEX_DISK_PATH или выбрать группу из папки.');
  }

  const url = `${PRIVATE_DOWNLOAD_ENDPOINT}?path=${encodeURIComponent(diskPath)}`;
  const href = await fetchDownloadUrl(url, {
    headers: {
      Authorization: `OAuth ${token}`,
    },
  });

  const buffer = await fetchFileBuffer(href);

  return {
    buffer,
    source: 'yandex-private',
    sourceDetails: diskPath,
    fileName: basenameFromFilePath(diskPath),
    groupNameHint: filenameToGroupName(basenameFromFilePath(diskPath)),
  };
}

async function listPrivateYandexJournalFiles(): Promise<JournalGroupRef[]> {
  const token = getPrivateToken();
  const folderPath = process.env.YANDEX_DISK_FOLDER?.trim();
  const singleFilePath = process.env.YANDEX_DISK_PATH?.trim();

  if (folderPath) {
    const url = `${PRIVATE_RESOURCE_ENDPOINT}?path=${encodeURIComponent(folderPath)}&limit=1000`;
    const payload = await fetchJson<{
      _embedded?: {
        items?: YandexListItem[];
      };
    }>(url, {
      headers: {
        Authorization: `OAuth ${token}`,
      },
    });

    const items = payload._embedded?.items ?? [];
    const files = items
      .filter((item) => item.type === 'file' && item.name && item.path && isSpreadsheetFile(item.name))
      .map((item) => buildGroupRef('yandex-private', item.path!, item.name!))
      .sort((a, b) => a.groupName.localeCompare(b.groupName, 'ru'));

    if (!files.length) {
      throw new Error('В папке на Yandex Disk не найдено ни одного Excel-файла с журналом.');
    }

    return files;
  }

  if (singleFilePath) {
    return [buildGroupRef('yandex-private', singleFilePath)];
  }

  throw new Error('Укажи YANDEX_DISK_FOLDER для списка групп или YANDEX_DISK_PATH для одного файла.');
}

function buildPublicParams(publicKey: string, publicPath?: string): URLSearchParams {
  const params = new URLSearchParams({
    public_key: publicKey,
  });

  if (publicPath) {
    params.set('path', publicPath);
  }

  return params;
}

async function readPublicResourceMeta(publicKey: string, publicPath?: string, limit = 200): Promise<PublicResourceMeta | null> {
  try {
    const params = buildPublicParams(publicKey, publicPath);
    params.set('limit', String(limit));
    return await fetchJson<PublicResourceMeta>(`${PUBLIC_RESOURCE_ENDPOINT}?${params.toString()}`);
  } catch {
    return null;
  }
}

async function getPublicDownloadBuffer(publicKey: string, publicPath?: string): Promise<Buffer> {
  const href = await fetchDownloadUrl(`${PUBLIC_DOWNLOAD_ENDPOINT}?${buildPublicParams(publicKey, publicPath).toString()}`);
  return fetchFileBuffer(href);
}

async function readFromPublicYandexDisk(): Promise<JournalFileResult> {
  const source = getPublicSources()[0];
  const meta = await readPublicResourceMeta(source.publicKey, source.publicPath);
  const buffer = await getPublicDownloadBuffer(source.publicKey, source.publicPath);
  const fileName = meta?.name || (source.publicPath ? basenameFromFilePath(source.publicPath) : 'public-journal.xlsx');

  return {
    buffer,
    source: 'yandex-public',
    sourceDetails: source.publicPath || source.publicKey,
    fileName,
    groupNameHint: source.label || filenameToGroupName(fileName),
  };
}

/** Рекурсивно собирает все Excel-файлы внутри публичной папки. */
async function collectPublicFolderFiles(
  source: PublicSourceConfig,
  meta: PublicResourceMeta | null,
  depth: number,
  accumulator: PublicGroupSource[],
): Promise<void> {
  const items = meta?._embedded?.items ?? [];

  for (const item of items) {
    if (accumulator.length >= MAX_PUBLIC_GROUPS) {
      return;
    }

    if (item.type === 'file' && item.name && isSpreadsheetFile(item.name)) {
      accumulator.push({
        publicKey: source.publicKey,
        publicPath: item.path || undefined,
        fileName: item.name,
      });
      continue;
    }

    if (item.type === 'dir' && item.path && depth < MAX_PUBLIC_FOLDER_DEPTH) {
      const nested = await readPublicResourceMeta(source.publicKey, item.path);
      await collectPublicFolderFiles(source, nested, depth + 1, accumulator);
    }
  }
}

async function readPublicGroupsCache(): Promise<PublicGroupsCacheMeta | null> {
  try {
    const content = await fs.readFile(path.join(getPublicCacheDir(), PUBLIC_CACHE_GROUPS_FILE), 'utf8');
    return JSON.parse(content) as PublicGroupsCacheMeta;
  } catch {
    return null;
  }
}

async function writePublicGroupsCache(meta: PublicGroupsCacheMeta): Promise<void> {
  const cacheDir = getPublicCacheDir();
  await fs.mkdir(cacheDir, { recursive: true });
  await fs
    .writeFile(path.join(cacheDir, PUBLIC_CACHE_GROUPS_FILE), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
    .catch(() => undefined);
}

function sortPublicGroups(groups: PublicGroupSource[]): PublicGroupSource[] {
  return [...groups].sort((a, b) => {
    const nameA = a.label || filenameToGroupName(a.fileName);
    const nameB = b.label || filenameToGroupName(b.fileName);
    return nameA.localeCompare(nameB, 'ru', { numeric: true });
  });
}

function dedupePublicGroups(groups: PublicGroupSource[]): PublicGroupSource[] {
  const seen = new Set<string>();
  const result: PublicGroupSource[] = [];

  for (const group of groups) {
    const key = `${group.publicKey}::${group.publicPath || ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(group);
  }

  return result;
}

async function resolvePublicGroupsFromNetwork(cached: PublicGroupsCacheMeta | null): Promise<PublicGroupSource[]> {
  const sources = getPublicSources();
  const groups: PublicGroupSource[] = [];

  for (const source of sources) {
    const meta = await readPublicResourceMeta(source.publicKey, source.publicPath);

    // Ссылка на папку — внутри может быть сразу несколько групп.
    if (meta?.type === 'dir') {
      const found: PublicGroupSource[] = [];
      await collectPublicFolderFiles(source, meta, 0, found);

      if (found.length) {
        groups.push(
          ...found.map((group) => ({
            ...group,
            label: found.length === 1 ? source.label : undefined,
          })),
        );
        continue;
      }

      // Папка есть, но файлов не видно — берём то, что уже знали раньше.
      const remembered = cached?.groups.filter((group) => group.publicKey === source.publicKey) ?? [];
      groups.push(...remembered);
      continue;
    }

    if (!meta) {
      // Яндекс не ответил: используем прошлый список для этой ссылки, иначе считаем её одним файлом.
      const remembered = cached?.groups.filter((group) => group.publicKey === source.publicKey) ?? [];
      if (remembered.length) {
        groups.push(...remembered);
        continue;
      }
    }

    groups.push({
      publicKey: source.publicKey,
      publicPath: source.publicPath,
      label: source.label,
      fileName:
        meta?.name ||
        (source.publicPath ? basenameFromFilePath(source.publicPath) : `${publicKeyHint(source.publicKey)}.xlsx`),
    });
  }

  return sortPublicGroups(dedupePublicGroups(groups)).slice(0, MAX_PUBLIC_GROUPS);
}

async function resolvePublicGroups(options: { force?: boolean } = {}): Promise<PublicGroupSource[]> {
  const runtime = getCacheRuntime();
  const configKey = getSourcesConfigKey(getPublicSources());
  const cached = await readPublicGroupsCache();
  const cacheIsCurrent = cached?.configKey === configKey && cached.groups.length > 0;

  if (!options.force && cacheIsCurrent) {
    const fetchedAtMs = new Date(cached.fetchedAt).getTime();
    if (Number.isFinite(fetchedAtMs) && Date.now() - fetchedAtMs < getPublicCacheIntervalMs()) {
      return cached.groups;
    }
    if (!isWithinRefreshWindow()) {
      return cached.groups;
    }
  }

  if (runtime.groupsPromise) {
    return runtime.groupsPromise;
  }

  runtime.groupsPromise = resolvePublicGroupsFromNetwork(cacheIsCurrent ? cached : null)
    .then(async (groups) => {
      if (groups.length) {
        await writePublicGroupsCache({
          configKey,
          fetchedAt: new Date().toISOString(),
          groups,
        });
        return groups;
      }

      if (cacheIsCurrent) {
        return cached.groups;
      }

      throw new Error('По указанным публичным ссылкам не найдено ни одного файла журнала.');
    })
    .catch((error) => {
      if (cacheIsCurrent) {
        console.error('[journal-cache] Не удалось обновить список групп, работаем по прошлому списку:', error);
        return cached.groups;
      }
      throw error;
    })
    .finally(() => {
      runtime.groupsPromise = undefined;
    });

  return runtime.groupsPromise;
}

async function readPublicCacheMeta(cacheDir: string): Promise<PublicJournalCacheMeta | null> {
  try {
    const content = await fs.readFile(path.join(cacheDir, PUBLIC_CACHE_META_FILE), 'utf8');
    return JSON.parse(content) as PublicJournalCacheMeta;
  } catch {
    return null;
  }
}

async function writePublicCacheMeta(cacheDir: string, meta: PublicJournalCacheMeta): Promise<void> {
  await fs.writeFile(path.join(cacheDir, PUBLIC_CACHE_META_FILE), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
}

function isCacheMetaForCurrentSource(meta: PublicJournalCacheMeta | null, publicKey: string, publicPath?: string): meta is PublicJournalCacheMeta {
  return Boolean(meta && meta.publicKey === publicKey && (meta.publicPath || '') === (publicPath || ''));
}

async function getValidLatestCachedVersion(cacheDir: string, publicKey: string, publicPath?: string): Promise<CachedJournalVersion | null> {
  const meta = await readPublicCacheMeta(cacheDir);

  if (!isCacheMetaForCurrentSource(meta, publicKey, publicPath)) {
    return null;
  }

  const latest = meta.versions.find((version) => version.fileName === meta.latestFileName) || meta.versions.at(-1);
  if (!latest) {
    return null;
  }

  const latestPath = path.isAbsolute(latest.filePath) ? latest.filePath : path.join(cacheDir, latest.fileName);
  if (!(await fileExists(latestPath))) {
    return null;
  }

  return {
    ...latest,
    filePath: latestPath,
  };
}

function shouldUseCachedVersion(version: CachedJournalVersion, intervalMs: number): boolean {
  const downloadedAtMs = new Date(version.downloadedAt).getTime();

  if (!Number.isFinite(downloadedAtMs)) {
    return false;
  }

  return Date.now() - downloadedAtMs < intervalMs;
}

async function cleanupOldCacheFiles(cacheDir: string, versionsToKeep: CachedJournalVersion[]): Promise<CachedJournalVersion[]> {
  const maxFiles = getPublicCacheMaxFiles();
  const keptVersions = versionsToKeep.slice(-maxFiles);
  const keepFileNames = new Set(keptVersions.map((version) => version.fileName));

  for (const version of versionsToKeep) {
    if (keepFileNames.has(version.fileName)) {
      continue;
    }

    const versionPath = path.isAbsolute(version.filePath) ? version.filePath : path.join(cacheDir, version.fileName);
    await fs.rm(versionPath, { force: true }).catch(() => undefined);
  }

  return keptVersions;
}

async function downloadPublicJournalToCache(group: PublicGroupSource): Promise<CachedJournalVersion> {
  const cacheDir = getGroupCacheDir(group);
  await fs.mkdir(cacheDir, { recursive: true });

  const now = new Date();
  const downloadedAt = now.toISOString();
  // Имя файла уже известно из списка групп — лишний запрос к API не нужен.
  const knownFileName = group.fileName?.trim();
  const meta = knownFileName ? null : await readPublicResourceMeta(group.publicKey, group.publicPath, 1);
  const originalFileName = sanitizeFileName(knownFileName || meta?.name || 'journal.xlsx');
  const extension = path.extname(originalFileName) || '.xlsx';
  const displayName = originalFileName;
  const cachedFileName = `journal-${timestampForFileName(now)}${extension}`;
  const cachedFilePath = path.join(cacheDir, cachedFileName);
  const tempFilePath = `${cachedFilePath}.tmp`;

  const buffer = await getPublicDownloadBuffer(group.publicKey, group.publicPath).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${reason} Ссылка: ${describePublicTarget(group)}. ` +
        `Ссылки берутся из переменной ${getActivePublicSourceEnvName()}. ` +
        'Проверь, что публичный доступ к файлу включён и ссылка не была пересоздана.',
    );
  });
  await fs.writeFile(tempFilePath, buffer);
  await fs.rename(tempFilePath, cachedFilePath);

  const existingMeta = await readPublicCacheMeta(cacheDir);
  const existingVersions = isCacheMetaForCurrentSource(existingMeta, group.publicKey, group.publicPath)
    ? existingMeta.versions
    : [];
  const version: CachedJournalVersion = {
    fileName: cachedFileName,
    filePath: cachedFilePath,
    displayName,
    downloadedAt,
    publicKey: group.publicKey,
    publicPath: group.publicPath,
  };
  const versions = await cleanupOldCacheFiles(cacheDir, [...existingVersions, version]);

  await writePublicCacheMeta(cacheDir, {
    latestFileName: version.fileName,
    latestFilePath: version.filePath,
    displayName,
    publicKey: group.publicKey,
    publicPath: group.publicPath,
    checkedAt: downloadedAt,
    downloadedAt,
    versions,
  });

  return version;
}

async function ensureFreshCachedPublicJournal(
  group: PublicGroupSource,
  options: { force?: boolean } = {},
): Promise<CachedJournalVersion> {
  const cacheDir = getGroupCacheDir(group);
  const intervalMs = getPublicCacheIntervalMs();
  const runtime = getCacheRuntime();
  const runtimeKey = getGroupCacheKey(group);

  await fs.mkdir(cacheDir, { recursive: true });

  const latest = await getValidLatestCachedVersion(cacheDir, group.publicKey, group.publicPath);
  if (!options.force && latest && (shouldUseCachedVersion(latest, intervalMs) || !isWithinRefreshWindow())) {
    return latest;
  }

  const running = runtime.refreshPromises?.get(runtimeKey);
  if (running) {
    return running;
  }

  const refreshPromise = downloadPublicJournalToCache(group)
    .catch((error) => {
      // Не смогли скачать новую копию — отдаём прошлую, чтобы сайт и бот не падали.
      if (latest) {
        console.error('[journal-cache] Не удалось обновить журнал, отдаём прошлую копию:', error);
        return latest;
      }
      throw error;
    })
    .finally(() => {
      runtime.refreshPromises?.delete(runtimeKey);
    });

  runtime.refreshPromises?.set(runtimeKey, refreshPromise);
  return refreshPromise;
}

async function refreshAllPublicJournals(options: { force?: boolean } = {}): Promise<void> {
  const groups = await resolvePublicGroups({ force: options.force });

  for (const group of groups) {
    try {
      await ensureFreshCachedPublicJournal(group, options);
    } catch (error) {
      console.error(`[journal-cache] Группа «${group.label || group.fileName}» не обновилась:`, error);
    }
  }
}

function startPublicCacheRefreshLoop(): void {
  const runtime = getCacheRuntime();
  if (runtime.interval) {
    return;
  }

  const intervalMs = getPublicCacheIntervalMs();
  runtime.interval = setInterval(() => {
    if (!isWithinRefreshWindow()) {
      return;
    }
    void refreshAllPublicJournals({ force: true }).catch((error) => {
      console.error('[journal-cache] Не удалось обновить журнал:', error);
    });
  }, intervalMs);

  runtime.interval.unref?.();
}

export async function startJournalCache(): Promise<void> {
  if (getSourceMode() !== 'yandex-public-cache') {
    return;
  }

  startPublicCacheRefreshLoop();

  // Стартовая загрузка с повторами: сеть при старте сервера иногда недоступна пару секунд.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await refreshAllPublicJournals({ force: true });
      return;
    } catch (error) {
      if (attempt === 3) {
        throw error;
      }
      console.error(`[journal-cache] Стартовая загрузка, попытка ${attempt} не удалась, повтор через 5 секунд...`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

async function resolvePublicGroupForPath(filePath?: string): Promise<PublicGroupSource> {
  const decoded = decodePublicGroupPath(filePath);
  if (decoded) {
    return decoded;
  }

  // Пустой путь или старый идентификатор одной группы — открываем первую группу списка.
  const groups = await resolvePublicGroups();
  const first = groups[0];

  if (!first) {
    throw new Error('По указанным публичным ссылкам не найдено ни одного файла журнала.');
  }

  return first;
}

async function readFromCachedPublicYandexDisk(filePath?: string): Promise<JournalFileResult> {
  startPublicCacheRefreshLoop();
  const group = await resolvePublicGroupForPath(filePath);
  const cached = await ensureFreshCachedPublicJournal(group);
  const buffer = await fs.readFile(cached.filePath);

  return {
    buffer,
    source: 'yandex-public-cache',
    sourceDetails: `${cached.filePath} ← ${cached.publicPath || cached.publicKey}`,
    fileName: cached.displayName,
    groupNameHint: group.label || filenameToGroupName(cached.displayName),
  };
}

export async function listJournalFiles(): Promise<JournalGroupRef[]> {
  const source = getSourceMode();

  if (source === 'yandex-private') {
    return listPrivateYandexJournalFiles();
  }

  if (source === 'yandex-public') {
    const file = await readFromPublicYandexDisk();
    return [buildGroupRef('yandex-public', file.sourceDetails, file.fileName, file.groupNameHint)];
  }

  if (source === 'yandex-public-cache') {
    startPublicCacheRefreshLoop();
    const groups = await resolvePublicGroups();

    if (!groups.length) {
      throw new Error('По указанным публичным ссылкам не найдено ни одного файла журнала.');
    }

    return groups.map((group) =>
      buildGroupRef('yandex-public-cache', encodePublicGroupPath(group), group.fileName, group.label),
    );
  }

  return listLocalJournalFiles();
}

export async function loadJournalFile(filePath?: string): Promise<JournalFileResult> {
  const source = getSourceMode();

  if (source === 'yandex-private') {
    return readFromPrivateYandexDisk(filePath);
  }

  if (source === 'yandex-public') {
    return readFromPublicYandexDisk();
  }

  if (source === 'yandex-public-cache') {
    return readFromCachedPublicYandexDisk(filePath);
  }

  return readLocalFile(filePath);
}
