'use client';

import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'journal-theme';

/**
 * Тема живёт в атрибуте data-theme на <html>: его выставляет маленький скрипт
 * в layout ещё до первой отрисовки, поэтому светлая тема не мигает тёмной.
 * React только читает это значение и переключает его по кнопке.
 */
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function readServerTheme(): Theme {
  return 'light';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Приватный режим браузера может запрещать localStorage — тема просто не запомнится.
  }
  emit();
}

export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const theme = useSyncExternalStore(subscribe, readTheme, readServerTheme);

  const toggleTheme = useCallback(() => {
    applyTheme(readTheme() === 'dark' ? 'light' : 'dark');
  }, []);

  return { theme, toggleTheme };
}

/**
 * Скрипт выставляет тему до первой отрисовки страницы.
 * Держим его строкой, чтобы вставить в <head> одним тегом.
 *
 * Свой выбор пользователя важнее всего; если его нет — берём настройку
 * системы, а по умолчанию светлую: журнал читают днём и с проектора.
 */
export const THEME_BOOTSTRAP_SCRIPT = `try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t!=='light'&&t!=='dark'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='light'}`;
