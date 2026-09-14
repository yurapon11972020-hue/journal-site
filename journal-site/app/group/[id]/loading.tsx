/**
 * Скелетон повторяет настоящую страницу группы: меню слева, панель сверху,
 * ряд показателей и таблица предметов. Так переход не «прыгает».
 */
export default function GroupLoading() {
  return (
    <div className="shell">
      <nav className="sidebar" aria-hidden>
        <div className="sidebar__brand">
          <span className="skel" style={{ width: 30, height: 30, borderRadius: 6 }} />
          <span style={{ display: 'grid', gap: 5 }}>
            <span className="skel" style={{ width: 104, height: 11 }} />
            <span className="skel" style={{ width: 76, height: 9 }} />
          </span>
        </div>
        <div className="sidebar__scroll">
          {[64, 52, 88, 80, 70, 76].map((width, index) => (
            <div className="navitem" key={index}>
              <span className="skel" style={{ width: 18, height: 18, borderRadius: 4 }} />
              <span className="skel" style={{ width, height: 11 }} />
            </div>
          ))}
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          <span className="skel" style={{ width: 190, height: 12 }} />
          <span className="topbar__right">
            <span className="skel" style={{ width: 30, height: 30, borderRadius: '50%' }} />
          </span>
        </header>

        <main className="content content--narrow">
          <div className="page-head">
            <div style={{ display: 'grid', gap: 8 }}>
              <span className="skel" style={{ width: 150, height: 22 }} />
              <span className="skel" style={{ width: 230, height: 12 }} />
            </div>
          </div>

          <div className="metrics" style={{ marginBottom: 16 }}>
            {[0, 1, 2, 3, 4].map((index) => (
              <div className="metric" key={index}>
                <span className="skel" style={{ display: 'block', width: 84, height: 10 }} />
                <span className="skel" style={{ display: 'block', width: 52, height: 22, marginTop: 8 }} />
              </div>
            ))}
          </div>

          <section className="card">
            <div className="card__head">
              <span className="skel" style={{ width: 96, height: 13 }} />
            </div>
            <div style={{ padding: '4px 16px 12px' }}>
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <div
                  key={index}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0' }}
                >
                  <span className="skel" style={{ flex: 1, height: 12, maxWidth: 340 }} />
                  <span className="skel" style={{ width: 34, height: 20, borderRadius: 4 }} />
                  <span className="skel" style={{ width: 34, height: 20, borderRadius: 4 }} />
                </div>
              ))}
            </div>
          </section>

          <p className="page-head__sub" style={{ marginTop: 14 }}>
            Открываем журнал. Первое открытие после простоя занимает чуть дольше — дальше страница грузится быстро.
          </p>
        </main>
      </div>
    </div>
  );
}
