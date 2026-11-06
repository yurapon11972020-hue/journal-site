import { escapeHtml } from '@/lib/telegram';
import { shortName, studentDisplayStats } from '@/lib/telegram-views';
import type { JournalData } from '@/lib/types';

import {
  clampCaption,
  compactMarkup,
  compactScript,
  CSS_BASE,
  embedJson,
  firstFitting,
  JS_BASE,
  round2,
  truncate,
  widgetDocument,
  type WidgetMessage,
} from './kit';

const CSS = CSS_BASE + compactMarkup(`
.tt{font-weight:700;font-size:16px}
.pd{display:flex;align-items:flex-end;justify-content:center;gap:8px;height:190px;margin:6px 0 12px}
.pc{flex:1;max-width:110px;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%}
.pc .nm{font-size:12px;font-weight:600;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:2px 0 5px}
.md{font-size:26px;animation:drop .7s cubic-bezier(.2,1.4,.4,1) both}
@keyframes drop{0%{transform:translateY(-40px) scale(.3)}100%{transform:none}}
.col{width:100%;border-radius:10px 10px 4px 4px;display:flex;justify-content:center;padding-top:8px;box-sizing:border-box;color:#fff;font-weight:800;font-size:17px;transform-origin:bottom;animation:up .8s cubic-bezier(.2,1.2,.4,1) both}
@keyframes up{0%{transform:scaleY(0)}100%{transform:scaleY(1)}}
.g1{background:#E3A82B}.g2{background:#9AA5B1}.g3{background:#C07A45}
.it{display:flex;align-items:center;gap:8px;padding:4px 0}
.n{width:22px;text-align:right;color:var(--tg-theme-hint-color);font-size:13px;flex:none}
.it .nm{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.br{width:60px;height:6px;border-radius:3px;background:var(--tg-theme-secondary-bg-color);overflow:hidden;flex:none}
.br i{display:block;height:100%;border-radius:3px;transform-origin:left;transform:scaleX(0);transition:transform .8s cubic-bezier(.2,.8,.2,1)}
.pg{display:flex;justify-content:space-between;align-items:center;margin-top:8px}
`);

const BODY = compactMarkup(`
<div class="tt" id="tt"></div>
<div class="pd" id="pd"></div>
<div id="ls"></div>
<div class="pg" id="pg"><button id="pp">◀</button><span class="h" id="pi"></span><button id="pn">▶</button></div>
`);

/** D: g — группа, r — [фамилия с инициалами, средний] по убыванию. */
const SCRIPT = compactScript(`
$('tt').textContent='🏆 Рейтинг · '+D.g;
const R=D.r,M=['🥇','🥈','🥉'],H=[100,76,58],pd=$('pd');
[1,0,2].forEach(i=>{const r=R[i];if(!r)return;const c=el('div','pc'),m=el('div','md',M[i]),col=el('div','col g'+(i+1),fm(r[1])),d=(2-i)*.25;c.appendChild(m);c.appendChild(el('div','nm',r[0]));col.style.height=H[i]+'px';col.style.animationDelay=d+'s';m.style.animationDelay=d+.45+'s';c.appendChild(col);pd.appendChild(c)});
if(!R.length)pd.appendChild(el('div','h','Пока нет оценок'));
const rest=R.slice(3),PG=8,N=Math.ceil(rest.length/PG);let pg=0;
function list(){const ls=$('ls'),bars=[];ls.textContent='';
rest.slice(pg*PG,pg*PG+PG).forEach((r,j)=>{const it=el('div','it'),br=el('span','br'),b=el('i');it.appendChild(el('span','n',String(pg*PG+j+4)));it.appendChild(el('span','nm',r[0]));b.style.background=TC[tn(r[1])];b.style.transitionDelay=j*50+'ms';br.appendChild(b);it.appendChild(br);it.appendChild(el('span','chip '+tn(r[1]),fm(r[1])));ls.appendChild(it);bars.push([b,(r[1]||0)/5])});
$('pi').textContent=(pg*PG+4)+'–'+Math.min(rest.length+3,pg*PG+PG+3)+' из '+R.length;
grow(bars)}
if(N>1){$('pp').onclick=()=>{pg=(pg+N-1)%N;list();hap()};$('pn').onclick=()=>{pg=(pg+1)%N;list();hap()}}else $('pg').style.display='none';
if(rest.length)list();
`);

export function ratingWidget(data: JournalData): WidgetMessage | null {
  const rated = data.students
    .map((student) => ({ name: shortName(student.name), avg: round2(studentDisplayStats(data, student).avg) }))
    .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));
  const group = data.groupName || 'группа';

  const html = firstFitting(3, (level) => {
    const limit = [Infinity, 40, 24][level];
    const payload = {
      g: truncate(group, 40),
      r: rated.slice(0, limit).map((item) => [truncate(item.name, [28, 24, 20][level]), item.avg]),
    };
    return widgetDocument(CSS, BODY, [JS_BASE, `const D=${embedJson(payload)};`, SCRIPT].join('\n'));
  });
  if (!html) return null;

  const medals = ['🥇', '🥈', '🥉'];
  return {
    html,
    caption: clampCaption([
      `🏆 <b>Рейтинг — ${escapeHtml(truncate(group, 80))}</b>`,
      ...rated.slice(0, 3).map((item, index) =>
        `${medals[index]} ${escapeHtml(item.name)} — ${item.avg === null ? '—' : item.avg.toFixed(2).replace('.', ',')}`),
    ]),
  };
}
