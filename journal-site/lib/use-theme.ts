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

function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (value === 'light' || value === 'dark') return value;
  } catch {
    // Некоторые встроенные браузеры запрещают localStorage.
  }
  try {
    const value = (`; ${document.cookie}`).split(`; ${THEME_STORAGE_KEY}=`)[1]?.split(';')[0];
    if (value === 'light' || value === 'dark') return value;
  } catch {
    // В таком случае используем тему устройства без сохранения.
  }
  return null;
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Встроенный браузер может запрещать localStorage; ниже остаётся cookie.
  }
  try {
    document.cookie = `${THEME_STORAGE_KEY}=${theme}; Max-Age=31536000; Path=/; SameSite=Lax`;
  } catch {
    // Приватный режим может запрещать и cookie.
  }
  emit();
}

/** Тема Telegram применяется, только пока пользователь не выбрал свою. */
export function applyTelegramTheme(theme: Theme): void {
  if (storedTheme()) return;
  document.documentElement.dataset.theme = theme;
  emit();
}

/** Восстанавливает оформление после гидратации, если React убрал атрибут с <html>. */
export function restoreTheme(): void {
  let theme = storedTheme();
  if (!theme) {
    try {
      theme = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch {
      theme = 'light';
    }
  }
  document.documentElement.dataset.theme = theme;
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
export const THEME_BOOTSTRAP_SCRIPT = `(function(){var t;try{t=localStorage.getItem('${THEME_STORAGE_KEY}')}catch(e){}if(t!=='light'&&t!=='dark'){try{t=('; '+document.cookie).split('; ${THEME_STORAGE_KEY}=')[1]?.split(';')[0]}catch(e){}}if(t!=='light'&&t!=='dark'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t})()`;
