import './globals.css';
import './redesign.css';
import type { Metadata, Viewport } from 'next';
import { Manrope, Unbounded } from 'next/font/google';
import type { ReactNode } from 'react';

import TelegramInit from '@/components/telegram-init';
import { THEME_BOOTSTRAP_SCRIPT } from '@/lib/use-theme';

// Шрифты раздаются со своего домена: нет обращения в Google из браузера
// и нет скачка вёрстки, пока шрифт грузится.
const manrope = Manrope({
  subsets: ['cyrillic', 'latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-manrope',
  display: 'swap',
});

const unbounded = Unbounded({
  subsets: ['cyrillic', 'latin'],
  weight: ['600', '700'],
  variable: '--font-unbounded',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Журнал группы',
  description: 'Сайт для просмотра оценок и пропусков из Excel-журнала.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className={`${manrope.variable} ${unbounded.variable}`} suppressHydrationWarning>
      <head>
        {/* Тема выставляется до первой отрисовки, иначе светлая тема на мгновение мигает тёмной. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body>
        <TelegramInit />
        {children}
      </body>
    </html>
  );
}
