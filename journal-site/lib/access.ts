export const ACCESS_COOKIE_NAME = 'journal-access';
export const ACCESS_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
export interface AccessGrant { scope: string; }
interface ConfiguredGrant extends AccessGrant { code: string; }

function grants(): ConfiguredGrant[] {
  const result: ConfiguredGrant[] = [];
  const raw = process.env.JOURNAL_GROUP_ACCESS_CODES?.trim();
  if (raw) {
    try {
      const values: unknown = JSON.parse(raw);
      if (!values || typeof values !== 'object' || Array.isArray(values)) return [];
      for (const [scope, code] of Object.entries(values)) {
        if (typeof code !== 'string' || code.trim().length < 8 || !scope || scope === '*') return [];
        result.push({ scope, code: code.trim() });
      }
    } catch { return []; }
  }
  const legacy = process.env.JOURNAL_ACCESS_CODE?.trim();
  if (legacy && legacy.length >= 8) result.push({ scope: '__single_group__', code: legacy });
  const admin = process.env.JOURNAL_ADMIN_CODE?.trim();
  if (admin && admin.length >= 16) result.push({ scope: '*', code: admin });
  return new Set(result.map((grant) => grant.code)).size === result.length ? result : [];
}

export function getAccessCode(): string | null { return process.env.JOURNAL_ACCESS_CODE?.trim() || null; }
export function isAccessConfigured(): boolean { return grants().length > 0; }

/**
 * Вход по коду включён только тогда, когда коды заданы.
 *
 * Пока ни один код не настроен, журнал открыт всем, у кого есть адрес —
 * так сайт работал до появления входа. Закрытый журнал без единого
 * рабочего кода означал бы, что внутрь не может попасть никто, включая
 * куратора: войти было бы нечем.
 */
export function isAccessCodeEnabled(): boolean { return isAccessConfigured(); }

/** Доступ ко всем группам, когда коды не настроены. */
const OPEN_GRANT: AccessGrant = { scope: '*' };

export function safeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

function encode(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function decode(text: string): string { return atob(text.replace(/-/g, '+').replace(/_/g, '/')); }
async function signature(payload: string, code: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode((process.env.JOURNAL_SESSION_SECRET || 'journal-v2') + '::' + code), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return encode(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload))));
}

export async function isValidAccessCode(candidate: string): Promise<boolean> {
  const value = candidate.trim();
  if (!value || value.length > 256) return false;
  const checks = await Promise.all(grants().map(async (grant) => safeEquals(await signature('login', grant.code), await signature('login', value))));
  return checks.some(Boolean);
}

export async function buildAccessToken(code: string): Promise<string> {
  const grant = grants().find((entry) => safeEquals(entry.code, code.trim()));
  if (!grant) throw new Error('Invalid access code');
  const payload = encode(new TextEncoder().encode(JSON.stringify({ scope: grant.scope, expires: Date.now() + ACCESS_COOKIE_MAX_AGE_SECONDS * 1000, nonce: crypto.randomUUID() })));
  return payload + '.' + await signature(payload, grant.code);
}

export async function getAccessGrant(token?: string): Promise<AccessGrant | null> {
  if (!isAccessConfigured()) return OPEN_GRANT;
  if (!token || token.length > 2048) return null;
  try {
    const [payload, sig, extra] = token.split('.');
    if (extra || !payload || !sig) return null;
    const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(decode(payload), (c) => c.charCodeAt(0)))) as { scope?: string; expires?: number };
    if (!parsed.expires || parsed.expires <= Date.now() || parsed.expires > Date.now() + ACCESS_COOKIE_MAX_AGE_SECONDS * 1000 + 60000) return null;
    const grant = grants().find((entry) => entry.scope === parsed.scope);
    if (!grant || !safeEquals(sig, await signature(payload, grant.code))) return null;
    return { scope: grant.scope };
  } catch { return null; }
}

export async function isValidAccessToken(token?: string): Promise<boolean> { return (await getAccessGrant(token)) !== null; }

export function safeNextPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || /[\\\u0000-\u0020]/.test(value)) return '/';
  try { const url = new URL(value, 'https://journal.invalid'); return url.origin === 'https://journal.invalid' ? url.pathname + url.search : '/'; } catch { return '/'; }
}

export function tokenFromRequest(request: Request): string | undefined {
  return request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(ACCESS_COOKIE_NAME + '='))?.slice(ACCESS_COOKIE_NAME.length + 1);
}
