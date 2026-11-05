import { afterEach, describe, expect, it, vi } from 'vitest';

import { HOLIDAY_BOOTSTRAP_SCRIPT, HOLIDAY_STORAGE_KEY, holidaySeason } from '@/lib/holiday';

afterEach(() => {
  vi.useRealTimers();
});

describe('новогодний сезон', () => {
  it('идёт с 1 ноября по 14 января и называется годом начала', () => {
    expect(holidaySeason(new Date(2026, 9, 31))).toBeNull();
    expect(holidaySeason(new Date(2026, 10, 1))).toBe('2026');
    expect(holidaySeason(new Date(2026, 11, 31, 23, 59))).toBe('2026');
    expect(holidaySeason(new Date(2027, 0, 1))).toBe('2026');
    expect(holidaySeason(new Date(2027, 0, 14, 23, 59))).toBe('2026');
    expect(holidaySeason(new Date(2027, 0, 15))).toBeNull();
    expect(holidaySeason(new Date(2027, 6, 1))).toBeNull();
  });
});

describe('скрипт украшений в <head>', () => {
  // Скрипт выполняется до React, поэтому проверяем его отдельно: он должен
  // считать сезон так же, как holidaySeason, и помнить выбор пользователя.
  function run(now: Date, stored: string | null, storageThrows = false): string | undefined {
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const documentElement = { dataset: {} as Record<string, string> };
    const localStorage = {
      getItem(key: string) {
        if (storageThrows) {
          throw new Error('localStorage запрещён');
        }
        return key === HOLIDAY_STORAGE_KEY ? stored : null;
      },
    };

    new Function('document', 'localStorage', HOLIDAY_BOOTSTRAP_SCRIPT)({ documentElement }, localStorage);
    return documentElement.dataset.holiday;
  }

  it('в сезон включает украшения', () => {
    expect(run(new Date(2026, 10, 5), null)).toBe('on');
    expect(run(new Date(2027, 0, 14), null)).toBe('on');
  });

  it('помнит, что украшения убрали в этом сезоне', () => {
    expect(run(new Date(2026, 11, 20), '2026')).toBe('off');
    expect(run(new Date(2027, 0, 10), '2026')).toBe('off');
  });

  it('в следующем сезоне возвращает украшения', () => {
    expect(run(new Date(2027, 10, 2), '2026')).toBe('on');
  });

  it('вне сезона не трогает страницу', () => {
    expect(run(new Date(2027, 0, 15), null)).toBeUndefined();
    expect(run(new Date(2027, 2, 1), '2026')).toBeUndefined();
  });

  it('без localStorage всё равно показывает украшения', () => {
    expect(run(new Date(2026, 10, 5), null, true)).toBe('on');
  });
});
