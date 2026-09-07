import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getPublicSourcesInfo, listJournalFiles, loadJournalFile } from '@/lib/yandex-disk';

const FILE_A = 'https://disk.yandex.ru/i/aaaaaaaaaaaaaa';
const FILE_B = 'https://disk.yandex.ru/i/bbbbbbbbbbbbbb';
const FOLDER = 'https://disk.yandex.ru/d/ffffffffffffff';

const fileNames: Record<string, string> = {
  [FILE_A]: 'ИСиП-25-9.xlsx',
  [FILE_B]: 'ИСиП-24-9.xlsx',
};

const folderTree: Record<string, unknown> = {
  '': {
    name: 'Журналы',
    type: 'dir',
    _embedded: {
      items: [
        { name: 'ПКС-24-9.xlsx', path: '/ПКС-24-9.xlsx', type: 'file' },
        { name: 'ИСиП-25-9.xlsx', path: '/ИСиП-25-9.xlsx', type: 'file' },
        { name: '~$черновик.xlsx', path: '/~$черновик.xlsx', type: 'file' },
        { name: 'заметки.txt', path: '/заметки.txt', type: 'file' },
        { name: 'Архив', path: '/Архив', type: 'dir' },
      ],
    },
  },
  '/Архив': {
    name: 'Архив',
    type: 'dir',
    _embedded: { items: [{ name: 'ИСиП-22-9.xlsx', path: '/Архив/ИСиП-22-9.xlsx', type: 'file' }] },
  },
};

let cacheRoot = '';
let downloads = 0;
let listCalls = 0;
let downloadFails = false;
let apiIsDown = false;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const fakeFetch = vi.fn(async (input: string | URL | Request) => {
  const target = new URL(String(input));
  const key = target.searchParams.get('public_key') ?? '';
  const innerPath = target.searchParams.get('path') ?? '';

  if (apiIsDown) {
    return json({ description: 'Resource not found.' }, 404);
  }

  if (target.pathname === '/v1/disk/public/resources') {
    listCalls += 1;
    if (key === FOLDER) {
      const node = folderTree[innerPath];
      return node ? json(node) : json({ name: path.posix.basename(innerPath), type: 'file' });
    }
    return fileNames[key] ? json({ name: fileNames[key], type: 'file' }) : json({ description: 'Not found' }, 404);
  }

  if (target.pathname === '/v1/disk/public/resources/download') {
    return json({ href: `https://dl.test/f?k=${encodeURIComponent(key)}&p=${encodeURIComponent(innerPath)}` });
  }

  if (target.hostname === 'dl.test') {
    if (downloadFails) {
      downloadFails = false;
      return new Response('nope', { status: 503, statusText: 'Service Unavailable' });
    }
    downloads += 1;
    return new Response(Buffer.from(`FILE::${target.searchParams.get('k')}::${target.searchParams.get('p')}`, 'utf8'));
  }

  throw new Error(`Неожиданный запрос в тесте: ${input}`);
});

/**
 * Помечает скачанную копию устаревшей, чтобы следующий запрос скачал файл заново.
 * Через маленький JOURNAL_CACHE_INTERVAL_MINUTES это делать нельзя: тогда
 * фоновый цикл обновления срабатывает каждые несколько миллисекунд и гонится с тестом.
 */
async function expireCachedCopy(): Promise<void> {
  const dirs = (await fs.readdir(cacheRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory());

  for (const dir of dirs) {
    const metaPath = path.join(cacheRoot, dir.name, 'latest.json');
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf8')) as {
      downloadedAt: string;
      versions: Array<{ downloadedAt: string }>;
    };

    meta.downloadedAt = new Date(0).toISOString();
    meta.versions = meta.versions.map((version) => ({ ...version, downloadedAt: new Date(0).toISOString() }));
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
  }
}

function resetRuntime(): void {
  const runtime = globalThis.__journalPublicCacheRuntime;
  if (runtime?.interval) {
    clearInterval(runtime.interval);
  }
  globalThis.__journalPublicCacheRuntime = undefined;
}

beforeEach(async () => {
  vi.stubGlobal('fetch', fakeFetch);
  cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-test-'));
  downloads = 0;
  listCalls = 0;
  downloadFails = false;
  apiIsDown = false;
  resetRuntime();

  process.env.JOURNAL_SOURCE = 'yandex-public-cache';
  process.env.JOURNAL_CACHE_DIR = cacheRoot;
  process.env.JOURNAL_CACHE_INTERVAL_MINUTES = '30';
  process.env.JOURNAL_CACHE_MAX_FILES = '2';
  process.env.JOURNAL_REFRESH_FROM_HOUR = '0';
  process.env.JOURNAL_REFRESH_TO_HOUR = '24';
  delete process.env.YANDEX_DISK_PUBLIC_URLS;
  delete process.env.YANDEX_DISK_PUBLIC_URL;
  delete process.env.YANDEX_DISK_PUBLIC_PATH;
});

afterEach(async () => {
  resetRuntime();
  vi.unstubAllGlobals();
  await fs.rm(cacheRoot, { recursive: true, force: true });
});

afterAll(() => {
  delete process.env.JOURNAL_SOURCE;
});

describe('список групп из публичных ссылок', () => {
  it('одна ссылка даёт одну группу', async () => {
    process.env.YANDEX_DISK_PUBLIC_URLS = FILE_A;

    const groups = await listJournalFiles();

    expect(groups).toHaveLength(1);
    expect(groups[0].groupName).toBe('ИСиП-25-9');
  });

  it('несколько ссылок дают несколько групп, названия можно задать вручную', async () => {
    process.env.YANDEX_DISK_PUBLIC_URLS = `Новый год = ${FILE_A}\nПрошлый год = ${FILE_B}`;

    const groups = await listJournalFiles();

    expect(groups.map((group) => group.groupName)).toEqual(['Новый год', 'Прошлый год']);
    expect(new Set(groups.map((group) => group.id)).size).toBe(2);
  });

  // Ровно та ошибка, что случилась на боевом сервере: список вписали в старую переменную.
  it('список ссылок работает и в старой переменной YANDEX_DISK_PUBLIC_URL', async () => {
    process.env.YANDEX_DISK_PUBLIC_URL = `${FILE_A},${FILE_B}`;

    expect(getPublicSourcesInfo()).toEqual({ variable: 'YANDEX_DISK_PUBLIC_URL', linkCount: 2 });
    await expect(listJournalFiles()).resolves.toHaveLength(2);
  });

  it('ссылка на папку разворачивается во все Excel внутри, включая вложенные', async () => {
    process.env.YANDEX_DISK_PUBLIC_URLS = FOLDER;

    const groups = await listJournalFiles();

    // Временный файл ~$ и текстовый файл не попадают, сортировка по названию.
    expect(groups.map((group) => group.groupName)).toEqual(['ИСиП-22-9', 'ИСиП-25-9', 'ПКС-24-9']);
  });

  it('папку и отдельную ссылку можно смешивать', async () => {
    process.env.YANDEX_DISK_PUBLIC_URLS = `${FOLDER}, Прошлый год = ${FILE_B}`;

    const groups = await listJournalFiles();

    expect(groups.map((group) => group.groupName)).toEqual(['ИСиП-22-9', 'ИСиП-25-9', 'ПКС-24-9', 'Прошлый год']);
  });

  it('список групп берётся из кэша, пока не истёк интервал', async () => {
    process.env.YANDEX_DISK_PUBLIC_URLS = FILE_A;

    await listJournalFiles();
    const callsAfterFirst = listCalls;
    await listJournalFiles();

    expect(listCalls).toBe(callsAfterFirst);
  });

  it('без ссылок объясняет, что задать', async () => {
    await expect(listJournalFiles()).rejects.toThrow(/YANDEX_DISK_PUBLIC_URLS/);
  });
});

describe('загрузка журнала группы', () => {
  it('каждая группа качает свой файл', async () => {
    process.env.YANDEX_DISK_PUBLIC_URLS = `${FILE_A},${FILE_B}`;

    // Группы отсортированы по названию, а не по порядку ссылок в переменной.
    const groups = await listJournalFiles();
    const byName = new Map(groups.map((group) => [group.groupName, group]));

    const newYear = await loadJournalFile(byName.get('ИСиП-25-9')!.filePath);
    const lastYear = await loadJournalFile(byName.get('ИСиП-24-9')!.filePath);

    expect(newYear.buffer.toString('utf8')).toContain(FILE_A);
    expect(lastYear.buffer.toString('utf8')).toContain(FILE_B);
    expect(newYear.sourceDetails).not.toBe(lastYear.sourceDetails);
  });

  it('внутри интервала файл берётся из кэша, а не качается заново', async () => {
    process.env.YANDEX_DISK_PUBLIC_URLS = FILE_A;

    const groups = await listJournalFiles();
    await loadJournalFile(groups[0].filePath);
    const afterFirst = downloads;
    await loadJournalFile(groups[0].filePath);

    expect(downloads).toBe(afterFirst);
  });

  it('старые ссылки на группу продолжают открываться', async () => {
    process.env.YANDEX_DISK_PUBLIC_URLS = FILE_A;

    const legacy = await loadJournalFile('__yandex_public_cache__');
    const empty = await loadJournalFile();

    expect(legacy.buffer.toString('utf8')).toContain(FILE_A);
    expect(empty.buffer.toString('utf8')).toContain(FILE_A);
  });

  it('при сбое скачивания отдаёт последнюю удачную копию', async () => {
    process.env.YANDEX_DISK_PUBLIC_URLS = FILE_A;

    const groups = await listJournalFiles();
    await loadJournalFile(groups[0].filePath);

    await expireCachedCopy();
    downloadFails = true;

    const stale = await loadJournalFile(groups[0].filePath);
    expect(stale.buffer.toString('utf8')).toContain(FILE_A);
  });

  it('хранит не больше JOURNAL_CACHE_MAX_FILES копий на группу', async () => {
    process.env.YANDEX_DISK_PUBLIC_URLS = FILE_A;

    const groups = await listJournalFiles();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await loadJournalFile(groups[0].filePath);
      await expireCachedCopy();
    }

    const dirs = (await fs.readdir(cacheRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory());
    expect(dirs).toHaveLength(1);

    const files = (await fs.readdir(path.join(cacheRoot, dirs[0].name))).filter((name) => name.endsWith('.xlsx'));
    expect(files.length).toBeLessThanOrEqual(2);
  });

  it('в ошибке видно ссылку и переменную, из которой она взята', async () => {
    process.env.YANDEX_DISK_PUBLIC_URL = FILE_A;
    const groups = await listJournalFiles();

    apiIsDown = true;
    resetRuntime();
    await fs.rm(cacheRoot, { recursive: true, force: true });

    await expect(loadJournalFile(groups[0].filePath)).rejects.toThrow(
      new RegExp(`404.*${FILE_A}.*YANDEX_DISK_PUBLIC_URL`, 's'),
    );
  });
});
