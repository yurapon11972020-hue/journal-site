import { NextResponse } from 'next/server';

import {
  ACCESS_COOKIE_MAX_AGE_SECONDS,
  ACCESS_COOKIE_NAME,
  buildAccessToken,
  getAccessCode,
  isValidAccessCode,
} from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function redirectTo(request: Request, target: string): NextResponse {
  return NextResponse.redirect(new URL(target, request.url), { status: 303 });
}

/** Разрешаем возврат только на свои же страницы, чтобы форму нельзя было увести на чужой сайт. */
function safeNextPath(value: FormDataEntryValue | null): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
}

export async function POST(request: Request) {
  const code = getAccessCode();
  if (!code) {
    return redirectTo(request, '/');
  }

  const form = await request.formData().catch(() => null);
  const candidate = typeof form?.get('code') === 'string' ? String(form.get('code')) : '';
  const nextPath = safeNextPath(form?.get('next') ?? null);

  if (!(await isValidAccessCode(candidate))) {
    const retry = new URL('/login', request.url);
    retry.searchParams.set('error', '1');
    if (nextPath !== '/') {
      retry.searchParams.set('next', nextPath);
    }
    return NextResponse.redirect(retry, { status: 303 });
  }

  const response = redirectTo(request, nextPath);
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
