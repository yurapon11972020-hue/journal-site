import { escapeHtml } from '@/lib/telegram';
import { shortName } from '@/lib/telegram-views';
import type { GradeEntry, JournalData } from '@/lib/types';

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
  truncate,
  widgetDocument,
  type WidgetMessage,
} from './kit';

const CSS = CSS_BASE + CSS_CONFETTI + compactMarkup(`
.hd{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:10px}
.ln{display:flex;align-items:center;gap:8px}
.sn{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center}
.kc{display:flex;align-items:center;justify-content:space-around;margin:12px 0;text-align:center}
.big{font-size:30px;font-weight:800}
.ks{display:flex;gap:6px}
.ks button{flex:1;color:#fff;font-weight:800;padding:10px 0}
.ks .kr{background:var(--tg-theme-secondary-bg-color);color:var(--tg-theme-text-color)}
.kl{display:flex;flex-wrap:wrap;gap:4px;margin:10px 0 6px;min-height:22px}
.kl .chip{animation:pop .35s both}
.pa{animation:pop .45s both}.pb{animation:pq .45s both}
@keyframes pq{0%{transform:scale(0)}70%{transform:scale(1.12)}100%{transform:scale(1)}}
`);

const BODY = compactMarkup(`
<div class="hd"><b>🧮 Калькулятор оценок</b><span class="h" id="n"></span></div>
<div class="ln"><button id="kp">◀</button><b class="sn" id="ks"></b><button id="kn">▶</button></div>
<div class="h" id="kc" style="text-align:center;margin-top:4px"></div>
<div class="kc"><div><div class="h">сейчас</div><div class="big" id="k0"></div></div><div class="h" id="kd" style="font-size:22px"></div><div><div class="h">станет</div><div class="big" id="k1"></div></div></div>
<div class="ks"><button id="a5" class="c5">+5</button><button id="a4" class="c4">+4</button><button id="a3" class="c3">+3</button><button id="a2" class="c2">+2</button><button id="kr" class="kr">↺</button></div>
<div class="kl" id="kl"></div><div class="h" id="kh"></div>
`);

/** D: n — студент, k — [предмет, сколько 5, 4, 3, 2]. Новые отметки живут только в этом сообщении. */
const SCRIPT = compactScript(`
$('n').textContent=D.n;
const K=D.k;let ki=0,ad=[],fl=0;
function pl(n,a){const m=n%10,h=n%100;return a[m==1&&h!=11?0:m>=2&&m<=4&&(h<10||h>=20)?1:2]}
function st(){const r=K[ki];return[r[1]*5+r[2]*4+r[3]*3+r[4]*2,r[1]+r[2]+r[3]+r[4]]}
function cur(){const[s,c]=st(),n=c+ad.length;return n?(s+ad.reduce((a,b)=>a+b,0))/n:null}
function need(s,c){if(!c)return'Нажми +5 или +4 — посчитаю средний';const a=s/c,t=a<2.5?2.5:a<3.5?3.5:a<4.5?4.5:0;if(!t)return'Выходит пятёрка — так держать 🔥';const n=Math.max(1,Math.ceil((t*c-s)/(5-t)-1e-9));return'До '+(t==4.5?'пятёрки':t==3.5?'четвёрки':'тройки')+' нужно ещё '+n+' '+pl(n,['пятёрка','пятёрки','пятёрок'])}
function calc(){const r=K[ki],[s,c]=st(),x=ad.reduce((a,b)=>a+b,0),a0=c?s/c:null,a1=cur(),k1=$('k1');
$('ks').textContent=r[0];$('kc').textContent=c+' '+pl(c,['оценка','оценки','оценок'])+': 5×'+r[1]+' · 4×'+r[2]+' · 3×'+r[3]+' · 2×'+r[4];
$('k0').textContent=fm(a0);$('k0').style.color=TC[tn(a0)];
k1.textContent=fm(a1);k1.style.color=TC[tn(a1)];fl=1-fl;k1.className='big '+(fl?'pa':'pb');
$('kd').textContent=ad.length&&a0!=null?(a1>a0+1e-9?'▲':a1<a0-1e-9?'▼':'='):'→';
const kl=$('kl');kl.textContent='';ad.forEach(v=>kl.appendChild(el('span','chip c'+v,'+'+v)));
$('kh').textContent=need(s+x,c+ad.length)}
[5,4,3,2].forEach(v=>{$('a'+v).onclick=()=>{const b=cur();ad.push(v);if(ad.length>14)ad.shift();calc();const a=cur();if(v==5&&a>=4.5&&!(b>=4.5)){boom(18);hap('s')}else hap(v>3?'medium':'light')}});
$('kr').onclick=()=>{ad=[];calc();hap()};
$('kp').onclick=()=>{ki=(ki+K.length-1)%K.length;ad=[];calc();hap()};
$('kn').onclick=()=>{ki=(ki+1)%K.length;ad=[];calc();hap()};
calc();
`);

/** Отметки 5/4/3/2 одной клетки; «5/4» — две отметки. Пропуски и зачёты калькулятору не нужны. */
export function countNumericMarks(grades: GradeEntry[]): [number, number, number, number] {
  const counts: [number, number, number, number] = [0, 0, 0, 0];
  for (const grade of grades) {
    const value = grade.value.replace(/\s+/g, '').replace(/\.$/, '');
    if (!/^[2-5](?:[/,;][2-5])*$/.test(value)) continue;
    for (const digit of value.match(/[2-5]/g) ?? []) {
      counts[5 - Number(digit)] += 1;
    }
  }
  return counts;
}

/** «Что будет, если получить ещё пятёрку»: null — у студента нет числовых оценок или не поместилось. */
export function calculatorWidget(data: JournalData, studentId: number): WidgetMessage | null {
  const student = data.students.find((item) => item.id === studentId);
  if (!student) return null;

  const subjects = student.subjects
    .map((subject) => ({ name: subject.subjectName, counts: countNumericMarks(subject.grades) }))
    .filter((item) => item.counts.some(Boolean));
  if (!subjects.length) return null;

  const html = firstFitting(3, (level) => {
    const payload = {
      n: truncate(shortName(student.name), 40),
      k: subjects.slice(0, [Infinity, 24, 14][level]).map((item) => [truncate(item.name, [60, 36, 26][level]), ...item.counts]),
    };
    return widgetDocument(CSS, BODY, [JS_BASE, JS_CONFETTI, `const D=${embedJson(payload)};`, SCRIPT].join('\n'));
  });
  if (!html) return null;

  return {
    html,
    caption: clampCaption([`🧮 <b>Калькулятор оценок</b> — ${escapeHtml(truncate(student.name, 80))}`]),
  };
}
