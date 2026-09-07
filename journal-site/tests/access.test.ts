import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildAccessToken, isAccessCodeEnabled, isValidAccessCode, isValidAccessToken, getAccessGrant, safeNextPath } from '@/lib/access';

afterEach(() => {
  delete process.env.JOURNAL_ACCESS_CODE;
  delete process.env.JOURNAL_GROUP_ACCESS_CODES;
  vi.useRealTimers();
});

describe('вход по коду', () => {
  // Закрытый журнал без единого настроенного кода означал бы, что войти
  // не может никто, включая куратора. Поэтому без кодов journal открыт,
  // как и работал до появления входа.
  it('без настроенных кодов журнал открыт всем', async () => {
    expect(isAccessCodeEnabled()).toBe(false);
    await expect(isValidAccessToken(undefined)).resolves.toBe(true);
    await expect(getAccessGrant(undefined)).resolves.toEqual({ scope: '*' });
  });

  it('как только код задан, журнал закрывается', async () => {
    process.env.JOURNAL_ACCESS_CODE = 'исип-2025-код';

    expect(isAccessCodeEnabled()).toBe(true);
    await expect(isValidAccessToken(undefined)).resolves.toBe(false);
    await expect(isValidAccessToken('мусор')).resolves.toBe(false);
  });

  it('с переменной пускает только по верному коду', async () => {
    process.env.JOURNAL_ACCESS_CODE = 'исип-2025';

    expect(isAccessCodeEnabled()).toBe(true);
    await expect(isValidAccessCode('исип-2025')).resolves.toBe(true);
    await expect(isValidAccessCode('исип-2024')).resolves.toBe(false);
    await expect(isValidAccessCode('')).resolves.toBe(false);
  });

  it('cookie подписан, имеет срок и не содержит код', async () => {
    process.env.JOURNAL_ACCESS_CODE = 'секретный-код';
    const token = await buildAccessToken('секретный-код');

    expect(token).not.toContain('секрет');
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    await expect(isValidAccessToken(token)).resolves.toBe(true);
    await expect(isValidAccessToken('нетакой')).resolves.toBe(false);
    await expect(isValidAccessToken(undefined)).resolves.toBe(false);
  });

  it('лишние пробелы вокруг кода не мешают войти', async () => {
    process.env.JOURNAL_ACCESS_CODE = '  код-группы  ';
    await expect(isValidAccessCode('код-группы')).resolves.toBe(true);
  });

  it('подмена scope и истечение срока не дают доступ', async () => {
    process.env.JOURNAL_GROUP_ACCESS_CODES = JSON.stringify({ 'Группа А': 'abcdefgh', 'Группа Б': 'ijklmnop' });
    const token = await buildAccessToken('abcdefgh');
    expect(await getAccessGrant(token)).toEqual({ scope: 'Группа А' });
    expect(await getAccessGrant(token + 'x')).toBeNull();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 8 * 24 * 60 * 60 * 1000);
    expect(await getAccessGrant(token)).toBeNull();
  });

  it('смена кода отзывает старую сессию', async () => {
    process.env.JOURNAL_ACCESS_CODE = 'old-code-123';
    const token = await buildAccessToken('old-code-123');
    process.env.JOURNAL_ACCESS_CODE = 'new-code-123';
    expect(await getAccessGrant(token)).toBeNull();
  });

  it.each(['//evil.test', '/\\evil.test', 'https://evil.test', '/\n/evil.test'])('безопасный redirect: %s', (value) => {
    expect(safeNextPath(value)).toBe('/');
  });
});
