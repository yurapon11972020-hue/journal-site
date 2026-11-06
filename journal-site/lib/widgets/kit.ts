import { deflateSync } from 'node:zlib';

/**
 * Общие куски HTML-виджетов Telegram (HTMLBubbles).
 *
 * Виджет — один самодостаточный HTML-документ, который бот присылает
 * сообщением (метод sendWidget, Bot API 10.4). Telegram отказывает, если HTML
 * длиннее 32 КБ или больше 4 КБ после zlib уровня 9; запас как в наборе
 * проверочных виджетов самого Telegram — 3800 байт. Внутри нет сети, полей
 * ввода и сторонних библиотек: только разметка, CSS, canvas и JS в QuickJS.
 *
 * Прозрачность (opacity < 1) и размытие Telegram считает «тяжёлыми» и
 * останавливает виджет, если таких элементов больше 16, поэтому вся
 * анимация здесь — на transform и цвете.
 */

export const WIDGET_MAX_HTML_BYTES = 32_000;
export const WIDGET_MAX_COMPRESSED_BYTES = 3_800;
export const WIDGET_CAPTION_LIMIT = 1024;

export interface WidgetMessage {
  /** Исходник виджета: его рисует клиент Telegram. */
  html: string;
  /** Подпись: её видят старые клиенты, список чатов и поиск (HTML-разметка Telegram). */
  caption: string;
}

export function widgetCompressedSize(html: string): number {
  return deflateSync(Buffer.from(html, 'utf8'), { level: 9 }).length;
}

export function fitsWidgetLimits(html: string): boolean {
  return Buffer.byteLength(html, 'utf8') <= WIDGET_MAX_HTML_BYTES
    && widgetCompressedSize(html) <= WIDGET_MAX_COMPRESSED_BYTES;
}

/** Данные вставляются в <script> как литерал: «<» и разделители строк экранируются. */
export function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** CSS и разметка: строки без отступов, склеенные без переводов строк. */
export function compactMarkup(source: string): string {
  return source.split('\n').map((line) => line.trim()).filter(Boolean).join('');
}

/** JS: строки без отступов. Переводы строк остаются — без них сломались бы выражения без «;». */
export function compactScript(source: string): string {
  return source.split('\n').map((line) => line.trim()).filter(Boolean).join('\n');
}

export function round2(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

export function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export function clampCaption(lines: string[]): string {
  const kept: string[] = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 1 > WIDGET_CAPTION_LIMIT) break;
    kept.push(line);
    length += line.length + 1;
  }
  return kept.join('\n');
}

/** Цвета отметок: различаются и оттенком, и светлотой, белый текст читается в обеих темах. */
export const CSS_BASE = compactMarkup(`
body{margin:0;padding:12px 14px 14px;font:15px/1.35 system-ui,sans-serif;color:var(--tg-theme-text-color);position:relative;overflow:hidden}
.h{color:var(--tg-theme-hint-color);font-size:13px}
.c5{background:#1E9E57}.c4{background:#2D7FD8}.c3{background:#D98A1C}.c2{background:#D9434A}.cn{background:#8C96A3}.cv{background:#7E6BC4}
.chip{display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:22px;padding:0 7px;border-radius:11px;color:#fff;font-weight:700;font-size:13px;flex:none;box-sizing:border-box}
button{font:inherit;border:0;border-radius:10px;padding:7px 10px;background:var(--tg-theme-secondary-bg-color);color:var(--tg-theme-text-color)}
button.on{background:var(--tg-theme-button-color);color:var(--tg-theme-button-text-color)}
@keyframes pop{0%{transform:scale(0)}70%{transform:scale(1.12)}100%{transform:scale(1)}}
`);

/** Конфетти падают ниже пузыря (он не выше 600 px) и там обрезаются: прозрачность не нужна. */
export const CSS_CONFETTI = compactMarkup(`
.cf{position:absolute;top:-14px;width:7px;height:11px;border-radius:2px;animation:f0 1.8s cubic-bezier(.25,.6,.45,1) both}
.f1{animation-name:f1}.f2{animation-name:f2}.f3{animation-name:f3}
@keyframes f0{to{transform:translate(-40px,640px) rotate(620deg)}}
@keyframes f1{to{transform:translate(30px,640px) rotate(-540deg)}}
@keyframes f2{to{transform:translate(-12px,640px) rotate(400deg)}}
@keyframes f3{to{transform:translate(45px,640px) rotate(-700deg)}}
`);

/** Общие функции: $, el (элемент с текстом через textContent), формат балла и цвет по баллу. */
export const JS_BASE = compactScript(`
const T=window.TelegramWidget,$=i=>document.getElementById(i);
const TC={c5:'#1E9E57',c4:'#2D7FD8',c3:'#D98A1C',c2:'#D9434A',cn:'#8C96A3',cv:'#7E6BC4'};
function el(t,c,x){const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function fm(v){return v==null?'—':v.toFixed(2).replace('.',',')}
function tn(v){return v==null?'cn':v>=4.5?'c5':v>=3.5?'c4':v>=2.5?'c3':'c2'}
function hap(k){try{const H=T&&T.HapticFeedback;if(H)k=='s'?H.notificationOccurred('success'):H.impactOccurred(k||'light')}catch(e){}}
function grow(bars){requestAnimationFrame(()=>requestAnimationFrame(()=>bars.forEach(b=>{b[0].style.transform='scaleX('+b[1]+')'})))}
`);

export const JS_CONFETTI = compactScript(`
function boom(n){const C=['#1E9E57','#2D7FD8','#D98A1C','#D9434A','#E05BB5','#F2C94C'];for(let i=0;i<n;i++){const e=el('i','cf f'+i%4),s=e.style;s.left=(4+Math.random()*92).toFixed(1)+'%';s.background=C[i%6];s.animationDuration=(1.3+Math.random()).toFixed(2)+'s';s.animationDelay=(Math.random()*.5).toFixed(2)+'s';document.body.appendChild(e)}}
`);

/** Кольцо прогресса на canvas: дорожка цвета темы и дуга от 12 часов по часовой стрелке. */
export const JS_RING = compactScript(`
const TR=(T&&T.themeParams&&T.themeParams.secondary_bg_color)||'rgba(128,128,128,.25)';
function ring(c,S,p,col){const r=Math.min(3,window.devicePixelRatio||1),x=c.getContext('2d'),w=S/11,R=S/2-w/2-1;if(c.width!=Math.round(S*r)){c.width=c.height=Math.round(S*r);c.style.width=c.style.height=S+'px'}x.setTransform(r,0,0,r,0,0);x.clearRect(0,0,S,S);x.lineWidth=w;x.lineCap='round';x.strokeStyle=TR;x.beginPath();x.arc(S/2,S/2,R,0,7);x.stroke();if(p>.002){x.strokeStyle=col;x.beginPath();x.arc(S/2,S/2,R,-1.5708,-1.5708+Math.min(p,1)*6.2832);x.stroke()}}
`);

export function widgetDocument(css: string, body: string, script: string): string {
  return `<style>${css}</style>${body}<script>${script}</script>`;
}

/**
 * Собирает виджет по уровням: 0 — со всеми данными, дальше — всё короче.
 * Первый уровень, который проходит лимиты Telegram, и есть результат;
 * если не прошёл ни один, бот отправит обычное текстовое сообщение.
 */
export function firstFitting(levels: number, build: (level: number) => string | null): string | null {
  for (let level = 0; level < levels; level += 1) {
    const html = build(level);
    if (html && fitsWidgetLimits(html)) return html;
  }
  return null;
}
