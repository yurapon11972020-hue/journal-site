/**
 * Новогоднее оформление: гирлянда по верхнему краю, снег и шапка на логотипе.
 *
 * Украшения висят с 1 ноября по 14 января, до старого Нового года, потом
 * исчезают сами и возвращаются в следующем ноябре. Любой может убрать их
 * кнопкой: выбор запоминается в браузере до конца текущего сезона.
 *
 * Состояние живёт в атрибуте data-holiday на <html>: "on" — украшения видны,
 * "off" — сезон идёт, но их убрали, атрибута нет — не сезон. Атрибут
 * выставляет скрипт в <head> до первой отрисовки, поэтому украшения не
 * появляются с опозданием и не мигают у тех, кто их убрал.
 */
export const HOLIDAY_STORAGE_KEY = 'journal-holiday-off';

/** Сезон начинается 1 ноября. */
const SEASON_START_MONTH = 11;
/** Последний день сезона — 14 января. */
const SEASON_LAST_JANUARY_DAY = 14;

/**
 * Сезон называется годом, в котором начался: зима 2026/27 — «2026».
 * Вне сезона — null.
 */
export function holidaySeason(date: Date): string | null {
  const month = date.getMonth() + 1;

  if (month >= SEASON_START_MONTH) {
    return String(date.getFullYear());
  }

  if (month === 1 && date.getDate() <= SEASON_LAST_JANUARY_DAY) {
    return String(date.getFullYear() - 1);
  }

  return null;
}

/**
 * Та же проверка сезона, что в holidaySeason, но строкой для <head>.
 * Если localStorage недоступен, украшения просто показываются.
 */
export const HOLIDAY_BOOTSTRAP_SCRIPT = `(function(){var n=new Date(),m=n.getMonth()+1,s=m>=${SEASON_START_MONTH}?n.getFullYear():m===1&&n.getDate()<=${SEASON_LAST_JANUARY_DAY}?n.getFullYear()-1:0;if(!s)return;var o=null;try{o=localStorage.getItem('${HOLIDAY_STORAGE_KEY}')}catch(e){}document.documentElement.dataset.holiday=o===String(s)?'off':'on'})()`;
