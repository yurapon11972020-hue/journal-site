import { escapeHtml } from '@/lib/telegram';

import {
  clampCaption,
  compactMarkup,
  compactScript,
  CSS_BASE,
  embedJson,
  firstFitting,
  JS_BASE,
  JS_RING,
  truncate,
  widgetDocument,
  type WidgetMessage,
} from './kit';

export interface LectureWidgetInput {
  video: boolean;
  startsAt: Date;
  /** Конец пары по расписанию; null — время окончания не указано. */
  endsAt: Date | null;
  subject: string;
  /** Время как в расписании: «10:00–11:30». */
  time: string;
  group: string;
  teachers: string[];
  /** Аудитория обычной лекции. */
  room: string;
  links: Array<{ label: string; url: string }>;
}

const CSS = CSS_BASE + compactMarkup(`
.hd{display:flex;align-items:center;gap:8px;font-weight:700}
.dot{width:10px;height:10px;border-radius:50%;background:#D98A1C;flex:none}
.lv{background:#D9434A;animation:pl 1.2s ease-in-out infinite}
@keyframes pl{0%,100%{transform:scale(1)}50%{transform:scale(1.6)}}
.rg{position:relative;width:150px;height:150px;margin:10px auto 8px}
.rg div{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.t{font-size:32px;font-weight:800;font-variant-numeric:tabular-nums}
.s{font-weight:700;font-size:16px;text-align:center}
.i{text-align:center;margin-top:3px}
.l{display:block;width:100%;margin-top:10px;padding:11px;border-radius:12px;font-weight:700;background:var(--tg-theme-button-color);color:var(--tg-theme-button-text-color);animation:gl 2.4s ease-in-out infinite}
@keyframes gl{0%,100%{transform:scale(1)}50%{transform:scale(1.03)}}
`);

const BODY = compactMarkup(`
<div class="hd"><span class="dot" id="dt"></span><span id="hd"></span></div>
<div class="rg"><canvas id="c"></canvas><div><span class="t" id="t"></span><span class="h" id="tl"></span></div></div>
<div class="s" id="s"></div><div class="i h" id="i"></div><div id="ls"></div>
`);

/**
 * D: v — видеолекция, a и e — начало и конец (мс от 1970), s — предмет, tm — время,
 * g — группа, tc — преподаватели, rm — аудитория, l — ссылки на комнаты.
 * Обратный отсчёт считается на телефоне по часам устройства раз в секунду.
 */
const SCRIPT = compactScript(`
$('hd').textContent=(D.v?'🎥 Видеолекция':'📚 Лекция')+(D.g?' · '+D.g:'');$('s').textContent=D.s;
$('i').textContent=[D.tm,D.tc,D.rm].filter(Boolean).join(' · ');
D.l.forEach(x=>{const b=el('button','l',x[0]);b.onclick=()=>{try{T&&T.openLink(x[1])}catch(e){}};$('ls').appendChild(b)});
function tw(ms){const s=Math.max(0,Math.round(ms/1000)),h=Math.floor(s/3600),m=Math.floor(s%3600/60),z=s%60,p=v=>(v<10?'0':'')+v;return(h?h+':'+p(m):p(m))+':'+p(z)}
function tick(){const n=Date.now();let p=1,c='#8C96A3',t='✓',l='занятие закончилось',lv=0;
if(n<D.a){const r=D.a-n;p=Math.min(1,r/6e5);c=r<12e4?'#D9434A':'#D98A1C';t=tw(r);l='до начала'}
else if(!D.e||n<D.e){lv=1;c='#1E9E57';if(D.e){p=(n-D.a)/(D.e-D.a);t=tw(D.e-n);l='до конца'}else{t='идёт';l='занятие началось'}}
ring($('c'),150,p,c);$('t').textContent=t;$('tl').textContent=l;$('dt').className='dot'+(lv?' lv':'')}
tick();setInterval(tick,1000);
`);

/** openLink в виджете принимает только https-адреса до 256 символов. */
function usableLink(url: string): boolean {
  return /^https:\/\//i.test(url) && url.length <= 256;
}

export function lectureWidget(input: LectureWidgetInput): WidgetMessage | null {
  const links = input.links.filter((link) => usableLink(link.url)).slice(0, 4);
  const teachers = input.teachers.join(', ');

  const html = firstFitting(2, (level) => {
    const payload = {
      v: input.video ? 1 : 0,
      a: input.startsAt.getTime(),
      e: input.endsAt && input.endsAt.getTime() > input.startsAt.getTime() ? input.endsAt.getTime() : null,
      s: truncate(input.subject, level ? 60 : 120),
      tm: truncate(input.time, 20),
      g: truncate(input.group, 30),
      tc: truncate(teachers, level ? 60 : 160),
      rm: input.video ? '' : truncate(input.room ? `📍 ${input.room}` : '', 40),
      l: links.map((link) => [truncate(link.label, 40), link.url]),
    };
    return widgetDocument(CSS, BODY, [JS_BASE, JS_RING, `const D=${embedJson(payload)};`, SCRIPT].join('\n'));
  });
  if (!html) return null;

  return {
    html,
    caption: clampCaption([
      `${input.video ? '🎥 <b>Видеолекция</b>' : '📚 <b>Лекция</b>'} · ${escapeHtml(truncate(input.time, 20))}`,
      escapeHtml(truncate(input.subject, 200)),
      `Преподаватель: ${teachers ? escapeHtml(truncate(teachers, 300)) : 'не указан'}`,
      ...(input.video ? [] : [`Аудитория: ${input.room ? escapeHtml(truncate(input.room, 80)) : 'не указана'}`]),
      // Ссылками в подписи подключаются и те, у кого Telegram ещё не умеет виджеты.
      ...input.links
        .filter((link) => /^https?:\/\//i.test(link.url))
        .map((link) => `<a href="${escapeHtml(link.url).replace(/"/g, '&quot;')}">${escapeHtml(truncate(link.label, 60))}</a>`),
    ]),
  };
}
