import Dashboard from '@/components/dashboard';
import { getJournalDataByGroupId } from '@/lib/journal';

export const dynamic = 'force-dynamic';

interface GroupPageProps {
  params: Promise<{
    id: string;
  }>;
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
            Проверь Excel-файл этой группы на Yandex Disk и настройки в <code>.env.local</code>.
          </p>
          <code className="code">{message}</code>
        </section>
      </main>
    );
  }
}
