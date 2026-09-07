import { redirect } from 'next/navigation';

import { isAccessCodeEnabled } from '@/lib/access';

export const dynamic = 'force-dynamic';

interface LoginPageProps {
  searchParams: Promise<{ next?: string; error?: string }>;
}

export const metadata = {
  title: 'Вход — журнал группы',
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  if (!isAccessCodeEnabled()) {
    redirect('/');
  }

  const { next, error } = await searchParams;
  const nextPath = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  return (
    <main className="login-page">
      <form className="login-card" method="post" action="/api/login">
        <div className="kicker">Электронный журнал</div>
        <h1 className="login-card__title">Вход по коду</h1>
        <p className="login-card__hint">Введи код доступа, который выдал куратор группы.</p>

        <input type="hidden" name="next" value={nextPath} />
        <label className="login-card__label" htmlFor="access-code">
          Код доступа
        </label>
        <input
          id="access-code"
          name="code"
          type="password"
          className="login-card__input"
          autoComplete="current-password"
          autoFocus
          required
        />

        {error ? (
          <p className="login-card__error" role="alert">
            Неверный код. Попробуй ещё раз.
          </p>
        ) : null}

        <button type="submit" className="login-card__submit">
          Войти
        </button>
      </form>
    </main>
  );
}
