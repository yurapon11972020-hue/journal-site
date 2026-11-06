import { escapeHtml } from '@/lib/telegram';
import { cardForStudent } from '@/lib/telegram-views';
import type { JournalData } from '@/lib/types';

import {
  clampCaption,
  compactMarkup,
  compactScript,
  CSS_BASE,
  CSS_CONFETTI,
  embedJson,
  firstFitting,
  JS_BASE,
  JS_CONFETTI,
  JS_RING,
  round2,
  truncate,
  widgetDocument,
  type WidgetMessage,
} from './kit';

const CSS = CSS_BASE + CSS_CONFETTI + compactMarkup(`
.tp{display:flex;gap:12px;align-items:center;margin-bottom:8px}
.rg{position:relative;width:76px;height:76px;flex:none}
.rg b{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;font-size:19px}
.nb{min-width:0}
.nm{font-weight:700;font-size:16px;line-height:1.2}
.ab{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap}
.it{padding:6px 0}
.ln{display:flex;align-items:center;gap:8px}
.sn{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.br{height:5px;border-radius:3px;background:var(--tg-theme-secondary-bg-color);margin-top:5px;overflow:hidden}
.br i{display:block;height:100%;border-radius:3px;transform-origin:left;transform:scaleX(0);transition:transform .9s cubic-bezier(.2,.8,.2,1)}
.mr{display:block;width:100%;margin-top:6px}
`);

const BODY = compactMarkup(`
<div class="tp"><div class="rg"><canvas id="c"></canvas><b id="av"></b></div><div class="nb"><div class="nm" id="n"></div><div class="h" id="g"></div><div class="ab" id="ab"></div></div></div>
<div id="p"></div>
`);

/** D: n — имя, g — группа, a — общий средний, i/v — пропуски Н/НУ, s — [предмет, средний, Н, НУ, подпись]. */
const SCRIPT = compactScript(`
$('n').textContent=D.n;$('g').textContent=D.g;
const ab=$('ab');
if(!D.i&&!D.v)ab.appendChild(el('span','chip c5','без пропусков'));
else{if(D.i)ab.appendChild(el('span','chip cn','Н '+D.i));if(D.v)ab.appendChild(el('span','chip cv','НУ '+D.v))}
const s0=Date.now(),av=$('av');
function an(){const p=Math.min(1,(Date.now()-s0)/1100),q=1-Math.pow(1-p,3);ring($('c'),76,(D.a||0)/5*q,TC[tn(D.a)]);av.textContent=D.a==null?'—':fm(D.a*q);if(p<1)requestAnimationFrame(an)}
an();
if(D.a>=4.5)setTimeout(()=>{boom(20);hap('s')},700);
const PG=8;let pg=0;
function list(){const p=$('p'),bars=[];p.textContent='';
D.s.slice(pg*PG,pg*PG+PG).forEach((r,i)=>{const it=el('div','it'),ln=el('div','ln'),a=[r[2]?'Н:'+r[2]:'',r[3]?'НУ:'+r[3]:''].join(' ').trim(),br=el('div','br'),b=el('i');ln.appendChild(el('span','sn',r[0]));if(a)ln.appendChild(el('span','h',a));ln.appendChild(el('span','chip '+tn(r[1]),r[4]||fm(r[1])));b.style.background=TC[tn(r[1])];b.style.transitionDelay=i*60+'ms';br.appendChild(b);it.appendChild(ln);it.appendChild(br);p.appendChild(it);bars.push([b,(r[1]||0)/5])});
if(!D.s.length)p.appendChild(el('div','h','Оценок пока нет'));
const n=Math.ceil(D.s.length/PG);if(n>1){const m=el('button','mr','Ещё предметы · '+(pg+1)+'/'+n);m.onclick=()=>{pg=(pg+1)%n;list();hap()};p.appendChild(m)}
grow(bars)}
list();
`);

/** Подпись из табеля нужна, только если это не число («зач», «н/а»): число виджет покажет сам. */
function nonNumericLabel(label: string | null | undefined): string | null {
  const clean = label?.trim();
  if (!clean || /^\d+(?:[.,]\d+)?$/.test(clean)) return null;
  return truncate(clean, 8);
}

function formatAvg(value: number | null): string {
  return value === null ? '—' : value.toFixed(2).replace('.', ',');
}

/** Табель студента: кольцо общего балла и предметы с полосками; null — студента нет или не поместилось. */
export function studentCardWidget(data: JournalData, studentId: number): WidgetMessage | null {
  const student = data.students.find((item) => item.id === studentId) ?? null;
  const card = student
    ? cardForStudent(data, student)
    : data.reportCards.find((item) => item.studentId === studentId) ?? null;
  if (!student && !card) return null;

  const name = student?.name || card?.studentName || 'Студент';
  const overall = round2(card?.overallAverage ?? student?.overallAverage ?? null);
  const invalid = card?.totalAbsences.invalid ?? student?.totalAbsences.invalid ?? 0;
  const valid = card?.totalAbsences.valid ?? student?.totalAbsences.valid ?? 0;

  const rows = card?.rows.length
    ? card.rows.map((row) => ({
      name: row.subjectName,
      avg: round2(row.average),
      invalid: row.absences.invalid,
      valid: row.absences.valid,
      label: nonNumericLabel(row.averageLabel),
    }))
    : (student?.subjects ?? []).map((subject) => ({
      name: subject.subjectName,
      avg: round2(subject.average),
      invalid: subject.absences.invalid,
      valid: subject.absences.valid,
      label: null,
    }));

  const html = firstFitting(4, (level) => {
    const nameMax = [48, 32, 24, 20][level];
    const rowLimit = [Infinity, Infinity, 24, 16][level];
    const payload = {
      n: truncate(name, 60),
      g: truncate(data.groupName ?? '', 40),
      a: overall,
      i: invalid,
      v: valid,
      s: rows.slice(0, rowLimit).map((row) => [truncate(row.name, nameMax), row.avg, row.invalid, row.valid, row.label]),
    };
    return widgetDocument(CSS, BODY, [JS_BASE, JS_CONFETTI, JS_RING, `const D=${embedJson(payload)};`, SCRIPT].join('\n'));
  });
  if (!html) return null;

  return {
    html,
    caption: clampCaption([
      `👤 <b>${escapeHtml(truncate(name, 80))}</b>`,
      `Средний балл: <b>${formatAvg(overall)}</b> · Пропуски: Н:${invalid} • НУ:${valid}`,
    ]),
  };
}
