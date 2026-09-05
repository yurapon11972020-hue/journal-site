import { afterEach, describe, expect, it } from 'vitest';

import { buildAccessToken, isAccessCodeEnabled, isValidAccessCode, isValidAccessToken } from '@/lib/access';

afterEach(() => {
  delete process.env.JOURNAL_ACCESS_CODE;
});

describe('вход по коду', () => {
  it('без переменной сайт открыт всем, как раньше', async () => {
    expect(isAccessCodeEnabled()).toBe(false);
    await expect(isValidAccessToken(undefined)).resolves.toBe(true);
  });

  it('с переменной пускает только по верному коду', async () => {
    process.env.JOURNAL_ACCESS_CODE = 'исип-2025';

    expect(isAccessCodeEnabled()).toBe(true);
    await expect(isValidAccessCode('исип-2025')).resolves.toBe(true);
    await expect(isValidAccessCode('исип-2024')).resolves.toBe(false);
    await expect(isValidAccessCode('')).resolves.toBe(false);
  });

  it('в cookie попадает хэш, а не сам код', async () => {
    process.env.JOURNAL_ACCESS_CODE = 'секрет';
    const token = await buildAccessToken('секрет');

    expect(token).not.toContain('секрет');
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    await expect(isValidAccessToken(token)).resolves.toBe(true);
    await expect(isValidAccessToken('нетакой')).resolves.toBe(false);
    await expect(isValidAccessToken(undefined)).resolves.toBe(false);
  });

  it('лишние пробелы вокруг кода не мешают войти', async () => {
    process.env.JOURNAL_ACCESS_CODE = '  код-группы  ';
    await expect(isValidAccessCode('код-группы')).resolves.toBe(true);
  });
});
