import { NextResponse, type NextRequest } from 'next/server';

import { ACCESS_COOKIE_NAME, isAccessCodeEnabled, isValidAccessToken } from '@/lib/access';

export async function middleware(request: NextRequest) {
  if (!isAccessCodeEnabled()) {
    return NextResponse.next();
  }

  const token = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
  if (await isValidAccessToken(token)) {
    return NextResponse.next();
  }

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
    '/((?!login|api/login|api/telegram|_next/static|_next/image|favicon.ico|hero.jpg).*)',
  ],
};
