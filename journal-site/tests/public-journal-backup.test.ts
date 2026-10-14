import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PublicJournalBackup } from '@/lib/public-journal-backup';
import { getCachedPublicJournalMd5, loadJournalFile } from '@/lib/yandex-disk';
import { buildJournalWorkbook } from './helpers/journal-fixture';

const backups = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/lib/public-journal-backup', () => ({
  readPublicJournalBackup: vi.fn(async (key: string) => backups.get(key) ?? null),
  writePublicJournalBackup: vi.fn(async (backup: { sourceKey: string }) => {
    backups.set(backup.sourceKey, backup);
  }),
}));

const PUBLIC_URL = 'https://disk.yandex.ru/i/backupfixture';
const FILE_NAME = 'ИСиП-25-9.xlsx';
const FILE_PATH = `__yandex_public_cache__::${Buffer.from(JSON.stringify({
  k: PUBLIC_URL, p: '', n: FILE_NAME, l: '', g: 0,
})).toString('base64url')}`;

let cacheRoot = '';
let workbook: Buffer;
let downloads = 0;
let downloaderFails = false;

function resetRuntime(): void {
  const runtime = globalThis.__journalPublicCacheRuntime;
  if (runtime?.interval) {
    clearInterval(runtime.interval);
  }
  globalThis.__journalPublicCacheRuntime = undefined;
}

beforeEach(async () => {
  cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-backup-test-'));
  workbook = buildJournalWorkbook();
  downloads = 0;
  downloaderFails = false;
  backups.clear();
  resetRuntime();
  process.env.JOURNAL_SOURCE = 'yandex-public-cache';
  process.env.JOURNAL_CACHE_DIR = cacheRoot;
  process.env.YANDEX_DISK_PUBLIC_URLS = PUBLIC_URL;
  process.env.JOURNAL_CACHE_INTERVAL_MINUTES = '30';
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname === '/v1/disk/public/resources') {
      return Response.json({
        name: FILE_NAME,
        type: 'file',
        md5: crypto.createHash('md5').update(workbook).digest('hex'),
      });
    }
    if (url.pathname === '/v1/disk/public/resources/download') {
      return Response.json({ href: 'https://dl.test/file' });
    }
    if (url.hostname === 'dl.test') {
      downloads += 1;
      return downloaderFails
        ? new Response('Yandex failed', { status: 500 })
        : new Response(new Uint8Array(workbook), { status: 200 });
    }
    throw new Error(`Unexpected URL: ${url}`);
  }));
});

afterEach(async () => {
  resetRuntime();
  vi.unstubAllGlobals();
  await fs.rm(cacheRoot, { recursive: true, force: true });
  delete process.env.JOURNAL_SOURCE;
  delete process.env.JOURNAL_CACHE_DIR;
  delete process.env.YANDEX_DISK_PUBLIC_URLS;
  delete process.env.JOURNAL_CACHE_INTERVAL_MINUTES;
});

describe('durable public journal backup', () => {
  it('restores a validated workbook after the local cache disappears, without Yandex downloader', async () => {
    const first = await loadJournalFile(FILE_PATH);
    expect(first.buffer).toEqual(workbook);
    expect(backups.size).toBe(1);
    expect(downloads).toBe(1);

    await fs.rm(cacheRoot, { recursive: true, force: true });
    resetRuntime();
    downloaderFails = true;

    const restored = await loadJournalFile(FILE_PATH);
    expect(restored.buffer).toEqual(workbook);
    expect(restored.updatedAt).toBe(first.updatedAt);
    expect(downloads).toBe(1);
    expect(await getCachedPublicJournalMd5(FILE_PATH)).toBe(crypto.createHash('md5').update(workbook).digest('hex'));
  });

  it('rejects a damaged backup even if its stored checksum matches the damaged bytes', async () => {
    await loadJournalFile(FILE_PATH);
    const [key, stored] = [...backups.entries()][0] as [string, PublicJournalBackup];
    const damaged = Buffer.from('not an Excel workbook');
    backups.set(key, {
      ...stored,
      md5: crypto.createHash('md5').update(damaged).digest('hex'),
      buffer: damaged,
    });

    await fs.rm(cacheRoot, { recursive: true, force: true });
    resetRuntime();
    downloaderFails = true;

    await expect(loadJournalFile(FILE_PATH)).rejects.toThrow(/500/);
    expect(await getCachedPublicJournalMd5(FILE_PATH)).toBeNull();
  });
});
