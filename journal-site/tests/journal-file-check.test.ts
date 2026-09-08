import { describe, expect, it } from 'vitest';

import { assertJournalFile, MAX_JOURNAL_FILE_BYTES, NotAJournalFileError } from '@/lib/journal-file-check';

import { buildJournalWorkbook } from './helpers/journal-fixture';

const WHERE = 'https://disk.yandex.ru/i/example';

describe('проверка скачанного файла', () => {
  it('настоящий журнал проходит проверку', () => {
    expect(() => assertJournalFile(buildJournalWorkbook(), WHERE)).not.toThrow();
  });

  // Главный случай: доступ к файлу закрыли, и вместо Excel приходит страница входа.
  it('страницу входа вместо журнала отклоняет и объясняет причину', () => {
    const page = Buffer.from('<!DOCTYPE html><html><body>Войдите в аккаунт</body></html>', 'utf8');

    expect(() => assertJournalFile(page, WHERE)).toThrow(NotAJournalFileError);
    expect(() => assertJournalFile(page, WHERE)).toThrow(/веб-страница/);
    expect(() => assertJournalFile(page, WHERE)).toThrow(WHERE);
  });

  it('пустой ответ отклоняет', () => {
    expect(() => assertJournalFile(Buffer.alloc(0), WHERE)).toThrow(/пустой файл/);
  });

  it('произвольный мусор отклоняет', () => {
    expect(() => assertJournalFile(Buffer.from('просто текст, не журнал'), WHERE)).toThrow(/не Excel-файл/);
  });

  it('слишком большой файл отклоняет, не пытаясь его разобрать', () => {
    const huge = Buffer.alloc(MAX_JOURNAL_FILE_BYTES + 1);
    huge.write('PK');

    expect(() => assertJournalFile(huge, WHERE)).toThrow(/больше 20 МБ/);
  });

  it('битый zip отклоняет', () => {
    const broken = Buffer.concat([Buffer.from('PK'), Buffer.alloc(300, 7)]);

    expect(() => assertJournalFile(broken, WHERE)).toThrow(NotAJournalFileError);
  });
});
