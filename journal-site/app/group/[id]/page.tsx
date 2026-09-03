import type { Metadata } from 'next';

import Dashboard from '@/components/dashboard';
import { findJournalGroupById, getJournalDataByGroupId } from '@/lib/journal';

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

  try {
    const data = await getJournalDataByGroupId(id);
    return <Dashboard data={data} backHref="/" backLabel="Все группы" />;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';

    return (
      <main className="error-page">
        <section className="error-card">
          <div className="kicker">Ошибка загрузки журнала</div>
          <h1 className="title">Не удалось открыть группу</h1>
          <p className="subtitle">
            Проверь, открывается ли Excel-файл этой группы по публичной ссылке, и переменные{' '}
            <code>YANDEX_DISK_PUBLIC_URLS</code> в настройках сервера.
          </p>
          <code className="code">{message}</code>
        </section>
      </main>
    );
  }
}
