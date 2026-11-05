import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';

import HolidayDecor from '@/components/holiday-decor';
import TelegramInit from '@/components/telegram-init';
import { HOLIDAY_BOOTSTRAP_SCRIPT } from '@/lib/holiday';
import { THEME_BOOTSTRAP_SCRIPT } from '@/lib/use-theme';

// Один шрифт на весь интерфейс. Раздаётся со своего домена: нет обращения
// в Google из браузера и нет скачка вёрстки, пока шрифт грузится.
const inter = Inter({
  subsets: ['cyrillic', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Подпольный журнал',
  description: 'Оценки, пропуски и темы занятий учебной группы.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Тема выставляется до первой отрисовки, иначе светлая тема на мгновение мигает тёмной. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        {/* Так же до отрисовки решается, висят ли новогодние украшения. */}
        <script dangerouslySetInnerHTML={{ __html: HOLIDAY_BOOTSTRAP_SCRIPT }} />
      </head>
      <body>
        <TelegramInit />
        {children}
        <HolidayDecor />
      </body>
    </html>
  );
}
