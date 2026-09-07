import { NextResponse } from 'next/server';

import {
  ACCESS_COOKIE_MAX_AGE_SECONDS,
  ACCESS_COOKIE_NAME,
  buildAccessToken,
  isAccessConfigured,
  isValidAccessCode,
  safeNextPath,
} from '@/lib/access';
import { isSameOrigin, withinRateLimit, requestOrigin } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function redirectTo(request: Request, target: string): NextResponse {
  return NextResponse.redirect(new URL(target, requestOrigin(request)), { status: 303 });
}

/** Разрешаем возврат только на свои же страницы, чтобы форму нельзя было увести на чужой сайт. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Недопустимый источник запроса.' }, { status: 403 });
  if (!isAccessConfigured()) return NextResponse.json({ error: 'Доступ ещё не настроен.' }, { status: 503 });
  if (!withinRateLimit('login-global', 30, 60000)) return NextResponse.json({ error: 'Слишком много попыток. Подождите минуту.' }, { status: 429, headers: { 'Retry-After': '60' } });

  const form = await request.formData().catch(() => null);
  const candidate = typeof form?.get('code') === 'string' ? String(form.get('code')) : '';
  const nextPath = safeNextPath(form?.get('next') ?? null);

  if (!(await isValidAccessCode(candidate))) {
    const retry = new URL('/login', requestOrigin(request));
    retry.searchParams.set('error', '1');
    if (nextPath !== '/') {
      retry.searchParams.set('next', nextPath);
    }
    return NextResponse.redirect(retry, { status: 303 });
  }

  const response = redirectTo(request, nextPath);
  response.headers.set('Cache-Control', 'private, no-store');
  response.cookies.set({
    name: ACCESS_COOKIE_NAME,
    value: await buildAccessToken(candidate),
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ACCESS_COOKIE_MAX_AGE_SECONDS,
  });

  return response;
}
