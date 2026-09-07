import type { Metadata } from 'next';

import JournalView from '@/components/journal-view';
import ErrorScreen from '@/components/error-screen';
import { findJournalGroupById, getJournalDataByGroupId } from '@/lib/journal';
import type { JournalData } from '@/lib/types';
import { redirect, notFound } from 'next/navigation';
import { currentGrant } from '@/lib/request-access';
import { isAccessConfigured } from '@/lib/access';
import { allowedGroups } from '@/lib/group-access';
import { getJournalGroups } from '@/lib/journal';
import { publicJournalError } from '@/lib/journal-errors';

export const dynamic = 'force-dynamic';

interface GroupPageProps {
  params: Promise<{
    id: string;
  }>;
}

export async function generateMetadata({ params }: GroupPageProps): Promise<Metadata> {
  const { id } = await params;

  try {
    const grant = await currentGrant();
    const group = allowedGroups(await getJournalGroups(), grant).find((entry) => entry.id === id);
    return { title: group ? `Журнал — ${group.groupName}` : 'Журнал группы' };
  } catch {
    return { title: 'Журнал группы' };
  }
}

export default async function GroupPage({ params }: GroupPageProps) {
  const { id } = await params;
  const grant = await currentGrant();
  if (!grant) redirect(`/login?next=${encodeURIComponent(`/group/${id}`)}`);
  let data: JournalData | null = null;
  let errorMessage: string | null = null;
  let resolvedGroupId: string | null = null;

  try {
    const group = await findJournalGroupById(id);
    if (group && allowedGroups(await getJournalGroups(), grant).some((entry) => entry.id === group.id)) {
      resolvedGroupId = group.id;
      data = await getJournalDataByGroupId(group.id, { cachedOnly: true });
    }
  } catch (error) {
    errorMessage = publicJournalError(error).error;
  }

  if (!resolvedGroupId && !errorMessage) notFound();

  if (data && resolvedGroupId) {
    return <JournalView initialData={data} groupId={resolvedGroupId} showLogout={isAccessConfigured()} />;
  }

  return (
    <ErrorScreen
      kicker="Ошибка загрузки журнала"
      title="Не удалось открыть группу"
      hint={
        <>
          Попробуйте обновить страницу позже. Если ошибка повторяется, сообщите куратору.
        </>
      }
      details={errorMessage ?? 'Неизвестная ошибка'}
    />
  );
}
