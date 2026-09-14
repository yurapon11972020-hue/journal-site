import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Когда Яндекс не отвечает про файл, группа всё равно появляется в списке,
 * но называется хвостом ссылки. Раньше причина молча терялась, и понять,
 * закрыт доступ или ссылка устарела, было неоткуда.
 */
describe('причины, по которым не прочитались данные о файле', () => {
  const link = 'https://disk.yandex.ru/i/testtesttest01';
  const saved = process.env.YANDEX_DISK_PUBLIC_URLS;

  beforeEach(() => {
    vi.resetModules();
    process.env.JOURNAL_SOURCE = 'yandex-public';
    process.env.YANDEX_DISK_PUBLIC_URLS = link;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (saved === undefined) {
      delete process.env.YANDEX_DISK_PUBLIC_URLS;
    } else {
      process.env.YANDEX_DISK_PUBLIC_URLS = saved;
    }
  });

  async function askYandex(status: number, body: Record<string, unknown> = {}) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })),
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const mod = await import('@/lib/yandex-disk');
    await mod.listJournalFiles().catch(() => undefined);
    return mod.getPublicMetaProblems();
  }

  it('закрытый доступ объясняется словами, а не кодом ошибки', async () => {
    const problems = await askYandex(403, { description: 'Forbidden' });

    expect(problems).toHaveLength(1);
    expect(problems[0].link).toContain(link);
    expect(problems[0].reason).toMatch(/доступ по ссылке/i);
  });

  it('устаревшая ссылка тоже объясняется словами', async () => {
    const problems = await askYandex(404, { description: 'Not Found' });

    expect(problems[0].reason).toMatch(/не нашёл файл/i);
  });

  it('когда ссылка открывается, жалоб нет', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ type: 'file', name: 'ИСиП-25-1.xlsx' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );

    const mod = await import('@/lib/yandex-disk');
    await mod.listJournalFiles().catch(() => undefined);

    expect(mod.getPublicMetaProblems()).toHaveLength(0);
  });
});
