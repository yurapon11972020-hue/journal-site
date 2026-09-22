/**
 * Разбор и приведение к общему виду названий групп.
 *
 * Название приходит из двух мест — из имени файла на Диске
 * («ИСиП-24-1.xlsx») и из шапки самого журнала («ИСиП 24/2»), —
 * и записано в них по-разному. Здесь оба варианта приводятся
 * к одной форме «ИСиП-24/1» и выбирается, какой показывать.
 */

/**
 * Код группы: буквенная часть, двузначный год и номер подгруппы.
 * Буквы обязаны идти первыми — этим код группы отличается от шапки
 * с учебным годом вроде «26/27-Д», где первыми идут цифры.
 */
const GROUP_CODE = /^(.*?[А-Яа-яA-Za-z)])[\s\-_]*(\d{2})[\s\-_/]+(\d{1,2})(.*)$/;

/** Слова, которые встречаются в шапке листа и группой не являются. */
const NOT_A_GROUP = [
  'месяц',
  'число',
  'дата',
  'тема',
  'дз',
  'учебный год',
  'группа здоровья',
  'журнал',
  'семестр',
  'курс',
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
];

function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Похоже ли это на код группы.
 *
 * Отсекает шапки с учебным годом («26/27-Д», «Журнал 26/27»):
 * там второе число — следующий год, а не номер подгруппы.
 */
export function looksLikeGroupName(value: string): boolean {
  const normalized = collapseSpaces(value);
  if (!normalized || normalized.length > 40) {
    return false;
  }

  const match = normalized.match(GROUP_CODE);
  if (!match) {
    return false;
  }

  const [, prefix, year, number] = match;

  // Буквенная часть должна быть настоящей, а не одиноким символом вроде «№».
  if (!/[А-Яа-яA-Za-z]{2}/.test(prefix)) {
    return false;
  }

  // «26/27», «2026/2027» — это учебный год, а не группа.
  if (Number(number) === Number(year) + 1) {
    return false;
  }

  const lowerPrefix = prefix.toLowerCase();
  if (NOT_A_GROUP.some((word) => lowerPrefix.includes(word))) {
    return false;
  }

  return true;
}

/** Приводит «ИСиП-24-1», «ИСиП 24/2», «ИБ_23_1» к виду «ИСиП-24/1». */
export function formatGroupName(value: string | null | undefined): string {
  const normalized = collapseSpaces(value ?? '');
  if (!normalized) {
    return '';
  }

  const match = normalized.match(GROUP_CODE);
  if (!match) {
    return normalized;
  }

  const [, prefix, year, number, tail] = match;
  return `${collapseSpaces(prefix)}-${year}/${number}${collapseSpaces(tail)}`;
}

/**
 * Что показать пользователю.
 *
 * Главнее шапка самого журнала: файл на Диске нередко называют по старой
 * группе или по шаблону, с которого его скопировали, — «ИСиП-26-2.xlsx»
 * с группой «ИБ 26/2» внутри встречается в живых журналах. Внутри же
 * написано то, что преподаватель ведёт на самом деле.
 *
 * Имя файла остаётся запасным вариантом: в шапке бывает пусто, а ссылка
 * на Диск — служебная, и тогда группа называлась бы «n2Ldf1ar5jbjJg».
 */
export function pickGroupName(fileNameGuess: string | null | undefined, parsedName: string | null | undefined): string {
  const fromFile = collapseSpaces(fileNameGuess ?? '');
  const fromSheet = collapseSpaces(parsedName ?? '');

  if (looksLikeGroupName(fromSheet)) {
    return formatGroupName(fromSheet);
  }

  if (looksLikeGroupName(fromFile)) {
    return formatGroupName(fromFile);
  }

  // Не подошло ничего: имя файла всё же лучше — по нему журнал
  // хотя бы находится на Диске, а мусор из шапки не значит ничего.
  return formatGroupName(fromFile) || formatGroupName(fromSheet);
}
