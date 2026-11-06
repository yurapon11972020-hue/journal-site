import { classifyMarkValue, type MarkTone } from '@/lib/mark-classifier';

/**
 * Одно изменение в журнале: что было в клетке и что стало.
 * Пустая строка означает, что клетка была (или стала) пустой.
 */
export interface JournalChange {
  studentId: number;
  studentName: string;
  subject: string;
  /** Подпись занятия, как в журнале: «3 сен». */
  columnLabel: string;
  before: string;
  after: string;
}

interface Phrase {
  icon: string;
  lines: string[];
}

/**
 * Реплики на каждый случай. Вариантов по несколько, чтобы бот не долбил
 * одним и тем же текстом — какой достанется, зависит от самой оценки,
 * поэтому повтор одного и того же события даёт тот же текст.
 */
const PHRASES: Record<string, Phrase> = {
  excellent: {
    icon: '🔥',
    lines: [
      'зашибись',
      'красавчик',
      'топ',
      'машина',
      'идеально',
      'вот это уровень',
      'ни добавить, ни убавить',
      'эталон',
    ],
  },
  good: {
    icon: '👍',
    lines: [
      'молодец',
      'красава',
      'почти идеал',
      'уверенно',
      'так держать',
      'чуть-чуть до пятёрки',
      'крепко',
      'достойно',
    ],
  },
  ok: {
    icon: '🙂',
    lines: [
      'нормалек',
      'жить можно',
      'сойдёт',
      'не блеск, но и не два',
      'рабочая тройка',
      'идём дальше',
      'бывало и хуже',
      'зачёт по факту',
    ],
  },
  bad: {
    icon: '💀',
    lines: [
      'анлак',
      'бывает, не последняя',
      'ну такое',
      'это фиаско',
      'переживём',
      'не твой день',
      'зато честно',
      'исправляй давай',
    ],
  },
  absence: {
    icon: '🫥',
    lines: [
      'ты куда делся?',
      'тебя потеряли',
      'и где ты был?',
      'прогул засчитан, поздравляю',
      'пара прошла без тебя',
      'тебя не было, а пара была',
      'отметочка в копилку',
      'ну и где тебя носило?',
    ],
  },
  'valid-absence': {
    icon: '📄',
    lines: [
      'фигня, отработаешь',
      'по уважительной — вопросов нет',
      'с документом всё ок',
      'уважительная, живём',
      'зачтено, не переживай',
      'это не страшно',
    ],
  },
  cleared: {
    icon: '✅',
    lines: [
      'надеюсь, это последняя',
      'минус один долг',
      'закрыл, красиво',
      'отработал — красава',
      'долгов меньше',
      'так и надо',
      'чисто',
    ],
  },
  fixed: {
    icon: '📈',
    lines: [
      'вот это другое дело',
      'исправил, красава',
      'совсем другой разговор',
      'растём',
      'так-то лучше',
    ],
  },
  plain: {
    icon: '📝',
    lines: ['отмечено в журнале'],
  },
};

/** Тона, о которых вообще имеет смысл писать. */
const NOTIFIED_TONES: MarkTone[] = [
  'excellent',
  'good',
  'ok',
  'bad',
  'absence',
  'valid-absence',
  'electronic-absence',
  'plain',
];

/**
 * Устойчивый выбор реплики: один и тот же случай всегда даёт один и тот же
 * текст. Иначе повторная отправка (например, после перезапуска) выглядела бы
 * как новое событие с другими словами.
 */
function pickLine(phrase: Phrase, seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return phrase.lines[hash % phrase.lines.length];
}

function isAbsenceTone(tone: MarkTone): boolean {
  return tone === 'absence' || tone === 'valid-absence' || tone === 'electronic-absence';
}

function phraseKeyFor(tone: MarkTone): string {
  return tone === 'electronic-absence' ? 'absence' : tone;
}

/** Что именно случилось: тон новой отметки, «отработал» или «исправил». */
export type ChangeKind = MarkTone | 'cleared' | 'fixed';

/** Разобранное уведомление: из него собираются и текст, и виджет. */
export interface ChangeParts {
  kind: ChangeKind;
  icon: string;
  /** Реплика без иконки: «зашибись». */
  phrase: string;
  beforeText: string;
  afterText: string;
  /** Готовый текст сообщения — тот же, что раньше возвращал describeChange. */
  text: string;
}

/**
 * Разбирает изменение в журнале для уведомления.
 * Возвращает null, если писать не о чем.
 */
export function describeChangeParts(change: JournalChange): ChangeParts | null {
  const before = classifyMarkValue(change.before);
  const after = classifyMarkValue(change.after);

  const wasEmpty = before.tone === 'empty';
  const nowEmpty = after.tone === 'empty';
  const marks = { beforeText: before.displayText, afterText: after.displayText };

  // Пропуск закрыли: было «н», стало пусто или что-то другое.
  if (!wasEmpty && isAbsenceTone(before.tone) && (nowEmpty || !isAbsenceTone(after.tone))) {
    const phrase = PHRASES.cleared;
    const seed = `${change.studentId}|${change.subject}|${change.columnLabel}|cleared`;
    const line = pickLine(phrase, seed);
    return {
      kind: 'cleared',
      icon: phrase.icon,
      phrase: line,
      ...marks,
      text: `${phrase.icon} Отработал ${before.displayText} по «${change.subject}» — ${line}`,
    };
  }

  if (nowEmpty) {
    // Оценку просто стёрли — про такое не пишем.
    return null;
  }

  if (!NOTIFIED_TONES.includes(after.tone)) {
    return null;
  }

  // Оценку исправили на более высокую.
  const rank: Partial<Record<MarkTone, number>> = { bad: 1, ok: 2, good: 3, excellent: 4 };
  const beforeRank = rank[before.tone];
  const afterRank = rank[after.tone];
  if (beforeRank && afterRank && afterRank > beforeRank) {
    const phrase = PHRASES.fixed;
    const seed = `${change.studentId}|${change.subject}|${change.columnLabel}|fixed`;
    const line = pickLine(phrase, seed);
    return {
      kind: 'fixed',
      icon: phrase.icon,
      phrase: line,
      ...marks,
      text: `${phrase.icon} Исправил ${before.displayText} на ${after.displayText} по «${change.subject}» — ${line}`,
    };
  }

  const phrase = PHRASES[phraseKeyFor(after.tone)] ?? PHRASES.plain;
  const seed = `${change.studentId}|${change.subject}|${change.columnLabel}|${change.after}`;
  const line = pickLine(phrase, seed);

  return {
    kind: after.tone,
    icon: phrase.icon,
    phrase: line,
    ...marks,
    text: `${phrase.icon} ${after.displayText} по «${change.subject}» — ${line}`,
  };
}

/**
 * Превращает изменение в журнале в текст сообщения.
 * Возвращает null, если писать не о чем.
 */
export function describeChange(change: JournalChange): string | null {
  return describeChangeParts(change)?.text ?? null;
}
