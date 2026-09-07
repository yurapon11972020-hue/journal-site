import https from 'node:https';
import { lookup } from 'node:dns';
import { isIP } from 'node:net';
import { JournalError } from '@/lib/journal-errors';

const API_HOST = 'cloud-api.yandex.net';
const DOWNLOAD_SUFFIXES = ['.disk.yandex.ru', '.disk.yandex.net', '.disk.yandex.com', '.storage.yandex.net'];
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export function validatePublicUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new JournalError('JOURNAL_INVALID_URL', 400); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !['disk.yandex.ru', 'disk.yandex.com', 'yadi.sk'].includes(url.hostname) || !/^\/(?:i|d)\/[^/\s]+\/?$/.test(url.pathname) || url.search) {
    throw new JournalError('JOURNAL_INVALID_URL', 400);
  }
  return url.origin + url.pathname;
}

export function validateFetchUrl(raw: string, kind: 'api' | 'download'): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new JournalError('JOURNAL_INVALID_URL', 400); }
  const allowed = kind === 'api' ? url.hostname === API_HOST : DOWNLOAD_SUFFIXES.some((suffix) => url.hostname.endsWith(suffix));
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !allowed || isIP(url.hostname) || url.hash) throw new JournalError('JOURNAL_INVALID_URL', 400);
  return url;
}

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0) || a >= 224);
  }
  // Permit only global unicast IPv6, excluding documentation and transition ranges.
  const lower = address.toLowerCase();
  return isIP(address) === 6 && /^[23]/.test(lower) && !lower.startsWith('2001:db8:') && !lower.startsWith('2001:0:') && !lower.startsWith('2002:');
}

/** DNS is checked in the actual socket lookup, so it cannot change between validation and connect. */
const safeLookup: NonNullable<https.RequestOptions['lookup']> = (hostname, options, callback) => {
  lookup(hostname, { all: true }, (error, addresses) => {
    if (error) return callback(error, [], undefined);
    if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) return callback(new Error('JOURNAL_INVALID_URL'), [], undefined);
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
};

export async function fetchSource(raw: string, kind: 'api' | 'download', headers: Record<string, string> = {}, redirects = 0, deadline = Date.now() + 20000): Promise<Buffer> {
  const url = validateFetchUrl(raw, kind);
  if (redirects > 4 || deadline <= Date.now()) throw new JournalError('JOURNAL_FETCH_FAILED');
  const maxBytes = kind === 'api' ? 2 * 1024 * 1024 : MAX_FILE_BYTES;
  return new Promise<Buffer>((resolve, reject) => {
    const request = https.get(url, { headers, lookup: safeLookup, signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) }, (response) => {
      const status = response.statusCode ?? 502;
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.resume();
        if (kind === 'api' || !response.headers.location) return reject(new JournalError('JOURNAL_FETCH_FAILED'));
        let target: URL;
        try { target = new URL(response.headers.location, url); validateFetchUrl(target.href, kind); } catch { return reject(new JournalError('JOURNAL_INVALID_URL', 400)); }
        resolve(fetchSource(target.href, kind, {}, redirects + 1, deadline));
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new JournalError(status === 401 || status === 403 ? 'JOURNAL_AUTH_REQUIRED' : 'JOURNAL_FETCH_FAILED', status === 401 || status === 403 ? 401 : 502));
        return;
      }
      if (Number(response.headers['content-length'] || 0) > maxBytes) {
        response.destroy(); reject(new JournalError('JOURNAL_TOO_LARGE')); return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) { response.destroy(); reject(new JournalError('JOURNAL_TOO_LARGE')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', () => reject(new JournalError('JOURNAL_FETCH_FAILED')));
    });
    request.on('error', () => reject(new JournalError('JOURNAL_FETCH_FAILED')));
  });
}
