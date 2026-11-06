import {
  compactMarkup,
  compactScript,
  CSS_BASE,
  CSS_CONFETTI,
  embedJson,
  firstFitting,
  JS_BASE,
  JS_CONFETTI,
  widgetDocument,
  type WidgetMessage,
} from './kit';

/**
 * Детали, из которых собираются экраны бота: у всех карточек один заголовок
 * и одни и те же плитки, графики и списки. В карточку попадает код только
 * тех деталей, что ей нужны, — так каждая остаётся в лимите Telegram.
 */
export type Block = 'stats' | 'dist' | 'grid' | 'chips' | 'list' | 'cards' | 'foot';

/** Данные экрана. Ключи короткие: они лежат в каждой карточке и считаются в лимит. */
export interface ScreenData {
  /** Эмодзи, заголовок и подзаголовок. */
  e: string;
  t: string;
  s?: string;
  /** Плитки: подпись, значение и 'a' — это средний балл (с цветом). */
  st?: Array<[string, number | string, 'a'?]>;
  /** Столбики: подпись, количество, цвет; dt — заголовок над ними. */
  ds?: Array<[string, number, string]>;
  dt?: string;
  /** Кружки: буквы, имя, средний, цвет. */
  gr?: Array<[string, string, string, string]>;
  /** Группы отметок: заголовок, подзаголовок, отметки [текст, цвет]; cp — групп на странице. */
  cs?: Array<[string, string | null, Array<[string, string]>]>;
  cp?: number;
  ce?: string;
  /** Строки: название, пояснение, значок, его цвет, полоска 0…1; pg — строк на странице. */
  ls?: Array<[string, string | null, string | null, string | null, number | null]>;
  pg?: number;
  le?: string;
  /** Карточки: значок, текст, пояснение. */
  cd?: Array<[string | null, string, string | null]>;
  /** Подсказка внизу. */
  f?: string;
}

const HEAD_CSS = compactMarkup(`
.hd{display:flex;align-items:center;gap:12px;margin-bottom:10px}
.he{font-size:34px;line-height:1;flex:none;animation:pop .6s cubic-bezier(.2,1.4,.4,1) both,fl 3s ease-in-out .6s infinite}
@keyframes fl{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
.hm{min-width:0}
.ht{font-weight:800;font-size:17px;line-height:1.2}
.mr{display:block;width:100%;margin-top:6px}
`);

const HEAD_HTML = '<div class="hd"><div class="he" id="he"></div><div class="hm"><div class="ht" id="ht"></div><div class="h" id="hs"></div></div></div>';

const COMMON_JS = compactScript(`
function pager(box,n,cur,go){if(n>1){const m=el('button','mr','Ещё · '+(cur+1)+'/'+n);m.onclick=()=>{go((cur+1)%n);hap()};box.appendChild(m)}}
function cnt(e,v,a){const s=Date.now();(function k(){const p=Math.min(1,(Date.now()-s)/900),q=1-Math.pow(1-p,3);e.textContent=a?fm(v*q):String(Math.round(v*q));if(p<1)requestAnimationFrame(k)})()}
$('he').textContent=D.e;$('ht').textContent=D.t;$('hs').textContent=D.s||'';
`);

interface BlockParts {
  css: string;
  html: string;
  js: string;
}

const BLOCKS: Record<Block, BlockParts> = {
  stats: {
    css: compactMarkup(`
.st{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}
.sv{background:var(--tg-theme-secondary-bg-color);border-radius:12px;padding:9px 11px;animation:pop .5s both}
.sv b{display:block;font-size:22px;font-weight:800;line-height:1.2}
`),
    html: '<div class="st" id="st"></div>',
    js: compactScript(`
if(D.st.length==3)$('st').style.gridTemplateColumns='1fr 1fr 1fr';
D.st.forEach((x,i)=>{const t=el('div','sv'),b=el('b');t.style.animationDelay=i*.07+'s';t.appendChild(b);t.appendChild(el('div','h',x[0]));$('st').appendChild(t);if(typeof x[1]=='number'){if(x[2]=='a')b.style.color=TC[tn(x[1])];cnt(b,x[1],x[2]=='a')}else b.textContent=x[1]});
`),
  },
  dist: {
    css: compactMarkup(`
.ds{display:flex;align-items:flex-end;gap:10px;height:100px;margin:4px 0 10px}
.dc{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%}
.dc i{width:100%;border-radius:8px 8px 3px 3px;transform-origin:bottom;animation:up .8s cubic-bezier(.2,1.2,.4,1) both}
@keyframes up{0%{transform:scaleY(0)}100%{transform:scaleY(1)}}
.dc b{font-size:13px;margin-bottom:3px}
`),
    html: '<div class="h" id="dt"></div><div class="ds" id="ds"></div>',
    js: compactScript(`
$('dt').textContent=D.dt||'';
{const M=Math.max(1,...D.ds.map(x=>x[1]));D.ds.forEach((x,i)=>{const c=el('div','dc'),b=el('i',x[2]);b.style.height=Math.max(4,Math.round(x[1]/M*62))+'px';b.style.animationDelay=i*.1+'s';c.appendChild(el('b',null,String(x[1])));c.appendChild(b);c.appendChild(el('span','h',x[0]));$('ds').appendChild(c)})}
`),
  },
  grid: {
    css: compactMarkup(`
.gr{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:4px 0 8px}
.av{aspect-ratio:1;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:14px;padding:0;animation:pop .45s both}
.av.on{outline:3px solid var(--tg-theme-button-color);outline-offset:2px}
.gd{min-height:38px;text-align:center}
`),
    html: '<div class="gr" id="gr"></div><div class="gd" id="gd"></div>',
    js: compactScript(`
{const g=$('gr');let on=null;if(D.gr.length>30)g.style.gridTemplateColumns='repeat(6,1fr)';
D.gr.forEach((s,i)=>{const b=el('button','av '+s[3],s[0]);b.style.animationDelay=(i*.03).toFixed(2)+'s';b.onclick=()=>{if(on)on.className=on.className.replace(' on','');b.className+=' on';on=b;const d=$('gd');d.textContent='';d.appendChild(el('b',null,s[1]));d.appendChild(el('div','h','средний балл '+s[2]));hap()};g.appendChild(b)})}
`),
  },
  chips: {
    css: compactMarkup(`
.cs{margin:4px 0 10px}
.cs b{display:block}
.cw{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}
.cw .chip{animation:pop .35s both}
`),
    html: '<div id="cs"></div>',
    js: compactScript(`
let cp=0;
function secs(){const p=$('cs'),P=D.cp||3,N=Math.ceil(D.cs.length/P);p.textContent='';
D.cs.slice(cp*P,cp*P+P).forEach((s,i)=>{const w=el('div','cs'),c=el('div','cw');w.appendChild(el('b',null,s[0]));if(s[1])w.appendChild(el('div','h',s[1]));s[2].forEach((x,j)=>{const k=el('span','chip '+x[1],x[0]);k.style.animationDelay=(i*.1+j*.02).toFixed(2)+'s';c.appendChild(k)});w.appendChild(c);p.appendChild(w)});
if(!D.cs.length&&D.ce)p.appendChild(el('div','h',D.ce));pager(p,N,cp,v=>{cp=v;secs()})}
secs();
`),
  },
  list: {
    css: compactMarkup(`
.it{padding:6px 0}
.ln{display:flex;align-items:center;gap:8px}
.sn{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.br{height:5px;border-radius:3px;background:var(--tg-theme-secondary-bg-color);margin-top:5px;overflow:hidden}
.br i{display:block;height:100%;border-radius:3px;transform-origin:left;transform:scaleX(0);transition:transform .9s cubic-bezier(.2,.8,.2,1)}
`),
    html: '<div id="ls"></div>',
    js: compactScript(`
let lp=0;
function rows(){const p=$('ls'),P=D.pg||8,N=Math.ceil(D.ls.length/P),bars=[];p.textContent='';
D.ls.slice(lp*P,lp*P+P).forEach((r,i)=>{const it=el('div','it'),ln=el('div','ln');ln.appendChild(el('span','sn',r[0]));if(r[1])ln.appendChild(el('span','h',r[1]));if(r[2]!=null)ln.appendChild(el('span','chip '+(r[3]||'cn'),r[2]));it.appendChild(ln);if(r[4]!=null){const br=el('div','br'),b=el('i');b.style.background=TC[r[3]]||TC.cn;b.style.transitionDelay=i*60+'ms';br.appendChild(b);it.appendChild(br);bars.push([b,r[4]])}p.appendChild(it)});
if(!D.ls.length&&D.le)p.appendChild(el('div','h',D.le));pager(p,N,lp,v=>{lp=v;rows()});grow(bars)}
rows();
`),
  },
  cards: {
    css: compactMarkup(`
.cd{display:flex;gap:10px;padding:9px 11px;margin:6px 0;border-radius:12px;background:var(--tg-theme-secondary-bg-color);animation:sl .45s cubic-bezier(.2,.8,.2,1) both}
@keyframes sl{0%{transform:translateX(-20px)}100%{transform:none}}
.cd i{font-style:normal;flex:none;font-weight:700;color:var(--tg-theme-accent-text-color,var(--tg-theme-button-color))}
.cd div{min-width:0}
.ct{font-weight:600}
`),
    html: '<div id="cd"></div>',
    js: compactScript(`
D.cd.forEach((c,i)=>{const w=el('div','cd'),d=el('div');w.style.animationDelay=i*.07+'s';if(c[0])w.appendChild(el('i',null,c[0]));d.appendChild(el('div','ct',c[1]));if(c[2])d.appendChild(el('div','h',c[2]));w.appendChild(d);$('cd').appendChild(w)});
`),
  },
  foot: {
    css: compactMarkup(`
.ft{margin-top:8px;text-align:center}
`),
    html: '<div class="h ft" id="ft"></div>',
    js: compactScript(`
$('ft').textContent=D.f||'';
`),
  },
};

function screenHtml(blocks: Block[], data: ScreenData, confetti: boolean): string {
  const parts = blocks.map((name) => BLOCKS[name]);
  const css = CSS_BASE + HEAD_CSS + (confetti ? CSS_CONFETTI : '') + parts.map((part) => part.css).join('');
  const body = HEAD_HTML + parts.map((part) => part.html).join('');
  const script = [
    JS_BASE,
    confetti ? JS_CONFETTI : '',
    `const D=${embedJson(data)};`,
    COMMON_JS,
    ...parts.map((part) => part.js),
    confetti ? "setTimeout(()=>{boom(18);hap('s')},600);" : '',
  ].filter(Boolean).join('\n');
  return widgetDocument(css, body, script);
}

/**
 * Карточка экрана: build(level) отдаёт данные, с каждым уровнем короче.
 * null — даже самый короткий вариант не влез в лимит Telegram.
 */
export function screenWidget(
  blocks: Block[],
  build: (level: number) => ScreenData,
  caption: string,
  options: { levels?: number; confetti?: boolean } = {},
): WidgetMessage | null {
  const html = firstFitting(options.levels ?? 1, (level) => screenHtml(blocks, build(level), options.confetti ?? false));
  return html ? { html, caption } : null;
}
