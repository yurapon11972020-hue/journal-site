import type { Metadata } from 'next';

import BrowserJournalRecovery from '@/components/browser-journal-recovery';
import BrowserJournalSync from '@/components/browser-journal-sync';
import Dashboard from '@/components/dashboard';
import ErrorScreen from '@/components/error-screen';
import { findJournalGroupById, getJournalDataByGroupId } from '@/lib/journal';
import type { JournalData } from '@/lib/types';
import { getCachedPublicJournalMd5, getPublicSourceForGroupPath } from '@/lib/yandex-disk';

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
    const group = await findJournalGroupById(id).catch(() => null);
    const source = group?.source === 'yandex-public-cache'
      ? getPublicSourceForGroupPath(group.filePath)
      : null;
    const cachedMd5 = group && source ? await getCachedPublicJournalMd5(group.filePath).catch(() => null) : null;

    return (
      <>
        <Dashboard data={data} backHref="/" backLabel="Все группы" />
        {group && source && cachedMd5 && (
          <BrowserJournalSync
            groupId={group.id}
            publicUrl={source.publicUrl}
            publicPath={source.publicPath}
            cachedMd5={cachedMd5}
          />
        )}
      </>
    );
  }

  let recoveryGroup: Awaited<ReturnType<typeof findJournalGroupById>> = null;
  let publicSource: ReturnType<typeof getPublicSourceForGroupPath> = null;
  try {
    recoveryGroup = await findJournalGroupById(id);
    publicSource = recoveryGroup?.source === 'yandex-public-cache'
      ? getPublicSourceForGroupPath(recoveryGroup.filePath)
      : null;
  } catch {
    // Если список групп тоже недоступен, показываем обычную ошибку ниже.
  }

  if (recoveryGroup && publicSource) {
    return (
      <BrowserJournalRecovery
        groupId={recoveryGroup.id}
        groupName={recoveryGroup.groupName}
        publicUrl={publicSource.publicUrl}
        publicPath={publicSource.publicPath}
      />
    );
  }

  const temporaryDownloadError = /\b(?:429|5\d{2})\b|fetch failed|timed?\s*out/i.test(errorMessage ?? '');

  return (
    <ErrorScreen
      kicker="Ошибка загрузки журнала"
      title="Не удалось открыть группу"
      hint={
        temporaryDownloadError ? (
          <>Яндекс.Диск временно не отдал файл. Обнови страницу позже — сайт повторит загрузку.</>
        ) : (
          <>
            Проверь, открывается ли Excel-файл этой группы по публичной ссылке, и переменную{' '}
            <code>YANDEX_DISK_PUBLIC_URLS</code> в настройках сервера.
          </>
        )
      }
      details={errorMessage ?? 'Неизвестная ошибка'}
    />
  );
}
