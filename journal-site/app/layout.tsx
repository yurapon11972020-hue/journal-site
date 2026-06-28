import './globals.css';
import './redesign.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import TelegramInit from '@/components/telegram-init';

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
    <html lang="ru" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Unbounded:wght@600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <TelegramInit />
        {children}
      </body>
    </html>
  );
}
