import crypto from 'node:crypto';
import path from 'node:path';

export function filenameToGroupName(fileName: string): string {
  // Пробелы убираем до отсечения расширения: на Диске встречаются имена
  // вида «ИСиП-25-9.xlsx » — иначе расширение не распознаётся.
  return fileName.trim().replace(/\.(xlsx|xlsm|xls)$/i, '').trim();
}

/**
 * Идентификатор группы для адресной строки.
 * Это короткий хэш, а не закодированный путь: по нему нельзя восстановить
 * ни публичную ссылку на Яндекс.Диск, ни путь к файлу на сервере.
 */
export function groupPathToPublicId(filePath: string): string {
  return crypto.createHash('sha256').update(filePath, 'utf8').digest('base64url').slice(0, 16);
}

/** Старый способ: путь, закодированный в base64. Оставлен, чтобы работали сохранённые ссылки. */
export function groupPathToId(filePath: string): string {
  return Buffer.from(filePath, 'utf8').toString('base64url');
}

export function idToGroupPath(id: string): string {
  return Buffer.from(id, 'base64url').toString('utf8');
}

export function basenameFromFilePath(filePath: string): string {
  const normalized = filePath.replace(/^disk:/, '');
  return path.posix.basename(normalized) || path.basename(filePath);
}
