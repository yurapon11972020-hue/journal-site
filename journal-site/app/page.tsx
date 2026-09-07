import ErrorScreen from '@/components/error-screen';
import GroupsDashboard from '@/components/groups-dashboard';
import { getJournalGroups } from '@/lib/journal';
import type { JournalGroupRef } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  // Данные читаем в try/catch, а разметку возвращаем уже за его пределами:
  // ошибки самой отрисовки в try/catch всё равно не попадают.
  let groups: JournalGroupRef[] | null = null;
  let errorMessage: string | null = null;

  try {
    groups = await getJournalGroups();
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
  }

  if (groups) {
    return <GroupsDashboard groups={groups} />;
  }

  return (
    <ErrorScreen
      kicker="Ошибка загрузки списка групп"
      title="Сайт запустился, но не смог прочитать группы"
      hint={
        <>
          Проверь публичные ссылки на Яндекс.Диск в переменной <code>YANDEX_DISK_PUBLIC_URLS</code> (локально — в{' '}
          <code>.env.local</code>, на Render — в разделе Environment).
        </>
      }
      details={errorMessage ?? 'Неизвестная ошибка'}
    />
  );
}
