import GroupsDashboard from '@/components/groups-dashboard';
import { getJournalGroups } from '@/lib/journal';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  try {
    const groups = await getJournalGroups();
    return <GroupsDashboard groups={groups} />;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';

    return (
      <main className="error-page">
        <section className="error-card">
          <div className="kicker">Ошибка загрузки списка групп</div>
          <h1 className="title">Сайт запустился, но не смог прочитать группы</h1>
          <p className="subtitle">
            Проверь папку с журналами на Yandex Disk и настройки в <code>.env.local</code>.
          </p>
          <code className="code">{message}</code>
        </section>
      </main>
    );
  }
}
