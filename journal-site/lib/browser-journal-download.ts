const MAX_WORKBOOK_BYTES = 20 * 1024 * 1024;
const YANDEX_RESOURCE_API = 'https://cloud-api.yandex.net/v1/disk/public/resources';
const YANDEX_DOWNLOAD_API = `${YANDEX_RESOURCE_API}/download`;

interface PublicJournalSource {
  publicUrl: string;
  publicPath?: string;
}

function resourceUrl(endpoint: string, source: PublicJournalSource): URL {
  const url = new URL(endpoint);
  url.searchParams.set('public_key', source.publicUrl);
  if (source.publicPath) {
    url.searchParams.set('path', source.publicPath);
  }
  return url;
}

export async function readYandexJournalMd5(source: PublicJournalSource): Promise<string> {
  const url = resourceUrl(YANDEX_RESOURCE_API, source);
  url.searchParams.set('limit', '1');
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`Яндекс не ответил о файле: ${response.status}`);
  }
  const metadata = (await response.json()) as { type?: string; md5?: string };
  if (metadata.type !== 'file' || !metadata.md5 || !/^[a-f\d]{32}$/i.test(metadata.md5)) {
    throw new Error('Яндекс не сообщил контрольную сумму файла.');
  }
  return metadata.md5.toLowerCase();
}

export async function downloadYandexJournalInBrowser(source: PublicJournalSource): Promise<ArrayBuffer> {
  const ticketResponse = await fetch(resourceUrl(YANDEX_DOWNLOAD_API, source), {
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  if (!ticketResponse.ok) {
    throw new Error(`Яндекс не выдал ссылку на файл: ${ticketResponse.status}`);
  }
  const ticket = (await ticketResponse.json()) as { href?: string };
  if (!ticket.href || new URL(ticket.href).protocol !== 'https:') {
    throw new Error('Яндекс не выдал безопасную ссылку на скачивание.');
  }

  const fileResponse = await fetch(ticket.href, { cache: 'no-store', signal: AbortSignal.timeout(45_000) });
  if (!fileResponse.ok) {
    throw new Error(`Яндекс вернул ошибку ${fileResponse.status} при скачивании файла.`);
  }
  const contentLength = Number(fileResponse.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_WORKBOOK_BYTES) {
    throw new Error('Файл больше 20 МБ.');
  }
  const buffer = await fileResponse.arrayBuffer();
  if (!buffer.byteLength || buffer.byteLength > MAX_WORKBOOK_BYTES) {
    throw new Error('Файл пустой или больше 20 МБ.');
  }
  return buffer;
}

export async function sendJournalFileToSite(groupId: string, buffer: ArrayBuffer): Promise<void> {
  if (!buffer.byteLength || buffer.byteLength > MAX_WORKBOOK_BYTES) {
    throw new Error('Файл пустой или больше 20 МБ.');
  }
  const response = await fetch(`/api/journal/recover?group=${encodeURIComponent(groupId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    body: buffer,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(typeof payload?.error === 'string' ? payload.error : `Ошибка ${response.status}`);
  }
}
