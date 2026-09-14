import type { ReactNode } from 'react';

import { IconAlert } from '@/components/icons';

interface ErrorScreenProps {
  kicker: string;
  title: string;
  hint: ReactNode;
  details: string;
}

export default function ErrorScreen({ kicker, title, hint, details }: ErrorScreenProps) {
  return (
    <main className="errorpage">
      <section className="errorpage__card">
        <div className="errorpage__icon" aria-hidden>
          <IconAlert size={20} />
        </div>
        <div className="errorpage__kicker">{kicker}</div>
        <h1 className="errorpage__title">{title}</h1>
        <p className="errorpage__text">{hint}</p>
        <code className="errorpage__details">{details}</code>
      </section>
    </main>
  );
}
