import * as XLSX from 'xlsx';

/**
 * Проверка того, что скачали именно журнал.
 *
 * Публичная ссылка может однажды отдать не Excel, а HTML-страницу входа или
 * заглушку об ошибке — например, если доступ к файлу закрыли. Такой ответ
 * приходит с обычным кодом 200, и без проверки он затирал бы рабочий журнал
 * мусором. Поэтому файл проверяется до того, как заменит прошлую копию.
 */
export const MAX_JOURNAL_FILE_BYTES = 20 * 1024 * 1024;

const ZIP_SIGNATURE = 'PK';
const OLD_EXCEL_SIGNATURE = 'd0cf11e0a1b11ae1';

export class NotAJournalFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotAJournalFileError';
  }
}

function looksLikeWebPage(buffer: Buffer): boolean {
  const preview = buffer.subarray(0, 2048).toString('utf8').toLowerCase();
  return preview.includes('<html') || preview.includes('<!doctype html');
}

/** Бросает ошибку, если это не рабочая книга Excel. */
export function assertJournalFile(buffer: Buffer, where: string): void {
  if (!buffer.length) {
    throw new NotAJournalFileError(`По ссылке ${where} пришёл пустой файл.`);
  }

  if (buffer.length > MAX_JOURNAL_FILE_BYTES) {
    throw new NotAJournalFileError(
      `Файл по ссылке ${where} больше ${Math.round(MAX_JOURNAL_FILE_BYTES / 1024 / 1024)} МБ — это не похоже на журнал.`,
    );
  }

  const isZip = buffer.subarray(0, 2).toString('latin1') === ZIP_SIGNATURE;
  const isOldExcel = buffer.subarray(0, 8).toString('hex') === OLD_EXCEL_SIGNATURE;

  if (!isZip && !isOldExcel) {
    throw new NotAJournalFileError(
      looksLikeWebPage(buffer)
        ? `По ссылке ${where} вместо журнала пришла веб-страница. Скорее всего, доступ к файлу закрыли.`
        : `По ссылке ${where} пришёл не Excel-файл.`,
    );
  }

  // Файл должен ещё и открываться как книга хотя бы с одним листом.
  let sheetNames: string[];
  try {
    sheetNames = XLSX.read(buffer, { type: 'buffer', bookSheets: true }).SheetNames;
  } catch {
    throw new NotAJournalFileError(`Файл по ссылке ${where} не открывается как книга Excel.`);
  }

  if (!sheetNames.length) {
    throw new NotAJournalFileError(`В файле по ссылке ${where} нет ни одного листа.`);
  }
}
