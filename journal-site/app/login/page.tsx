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
    <main className="auth">
      <form className="auth__card" method="post" action="/api/login">
        <div className="auth__logo" aria-hidden>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
            <path d="M12 3 2 8l10 5 10-5-10-5Z" />
            <path d="M5 10.5V16c0 1.7 3.1 3 7 3s7-1.3 7-3v-5.5" />
          </svg>
        </div>

        <h1 className="auth__title">Вход в электронный журнал</h1>
        <p className="auth__text">Введи код доступа, который выдал куратор группы.</p>

        <input type="hidden" name="next" value={nextPath} />

        <label className="field" htmlFor="access-code">
          <span className="field__label">Код доступа</span>
          <input
            id="access-code"
            name="code"
            type="password"
            className="input"
            autoComplete="current-password"
            autoFocus
            required
            aria-describedby={error ? 'access-code-error' : undefined}
          />
        </label>

        {error ? (
          <p className="auth__error" id="access-code-error" role="alert">
            Неверный код. Проверь раскладку и попробуй ещё раз.
          </p>
        ) : null}

        <button type="submit" className="btn btn--primary btn--block" style={{ marginTop: 16, minHeight: 40 }}>
          Войти
        </button>
      </form>
    </main>
  );
}
