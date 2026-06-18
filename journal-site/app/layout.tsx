import './globals.css';
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
      <body>
        <TelegramInit />
        {children}
      </body>
    </html>
  );
}
