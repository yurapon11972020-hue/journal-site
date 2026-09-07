export type JournalErrorCode = 'JOURNAL_INVALID_URL' | 'JOURNAL_AUTH_REQUIRED' | 'JOURNAL_FETCH_FAILED' | 'JOURNAL_STRUCTURE_CHANGED' | 'JOURNAL_PARSE_FAILED' | 'JOURNAL_VALIDATION_FAILED' | 'JOURNAL_TOO_LARGE' | 'JOURNAL_NOT_FOUND' | 'JOURNAL_ACCESS_DENIED';

const messages: Record<JournalErrorCode, string> = {
  JOURNAL_INVALID_URL: 'Неверная ссылка на журнал. Нужна публичная ссылка Яндекс.Диска.',
  JOURNAL_AUTH_REQUIRED: 'Источник требует авторизацию. Проверьте доступ к журналу.',
  JOURNAL_FETCH_FAILED: 'Источник журнала временно недоступен. Попробуйте обновить позже.',
  JOURNAL_STRUCTURE_CHANGED: 'Не удалось распознать структуру журнала. Нужна проверка исходного файла.',
  JOURNAL_PARSE_FAILED: 'Не удалось прочитать файл журнала.',
  JOURNAL_VALIDATION_FAILED: 'Данные журнала не прошли проверку. Последняя исправная версия сохранена.',
  JOURNAL_TOO_LARGE: 'Файл журнала превышает допустимый размер.',
  JOURNAL_NOT_FOUND: 'Группа не найдена. Откройте список доступных групп.',
  JOURNAL_ACCESS_DENIED: 'Для этой группы нужен её код доступа.',
};

export class JournalError extends Error {
  constructor(public readonly code: JournalErrorCode, public readonly status = 502) {
    super(messages[code]);
    this.name = 'JournalError';
  }
}

export function publicJournalError(error: unknown): { code: JournalErrorCode; error: string; status: number } {
  const known = error instanceof JournalError ? error : new JournalError('JOURNAL_FETCH_FAILED');
  return { code: known.code, error: known.message, status: known.status };
}

/** Only codes/counts/durations: never serialize an upstream Error, URL, path or person. */
export function logJournalEvent(event: string, details: Record<string, string | number | boolean> = {}): void {
  if (process.env.JOURNAL_DEBUG === 'true' || event.includes('failed')) {
    console.info('[journal]', JSON.stringify({ event, ...details }));
  }
}
