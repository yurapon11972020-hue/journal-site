import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getJournalDataByPath, getJournalGroups } from '@/lib/journal';

import { buildJournalWorkbook } from './helpers/journal-fixture';

/**
 * Список групп строится по именам файлов, а настоящее название группы
 * написано внутри журнала. Разобранных журналов в памяти держится
 * всего несколько, групп бывает больше — и вытесненная группа
 * возвращалась в списке к имени файла: карточка и страница внутри
 * назывались по-разному.
 */
let folder: string;

const GROUPS = [
  { file: 'ИБ-24-1.xlsx', inside: 'ИСиП 24/2' },
  { file: 'ИСиП-26-2.xlsx', inside: 'ИБ 26/2' },
  { file: 'ИСиП-26-1.xlsx', inside: 'РУПО 26/1' },
];

beforeEach(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-names-'));

  for (const group of GROUPS) {
    await fs.writeFile(path.join(folder, group.file), buildJournalWorkbook({ groupName: group.inside }));
  }

  globalThis.__journalRuntimeCache = undefined;
  process.env.JOURNAL_SOURCE = 'local';
  process.env.JOURNAL_LOCAL_FOLDER = folder;
  // Меньше, чем групп: ровно та ситуация, что на боевом сервере.
  process.env.JOURNAL_PARSED_CACHE_SIZE = '1';
});

afterEach(async () => {
  globalThis.__journalRuntimeCache = undefined;
  delete process.env.JOURNAL_SOURCE;
  delete process.env.JOURNAL_LOCAL_FOLDER;
  delete process.env.JOURNAL_PARSED_CACHE_SIZE;
  await fs.rm(folder, { recursive: true, force: true });
});

describe('названия групп в списке', () => {
  it('до разбора берутся из имени файла', async () => {
    const groups = await getJournalGroups();
    expect(groups.map((group) => group.groupName).sort()).toEqual(['ИБ-24/1', 'ИСиП-26/1', 'ИСиП-26/2']);
  });

  it('после разбора совпадают с тем, что внутри журнала', async () => {
    const groups = await getJournalGroups();

    for (const group of groups) {
      await getJournalDataByPath(group.filePath);
    }

    // Разобранных журналов в памяти остался один, но названия помнятся все.
    const refreshed = await getJournalGroups();
    expect(refreshed.map((group) => group.groupName).sort()).toEqual(['ИБ-26/2', 'ИСиП-24/2', 'РУПО-26/1']);
  });

  it('карточка и страница внутри называются одинаково', async () => {
    const groups = await getJournalGroups();

    for (const group of groups) {
      await getJournalDataByPath(group.filePath);
    }

    for (const group of await getJournalGroups()) {
      const data = await getJournalDataByPath(group.filePath);
      expect(group.groupName).toBe(data.groupName);
    }
  });
});
