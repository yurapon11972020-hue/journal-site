import { generateKeyPairSync, sign } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { LECTURE_CRON_AUDIENCE, verifyLectureCronToken } from '@/lib/lecture-cron-auth';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const kid = 'test-github-key';
const now = Date.UTC(2026, 9, 20, 12, 0, 0);
const nowSeconds = Math.floor(now / 1_000);
const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: 'https://token.actions.githubusercontent.com',
    aud: LECTURE_CRON_AUDIENCE,
    exp: nowSeconds + 300,
    nbf: nowSeconds - 30,
    iat: nowSeconds - 30,
    repository: 'yurapon11972020-hue/journal-site',
    ref: 'refs/heads/main',
    workflow_ref: 'yurapon11972020-hue/journal-site/.github/workflows/lecture-reminders.yml@refs/heads/main',
    sub: 'repo:yurapon11972020-hue/journal-site:ref:refs/heads/main',
    event_name: 'schedule',
    ...overrides,
  };
}

function token(payload = claims(), keyId = kid): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: keyId })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signed = `${header}.${body}`;
  const signature = sign('RSA-SHA256', Buffer.from(signed), privateKey).toString('base64url');
  return `${signed}.${signature}`;
}

beforeAll(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    expect(url).toBe('https://token.actions.githubusercontent.com/.well-known/jwks');
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  }));
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('планировщик лекций: GitHub OIDC', () => {
  it('принимает подписанный токен только нашего запланированного или ручного запуска', async () => {
    expect(await verifyLectureCronToken(token(), now)).toBe(true);
    expect(await verifyLectureCronToken(token(claims({ event_name: 'workflow_dispatch' })), now)).toBe(true);
  });

  it('отклоняет чужой репозиторий, ветку, рабочий процесс и аудиторию', async () => {
    for (const changed of [
      { repository: 'another/repo' },
      { ref: 'refs/heads/another' },
      { workflow_ref: 'yurapon11972020-hue/journal-site/.github/workflows/other.yml@refs/heads/main' },
      { aud: 'https://another.example/api/lecture-reminders/run' },
      { event_name: 'pull_request' },
    ]) {
      expect(await verifyLectureCronToken(token(claims(changed)), now)).toBe(false);
    }
  });

  it('отклоняет просроченный и изменённый после подписи токен', async () => {
    expect(await verifyLectureCronToken(token(claims({ exp: nowSeconds - 1 })), now)).toBe(false);

    const signed = token();
    const parts = signed.split('.');
    parts[1] = Buffer.from(JSON.stringify(claims({ event_name: 'workflow_dispatch' }))).toString('base64url');
    expect(await verifyLectureCronToken(parts.join('.'), now)).toBe(false);
  });

  it('отклоняет неизвестный ключ подписи и неверный алгоритм', async () => {
    expect(await verifyLectureCronToken(token(claims(), 'unknown-key'), now)).toBe(false);
    const parts = token().split('.');
    parts[0] = Buffer.from(JSON.stringify({ alg: 'none', kid })).toString('base64url');
    expect(await verifyLectureCronToken(parts.join('.'), now)).toBe(false);
  });
});
