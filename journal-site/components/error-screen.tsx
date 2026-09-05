import type { ReactNode } from 'react';

interface ErrorScreenProps {
  kicker: string;
  title: string;
  hint: ReactNode;
  details: string;
}

export default function ErrorScreen({ kicker, title, hint, details }: ErrorScreenProps) {
  return (
    <main className="error-page">
      <section className="error-card">
        <div className="kicker">{kicker}</div>
        <h1 className="title">{title}</h1>
        <p className="subtitle">{hint}</p>
        <code className="code">{details}</code>
      </section>
    </main>
  );
}
