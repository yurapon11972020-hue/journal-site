import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetWidgetApiPauseForTests, sendWidget, widgetDeliveryNote } from '@/lib/telegram';

const fetchMock = vi.fn();
const MAIN = 'https://api.telegram.org/bot123:abc/sendWidget';
const BETA = 'https://api.telegram.org/beta/bot123:abc/sendWidget';
const WIDGET = { html: '<b>карточка</b>', caption: 'подпись' };

function reply(status: number, body: object): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const notFound = () => reply(404, { ok: false, error_code: 404, description: 'Not Found' });
const sent = () => reply(200, { ok: true, result: { message_id: 5 } });

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = '123:abc';
  resetWidgetApiPauseForTests();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchMock.mockReset();
  delete process.env.TELEGRAM_BOT_TOKEN;
});

describe('отправка карточки (sendWidget)', () => {
  it('без метода на основном сервере отправляет через бета-сервер и дальше идёт туда сразу', async () => {
    fetchMock.mockResolvedValueOnce(notFound()).mockResolvedValueOnce(sent()).mockResolvedValueOnce(sent());

    expect(await sendWidget(42, WIDGET)).toBe('sent');
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([MAIN, BETA]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ chat_id: 42, html: WIDGET.html, caption: 'подпись', parse_mode: 'HTML' });
    expect(widgetDeliveryNote()).toContain('через бета-сервер Telegram');

    expect(await sendWidget(42, WIDGET)).toBe('sent');
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([MAIN, BETA, BETA]);
  });

  it('основной сервер, который знает метод, используется без беты', async () => {
    fetchMock.mockResolvedValueOnce(sent());

    expect(await sendWidget(42, WIDGET)).toBe('sent');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(widgetDeliveryNote()).toContain('через основной сервер Telegram');
  });

  it('ошибка про само сообщение не уходит на другой сервер и не ставит паузу', async () => {
    fetchMock.mockResolvedValueOnce(reply(400, { ok: false, description: 'Bad Request: INPUT_MEDIA_WIDGET_TOO_LARGE' }))
      .mockResolvedValueOnce(sent());

    expect(await sendWidget(42, WIDGET)).toBe('failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(widgetDeliveryNote()).toContain('INPUT_MEDIA_WIDGET_TOO_LARGE');
    expect(await sendWidget(42, WIDGET)).toBe('sent');
  });

  it('если метода нет нигде, 15 минут не спрашивает, а проверка владельца спрашивает сразу', async () => {
    fetchMock.mockResolvedValueOnce(notFound()).mockResolvedValueOnce(notFound());

    expect(await sendWidget(42, WIDGET)).toBe('failed');
    expect(widgetDeliveryNote()).toContain('Telegram ответил «Not Found»');
    expect(widgetDeliveryNote()).toContain('попробует снова через 15 мин.');

    expect(await sendWidget(42, WIDGET)).toBe('failed');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockResolvedValueOnce(notFound()).mockResolvedValueOnce(sent());
    expect(await sendWidget(42, WIDGET, undefined, { ignorePause: true })).toBe('sent');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(await sendWidget(42, WIDGET).then(() => fetchMock.mock.calls.length)).toBe(5);
  });

  it('без ответа сервера карточку не повторяет и 15 минут шлёт текстом', async () => {
    fetchMock.mockRejectedValueOnce(new Error('The operation was aborted due to timeout'));

    expect(await sendWidget(42, WIDGET)).toBe('unknown');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(widgetDeliveryNote()).toContain('попробует снова через 15 мин.');
    expect(await sendWidget(42, WIDGET)).toBe('failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('до первой карточки так и говорит', () => {
    expect(widgetDeliveryNote()).toBe('С последнего перезапуска сервера карточек ещё не отправлялось.');
  });
});
