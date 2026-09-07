import { idToGroupPath, groupPathToPublicId } from '@/lib/group-files';
import { readValidatedJournal } from '@/lib/validated-journal';
import { JournalError, publicJournalError } from '@/lib/journal-errors';
import type { JournalData, JournalGroupRef } from '@/lib/types';
import { listJournalFiles, loadJournalFile } from '@/lib/yandex-disk';

interface Snapshot { data: JournalData; readAt: number; }
declare global {
  var __journalSnapshots: Map<string, Snapshot> | undefined;
  var __journalLoads: Map<string, Promise<JournalData>> | undefined;
}

export async function getJournalGroups(): Promise<JournalGroupRef[]> { return listJournalFiles(); }

export async function getJournalDataByPath(filePath?: string, options: { force?: boolean; cachedOnly?: boolean } = {}): Promise<JournalData> {
  const snapshots = globalThis.__journalSnapshots ??= new Map();
  const loads = globalThis.__journalLoads ??= new Map();
  const key = (process.env.JOURNAL_SOURCE || 'local') + '::' + (filePath || '') + '::' + (process.env.JOURNAL_ACADEMIC_YEAR_START || '');
  const last = snapshots.get(key);
  const source = process.env.JOURNAL_SOURCE || 'local';
  if (last && source !== 'local' && source !== 'yandex-public-cache' && Date.now() - last.readAt < (last.data.sync?.stale ? 60000 : options.force ? 30000 : 60000)) return last.data;
  const running = loads.get(key);
  if (running) return running;
  const pending = (async () => {
    try {
      const file = await loadJournalFile(filePath, options);
      const data = readValidatedJournal(file);
      snapshots.set(key, { data, readAt: Date.now() });
      const limit = Math.min(60, Math.max(1, Number(process.env.JOURNAL_PARSED_CACHE_SIZE) || 4));
      while (snapshots.size > limit) snapshots.delete(snapshots.keys().next().value!);
      return data;
    } catch (error) {
      if (!last) throw error;
      const safe = publicJournalError(error);
      const stale = { ...last.data, sync: { stale: true, checkedAt: new Date().toISOString(), errorCode: safe.code, error: safe.error } };
      snapshots.set(key, { data: stale, readAt: Date.now() });
      return stale;
    }
  })().finally(() => loads.delete(key));
  loads.set(key, pending);
  return pending;
}

export async function getJournalData(): Promise<JournalData> {
  const groups = await getJournalGroups();
  return getJournalDataByPath(groups[0]?.filePath);
}

export async function findJournalGroupById(groupId: string): Promise<JournalGroupRef | null> {
  if (!groupId || groupId.length > 2048) return null;
  const groups = await listJournalFiles();
  const direct = groups.find((group) => group.id === groupId || groupPathToPublicId(group.filePath) === groupId);
  if (direct) return direct;
  try {
    const path = idToGroupPath(groupId);
    if (/[\u0000-\u001f]/.test(path)) return null;
    return groups.find((group) => group.filePath === path) ?? (path === '__yandex_public_cache__' ? groups[0] ?? null : null);
  } catch { return null; }
}

export async function getJournalDataByGroupId(groupId: string, options: { force?: boolean; cachedOnly?: boolean } = {}): Promise<JournalData> {
  const group = await findJournalGroupById(groupId);
  if (!group) throw new JournalError('JOURNAL_NOT_FOUND', 404);
  return getJournalDataByPath(group.filePath, options);
}
