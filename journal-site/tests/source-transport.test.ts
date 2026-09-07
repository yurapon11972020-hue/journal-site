import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import https from 'node:https';
import type { IncomingMessage, ClientRequest } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchSource } from '@/lib/source-fetch';

const network = vi.hoisted(() => ({ address: '8.8.8.8' }));
vi.mock('node:dns', () => ({ lookup: (_host: unknown, _options: unknown, callback: (error: null, addresses: Array<{ address: string; family: number }>) => void) => callback(null, [{ address: network.address, family: 4 }]) }));
let status = 200;
let responseHeaders: Record<string, string> = {};
let bytes = Buffer.from('test-file');
let requests = 0;
beforeEach(() => {
  network.address = '8.8.8.8'; status = 200; responseHeaders = {}; bytes = Buffer.from('test-file'); requests = 0;
  vi.spyOn(https, 'get').mockImplementation(((_url: unknown, options: https.RequestOptions, callback: (response: IncomingMessage) => void) => {
    requests += 1;
    const request = new EventEmitter() as ClientRequest;
    queueMicrotask(() => {
      const resolver = options.lookup!;
      resolver('downloader.disk.yandex.ru', { all: true }, (error) => {
        if (error) { request.emit('error', error); return; }
        const response = new PassThrough() as unknown as IncomingMessage;
        response.statusCode = status; response.headers = responseHeaders;
        callback(response);
        (response as unknown as PassThrough).end(bytes);
      });
    });
    return request;
  }) as typeof https.get);
});
afterEach(() => vi.restoreAllMocks());

describe('ограниченный HTTPS транспорт без реальной сети', () => {
  it('читает разрешённый ответ после проверки DNS', async () => expect((await fetchSource('https://downloader.disk.yandex.ru/file', 'download')).toString()).toBe('test-file'));
  it('DNS на private IP отклоняется в socket lookup', async () => { network.address = '10.1.2.3'; await expect(fetchSource('https://downloader.disk.yandex.ru/file', 'download')).rejects.toThrow(); });
  it('redirect на metadata не отправляет второй запрос', async () => {
    status = 302; responseHeaders = { location: 'http://169.254.169.254/latest/meta-data' };
    await expect(fetchSource('https://downloader.disk.yandex.ru/file', 'download')).rejects.toThrow();
    expect(requests).toBe(1);
  });
  it('API redirects запрещены: OAuth не пересылается', async () => {
    status = 302; responseHeaders = { location: 'https://downloader.disk.yandex.ru/file' };
    await expect(fetchSource('https://cloud-api.yandex.net/v1/disk/resources', 'api', { Authorization: 'OAuth test-only' })).rejects.toThrow();
    expect(requests).toBe(1);
  });
  it('ограничивает поток даже без Content-Length', async () => {
    bytes = Buffer.alloc(20 * 1024 * 1024 + 1);
    await expect(fetchSource('https://downloader.disk.yandex.ru/file', 'download')).rejects.toMatchObject({ code: 'JOURNAL_TOO_LARGE' });
  });
});
