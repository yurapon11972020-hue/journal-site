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
            Проверь публичные ссылки на Яндекс.Диск в переменной <code>YANDEX_DISK_PUBLIC_URLS</code>{' '}
            (локально — в <code>.env.local</code>, на Render — в разделе Environment).
          </p>
          <code className="code">{message}</code>
        </section>
      </main>
    );
  }
}
