import './globals.css';
import './redesign.css';
import './chrome.css';
import type { Metadata, Viewport } from 'next';
import { Manrope, Marck_Script, Oswald, UnifrakturMaguntia } from 'next/font/google';
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

// Узкий гротеск для заголовков: держит кириллицу и остаётся читаемым
// даже в названиях вроде «ИСиП-26-2».
const oswald = Oswald({
  subsets: ['cyrillic', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-oswald',
  display: 'swap',
});

// Настоящий готический шрифт. Кириллицы в нём нет, поэтому он идёт
// только на латинские надписи-украшения: логотип, годы, короткие слова.
const unifraktur = UnifrakturMaguntia({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-gothic-src',
  display: 'swap',
});

// Рукописный акцент — для подписей в одну строку, не для данных.
const marck = Marck_Script({
  subsets: ['cyrillic', 'latin'],
  weight: ['400'],
  variable: '--font-script-src',
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
    <html
      lang="ru"
      className={`${manrope.variable} ${oswald.variable} ${unifraktur.variable} ${marck.variable}`}
      suppressHydrationWarning
    >
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
