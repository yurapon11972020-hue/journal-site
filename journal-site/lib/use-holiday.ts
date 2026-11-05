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

    try {
      const season = holidaySeason(new Date());
      if (next === 'off' && season) {
        window.localStorage.setItem(HOLIDAY_STORAGE_KEY, season);
      } else {
        window.localStorage.removeItem(HOLIDAY_STORAGE_KEY);
      }
    } catch {
      // Приватный режим может запрещать localStorage — выбор просто не запомнится.
    }

    for (const listener of listeners) {
      listener();
    }
  }, []);

  return { holiday, toggleHoliday };
}
