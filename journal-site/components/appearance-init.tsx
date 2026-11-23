'use client';

import { useEffect } from 'react';

import { restoreHoliday } from '@/lib/use-holiday';
import { restoreTheme } from '@/lib/use-theme';

export default function AppearanceInit() {
  useEffect(() => {
    restoreTheme();
    restoreHoliday();
  }, []);

  return null;
}
