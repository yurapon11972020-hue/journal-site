import { idToGroupPath } from '@/lib/group-files';
import { parseJournalWorkbook } from '@/lib/parseJournal';
import type { JournalData, JournalGroupRef } from '@/lib/types';
import { listJournalFiles, loadJournalFile } from '@/lib/yandex-disk';

export async function getJournalGroups(): Promise<JournalGroupRef[]> {
  return listJournalFiles();
}

export async function getJournalDataByPath(filePath?: string): Promise<JournalData> {
  const file = await loadJournalFile(filePath);
  const data = parseJournalWorkbook(file.buffer, file);

  if (file.groupNameHint) {
    data.groupName = file.groupNameHint;
  }

  return data;
}

export async function getJournalData(): Promise<JournalData> {
  const groups = await getJournalGroups();
  const firstGroup = groups[0];
  return getJournalDataByPath(firstGroup?.filePath);
}

export async function getJournalDataByGroupId(groupId: string): Promise<JournalData> {
  const filePath = idToGroupPath(groupId);
  return getJournalDataByPath(filePath);
}
