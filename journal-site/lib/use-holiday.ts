'use client';

import { useCallback, useSyncExternalStore } from 'react';

import { HOLIDAY_STORAGE_KEY, holidaySeason } from '@/lib/holiday';

/** "none" — не сезон: кнопки украшений нет. */
export type HolidayState = 'on' | 'off' | 'none';

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readHoliday(): HolidayState {
  const value = document.documentElement.dataset.holiday;
  return value === 'on' || value === 'off' ? value : 'none';
}

function readServerHoliday(): HolidayState {
  return 'none';
}

/** Состояние украшений и кнопка «убрать / вернуть». Подробности в lib/holiday. */
export function useHoliday(): { holiday: HolidayState; toggleHoliday: () => void } {
  const holiday = useSyncExternalStore(subscribe, readHoliday, readServerHoliday);

  const toggleHoliday = useCallback(() => {
    const current = readHoliday();
    if (current === 'none') {
      return;
    }

    const next = current === 'on' ? 'off' : 'on';
    document.documentElement.dataset.holiday = next;
    const season = holidaySeason(new Date());

    try {
      if (next === 'off' && season) {
        window.localStorage.setItem(HOLIDAY_STORAGE_KEY, season);
      } else {
        window.localStorage.removeItem(HOLIDAY_STORAGE_KEY);
      }
    } catch {
      // Встроенный браузер может запрещать localStorage; ниже остаётся cookie.
    }

    try {
      document.cookie = next === 'off' && season
        ? `${HOLIDAY_STORAGE_KEY}=${season}; Max-Age=34560000; Path=/; SameSite=Lax`
        : `${HOLIDAY_STORAGE_KEY}=; Max-Age=0; Path=/; SameSite=Lax`;
    } catch {
      // Приватный режим может запрещать и cookie.
    }

    for (const listener of listeners) {
      listener();
    }
  }, []);

  return { holiday, toggleHoliday };
}
