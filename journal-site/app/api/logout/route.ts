import { NextResponse } from 'next/server';
import { ACCESS_COOKIE_NAME } from '@/lib/access';
import { isSameOrigin, requestOrigin } from '@/lib/rate-limit';
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Недопустимый источник запроса.' }, { status: 403 });
  const response = NextResponse.redirect(new URL('/login', requestOrigin(request)), { status: 303 });
  response.cookies.set(ACCESS_COOKIE_NAME, '', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 0 });
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Clear-Site-Data', '"cache"');
  return response;
}
