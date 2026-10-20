/** Два общедоступных источника напоминаний, не зависящих от Excel-журналов. */
const SCHEDULE_URL = 'https://skp-rasp.ru/api/schedule';
const TEACHER_ROOMS_URL = 'https://skp-surgut.ru/wp-json/wp/v2/pages/13420?_fields=content,modified';
export const TEACHER_ROOMS_DIRECTORY_URL = 'https://skp-surgut.ru/%d0%ba%d0%be%d0%bc%d0%bd%d0%b0%d1%82%d1%8b-%d0%b4%d0%bb%d1%8f-%d0%b2%d0%b8%d0%b4%d0%b5%d0%be-%d0%bb%d0%b5%d0%ba%d1%86%d0%b8%d0%b9/';
const SCHEDULE_CACHE_MS = 60_000;
const SCHEDULE_STALE_MAX_MS = 2 * 60 * 60 * 1000;
const TEACHER_ROOMS_CACHE_MS = 6 * 60 * 60 * 1000;

export interface ScheduleLesson {
  date: string;
  time: string;
  group: string;
  subject: string;
  teacher: string | null;
  teachers: string[];
  format: string | null;
  room: string | null;
  room_label: string | null;
  pair: number | null;
}

export interface ScheduleData {
  groups: string[];
  items: ScheduleLesson[];
}

interface ScheduleCache {
  data: ScheduleData;
  etag: string | null;
  fetchedAt: number;
}

interface RoomsCache {
  rooms: Map<string, string>;
  fetchedAt: number;
}

let scheduleCache: ScheduleCache | null = null;
let scheduleRequest: Promise<ScheduleData> | null = null;
let roomsCache: RoomsCache | null = null;
let roomsRequest: Promise<Map<string, string>> | null = null;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Проверяем схему ответа, чтобы случайная ошибка API не стала пустым расписанием. */
export function parseSchedulePayload(payload: unknown): ScheduleData {
  const data = record(payload);
  if (!data || !Array.isArray(data.groups) || !Array.isArray(data.items)) {
    throw new Error('Сайт расписания вернул данные в неожиданном формате.');
  }

  const groups = [...new Set(data.groups.filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim()).filter(Boolean))];
  const items: ScheduleLesson[] = [];

  for (const raw of data.items) {
    const item = record(raw);
    if (!item) continue;
    const date = optionalText(item.date);
    const time = optionalText(item.time);
    const group = optionalText(item.group);
    const subject = optionalText(item.subject);
    if (!date || !time || !group || !subject) continue;

    const teachers = Array.isArray(item.teachers)
      ? item.teachers.map(optionalText).filter((value): value is string => Boolean(value))
      : [];
    const teacher = optionalText(item.teacher);
    if (teacher && !teachers.includes(teacher)) teachers.unshift(teacher);

    items.push({
      date,
      time,
      group,
      subject,
      teacher,
      teachers,
      format: optionalText(item.format),
      room: optionalText(item.room),
      room_label: optionalText(item.room_label),
      pair: typeof item.pair === 'number' && Number.isInteger(item.pair) ? item.pair : null,
    });
  }

  if (!groups.length || !items.length) {
    throw new Error('На сайте расписания нет групп или занятий.');
  }

  return { groups, items };
}

async function fetchScheduleData(): Promise<ScheduleData> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (scheduleCache?.etag) headers['If-None-Match'] = scheduleCache.etag;

  const response = await fetch(SCHEDULE_URL, {
    headers,
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 304 && scheduleCache) {
    scheduleCache.fetchedAt = Date.now();
    return scheduleCache.data;
  }
  if (!response.ok) {
    throw new Error(`Не удалось получить расписание: ${response.status} ${response.statusText}`);
  }

  const data = parseSchedulePayload(await response.json());
  scheduleCache = { data, etag: response.headers.get('etag'), fetchedAt: Date.now() };
  return data;
}

/** Расписание обновляется независимо от журнала, не чаще одного запроса в минуту. */
export function getScheduleData(): Promise<ScheduleData> {
  if (scheduleCache && Date.now() - scheduleCache.fetchedAt < SCHEDULE_CACHE_MS) {
    return Promise.resolve(scheduleCache.data);
  }
  if (!scheduleRequest) {
    scheduleRequest = fetchScheduleData().catch((error: unknown) => {
      if (scheduleCache && Date.now() - scheduleCache.fetchedAt < SCHEDULE_STALE_MAX_MS) {
        console.error('[лекции] Расписание временно недоступно, используем последнюю копию:', error);
        return scheduleCache.data;
      }
      throw error;
    }).finally(() => { scheduleRequest = null; });
  }
  return scheduleRequest;
}

function decodeHtmlText(value: string): string {
  const named: Record<string, string> = {
    amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—',
  };
  return value
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
      if (entity.startsWith('#')) {
        const codePoint = entity[1]?.toLowerCase() === 'x'
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
        return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : match;
      }
      return named[entity.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** ФИО и «Фамилия И.О.» дают один ключ; неполные имена не угадываем. */
export function teacherLookupKey(value: string): string | null {
  const words = decodeHtmlText(value).toLowerCase().replace(/ё/g, 'е')
    .match(/[\p{L}]+(?:-[\p{L}]+)*/gu);
  if (!words || words.length < 2) return null;

  const surname = words[0];
  const first = words[1];
  const second = words[2];
  if (second) return `${surname}:${first[0]}${second[0]}`;
  if (first.length === 2) return `${surname}:${first}`;
  return null;
}

function safeRoomUrl(value: string): string | null {
  try {
    const url = new URL(decodeHtmlText(value));
    if (url.protocol !== 'https:' || url.hostname !== 'eduskp-surgut.store' ||
        url.username || url.password || !/^\/b\/[a-z0-9-]+\/?$/i.test(url.pathname)) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

/** Из карточек Elementor берём только однозначные пары ФИО → ссылка комнаты. */
export function parseTeacherRoomLinks(html: string): Map<string, string> {
  const rooms = new Map<string, string>();
  const ambiguous = new Set<string>();
  const cards = html.split(/<div\b[^>]*class\s*=\s*["'][^"']*\belementor-icon-box-wrapper\b[^"']*["'][^>]*>/gi);

  for (const card of cards.slice(1)) {
    const title = card.match(/<h3\b[^>]*class\s*=\s*["'][^"']*\belementor-icon-box-title\b[^"']*["'][^>]*>[\s\S]*?<\/h3>/i)?.[0];
    const description = card.match(/<p\b[^>]*class\s*=\s*["'][^"']*\belementor-icon-box-description\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1];
    const href = title?.match(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!description || !href) continue;

    const key = teacherLookupKey(description);
    const url = safeRoomUrl(href);
    if (!key || !url || ambiguous.has(key)) continue;
    if (rooms.has(key) && rooms.get(key) !== url) {
      rooms.delete(key);
      ambiguous.add(key);
    } else {
      rooms.set(key, url);
    }
  }

  return rooms;
}

/** Совпадение строго по фамилии и обоим инициалам, без подбора похожих имён. */
export function matchTeacherRoom(teacher: string, rooms: Map<string, string>): string | null {
  const key = teacherLookupKey(teacher);
  return key ? rooms.get(key) ?? null : null;
}

async function fetchTeacherRoomLinks(): Promise<Map<string, string>> {
  const response = await fetch(TEACHER_ROOMS_URL, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Не удалось получить комнаты преподавателей: ${response.status} ${response.statusText}`);
  }
  const payload = record(await response.json());
  const content = record(payload?.content);
  const html = optionalText(content?.rendered);
  if (!html) throw new Error('Страница комнат преподавателей вернула пустой ответ.');

  const rooms = parseTeacherRoomLinks(html);
  if (!rooms.size) throw new Error('На странице колледжа не найдены ссылки на комнаты преподавателей.');
  roomsCache = { rooms, fetchedAt: Date.now() };
  return rooms;
}

/** Ссылки на комнаты обновляются раз в шесть часов; при сетевом сбое используется прошлый список. */
export async function getTeacherRoomLinks(): Promise<Map<string, string>> {
  if (roomsCache && Date.now() - roomsCache.fetchedAt < TEACHER_ROOMS_CACHE_MS) {
    return new Map(roomsCache.rooms);
  }
  if (!roomsRequest) {
    roomsRequest = fetchTeacherRoomLinks().catch((error: unknown) => {
      if (roomsCache) return roomsCache.rooms;
      throw error;
    }).finally(() => { roomsRequest = null; });
  }
  return new Map(await roomsRequest);
}
