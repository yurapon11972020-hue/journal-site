import { afterEach, describe, expect, it, vi } from 'vitest';
import { validatePublicUrl, validateFetchUrl, isPublicAddress } from '@/lib/source-fetch';
import { allowedGroups, groupView } from '@/lib/group-access';
import { publicJournalError } from '@/lib/journal-errors';
import { buildAccessToken } from '@/lib/access';
import { GET as getJournal } from '@/app/api/journal/route';
import { GET as getGroups } from '@/app/api/groups/route';
import { POST as telegram } from '@/app/api/telegram/route';
import { POST as setup } from '@/app/api/telegram/setup/route';
import type { JournalGroupRef } from '@/lib/types';

const mocks = vi.hoisted(() => ({ load: vi.fn(), list: vi.fn(), find: vi.fn(), send: vi.fn(), edit: vi.fn(), callback: vi.fn(), setup: vi.fn() }));
vi.mock('@/lib/journal', () => ({ getJournalGroups: mocks.list, getJournalDataByPath: mocks.load, findJournalGroupById: mocks.find }));
vi.mock('@/lib/telegram', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/telegram')>(), sendMessage: mocks.send, editMessage: mocks.edit, answerCallback: mocks.callback, setWebhook: mocks.setup }));

const groups: JournalGroupRef[] = ['A', 'B'].map((id) => ({ id, groupName: 'Группа ' + id, fileName: id + '.xlsx', filePath: '/secret/' + id, source: 'local', sourceDetails: 'secret-source' }));
afterEach(() => { vi.clearAllMocks(); delete process.env.JOURNAL_GROUP_ACCESS_CODES; delete process.env.TELEGRAM_WEBHOOK_SECRET; delete process.env.TELEGRAM_GROUP_ACCESS; });

describe('границы источника', () => {
  it.each(['http://disk.yandex.ru/i/abc', 'https://127.0.0.1/i/a', 'https://disk.yandex.ru.evil.test/i/a', 'https://disk.yandex.ru:444/i/a', 'https://u:p@disk.yandex.ru/i/a', 'file:///etc/passwd', 'https://disk.yandex.ru/i/a?token=secret'])('отклоняет URL %s', (url) => expect(() => validatePublicUrl(url)).toThrow());
  it('принимает только ожидаемые публичные ссылки', () => expect(validatePublicUrl('https://disk.yandex.ru/i/example')).toBe('https://disk.yandex.ru/i/example'));
  it.each(['https://localhost/file', 'https://169.254.169.254/latest/meta-data', 'https://downloader.disk.yandex.ru.evil.test/file', 'http://downloader.disk.yandex.ru/file', 'https://user@downloader.disk.yandex.ru/file'])('проверяет href и каждый redirect %s', (url) => expect(() => validateFetchUrl(url, 'download')).toThrow());
  it.each(['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', '::ffff:127.0.0.1', 'fe80::1', 'fc00::1', '2001:db8::1'])('отклоняет внутренний DNS-адрес %s', (address) => expect(isPublicAddress(address)).toBe(false));
  it('разрешает глобальные IPv4/IPv6', () => { expect(isPublicAddress('8.8.8.8')).toBe(true); expect(isPublicAddress('2606:4700:4700::1111')).toBe(true); });
  it('скрывает внешние ошибки и пути', () => expect(JSON.stringify(publicJournalError(new Error('secret https://private.example/token')))).not.toContain('private.example'));
});

describe('серверная изоляция групп', () => {
  it('view DTO не включает пути и ссылки', () => {
    expect(groupView(groups[0])).not.toHaveProperty('filePath');
    expect(groupView(groups[0])).not.toHaveProperty('sourceDetails');
    expect(allowedGroups(groups, { scope: 'Группа A' }).map((group) => group.id)).toEqual(['A']);
    expect(allowedGroups(groups, { scope: '__single_group__' })).toEqual([]);
  });
  it('когда коды настроены, без сессии API не читает журнал', async () => {
    process.env.JOURNAL_GROUP_ACCESS_CODES = JSON.stringify({ 'Группа A': 'group-A-test' });

    expect((await getJournal(new Request('http://localhost/api/journal'))).status).toBe(401);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it('код A не открывает B через прямой API', async () => {
    process.env.JOURNAL_GROUP_ACCESS_CODES = JSON.stringify({ 'Группа A': 'group-A-test', 'Группа B': 'group-B-test' });
    const token = await buildAccessToken('group-A-test');
    mocks.list.mockResolvedValue(groups); mocks.find.mockResolvedValue(groups[1]);
    const request = new Request('http://localhost/api/journal?group=B', { headers: { cookie: 'journal-access=' + token } });
    expect((await getJournal(request)).status).toBe(404);
    expect(mocks.load).not.toHaveBeenCalled();
    const response = await getGroups(new Request('http://localhost/api/groups', { headers: { cookie: 'journal-access=' + token } }));
    const payload = await response.json();
    expect(payload.groups.map((group: { id: string }) => group.id)).toEqual(['A']);
    expect(JSON.stringify(payload)).not.toContain('/secret/');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});

describe('Telegram', () => {
  it('когда журнал закрыт кодами, без секрета webhook тоже закрыт', async () => {
    process.env.JOURNAL_GROUP_ACCESS_CODES = JSON.stringify({ 'Группа A': 'group-A-test' });

    expect((await telegram(new Request('http://localhost/api/telegram', { method: 'POST', body: '{}' }))).status).toBe(503);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  // Пока журнал открыт всем, закрывать бота нечего защищать, а работать он перестаёт.
  it('при открытом журнале бот отвечает и без секрета, и без списка чатов', async () => {
    mocks.list.mockResolvedValue(groups);
    mocks.load.mockResolvedValue({ groupName: 'Группа A', students: [], subjects: [], reportCards: [], studentCount: 0, subjectCount: 0 });

    const response = await telegram(
      new Request('http://localhost/api/telegram', {
        method: 'POST',
        body: JSON.stringify({ message: { chat: { id: 501, type: 'private' }, from: { id: 501 }, text: '/start' } }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.send).toHaveBeenCalled();
  });
  it('поддельный webhook не читает журнал', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret';
    expect((await telegram(new Request('http://localhost/api/telegram', { method: 'POST', body: '{}' }))).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it('неизвестный чат не получает данные даже с подлинным webhook', async () => {
    process.env.JOURNAL_GROUP_ACCESS_CODES = JSON.stringify({ 'Группа A': 'group-A-test' });
    process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret';
    const response = await telegram(new Request('http://localhost/api/telegram', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret' }, body: JSON.stringify({ message: { chat: { id: 101, type: 'private' }, from: { id: 101 }, text: '/start' } }) }));
    expect(response.status).toBe(200); expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it('setup без администратора не вызывает Telegram', async () => {
    expect((await setup(new Request('http://localhost/api/telegram/setup', { method: 'POST', headers: { origin: 'http://localhost', 'x-forwarded-host': 'evil.test' } }))).status).toBe(403);
    expect(mocks.setup).not.toHaveBeenCalled();
  });

  // Журнал может быть открыт всем, но бота это администрировать не позволяет.
  it('открытый журнал не даёт настраивать webhook', async () => {
    process.env.PUBLIC_SITE_URL = 'https://journal.example/';
    process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret';

    const response = await setup(
      new Request('http://localhost/api/telegram/setup', { method: 'POST', headers: { origin: 'http://localhost' } }),
    );

    expect(response.status).toBe(403);
    expect(mocks.setup).not.toHaveBeenCalled();
    delete process.env.PUBLIC_SITE_URL;
  });
});
