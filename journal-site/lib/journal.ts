import { idToGroupPath } from '@/lib/group-files';
import { parseJournalWorkbook } from '@/lib/parseJournal';
import type { JournalData, JournalFileResult, JournalGroupRef } from '@/lib/types';
import { listJournalFiles, loadJournalFile } from '@/lib/yandex-disk';

const LEGACY_SINGLE_GROUP_PATH = '__yandex_public_cache__';

interface ParsedJournalCacheEntry {
  data: JournalData;
  createdAt: number;
}

interface JournalRuntimeCache {
  parsed: Map<string, ParsedJournalCacheEntry>;
  parsing: Map<string, Promise<JournalData>>;
}

declare global {
  var __journalRuntimeCache: JournalRuntimeCache | undefined;
}

// Сколько разобранных журналов держим в памяти одновременно.
// При нескольких группах имеет смысл держать больше одной, но не все сразу:
// каждый разобранный журнал занимает память.
function getParsedCacheLimit(): number {
  const raw = process.env.JOURNAL_PARSED_CACHE_SIZE?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 4;
}

function getRuntimeCache(): JournalRuntimeCache {
  globalThis.__journalRuntimeCache ??= {
    parsed: new Map<string, ParsedJournalCacheEntry>(),
    parsing: new Map<string, Promise<JournalData>>(),
  };

  return globalThis.__journalRuntimeCache;
}

function buildCacheKey(file: JournalFileResult): string {
  return `${file.source}::${file.sourceDetails}::${file.fileName ?? ''}`;
}

function parseAndNormalizeJournal(file: JournalFileResult): JournalData {
  const data = parseJournalWorkbook(file.buffer, file);

  if (file.groupNameHint) {
    data.groupName = file.groupNameHint;
  }

  return data;
}

async function getParsedJournalFromFile(file: JournalFileResult): Promise<JournalData> {
  const cache = getRuntimeCache();
  const key = buildCacheKey(file);
  const cached = cache.parsed.get(key);

  if (cached) {
    return cached.data;
  }

  const existingParse = cache.parsing.get(key);
  if (existingParse) {
    return existingParse;
  }

  const parsePromise = Promise.resolve()
    .then(() => {
      const data = parseAndNormalizeJournal(file);
      cache.parsed.set(key, {
        data,
        createdAt: Date.now(),
      });

      while (cache.parsed.size > getParsedCacheLimit()) {
        const oldestKey = cache.parsed.keys().next().value;
        if (!oldestKey) {
          break;
        }
        cache.parsed.delete(oldestKey);
      }

      return data;
    })
    .finally(() => {
      cache.parsing.delete(key);
    });

  cache.parsing.set(key, parsePromise);
  return parsePromise;
}

function warmFirstGroup(groups: JournalGroupRef[]): void {
  const firstGroup = groups[0];
  if (!firstGroup?.filePath) {
    return;
  }

  void getJournalDataByPath(firstGroup.filePath).catch((error) => {
    console.error('[journal-cache] Не удалось заранее подготовить журнал:', error);
  });
}

export async function getJournalGroups(): Promise<JournalGroupRef[]> {
  const groups = await listJournalFiles();
  warmFirstGroup(groups);
  return groups;
}

export async function getJournalDataByPath(filePath?: string): Promise<JournalData> {
  const file = await loadJournalFile(filePath);
  return getParsedJournalFromFile(file);
}

export async function getJournalData(): Promise<JournalData> {
  const groups = await getJournalGroups();
  const firstGroup = groups[0];
  return getJournalDataByPath(firstGroup?.filePath);
}

/**
 * Старый идентификатор группы — путь к файлу, закодированный в base64.
 * Раскодированное значение используется только для сверки со списком групп:
 * открыть по нему произвольный путь на сервере нельзя.
 */
function decodeLegacyGroupId(groupId: string): string | null {
  try {
    const decoded = idToGroupPath(groupId);
    return decoded && !/[\u0000-\u001f]/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export async function findJournalGroupById(groupId: string): Promise<JournalGroupRef | null> {
  const groups = await listJournalFiles();
  const byId = groups.find((group) => group.id === groupId);
  if (byId) {
    return byId;
  }

  const legacyPath = decodeLegacyGroupId(groupId);
  if (!legacyPath) {
    return null;
  }

  const byLegacyPath = groups.find((group) => group.filePath === legacyPath);
  if (byLegacyPath) {
    return byLegacyPath;
  }

  // До поддержки нескольких групп у единственной группы был фиксированный путь.
  return legacyPath === LEGACY_SINGLE_GROUP_PATH ? (groups[0] ?? null) : null;
}

export async function getJournalDataByGroupId(groupId: string): Promise<JournalData> {
  const group = await findJournalGroupById(groupId);

  if (!group) {
    throw new Error('Такая группа не найдена. Скорее всего, ссылка устарела — открой список групп заново.');
  }

  return getJournalDataByPath(group.filePath);
}
