import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

import { setSubscriptionStoreForTests } from '@/lib/subscriptions';
import { getPublicSourcesInfo, listJournalFiles, loadJournalFile, startJournalCache } from '@/lib/yandex-disk';
import { buildJournalWorkbook } from './helpers/journal-fixture';

const FILE_A = 'https://disk.yandex.ru/i/aaaaaaaaaaaaaa';
const FILE_B = 'https://disk.yandex.ru/i/bbbbbbbbbbbbbb';
const FOLDER = 'https://disk.yandex.ru/d/ffffffffffffff';
const EXISTING_GROUPS = [
  ['https://disk.yandex.ru/i/jr0lr00cUQp0FQ', 'ИСиП(Р)-24-1.xlsx', 'X0p3qpi4K5zZhKZU'],
  ['https://disk.yandex.ru/i/QZZ5ghsJ_w7xAg', 'РУПО-26-1.xlsx', 'rjrCcrvyk6KZ3aHV'],
  ['https://disk.yandex.ru/i/ezTOIqg1oAictA', 'ИБ 26-2.xlsx', 'VkYOwj-4KoT2m9y_'],
  ['https://disk.yandex.ru/i/n2Ldf1ar5jbjJg', 'ПД-25-2.xlsx', 'H2be0UpJGvfFhj1m'],
  ['https://disk.yandex.ru/i/WtnnnWnxsUUoZw', 'ПД-25-3.xlsx', 'KDe8a9WOKaPeTtqb'],
  ['https://disk.yandex.ru/i/kORWvg2JaCqGQw', 'ЮР-24-1.xlsx', 'F4SaPdO2RQ-FCI3J'],
  ['https://disk.yandex.ru/i/mzbfhA6hE_MWSA', 'ИБ-24-1.xlsx', 'Ym2xG1J7QX2_Qnvd'],
  ['https://disk.yandex.ru/i/NIRLGEBZ9kcE8g', 'ПД-25-1.xlsx', 'AUdmADooLxxqFu79'],
  ['https://disk.yandex.ru/i/pTtJyYNVAxv_9w', 'ПД-24-1.xlsx', 'jnhy2jHvh-DXabW7'],
  ['https://disk.yandex.ru/i/DqRcoPsqQh233g', 'ПД-24-2.xlsx', 'DxMjFq_nlU3zMRg3'],
] as const;

const fileNames: Record<string, string> = {
  [FILE_A]: 'ИСиП-25-9.xlsx',
  [FILE_B]: 'ИСиП-24-9.xlsx',
};
const originalFileNames = { ...fileNames };

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
/** Сколько ближайших попыток скачивания должны провалиться. */
let downloadFailures = 0;
/** Яндекс не отвечает на запрос метаданных, но файл отдаёт. */
let metaIsDown = false;
let downloadReturnsLoginPage = false;
let apiIsDown = false;
let downloadApiStatus = 0;
let metadataBarrier: Promise<void> | null = null;
let blockedDownloadKey: string | null = null;
let downloadBarrier: Promise<void> | null = null;
const malformedRemoteRevisions = new Set<string>();
const remoteRevisions = new Map<string, number>();
const remoteBuffers = new Map<string, Buffer>();

/** Настоящая книга Excel с меткой в A1 — по ней тест узнаёт, откуда файл. */
function workbookFor(marker: string): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[marker]]), 'Лист1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function remoteWorkbook(publicKey: string, innerPath: string): Buffer {
  const revision = remoteRevisions.get(publicKey) ?? 1;
  const key = `${publicKey}::${innerPath}::${revision}`;
  let buffer = remoteBuffers.get(key);
  if (!buffer) {
    if (malformedRemoteRevisions.has(`${publicKey}::${revision}`)) {
      buffer = workbookFor(key);
    } else {
      const fixture = buildJournalWorkbook({ groupName: publicKey === FILE_B ? 'ИСиП-24/9' : 'ИСиП-25/9' });
      const workbook = XLSX.read(fixture, { type: 'buffer' });
      // Маркер в A1 помогает увидеть версию файла, не ломая его структуру.
      workbook.Sheets[workbook.SheetNames[0]].A1 = { t: 's', v: key };
      buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    }
    remoteBuffers.set(key, buffer);
  }
  return buffer;
}

function markerOf(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return String((sheet.A1 as { v?: unknown } | undefined)?.v ?? '');
}

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
    if (metadataBarrier) {
      await metadataBarrier;
    }
    if (metaIsDown) {
      return json({ description: 'Service Unavailable' }, 503);
    }
    if (key === FOLDER) {
      const node = folderTree[innerPath];
      return node
        ? json(node)
        : json({
          name: path.posix.basename(innerPath),
          type: 'file',
          md5: crypto.createHash('md5').update(remoteWorkbook(key, innerPath)).digest('hex'),
        });
    }
    return fileNames[key]
      ? json({
        name: fileNames[key],
        type: 'file',
        md5: crypto.createHash('md5').update(remoteWorkbook(key, innerPath)).digest('hex'),
      })
      : json({ description: 'Not found' }, 404);
  }

  if (target.pathname === '/v1/disk/public/resources/download') {
    if (downloadApiStatus) {
      return json({ description: 'Internal Server Error' }, downloadApiStatus);
    }
    return json({ href: `https://dl.test/f?k=${encodeURIComponent(key)}&p=${encodeURIComponent(innerPath)}` });
  }

  if (target.hostname === 'dl.test') {
    if (target.searchParams.get('k') === blockedDownloadKey && downloadBarrier) {
      await downloadBarrier;
    }
    if (downloadFailures > 0) {
      downloadFailures -= 1;
      return new Response('nope', { status: 503, statusText: 'Service Unavailable' });
    }
    if (downloadReturnsLoginPage) {
      // Яндекс отвечает 200, но отдаёт HTML вместо файла: доступ закрыли.
      return new Response('<!DOCTYPE html><html><body>Вход</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    downloads += 1;
    const workbook = remoteWorkbook(target.searchParams.get('k') ?? '', target.searchParams.get('p') ?? '');
    const name = fileNames[target.searchParams.get('k') ?? ''] ?? 'journal.xlsx';

    // Яндекс присылает имя файла вместе со скачиванием, кириллицу —
    // в процентной кодировке через filename*.
    return new Response(new Uint8Array(workbook), {
      headers: { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}` },
    });
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
      checkedAt: string;
    };

    meta.checkedAt = new Date(0).toISOString();
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
  }
}

async function waitForBackgroundCheck(): Promise<void> {
  await vi.waitFor(async () => {
    const dirs = (await fs.readdir(cacheRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory());
    for (const dir of dirs) {
      const metaPath = path.join(cacheRoot, dir.name, 'latest.json');
      const meta = JSON.parse(await fs.readFile(metaPath, 'utf8')) as { checkedAt: string };
      expect(meta.checkedAt).not.toBe(new Date(0).toISOString());
    }
  }, { timeout: 5_000, interval: 10 });
  const running = [...(globalThis.__journalPublicCacheRuntime?.refreshPromises?.values() ?? [])];
  await Promise.allSettled(running);
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
  downloadFailures = 0;
  metaIsDown = false;
  downloadReturnsLoginPage = false;
  apiIsDown = false;
  downloadApiStatus = 0;
  metadataBarrier = null;
  blockedDownloadKey = null;
  downloadBarrier = null;
  malformedRemoteRevisions.clear();
  for (const key of Object.keys(fileNames)) {
    delete fileNames[key];
  }
  Object.assign(fileNames, originalFileNames);
  remoteRevisions.clear();
  remoteBuffers.clear();
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
  setSubscriptionStoreForTests(null);
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
    expect(groups[0].groupName).toBe('ИСиП-25/9');
  });

  it('несколько ссылок дают несколько групп, названия можно задать вручную', async () => {
    process.env.YANDEX_DISK_PUBLIC_URLS = `Новый год = ${FILE_A}\nПрошлый год = ${FILE_B}`;

    const groups = await listJournalFiles();

    expect(groups.map((group) => group.groupName)).toEqual(['Новый год', 'Прошлый год']);
    expect(new Set(groups.map((group) => group.id)).size).toBe(2);
  });

  it('сохраняет опубликованные ID всех действующих групп для подписок', async () => {
    for (const [link, fileName] of EXISTING_GROUPS) {
      fileNames[link] = fileName;
    }
    process.env.YANDEX_DISK_PUBLIC_URLS = EXISTING_GROUPS.map(([link]) => link).join(',');

    const groups = await listJournalFiles();
    const byFileName = new Map(groups.map((group) => [group.fileName, group.id]));
    for (const [, fileName, id] of EXISTING_GROUPS) {
      expect(byFileName.get(fileName)).toBe(id);
    }
  });

  it('переименование файла и подписи не меняет ID группы', async () => {
    process.env.YANDEX_DISK_PUBLIC_URLS = FILE_A;
    const before = (await listJournalFiles())[0];

    fileNames[FILE_A] = 'Новое имя.xlsx';
    const groupsPath = path.join(cacheRoot, 'groups.json');
    const cached = JSON.parse(await fs.readFile(groupsPath, 'utf8')) as { fetchedAt: string };
    cached.fetchedAt = new Date(0).toISOString();
    await fs.writeFile(groupsPath, JSON.stringify(cached), 'utf8');
    await listJournalFiles();
    await globalThis.__journalPublicCacheRuntime?.groupsPromise;
    const renamed = (await listJournalFiles())[0];
    expect(renamed.fileName).toBe('Новое имя.xlsx');
    expect(renamed.id).toBe(before.id);

    process.env.YANDEX_DISK_PUBLIC_URLS = `Своя подпись = ${FILE_A}`;
    const relabeled = (await listJournalFiles())[0];
    expect(relabeled.groupName).toBe('Своя подпись');
    expect(relabeled.id).toBe(before.id);
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
    expect(groups.map((group) => group.groupName)).toEqual(['ИСиП-22/9', 'ИСиП-25/9', 'ПКС-24/9']);
  });

  it('папку и отдельную ссылку можно смешивать', async () => {
    process.env.YANDEX_DISK_PUBLIC_URLS = `${FOLDER}, Прошлый год = ${FILE_B}`;

    const groups = await listJournalFiles();

    expect(groups.map((group) => group.groupName)).toEqual(['ИСиП-22/9', 'ИСиП-25/9', 'ПКС-24/9', 'Прошлый год']);
  });

  it('список групп берётся из кэша, пока не истёк интервал', async () => {
    process.env.YANDEX_DISK_PUBLIC_URLS = FILE_A;

    await listJournalFiles();
    const callsAfterFirst = listCalls;
    await listJournalFiles();

    expect(listCalls).toBe(callsAfterFirst);
  });

  it('просроченный список возвращается сразу, пока обновляется в фоне', async () => {
    process.env.YANDEX_DISK_PUBLIC_URLS = FILE_A;
    await listJournalFiles();

    const groupsPath = path.join(cacheRoot, 'groups.json');
    const cached = JSON.parse(await fs.readFile(groupsPath, 'utf8')) as { fetchedAt: string };
    cached.fetchedAt = new Date(0).toISOString();
    await fs.writeFile(groupsPath, JSON.stringify(cached), 'utf8');

    let releaseMetadata = () => {};
    metadataBarrier = new Promise<void>((resolve) => {
      releaseMetadata = resolve;
    });

    let timeout: NodeJS.Timeout | undefined;
    let result: Awaited<ReturnType<typeof listJournalFiles>> | 'slow';
    try {
      result = await Promise.race([
        listJournalFiles(),
        new Promise<'slow'>((resolve) => {
          timeout = setTimeout(() => resolve('slow'), 1_000);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
      releaseMetadata();
      metadataBarrier = null;
    }

    expect(result).not.toBe('slow');
    if (result !== 'slow') {
      expect(result[0].groupName).toBe('ИСиП-25/9');
    }
    await globalThis.__journalPublicCacheRuntime?.groupsPromise;
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

    const newYear = await loadJournalFile(byName.get('ИСиП-25/9')!.filePath);
    const lastYear = await loadJournalFile(byName.get('ИСиП-24/9')!.filePath);

    expect(markerOf(newYear.buffer)).toContain(FILE_A);
    expect(markerOf(lastYear.buffer)).toContain(FILE_B);
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

  it('по прежнему md5 не скачивает неизменившийся журнал повторно', async () => {
    process.env.YANDEX_DISK_PUBLIC_URLS = FILE_A;

    const groups = await listJournalFiles();
    await loadJournalFile(groups[0].filePath);
    await expireCachedCopy();

    const same = await loadJournalFile(groups[0].filePath);
    expect(markerOf(same.buffer)).toContain(FILE_A);
    expect(downloads).toBe(1);
    await waitForBackgroundCheck();

    // После проверки md5 обычный запрос опять берёт свежую копию из кэша.
    const checks = listCalls;
    await loadJournalFile(groups[0].filePath);
    expect(listCalls).toBe(checks);
  });

  it('после изменения md5 скачивает и отдаёт новую версию', async () => {
    process.env.YANDEX_DISK_PUBLIC_URLS = FILE_A;

    const groups = await listJournalFiles();
    await loadJournalFile(groups[0].filePath);
    await expireCachedCopy();
    remoteRevisions.set(FILE_A, 2);

    const stale = await loadJournalFile(groups[0].filePath);
    expect(markerOf(stale.buffer)).toContain('::1');
    await waitForBackgroundCheck();
    const changed = await loadJournalFile(groups[0].filePath);
    expect(markerOf(changed.buffer)).toContain('::2');
    expect(downloads).toBe(2);
  });

  it('со старой копией ответ не ждёт медленный Яндекс', async () => {
    process.env.YANDEX_DISK_PUBLIC_URLS = FILE_A;
    const groups = await listJournalFiles();
    await loadJournalFile(groups[0].filePath);
    await expireCachedCopy();
    remoteRevisions.set(FILE_A, 2);

    let releaseMetadata = () => {};
    metadataBarrier = new Promise<void>((resolve) => {
      releaseMetadata = resolve;
    });

    let timeout: NodeJS.Timeout | undefined;
    const loading = loadJournalFile(groups[0].filePath);
    let result: Awaited<typeof loading> | 'slow';
    try {
      result = await Promise.race([
        loading,
        new Promise<'slow'>((resolve) => {
          timeout = setTimeout(() => resolve('slow'), 1_000);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
      releaseMetadata();
      metadataBarrier = null;
    }

    expect(result).not.toBe('slow');
    if (result !== 'slow') {
      expect(markerOf(result.buffer)).toContain('::1');
    }
    await waitForBackgroundCheck();
    expect(markerOf((await loadJournalFile(groups[0].filePath)).buffer)).toContain('::2');
  });

  it('старые ссылки на группу продолжают открываться', async () => {
    process.env.YANDEX_DISK_PUBLIC_URLS = FILE_A;

    const legacy = await loadJournalFile('__yandex_public_cache__');
    const empty = await loadJournalFile();

    expect(markerOf(legacy.buffer)).toContain(FILE_A);
    expect(markerOf(empty.buffer)).toContain(FILE_A);
  });

  it('при сбое скачивания отдаёт последнюю удачную копию', async () => {
    process.env.YANDEX_DISK_PUBLIC_URLS = FILE_A;

    const groups = await listJournalFiles();
    const good = await loadJournalFile(groups[0].filePath);

    await expireCachedCopy();
    // Валим все попытки, включая повторные: иначе проверялся бы повтор,
    // а не запасная копия.
    downloadFailures = 99;
    remoteRevisions.set(FILE_A, 2);

    const stale = await loadJournalFile(groups[0].filePath);
    expect(markerOf(stale.buffer)).toContain(FILE_A);
    expect(stale.updatedAt).toBe(good.updatedAt);
    await waitForBackgroundCheck();
    expect(downloadFailures).toBe(96);
  });

  it('разовая осечка сети не оставляет группу без журнала', async () => {
    process.env.YANDEX_DISK_PUBLIC_URLS = FILE_A;

    // Первая попытка проваливается, как на Render в первые секунды
    // после запуска. Прошлой копии ещё нет — спасает только повтор.
    downloadFailures = 1;

    const groups = await listJournalFiles();
    const file = await loadJournalFile(groups[0].filePath);

    expect(markerOf(file.buffer)).toContain(FILE_A);
    expect(downloads).toBe(1);
  });

  it('без ответа на метаданные имя берётся из скачанного файла', async () => {
    process.env.YANDEX_DISK_PUBLIC_URLS = FILE_A;
    metaIsDown = true;

    // Пока файл не скачан, известен только хвост ссылки.
    const before = await listJournalFiles();
    expect(before[0].fileName).toBe('aaaaaaaaaaaaaa.xlsx');

    await loadJournalFile(before[0].filePath);

    // Скачивание принесло настоящее имя в заголовке ответа.
    const after = await listJournalFiles();
    expect(after[0].fileName).toBe('ИСиП-25-9.xlsx');
    expect(after[0].groupName).toBe('ИСиП-25/9');
  });

  it('страница входа вместо журнала не затирает рабочую копию', async () => {
    process.env.YANDEX_DISK_PUBLIC_URLS = FILE_A;

    const groups = await listJournalFiles();
    const good = await loadJournalFile(groups[0].filePath);
    expect(markerOf(good.buffer)).toContain(FILE_A);

    await expireCachedCopy();
    downloadReturnsLoginPage = true;
    remoteRevisions.set(FILE_A, 2);

    const still = await loadJournalFile(groups[0].filePath);
    expect(markerOf(still.buffer)).toContain(FILE_A);
    expect(still.buffer.subarray(0, 2).toString()).toBe('PK');
    await waitForBackgroundCheck();
  });

  it('битая книга Excel не заменяет проверенный журнал', async () => {
    process.env.YANDEX_DISK_PUBLIC_URLS = FILE_A;
    const groups = await listJournalFiles();
    const good = await loadJournalFile(groups[0].filePath);
    await expireCachedCopy();
    remoteRevisions.set(FILE_A, 2);
    malformedRemoteRevisions.add(`${FILE_A}::2`);

    const stale = await loadJournalFile(groups[0].filePath);
    await waitForBackgroundCheck();
    const after = await loadJournalFile(groups[0].filePath);

    expect(markerOf(stale.buffer)).toContain('::1');
    expect(markerOf(after.buffer)).toContain('::1');
    expect(after.sourceDetails).toBe(good.sourceDetails);
    const dirs = (await fs.readdir(cacheRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory());
    const meta = JSON.parse(await fs.readFile(path.join(cacheRoot, dirs[0].name, 'latest.json'), 'utf8')) as {
      versions: unknown[];
    };
    expect(meta.versions).toHaveLength(1);
  });

  it('хранит не больше JOURNAL_CACHE_MAX_FILES копий на группу', async () => {
    process.env.YANDEX_DISK_PUBLIC_URLS = FILE_A;

    const groups = await listJournalFiles();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      remoteRevisions.set(FILE_A, attempt + 1);
      await loadJournalFile(groups[0].filePath);
      if (attempt > 0) {
        await waitForBackgroundCheck();
      }
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

  it('ошибка 500 от Яндекса объясняется как временный сбой', async () => {
    process.env.YANDEX_DISK_PUBLIC_URLS = FILE_A;
    const groups = await listJournalFiles();
    downloadApiStatus = 500;

    await expect(loadJournalFile(groups[0].filePath)).rejects.toThrow(/500.*временный сбой/i);
  });

  it('быстрая группа получает стартовый снимок до медленной, одновременные циклы не дублируются', async () => {
    process.env.YANDEX_DISK_PUBLIC_URLS = `${FILE_A},${FILE_B}`;
    const groups = await listJournalFiles();
    const fastId = groups.find((group) => group.groupName === 'ИСиП-25/9')!.id;
    const slowId = groups.find((group) => group.groupName === 'ИСиП-24/9')!.id;
    const writes = new Map<string, number>();
    let finishFast = () => {};
    const fastWritten = new Promise<void>((resolve) => {
      finishFast = resolve;
    });

    setSubscriptionStoreForTests({
      listByGroup: async () => [],
      listByChat: async () => [],
      save: async () => {},
      remove: async () => {},
      stageNotificationsAndSnapshot: async () => {},
      listPendingMessages: async () => [],
      ackPendingMessage: async () => {},
      readSnapshot: async () => null,
      writeSnapshot: async (groupId) => {
        writes.set(groupId, (writes.get(groupId) ?? 0) + 1);
        if (groupId === fastId) {
          finishFast();
        }
      },
    });

    blockedDownloadKey = FILE_B;
    let releaseDownload = () => {};
    downloadBarrier = new Promise<void>((resolve) => {
      releaseDownload = resolve;
    });

    const firstStart = startJournalCache();
    const secondStart = startJournalCache();
    let timeout: NodeJS.Timeout | undefined;
    let fastBeforeSlow = false;
    let slowWasPending = false;
    try {
      fastBeforeSlow = await Promise.race([
        fastWritten.then(() => true),
        new Promise<false>((resolve) => {
          timeout = setTimeout(() => resolve(false), 3_000);
        }),
      ]);
      slowWasPending = !writes.has(slowId);
    } finally {
      clearTimeout(timeout);
      releaseDownload();
      downloadBarrier = null;
      blockedDownloadKey = null;
      await Promise.all([firstStart, secondStart]);
    }

    expect(fastBeforeSlow).toBe(true);
    expect(slowWasPending).toBe(true);
    expect(writes.get(fastId)).toBe(1);
    expect(writes.get(slowId)).toBe(1);
    expect(downloads).toBe(2);
  });
});
