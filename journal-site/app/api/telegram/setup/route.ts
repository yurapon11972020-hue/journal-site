import { NextResponse } from 'next/server';
import { setWebhook, getWebhookSecret } from '@/lib/telegram';
import { getAccessGrant, isAccessConfigured, tokenFromRequest } from '@/lib/access';
import { isSameOrigin } from '@/lib/rate-limit';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const grant = await getAccessGrant(tokenFromRequest(request));
  // Открытый журнал (когда коды не настроены) не даёт права настраивать бота:
  // для этого нужен именно код администратора, JOURNAL_ADMIN_CODE.
  if (!isAccessConfigured() || grant?.scope !== '*' || !isSameOrigin(request)) {
    return NextResponse.json({ error: 'Недостаточно прав.' }, { status: 403 });
  }
  const raw = process.env.PUBLIC_SITE_URL?.trim();
  if (!raw || !getWebhookSecret()) return NextResponse.json({ error: 'Настройте адрес сайта и секрет webhook.' }, { status: 503 });
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) throw new Error('invalid');
    const result = await setWebhook(new URL('/api/telegram', url).href);
    return NextResponse.json({ ok: result.ok }, { status: result.ok ? 200 : 502, headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return NextResponse.json({ error: 'Не удалось настроить webhook.' }, { status: 502 }); }
}
