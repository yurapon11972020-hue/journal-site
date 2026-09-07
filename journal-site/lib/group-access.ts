import type { AccessGrant } from '@/lib/access';
import type { JournalGroupRef, JournalGroupView } from '@/lib/types';

export function allowedGroups(groups: JournalGroupRef[], grant: AccessGrant | null): JournalGroupRef[] {
  if (!grant) return [];
  if (grant.scope === '*') return groups;
  if (grant.scope === '__single_group__') return groups.length === 1 ? groups : [];
  const exact = groups.filter((group) => group.id === grant.scope);
  if (exact.length) return exact;
  const named = groups.filter((group) => group.groupName === grant.scope);
  return named.length === 1 ? named : [];
}

export function groupView(group: JournalGroupRef): JournalGroupView {
  return { id: group.id, groupName: group.groupName, fileName: group.fileName, source: group.source };
}
