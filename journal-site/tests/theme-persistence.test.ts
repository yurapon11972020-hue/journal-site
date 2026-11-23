import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyTelegramTheme, applyTheme, restoreTheme, THEME_BOOTSTRAP_SCRIPT, THEME_STORAGE_KEY } from '@/lib/use-theme';

afterEach(() => vi.unstubAllGlobals());

function runBootstrap(stored: string | null, cookie: string, systemDark = false): string | undefined {
  const document = { cookie, documentElement: { dataset: {} as Record<string, string> } };
  const localStorage = { getItem: () => stored };
  const window = { matchMedia: () => ({ matches: systemDark }) };
  new Function('document', 'localStorage', 'window', THEME_BOOTSTRAP_SCRIPT)(document, localStorage, window);
  return document.documentElement.dataset.theme;
}

describe('сохранение темы сайта', () => {
  it('выбор пользователя важнее темы устройства и Telegram', () => {
    expect(runBootstrap('dark', `${THEME_STORAGE_KEY}=light`)).toBe('dark');

    const document = { cookie: '', documentElement: { dataset: { theme: 'dark' } } };
    vi.stubGlobal('document', document);
    vi.stubGlobal('window', { localStorage: { getItem: () => 'dark' } });
    applyTelegramTheme('light');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('запоминает тему в cookie и восстанавливает её при недоступном localStorage', () => {
    const document = { cookie: '', documentElement: { dataset: { theme: 'light' } } };
    vi.stubGlobal('document', document);
    vi.stubGlobal('window', { localStorage: { setItem: () => { throw new Error('blocked'); } } });

    applyTheme('dark');
    expect(document.cookie).toContain(`${THEME_STORAGE_KEY}=dark`);

    const bootstrapDocument = { cookie: document.cookie, documentElement: { dataset: {} as Record<string, string> } };
    const blockedStorage = { getItem: () => { throw new Error('blocked'); } };
    new Function('document', 'localStorage', 'window', THEME_BOOTSTRAP_SCRIPT)(
      bootstrapDocument, blockedStorage, { matchMedia: () => ({ matches: false }) },
    );
    expect(bootstrapDocument.documentElement.dataset.theme).toBe('dark');
  });

  it('использует тему устройства, если своего выбора ещё нет', () => {
    expect(runBootstrap(null, '', true)).toBe('dark');
    expect(runBootstrap(null, '', false)).toBe('light');
  });

  it('возвращает выбранную тему, если она исчезла после загрузки React', () => {
    const document = { cookie: '', documentElement: { dataset: {} as Record<string, string> } };
    vi.stubGlobal('document', document);
    vi.stubGlobal('window', { localStorage: { getItem: () => 'dark' }, matchMedia: () => ({ matches: false }) });

    restoreTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
