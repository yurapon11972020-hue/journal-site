import { NextResponse } from 'next/server';

import { setWebhook } from '@/lib/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const forwardedHost = request.headers.get('x-forwarded-host') || requestUrl.host;
    const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
    const webhookUrl = `${forwardedProto}://${forwardedHost}/api/telegram`;

    const result = await setWebhook(webhookUrl);

    return NextResponse.json({
      ok: result.ok,
      webhook: webhookUrl,
      telegram: result.description,
      next_step: result.ok
        ? 'Готово! Открой своего бота в Telegram и нажми /start.'
        : 'Проверь, что TELEGRAM_BOT_TOKEN задан в переменных окружения на Render.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
