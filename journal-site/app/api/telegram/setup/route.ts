import { NextResponse } from 'next/server';

import { getWebhookSecret, setWebhook } from '@/lib/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    // Без секрета вебхук подключать нельзя: бот всё равно не станет отвечать,
    // а адрес окажется открыт для поддельных запросов.
    const secret = getWebhookSecret();

    // Телеграм принимает в секрете только латиницу, цифры, дефис и подчёркивание.
    if (secret && !/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'TELEGRAM_WEBHOOK_SECRET содержит недопустимые символы.',
          next_step:
            'Оставь в секрете только латинские буквы, цифры, дефис и подчёркивание — кириллицу Telegram не принимает.',
        },
        { status: 400 },
      );
    }

    if (!secret) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Не задан TELEGRAM_WEBHOOK_SECRET.',
          next_step:
            'Добавь на Render переменную TELEGRAM_WEBHOOK_SECRET с любой длинной случайной строкой, дождись перезапуска и открой эту страницу снова.',
        },
        { status: 503 },
      );
    }

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
