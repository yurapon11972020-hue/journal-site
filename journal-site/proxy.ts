import { NextResponse, type NextRequest } from 'next/server';

import { ACCESS_COOKIE_NAME, isValidAccessToken } from '@/lib/access';

export async function proxy(request: NextRequest) {
  if (['/login', '/api/login', '/api/logout', '/api/telegram'].includes(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
  if (await isValidAccessToken(token)) {
    return NextResponse.next();
  }
  if (request.nextUrl.pathname.startsWith('/api/')) return NextResponse.json({ code: 'JOURNAL_AUTH_REQUIRED', error: 'Войдите по коду своей группы.' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } });

  const loginUrl = new URL('/login', request.url);
  const target = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (target && target !== '/') {
    loginUrl.searchParams.set('next', target);
  }

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    /*
     * Проверяем всё, кроме:
     * - /login и /api/login — иначе вход стал бы недостижим;
     * - /api/telegram — вебхук вызывает Telegram, а не человек с cookie;
     * - служебных файлов Next.js и картинок.
     */
    '/((?!_next/static|_next/image|favicon.ico|hero.jpg).*)',
  ],
};
