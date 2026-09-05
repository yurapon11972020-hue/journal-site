import { describe, expect, it } from 'vitest';

import {
  basenameFromFilePath,
  filenameToGroupName,
  groupPathToId,
  groupPathToPublicId,
  idToGroupPath,
} from '@/lib/group-files';

describe('group-files', () => {
  it('превращает имя файла в название группы', () => {
    expect(filenameToGroupName('ИСиП-25-9.xlsx')).toBe('ИСиП-25-9');
    expect(filenameToGroupName('Журнал.XLSM')).toBe('Журнал');
    expect(filenameToGroupName('  ПКС-24-9.xls  ')).toBe('ПКС-24-9');
  });

  it('кодирует и раскодирует путь без потерь', () => {
    for (const filePath of ['disk:/Журналы/ИСиП-25-9.xlsx', '/tmp/journal-cache/a.xlsx', '__yandex_public_cache__']) {
      expect(idToGroupPath(groupPathToId(filePath))).toBe(filePath);
    }
  });

  it('идентификатор безопасен для адресной строки', () => {
    const id = groupPathToId('disk:/Журналы/ИСиП 25-9.xlsx');
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('достаёт имя файла из пути Яндекс.Диска', () => {
    expect(basenameFromFilePath('disk:/Журналы/ИСиП-25-9.xlsx')).toBe('ИСиП-25-9.xlsx');
    expect(basenameFromFilePath('/ИСиП-24-9.xlsx')).toBe('ИСиП-24-9.xlsx');
  });
});

describe('идентификатор группы для адресной строки', () => {
  it('не раскрывает публичную ссылку и путь на сервере', () => {
    const secretPath = '__yandex_public_cache__::eyJrIjoiaHR0cHM6Ly9kaXNrLnlhbmRleC5ydS9pL3NlY3JldCJ9';
    const id = groupPathToPublicId(secretPath);

    expect(id).not.toContain('yandex');
    expect(Buffer.from(id, 'base64url').toString('utf8')).not.toContain('disk.yandex.ru');
    expect(id).toHaveLength(16);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('для одного и того же файла идентификатор не меняется', () => {
    expect(groupPathToPublicId('/journals/ИСиП-25-9.xlsx')).toBe(groupPathToPublicId('/journals/ИСиП-25-9.xlsx'));
    expect(groupPathToPublicId('/journals/a.xlsx')).not.toBe(groupPathToPublicId('/journals/b.xlsx'));
  });
});
