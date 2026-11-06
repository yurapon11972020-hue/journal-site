import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

import type { JournalChange } from '@/lib/notify-messages';
import { calculatorWidget, countNumericMarks } from '@/lib/widgets/calculator';
import { gradeAlertWidget } from '@/lib/widgets/grade-alert';
import {
  embedJson,
  WIDGET_CAPTION_LIMIT,
  WIDGET_MAX_COMPRESSED_BYTES,
  WIDGET_MAX_HTML_BYTES,
  widgetCompressedSize,
  type WidgetMessage,
} from '@/lib/widgets/kit';
import { lectureWidget, type LectureWidgetInput } from '@/lib/widgets/lecture';
import { ratingWidget } from '@/lib/widgets/rating';
import { studentCardWidget } from '@/lib/widgets/student-card';

import { WIDGET_STUDENTS, WIDGET_SUBJECTS, widgetJournal } from './helpers/widget-fixture';

/** Свойства CSS из профиля виджетов Telegram 1 (docs/profile-v1.md), которые могут понадобиться карточкам. */
const ALLOWED_CSS = new Set([
  'display', 'flex', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap', 'width', 'height',
  'min-width', 'min-height', 'max-width', 'max-height', 'margin', 'margin-top', 'margin-right', 'margin-bottom',
  'margin-left', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border',
  'border-color', 'border-radius', 'box-sizing', 'position', 'top', 'right', 'bottom', 'left', 'overflow',
  'color', 'background', 'font', 'font-size', 'font-weight', 'line-height', 'font-variant-numeric', 'text-align',
  'text-decoration', 'white-space', 'text-overflow', 'transform', 'transform-origin', 'transition',
  'transition-delay', 'animation', 'animation-name', 'animation-delay', 'animation-duration',
]);

/** Элементы, которые карточки создают; все — из профиля (canvas, button и текстовые). */
const ALLOWED_ELEMENTS = new Set(['style', 'script', 'div', 'span', 'b', 'i', 'button', 'canvas']);

/** То, что Telegram вырезает или запрещает; прозрачность — «тяжёлая» отрисовка, её карточки не используют. */
const FORBIDDEN = [
  /<(input|select|textarea|form|iframe|video|audio|img|link|meta|svg)\b/i,
  /\d(vh|dvh|svh)\b/, /@font-face/, /@import/, /position:\s*sticky/, /overflow:\s*(auto|scroll)/, /text-shadow/,
  /:has\(/, /\bfetch\(/, /XMLHttpRequest/, /WebSocket/, /window\.open/, /\.focus\(/, /touch(start|move|end)/,
  /key(down|up|press)/, /cssText/, /innerHTML/, /opacity/, /localStorage/, /\balert\(/, /https?:\/\//,
];

function parts(html: string): { css: string; body: string; script: string; template: string } {
  const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));
  const body = html.slice(html.indexOf('</style>') + 8, html.indexOf('<script>'));
  const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  // Данные (const D=…) — содержимое журнала, а не код: правила профиля к ним не относятся.
  const template = html.replace(/const D=.*;\n/, '');
  return { css, body, script, template };
}

function cssProperties(css: string, body: string, script: string): string[] {
  const declarations = [...css.matchAll(/\{([^{}]*)\}/g)].flatMap((match) => match[1].split(';'));
  const inline = [...body.matchAll(/style="([^"]*)"/g)].flatMap((match) => match[1].split(';'));
  const fromCss = [...declarations, ...inline]
    .map((item) => item.split(':')[0].trim())
    .filter(Boolean);
  const fromScript = [...script.matchAll(/\.style\.([a-zA-Z]+)\s*=/g)]
    .map((match) => match[1].replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`));
  return [...new Set([...fromCss, ...fromScript])];
}

function elements(body: string, script: string): string[] {
  const tags = [...body.matchAll(/<([a-z][a-z0-9]*)[\s>]/g)].map((match) => match[1]);
  const created = [...script.matchAll(/el\('([a-z]+)'/g)].map((match) => match[1]);
  return [...new Set(['style', 'script', ...tags, ...created])];
}

function expectWithinTelegramProfile(widget: WidgetMessage | null): WidgetMessage {
  expect(widget).not.toBeNull();
  const { html, caption } = widget!;
  expect(Buffer.byteLength(html)).toBeLessThanOrEqual(WIDGET_MAX_HTML_BYTES);
  expect(widgetCompressedSize(html)).toBeLessThanOrEqual(WIDGET_MAX_COMPRESSED_BYTES);
  expect(caption.length).toBeGreaterThan(0);
  expect(caption.length).toBeLessThanOrEqual(WIDGET_CAPTION_LIMIT);

  const { css, body, script, template } = parts(html);
  for (const pattern of FORBIDDEN) {
    expect(template, String(pattern)).not.toMatch(pattern);
  }
  expect(cssProperties(css, body, script).filter((name) => !name.startsWith('--') && !ALLOWED_CSS.has(name))).toEqual([]);
  expect(elements(body, script).filter((name) => !ALLOWED_ELEMENTS.has(name))).toEqual([]);
  expect(html.match(/<\/script>/g)).toHaveLength(1);
  expect(() => new vm.Script(script)).not.toThrow();
  return widget!;
}

/* ------------- запуск скрипта виджета на заглушке DOM, без браузера ------------- */

class StubElement {
  className = '';
  style: Record<string, string> = {};
  children: StubElement[] = [];
  onclick: (() => void) | null = null;
  width = 0;
  height = 0;
  private text = '';

  constructor(readonly tagName: string) {}

  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join('');
  }

  set textContent(value: string) {
    this.text = String(value);
    this.children = [];
  }

  appendChild(child: StubElement): StubElement {
    this.children.push(child);
    return child;
  }

  getContext(): Record<string, unknown> {
    const noop = () => undefined;
    return { setTransform: noop, clearRect: noop, beginPath: noop, arc: noop, stroke: noop };
  }
}

function runWidget(html: string) {
  const { body, script } = parts(html);
  const byId = new Map([...body.matchAll(/<([a-z0-9]+)[^>]*\bid="([^"]+)"/g)].map((match) => [match[2], new StubElement(match[1])]));
  const queue: Array<(time: number) => void> = [];
  const intervals: Array<() => void> = [];
  const openLink = vi.fn();
  const haptics = { impactOccurred: vi.fn(), notificationOccurred: vi.fn() };
  const document = {
    body: new StubElement('body'),
    getElementById: (id: string) => byId.get(id) ?? null,
    createElement: (tag: string) => new StubElement(tag),
  };
  vm.runInNewContext(script, {
    window: { TelegramWidget: { themeParams: {}, HapticFeedback: haptics, openLink }, devicePixelRatio: 2 },
    document,
    requestAnimationFrame: (callback: (time: number) => void) => queue.push(callback),
    setTimeout: (callback: () => void) => queue.push(callback),
    setInterval: (callback: () => void) => intervals.push(callback),
    Date,
    Math,
  });
  const flush = () => {
    for (let round = 0; round < 6 && queue.length; round += 1) {
      for (const callback of queue.splice(0)) callback(Date.now());
    }
    intervals.forEach((callback) => callback());
  };
  return { byId, body: document.body, flush, openLink, haptics };
}

/* --------------------------------- тесты --------------------------------- */

const change = (overrides: Partial<JournalChange> = {}): JournalChange => ({
  studentId: 1,
  studentName: WIDGET_STUDENTS[0],
  subject: WIDGET_SUBJECTS[0],
  columnLabel: '5 сен',
  before: '',
  after: '5',
  ...overrides,
});

function lectureInput(overrides: Partial<LectureWidgetInput> = {}): LectureWidgetInput {
  return {
    video: true,
    startsAt: new Date(Date.now() + 9 * 60_000),
    endsAt: new Date(Date.now() + 99 * 60_000),
    subject: 'Операционные системы и среды (Лек)',
    time: '10:00–11:30',
    group: 'ИСиП-24/1',
    teachers: ['Сидоров И. И.'],
    room: '',
    links: [{ label: '🎥 Подключиться', url: 'https://room.example/sidorov' }],
    ...overrides,
  };
}

describe('анимированные карточки (HTMLBubbles)', () => {
  it('табель студента с 15 предметами укладывается в лимиты Telegram и рисуется', () => {
    const widget = expectWithinTelegramProfile(studentCardWidget(widgetJournal(), 1));
    expect(widget.caption).toContain('Абрамов Пётр Ильич');

    const run = runWidget(widget.html);
    run.flush();
    expect(run.byId.get('n')?.textContent).toBe('Абрамов Пётр Ильич');
    // 8 предметов на странице и кнопка «Ещё предметы».
    const list = run.byId.get('p')!;
    expect(list.children).toHaveLength(9);
    // Зачёт из табеля показывается подписью, а не числом.
    expect(list.textContent).toContain('Физическая культура');
    expect(list.textContent).toContain('зач');
    expect(list.children[8].textContent).toBe('Ещё предметы · 1/2');
    list.children[8].onclick?.();
    // Вторая страница: 7 предметов и та же кнопка.
    expect(list.children).toHaveLength(8);
    expect(list.children[7].textContent).toBe('Ещё предметы · 2/2');
  });

  it('пустой табель и неизвестный студент не ломают карточку', () => {
    const data = widgetJournal({ students: ['Абрамов Пётр Ильич'], subjects: [], reportCards: false });
    const run = runWidget(expectWithinTelegramProfile(studentCardWidget(data, 1)).html);
    run.flush();
    expect(run.byId.get('p')?.textContent).toBe('Оценок пока нет');
    expect(studentCardWidget(data, 999)).toBeNull();
  });

  it('калькулятор считает, сколько пятёрок нужно до следующей оценки', () => {
    const data = widgetJournal();
    const widget = expectWithinTelegramProfile(calculatorWidget(data, 1));
    const run = runWidget(widget.html);
    const hint = () => run.byId.get('kh')!.textContent;

    const first = hint();
    expect(first).toMatch(/^До (пятёрки|четвёрки|тройки) нужно ещё \d+ (пятёрка|пятёрки|пятёрок)$|^Выходит пятёрка/);
    run.byId.get('a5')!.onclick?.();
    expect(run.byId.get('kl')!.children.map((chip) => chip.textContent)).toEqual(['+5']);
    run.byId.get('kr')!.onclick?.();
    expect(hint()).toBe(first);
    run.byId.get('kn')!.onclick?.();
    expect(run.byId.get('ks')!.textContent).toBe(WIDGET_SUBJECTS[1]);

    expect(calculatorWidget(widgetJournal({ subjects: [] }), 1)).toBeNull();
  });

  it('калькулятор понимает двойные отметки и пропускает «н» и «зач»', () => {
    const grades = ['5', '4/5', '3', 'н', 'зач', '2', '5.'].map((value) => ({
      column: 'C', monthLabel: null, dayLabel: null, label: value, value,
    }));
    expect(countNumericMarks(grades)).toEqual([3, 1, 1, 1]);
  });

  it('рейтинг рисует пьедестал и листает остальных по восемь', () => {
    const widget = expectWithinTelegramProfile(ratingWidget(widgetJournal()));
    expect(widget.caption).toContain('🥇 Абрамов П.И.');

    const run = runWidget(widget.html);
    run.flush();
    expect(run.byId.get('pd')!.children).toHaveLength(3);
    expect(run.byId.get('ls')!.children).toHaveLength(8);
    expect(run.byId.get('pi')!.textContent).toBe('4–11 из 25');
    run.byId.get('pn')!.onclick?.();
    expect(run.byId.get('pi')!.textContent).toBe('12–19 из 25');
  });

  it('уведомление об оценке выбирает цвет и анимацию по отметке', () => {
    const cases: Array<[Partial<JournalChange>, string, string]> = [
      [{ after: '5' }, 'c5', 'bn'],
      [{ after: '2' }, 'c2', 'sh'],
      [{ after: 'н' }, 'cn', 'fl'],
      [{ before: '2', after: '4' }, 'c4', ''],
      [{ before: 'н', after: '' }, 'c5', ''],
    ];
    for (const [overrides, colour, effect] of cases) {
      const widget = expectWithinTelegramProfile(gradeAlertWidget(change(overrides), widgetJournal()));
      const run = runWidget(widget.html);
      run.flush();
      const mark = run.byId.get('m')!;
      expect(mark.className).toContain(colour);
      if (effect) expect(mark.className).toContain(effect);
      expect(widget.caption).not.toContain('<b>');
    }
    // Стёртую оценку не присылаем, как и раньше.
    expect(gradeAlertWidget(change({ before: '5', after: '' }), widgetJournal())).toBeNull();
  });

  it('напоминание о паре ведёт обратный отсчёт и открывает комнату по нажатию', () => {
    const widget = expectWithinTelegramProfile(lectureWidget(lectureInput()));
    expect(widget.caption).toContain('<a href="https://room.example/sidorov">🎥 Подключиться</a>');

    const run = runWidget(widget.html);
    run.flush();
    expect(run.byId.get('t')!.textContent).toMatch(/^0\d:\d\d$/);
    expect(run.byId.get('tl')!.textContent).toBe('до начала');
    const buttons = run.byId.get('ls')!.children;
    expect(buttons).toHaveLength(1);
    buttons[0].onclick?.();
    expect(run.openLink).toHaveBeenCalledWith('https://room.example/sidorov');

    const live = runWidget(lectureWidget(lectureInput({ video: false, links: [], room: 'каб. 305', startsAt: new Date(Date.now() - 60_000) }))!.html);
    live.flush();
    expect(live.byId.get('tl')!.textContent).toBe('до конца');
    expect(live.byId.get('dt')!.className).toBe('dot lv');
  });

  it('данные журнала не могут закрыть <script> или подменить разметку', () => {
    const hostile = '</script><b onclick=alert(1)>«5»</b>\u2028';
    expect(embedJson(hostile)).not.toContain('<');
    const data = widgetJournal({ students: [hostile], subjects: [hostile] });
    for (const widget of [studentCardWidget(data, 1), calculatorWidget(data, 1), ratingWidget(data)]) {
      const html = expectWithinTelegramProfile(widget).html;
      expect(html).not.toContain('</script><b');
    }
    expect(studentCardWidget(data, 1)!.caption).toContain('&lt;/script&gt;');
  });

  it('слишком большой журнал сокращается, а не ломает лимит', () => {
    const many = Array.from({ length: 60 }, (_, index) => `Очень длинное название междисциплинарного курса номер ${index + 1}`);
    const widget = studentCardWidget(widgetJournal({ subjects: many, students: WIDGET_STUDENTS.slice(0, 2) }), 1);
    expectWithinTelegramProfile(widget);
  });
});
