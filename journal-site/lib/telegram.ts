const TELEGRAM_API = 'https://api.telegram.org';
/**
 * Бета-сервер Bot API Telegram. Через него сам Telegram отправляет виджеты
 * (sendWidget), пока Bot API 10.4 не вышел на основном сервере.
 */
const TELEGRAM_BETA_API = 'https://api.telegram.org/beta';

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
  /** Объяснение Telegram при ошибке: «Not Found», «Bad Request: …». */
  description: string;
}

async function tgCall<T>(
  method: string,
  payload: Record<string, unknown>,
  timeoutMs?: number,
  base = TELEGRAM_API,
): Promise<TelegramCall<T>> {
  const token = getBotToken();
  try {
    const response = await fetch(`${base}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
    });

    const data = (await response.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;

    if (!data?.ok) {
      const description = data?.description || `HTTP ${response.status}`;
      console.error(`[telegram] ${method} failed:`, description);
      return { result: null, status: response.status, description };
    }

    return { result: data.result ?? null, status: response.status, description: '' };
  } catch (error) {
    console.error(`[telegram] ${method} error:`, error);
    return { result: null, status: 0, description: error instanceof Error ? error.message : 'нет ответа' };
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

type WidgetServer = 'main' | 'beta';

const WIDGET_SERVERS: Record<WidgetServer, string> = { main: TELEGRAM_API, beta: TELEGRAM_BETA_API };

/** Ответы «метода нет» и «бота не пустили»: этот сервер виджеты пока не отправит. */
const SERVER_REFUSALS = new Set([401, 403, 404]);

/** Пока ни один сервер не принимает виджеты, не дёргаем их на каждое сообщение. */
const WIDGET_API_PAUSE_MS = 15 * 60 * 1000;
let widgetApiPausedUntil = 0;
/** Сервер, который последним принял виджет: с него и начинаем. */
let widgetServer: WidgetServer = 'main';
let lastWidgetAttempt: { at: number; ok: boolean; server: WidgetServer; description: string } | null = null;

/**
 * Отправляет виджет (метод sendWidget из Bot API 10.4). Если основной сервер
 * метода не знает, пробует бета-сервер Telegram.
 * false — виджет не принят, и вызывающий отправляет обычный текст.
 */
export async function sendWidget(
  chatId: number,
  widget: WidgetPayload,
  buttons?: InlineButton[][],
  options: { ignorePause?: boolean } = {},
): Promise<boolean> {
  if (!options.ignorePause && Date.now() < widgetApiPausedUntil) return false;

  const payload = {
    chat_id: chatId,
    html: widget.html,
    caption: widget.caption || undefined,
    parse_mode: widget.caption ? 'HTML' : undefined,
    reply_markup: buttons ? { inline_keyboard: buttons } : undefined,
  };
  const order: WidgetServer[] = widgetServer === 'beta' ? ['beta', 'main'] : ['main', 'beta'];

  for (const server of order) {
    const { result, status, description } = await tgCall<{ message_id?: number }>(
      'sendWidget', payload, 10_000, WIDGET_SERVERS[server],
    );
    lastWidgetAttempt = { at: Date.now(), ok: result !== null, server, description };
    if (result !== null) {
      widgetServer = server;
      widgetApiPausedUntil = 0;
      return true;
    }
    // Ошибка про само сообщение (размер, права в группе) другой сервер не исправит.
    if (!SERVER_REFUSALS.has(status)) return false;
  }

  widgetApiPausedUntil = Date.now() + WIDGET_API_PAUSE_MS;
  return false;
}

/** Что было с последней карточкой — для владельца бота (команда /widgets). */
export function widgetDeliveryNote(now = Date.now()): string {
  const attempt = lastWidgetAttempt;
  if (!attempt) return 'С последнего перезапуска сервера карточек ещё не отправлялось.';

  const time = new Date(attempt.at).toLocaleTimeString('ru-RU', { timeZone: 'Asia/Yekaterinburg', hour: '2-digit', minute: '2-digit' });
  if (attempt.ok) {
    return `Последняя карточка в ${time} отправлена через ${attempt.server === 'beta' ? 'бета-сервер' : 'основной сервер'} Telegram.`;
  }
  const pause = widgetApiPausedUntil > now
    ? ` Пока бот шлёт обычные сообщения и попробует снова через ${Math.ceil((widgetApiPausedUntil - now) / 60_000)} мин.`
    : '';
  return `Последняя попытка в ${time} не удалась: Telegram ответил «${attempt.description}».${pause}`;
}

/** Только для тестов: забыть паузу, выбранный сервер и последнюю попытку. */
export function resetWidgetApiPauseForTests(): void {
  widgetApiPausedUntil = 0;
  widgetServer = 'main';
  lastWidgetAttempt = null;
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

/** Меняет только кнопки под сообщением — так переключатели работают и под карточкой. */
export async function editReplyMarkup(chatId: number, messageId: number, buttons: InlineButton[][]): Promise<boolean> {
  const result = await tg('editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: buttons },
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
