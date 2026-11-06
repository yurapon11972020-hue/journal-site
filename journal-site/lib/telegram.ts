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

interface TelegramCall<T> {
  result: T | null;
  /** HTTP-статус ответа; 0 — ответа не было (сеть, тайм-аут). */
  status: number;
}

async function tgCall<T>(method: string, payload: Record<string, unknown>, timeoutMs?: number): Promise<TelegramCall<T>> {
  const token = getBotToken();
  try {
    const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
    });

    const data = (await response.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;

    if (!data?.ok) {
      console.error(`[telegram] ${method} failed:`, data?.description || response.status);
      return { result: null, status: response.status };
    }

    return { result: data.result ?? null, status: response.status };
  } catch (error) {
    console.error(`[telegram] ${method} error:`, error);
    return { result: null, status: 0 };
  }
}

async function tg<T = unknown>(method: string, payload: Record<string, unknown>, timeoutMs?: number): Promise<T | null> {
  return (await tgCall<T>(method, payload, timeoutMs)).result;
}

/** HTML-виджет (HTMLBubbles) и подпись к нему для старых клиентов и списка чатов. */
export interface WidgetPayload {
  html: string;
  caption?: string;
}

/** Пока Telegram отвечает «метода нет», не дёргаем его на каждое сообщение. */
const WIDGET_API_PAUSE_MS = 15 * 60 * 1000;
let widgetApiPausedUntil = 0;

/**
 * Отправляет виджет (метод sendWidget из Bot API 10.4).
 * false — Telegram виджет не принял, и вызывающий отправляет обычный текст.
 */
export async function sendWidget(chatId: number, widget: WidgetPayload, buttons?: InlineButton[][]): Promise<boolean> {
  if (Date.now() < widgetApiPausedUntil) return false;

  const { result, status } = await tgCall<{ message_id?: number }>('sendWidget', {
    chat_id: chatId,
    html: widget.html,
    caption: widget.caption || undefined,
    parse_mode: widget.caption ? 'HTML' : undefined,
    reply_markup: buttons ? { inline_keyboard: buttons } : undefined,
  }, 10_000);

  if (status === 404) {
    widgetApiPausedUntil = Date.now() + WIDGET_API_PAUSE_MS;
  }
  return result !== null;
}

/** Только для тестов: снять паузу после ответа «метода нет». */
export function resetWidgetApiPauseForTests(): void {
  widgetApiPausedUntil = 0;
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

/** Возвращает результат доставки: напоминание нельзя помечать отправленным после ошибки API. */
export async function sendMessageChecked(chatId: number, text: string, buttons?: InlineButton[][]): Promise<boolean> {
  const result = await tg('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: buttons ? { inline_keyboard: buttons } : undefined,
  }, 10_000);
  return result !== null;
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

/** Убирает сообщение с паролем из личного чата, если Telegram разрешает удаление. */
export async function deleteMessage(chatId: number, messageId: number): Promise<boolean> {
  return (await tg('deleteMessage', { chat_id: chatId, message_id: messageId }, 10_000)) === true;
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

/** Сравнение за одинаковое время: по скорости ответа секрет подобрать нельзя. */
export function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return diff === 0;
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
