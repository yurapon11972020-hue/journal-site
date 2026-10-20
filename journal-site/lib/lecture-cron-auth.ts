import { createPublicKey, verify } from 'node:crypto';

/** GitHub Actions может запустить проверку без общего секрета с Render. */
export const LECTURE_CRON_AUDIENCE = 'https://journal-site-yfev.onrender.com/api/lecture-reminders/run';

const ISSUER = 'https://token.actions.githubusercontent.com';
const JWKS_URL = `${ISSUER}/.well-known/jwks`;
const REPOSITORY = 'yurapon11972020-hue/journal-site';
const MAIN_REF = 'refs/heads/main';
const WORKFLOW_REF = `${REPOSITORY}/.github/workflows/lecture-reminders.yml@${MAIN_REF}`;
const JWKS_TTL_MS = 60 * 60 * 1000;
const UNKNOWN_KEY_REFRESH_MS = 5 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 60;

interface SigningKey extends JsonWebKey {
  kid?: string;
  alg?: string;
  use?: string;
}

interface TokenHeader {
  alg?: unknown;
  kid?: unknown;
}

interface TokenClaims {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  nbf?: unknown;
  iat?: unknown;
  repository?: unknown;
  ref?: unknown;
  workflow_ref?: unknown;
  event_name?: unknown;
  sub?: unknown;
}

let cachedKeys: { keys: SigningKey[]; fetchedAt: number; expiresAt: number } | null = null;

function decodeJsonPart(part: string): Record<string, unknown> | null {
  if (!part || part.length > 16_384 || !/^[A-Za-z0-9_-]+$/.test(part)) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function readSigningKeys(forceRefresh = false): Promise<SigningKey[]> {
  if (!forceRefresh && cachedKeys && cachedKeys.expiresAt > Date.now()) {
    return cachedKeys.keys;
  }

  const response = await fetch(JWKS_URL, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub JWKS returned ${response.status}`);
  }

  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || !('keys' in body) || !Array.isArray(body.keys)) {
    throw new Error('GitHub JWKS is missing keys');
  }

  const keys = body.keys.filter((key: unknown): key is SigningKey =>
    Boolean(key && typeof key === 'object' && 'kid' in key && typeof key.kid === 'string'),
  );
  if (!keys.length) {
    throw new Error('GitHub JWKS has no signing keys');
  }

  const fetchedAt = Date.now();
  cachedKeys = { keys, fetchedAt, expiresAt: fetchedAt + JWKS_TTL_MS };
  return keys;
}

function validClaims(claims: TokenClaims, nowSeconds: number): boolean {
  const audience = claims.aud;
  const validAudience = audience === LECTURE_CRON_AUDIENCE ||
    (Array.isArray(audience) && audience.includes(LECTURE_CRON_AUDIENCE));

  return claims.iss === ISSUER &&
    validAudience &&
    Number.isSafeInteger(claims.exp) &&
    Number.isSafeInteger(claims.nbf) &&
    Number.isSafeInteger(claims.iat) &&
    (claims.exp as number) > nowSeconds &&
    (claims.nbf as number) <= nowSeconds + CLOCK_SKEW_SECONDS &&
    (claims.iat as number) <= nowSeconds + CLOCK_SKEW_SECONDS &&
    claims.repository === REPOSITORY &&
    claims.ref === MAIN_REF &&
    claims.workflow_ref === WORKFLOW_REF &&
    claims.sub === `repo:${REPOSITORY}:ref:${MAIN_REF}` &&
    (claims.event_name === 'schedule' || claims.event_name === 'workflow_dispatch');
}

/** Разрешает только подписанный GitHub-токен именно нашего рабочего процесса. */
export async function verifyLectureCronToken(token: string, now = Date.now()): Promise<boolean> {
  if (!token || token.length > 16_384) {
    return false;
  }

  const parts = token.split('.');
  if (parts.length !== 3 || !parts[2] || !/^[A-Za-z0-9_-]+$/.test(parts[2])) {
    return false;
  }

  const header = decodeJsonPart(parts[0]) as TokenHeader | null;
  const claims = decodeJsonPart(parts[1]) as TokenClaims | null;
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid || !claims) {
    return false;
  }

  if (!validClaims(claims, Math.floor(now / 1_000))) {
    return false;
  }

  try {
    let keys = await readSigningKeys();
    let key = keys.find((item) => item.kid === header.kid);
    if (!key && cachedKeys && Date.now() - cachedKeys.fetchedAt >= UNKNOWN_KEY_REFRESH_MS) {
      // GitHub мог сменить ключ. Частые неподписанные запросы не должны
      // заставлять сервер каждый раз обращаться к JWKS.
      keys = await readSigningKeys(true);
      key = keys.find((item) => item.kid === header.kid);
    }
    if (!key || key.kty !== 'RSA' || (key.alg && key.alg !== 'RS256') || (key.use && key.use !== 'sig')) {
      return false;
    }

    return verify(
      'RSA-SHA256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      createPublicKey({ key, format: 'jwk' }),
      Buffer.from(parts[2], 'base64url'),
    );
  } catch (error) {
    console.error('[lecture-reminders] Cannot verify GitHub OIDC token:', error);
    return false;
  }
}
