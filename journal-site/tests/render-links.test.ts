import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Список ссылок на журналы живёт в render.yaml — именно он уезжает на Render.
 * Ошибка в нём (лишняя запятая, дубль, опечатка в адресе) тихо превращается
 * в пропавшую или «пустую» группу на боевом сайте, поэтому сверяем его здесь.
 */
function readRenderLinks(): string[] {
  const yaml = readFileSync('render.yaml', 'utf8');
  const match = yaml.match(/key: YANDEX_DISK_PUBLIC_URLS\s*\n\s*value: "([^"]+)"/);

  if (!match) {
    throw new Error('В render.yaml не нашлась переменная YANDEX_DISK_PUBLIC_URLS.');
  }

  return match[1].split(',');
}

describe('ссылки на журналы в render.yaml', () => {
  const saved = process.env.YANDEX_DISK_PUBLIC_URLS;

  beforeEach(() => {
    process.env.YANDEX_DISK_PUBLIC_URLS = readRenderLinks().join(',');
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.YANDEX_DISK_PUBLIC_URLS;
    } else {
      process.env.YANDEX_DISK_PUBLIC_URLS = saved;
    }
  });

  it('каждая запись — непустая публичная ссылка Яндекс.Диска', () => {
    const links = readRenderLinks();

    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.trim()).not.toBe('');
      expect(link.trim()).toMatch(/^https:\/\/disk\.yandex\.(ru|com)\/[id]\/[\w-]+$/);
    }
  });

  it('одна и та же ссылка не записана дважды', () => {
    const links = readRenderLinks().map((link) => link.trim());

    expect(new Set(links).size).toBe(links.length);
  });

  it('сайт видит столько же групп, сколько ссылок в файле', async () => {
    const { getPublicSourcesInfo } = await import('@/lib/yandex-disk');
    const info = getPublicSourcesInfo();

    expect(info.variable).toBe('YANDEX_DISK_PUBLIC_URLS');
    expect(info.linkCount).toBe(readRenderLinks().length);
  });
});
