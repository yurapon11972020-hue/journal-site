import { createHash } from 'node:crypto';
import { parseJournalWorkbook } from '@/lib/parseJournal';
import type { JournalData, JournalFileResult } from '@/lib/types';

declare global {
  var __validatedJournalCache: Map<string, JournalData> | undefined;
}

export function readValidatedJournal(file: JournalFileResult): JournalData {
  const cache = globalThis.__validatedJournalCache ??= new Map();
  const key = createHash('sha256').update('parser-2026-09-08-v1').update(file.buffer).update(process.env.JOURNAL_ACADEMIC_YEAR_START || '').digest('hex');
  let data = cache.get(key);
  if (!data) {
    data = parseJournalWorkbook(file.buffer, file);
    cache.set(key, data);
    const limit = Math.min(60, Math.max(1, Number(process.env.JOURNAL_PARSED_CACHE_SIZE) || 4));
    while (cache.size > limit) cache.delete(cache.keys().next().value!);
  }
  return {
    ...data,
    source: file.source,
    sourceDetails: file.source === 'local' ? 'Локальный файл' : 'Яндекс.Диск',
    groupName: file.groupNameHint || data.groupName,
    updatedAt: file.fetchedAt ?? data.updatedAt,
    sync: file.sync,
  };
}
