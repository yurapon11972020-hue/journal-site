import { promises as fs } from 'node:fs';
import path from 'node:path';

import { basenameFromFilePath, filenameToGroupName, groupPathToId } from '@/lib/group-files';
import type { JournalFileResult, JournalGroupRef, JournalSource } from '@/lib/types';

const PRIVATE_DOWNLOAD_ENDPOINT = 'https://cloud-api.yandex.net/v1/disk/resources/download';
const PRIVATE_RESOURCE_ENDPOINT = 'https://cloud-api.yandex.net/v1/disk/resources';
const PUBLIC_DOWNLOAD_ENDPOINT = 'https://cloud-api.yandex.net/v1/disk/public/resources/download';
const PUBLIC_RESOURCE_ENDPOINT = 'https://cloud-api.yandex.net/v1/disk/public/resources';

const PUBLIC_CACHE_GROUP_PATH = '__yandex_public_cache__';
const PUBLIC_CACHE_META_FILE = 'latest.json';
const DEFAULT_PUBLIC_CACHE_INTERVAL_MINUTES = 30;
const DEFAULT_PUBLIC_CACHE_MAX_FILES = 2;

interface YandexListItem {
  name?: string;
  path?: string;
  type?: string;
}

interface PublicResourceMeta {
  name?: string;
  path?: string;
  type?: string;
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

interface PublicJournalCacheRuntime {
  refreshPromise?: Promise<CachedJournalVersion>;
  interval?: NodeJS.Timeout;
}

declare global {
  // eslint-disable-next-line no-var
  var __journalPublicCacheRuntime: PublicJournalCacheRuntime | undefined;
}

function getCacheRuntime(): PublicJournalCacheRuntime {
  globalThis.__journalPublicCacheRuntime ??= {};
  return globalThis.__journalPublicCacheRuntime;
}

function getSourceMode(): JournalSource {
  const source = process.env.JOURNAL_SOURCE?.trim();

  if (source === 'yandex-private' || source === 'yandex-public' || source === 'yandex-public-cache' || source === 'local') {
    return source;
  }

  return 'local';
}

function isSpreadsheetFile(fileName: string): boolean {
  return /\.(xlsx|xlsm|xls)$/i.test(fileName);
}

function buildGroupRef(source: JournalSource, filePath: string, fileName?: string): JournalGroupRef {
  const resolvedFileName = fileName || basenameFromFilePath(filePath);
  return {
    id: groupPathToId(filePath),
    groupName: filenameToGroupName(resolvedFileName),
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

function getPublicKey(): string {
  const publicKey = process.env.YANDEX_DISK_PUBLIC_URL?.trim() || process.env.YANDEX_DISK_PUBLIC_KEY?.trim();

  if (!publicKey) {
    throw new Error('Для режима yandex-public-cache или yandex-public нужно указать YANDEX_DISK_PUBLIC_URL либо YANDEX_DISK_PUBLIC_KEY.');
  }

  return publicKey;
}

function getPublicPath(): string | undefined {
  return process.env.YANDEX_DISK_PUBLIC_PATH?.trim() || undefined;
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

async function readPublicResourceMeta(publicKey: string, publicPath?: string): Promise<PublicResourceMeta | null> {
  try {
    return await fetchJson<PublicResourceMeta>(`${PUBLIC_RESOURCE_ENDPOINT}?${buildPublicParams(publicKey, publicPath).toString()}`);
  } catch {
    return null;
  }
}

async function getPublicDownloadBuffer(publicKey: string, publicPath?: string): Promise<Buffer> {
  const href = await fetchDownloadUrl(`${PUBLIC_DOWNLOAD_ENDPOINT}?${buildPublicParams(publicKey, publicPath).toString()}`);
  return fetchFileBuffer(href);
}

async function readFromPublicYandexDisk(): Promise<JournalFileResult> {
  const publicKey = getPublicKey();
  const publicPath = getPublicPath();
  const meta = await readPublicResourceMeta(publicKey, publicPath);
  const buffer = await getPublicDownloadBuffer(publicKey, publicPath);
  const fileName = meta?.name || (publicPath ? basenameFromFilePath(publicPath) : 'public-journal.xlsx');

  return {
    buffer,
    source: 'yandex-public',
    sourceDetails: publicPath || publicKey,
    fileName,
    groupNameHint: filenameToGroupName(fileName),
  };
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

async function downloadPublicJournalToCache(cacheDir: string, publicKey: string, publicPath?: string): Promise<CachedJournalVersion> {
  await fs.mkdir(cacheDir, { recursive: true });

  const now = new Date();
  const downloadedAt = now.toISOString();
  const meta = await readPublicResourceMeta(publicKey, publicPath);
  const originalFileName = sanitizeFileName(meta?.name || (publicPath ? basenameFromFilePath(publicPath) : 'journal.xlsx'));
  const extension = path.extname(originalFileName) || '.xlsx';
  const displayName = originalFileName;
  const cachedFileName = `journal-${timestampForFileName(now)}${extension}`;
  const cachedFilePath = path.join(cacheDir, cachedFileName);
  const tempFilePath = `${cachedFilePath}.tmp`;

  const buffer = await getPublicDownloadBuffer(publicKey, publicPath);
  await fs.writeFile(tempFilePath, buffer);
  await fs.rename(tempFilePath, cachedFilePath);

  const existingMeta = await readPublicCacheMeta(cacheDir);
  const existingVersions = isCacheMetaForCurrentSource(existingMeta, publicKey, publicPath) ? existingMeta.versions : [];
  const version: CachedJournalVersion = {
    fileName: cachedFileName,
    filePath: cachedFilePath,
    displayName,
    downloadedAt,
    publicKey,
    publicPath,
  };
  const versions = await cleanupOldCacheFiles(cacheDir, [...existingVersions, version]);

  await writePublicCacheMeta(cacheDir, {
    latestFileName: version.fileName,
    latestFilePath: version.filePath,
    displayName,
    publicKey,
    publicPath,
    checkedAt: downloadedAt,
    downloadedAt,
    versions,
  });

  return version;
}

async function ensureFreshCachedPublicJournal(options: { force?: boolean } = {}): Promise<CachedJournalVersion> {
  const publicKey = getPublicKey();
  const publicPath = getPublicPath();
  const cacheDir = getPublicCacheDir();
  const intervalMs = getPublicCacheIntervalMs();
  const runtime = getCacheRuntime();

  await fs.mkdir(cacheDir, { recursive: true });

  const latest = await getValidLatestCachedVersion(cacheDir, publicKey, publicPath);
  if (!options.force && latest && (shouldUseCachedVersion(latest, intervalMs) || !isWithinRefreshWindow())) {
    return latest;
  }

  if (runtime.refreshPromise) {
    return runtime.refreshPromise;
  }

  runtime.refreshPromise = downloadPublicJournalToCache(cacheDir, publicKey, publicPath).finally(() => {
    runtime.refreshPromise = undefined;
  });

  return runtime.refreshPromise;
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
    void ensureFreshCachedPublicJournal({ force: true }).catch((error) => {
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
  await ensureFreshCachedPublicJournal({ force: true });
}

async function readFromCachedPublicYandexDisk(): Promise<JournalFileResult> {
  startPublicCacheRefreshLoop();
  const cached = await ensureFreshCachedPublicJournal();
  const buffer = await fs.readFile(cached.filePath);

  return {
    buffer,
    source: 'yandex-public-cache',
    sourceDetails: `${cached.filePath} ← ${cached.publicPath || cached.publicKey}`,
    fileName: cached.displayName,
    groupNameHint: filenameToGroupName(cached.displayName),
  };
}

export async function listJournalFiles(): Promise<JournalGroupRef[]> {
  const source = getSourceMode();

  if (source === 'yandex-private') {
    return listPrivateYandexJournalFiles();
  }

  if (source === 'yandex-public') {
    const file = await readFromPublicYandexDisk();
    return [buildGroupRef('yandex-public', file.sourceDetails, file.fileName)];
  }

  if (source === 'yandex-public-cache') {
    startPublicCacheRefreshLoop();
    const cached = await ensureFreshCachedPublicJournal();
    return [buildGroupRef('yandex-public-cache', PUBLIC_CACHE_GROUP_PATH, cached.displayName)];
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
    return readFromCachedPublicYandexDisk();
  }

  return readLocalFile(filePath);
}
