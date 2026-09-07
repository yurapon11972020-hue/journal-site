import type { Metadata } from 'next';

import Dashboard from '@/components/dashboard';
import ErrorScreen from '@/components/error-screen';
import { findJournalGroupById, getJournalDataByGroupId } from '@/lib/journal';
import type { JournalData } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface GroupPageProps {
  params: Promise<{
    id: string;
  }>;
}

export async function generateMetadata({ params }: GroupPageProps): Promise<Metadata> {
  const { id } = await params;

  try {
    const group = await findJournalGroupById(id);
    return { title: group ? `Журнал — ${group.groupName}` : 'Журнал группы' };
  } catch {
    return { title: 'Журнал группы' };
  }
}

export default async function GroupPage({ params }: GroupPageProps) {
  const { id } = await params;

  let data: JournalData | null = null;
  let errorMessage: string | null = null;

  try {
    data = await getJournalDataByGroupId(id);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
  }

  if (data) {
    return <Dashboard data={data} backHref="/" backLabel="Все группы" />;
  }

  return (
    <ErrorScreen
      kicker="Ошибка загрузки журнала"
      title="Не удалось открыть группу"
      hint={
        <>
          Проверь, открывается ли Excel-файл этой группы по публичной ссылке, и переменную{' '}
          <code>YANDEX_DISK_PUBLIC_URLS</code> в настройках сервера.
        </>
      }
      details={errorMessage ?? 'Неизвестная ошибка'}
    />
  );
}
