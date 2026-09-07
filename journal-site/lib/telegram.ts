const TELEGRAM_API = 'https://api.telegram.org';

export interface InlineButton {
  text: string;
  callback_data?: string;
  web_app?: { url: string };
}

export function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error('Не задан TELEGRAM_BOT_TOKEN. Добавь его в переменные окружения.');
  }
  return token;
}

export function getWebhookSecret(): string | undefined {
  return process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || undefined;
}

async function tg<T = unknown>(method: string, payload: Record<string, unknown>): Promise<T | null> {
  const token = getBotToken();
  try {
    const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    const data = (await response.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;

    if (!data?.ok) {
      console.error(`[telegram] ${method} failed:`, data?.description || response.status);
      return null;
    }

    return data.result ?? null;
  } catch (error) {
    console.error(`[telegram] ${method} error:`, error);
    return null;
  }
}

export async function sendMessage(chatId: number, text: string, buttons?: InlineButton[][]): Promise<void> {
  await tg('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: buttons ? { inline_keyboard: buttons } : undefined,
  });
}

export async function editMessage(chatId: number, messageId: number, text: string, buttons?: InlineButton[][]): Promise<boolean> {
  const result = await tg('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: buttons ? { inline_keyboard: buttons } : undefined,
  });
  return result !== null;
}

export async function answerCallback(callbackId: string, text?: string): Promise<void> {
  await tg('answerCallbackQuery', {
    callback_query_id: callbackId,
    text,
  });
}

export async function setWebhook(url: string): Promise<{ ok: boolean; description: string }> {
  const token = getBotToken();
  const payload: Record<string, unknown> = {
    url,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  };

  const secret = getWebhookSecret();
  if (secret) {
    payload.secret_token = secret;
  }

  const response = await fetch(`${TELEGRAM_API}/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });

  const data = (await response.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  return {
    ok: Boolean(data.ok),
    description: data.description || (data.ok ? 'Webhook установлен' : 'Не удалось установить webhook'),
  };
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
