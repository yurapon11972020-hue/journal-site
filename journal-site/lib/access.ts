/**
 * Необязательный вход по коду.
 *
 * Пока переменная JOURNAL_ACCESS_CODE не задана, сайт работает как раньше —
 * открыт всем, у кого есть адрес. Если код задан, любая страница journal-сайта
 * сначала спрашивает его и запоминает в cookie.
 *
 * Код проверяется только на сервере. В cookie кладётся не сам код, а его хэш.
 */
export const ACCESS_COOKIE_NAME = 'journal-access';
export const ACCESS_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

export function getAccessCode(): string | null {
  return process.env.JOURNAL_ACCESS_CODE?.trim() || null;
}

export function isAccessCodeEnabled(): boolean {
  return getAccessCode() !== null;
}

function normalizeCode(code: string): string {
  return code.trim();
}

/** Работает и в Node, и в middleware: обе среды дают Web Crypto. */
export async function buildAccessToken(code: string): Promise<string> {
  const data = new TextEncoder().encode(`journal-access::${normalizeCode(code)}`);
  const digest = await crypto.subtle.digest('SHA-256', data);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Сравнение постоянного времени, чтобы по скорости ответа нельзя было подобрать значение. */
function safeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return diff === 0;
}

export async function isValidAccessToken(token: string | undefined): Promise<boolean> {
  const code = getAccessCode();

  if (!code) {
    return true;
  }

  if (!token) {
    return false;
  }

  return safeEquals(token, await buildAccessToken(code));
}

export async function isValidAccessCode(candidate: string): Promise<boolean> {
  const code = getAccessCode();

  if (!code) {
    return true;
  }

  return safeEquals(await buildAccessToken(candidate), await buildAccessToken(code));
}
