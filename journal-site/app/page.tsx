import ErrorScreen from '@/components/error-screen';
import GroupsDashboard from '@/components/groups-dashboard';
import { getJournalGroups } from '@/lib/journal';
import type { JournalGroupRef } from '@/lib/types';
import { redirect } from 'next/navigation';
import { currentGrant } from '@/lib/request-access';
import { isAccessConfigured } from '@/lib/access';
import { allowedGroups, groupView } from '@/lib/group-access';
import { publicJournalError } from '@/lib/journal-errors';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const grant = await currentGrant();
  if (!grant) redirect('/login');
  // Данные читаем в try/catch, а разметку возвращаем уже за его пределами:
  // ошибки самой отрисовки в try/catch всё равно не попадают.
  let groups: JournalGroupRef[] | null = null;
  let errorMessage: string | null = null;

  try {
    groups = allowedGroups(await getJournalGroups(), grant);
  } catch (error) {
    errorMessage = publicJournalError(error).error;
  }

  if (groups) {
    return <GroupsDashboard groups={groups.map(groupView)} showLogout={isAccessConfigured()} />;
  }

  return (
    <ErrorScreen
      kicker="Ошибка загрузки списка групп"
      title="Не удалось загрузить группы"
      hint={
        <>
          Попробуйте открыть страницу позже или сообщите куратору.
        </>
      }
      details={errorMessage ?? 'Неизвестная ошибка'}
    />
  );
}
