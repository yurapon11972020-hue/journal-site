import { classifyMarkValue, type MarkTone } from '@/lib/mark-classifier';
import { describeChangeParts, type ChangeKind, type JournalChange } from '@/lib/notify-messages';
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
  round2,
  truncate,
  widgetDocument,
  type WidgetMessage,
} from './kit';

const CSS = CSS_BASE + CSS_CONFETTI + compactMarkup(`
body{text-align:center;padding-top:16px}
.mr{display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:10px}
.mw{position:relative;width:88px;height:88px;flex:none}
.m{position:relative;width:88px;height:88px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:36px;font-weight:800;animation:pop .6s cubic-bezier(.2,1.4,.4,1) both}
.w{position:absolute;top:0;left:0;width:88px;height:88px;border-radius:50%;border:3px solid;box-sizing:border-box;animation:wave 1.3s ease-out .25s both}
@keyframes wave{0%{transform:scale(1)}100%{transform:scale(2.3);border-color:transparent}}
.ol{text-decoration:line-through;font-size:16px;height:28px;min-width:34px;border-radius:14px;animation:ol .9s .35s both}
@keyframes ol{0%{transform:translateX(46px) scale(1.3)}100%{transform:none}}
.bn{animation:bn .7s ease-in-out 2}
@keyframes bn{0%,100%{transform:translateY(0)}40%{transform:translateY(-12px)}}
.wb{animation:wb .9s ease-in-out}
@keyframes wb{0%,100%{transform:rotate(0)}25%{transform:rotate(-8deg)}75%{transform:rotate(8deg)}}
.sh{animation:sh .5s ease-in-out 2}
@keyframes sh{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}
.fl{animation:fl 2.4s ease-in-out infinite}
@keyframes fl{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
.p{font-size:20px;font-weight:800;margin-bottom:2px}
.s{font-weight:600}
.r{display:flex;gap:5px;justify-content:center;flex-wrap:wrap;margin:12px 0 6px}
.r .chip{animation:pop .4s both}
.r .chip:last-child{animation:pop .4s both,beat 1.4s ease-in-out 1.6s infinite}
@keyframes beat{0%,100%{transform:scale(1)}50%{transform:scale(1.2)}}
`);

const BODY = compactMarkup(`
<div class="mr"><span class="chip cn ol" id="o" style="display:none"></span><div class="mw"><div class="w" id="w"></div><div class="m" id="m"></div></div></div>
<div class="p" id="p"></div><div class="s" id="s"></div><div class="h" id="d"></div>
<div class="r" id="r"></div><div class="h" id="a"></div>
`);

/**
 * D: t — что случилось (e/g/o/b — 5/4/3/2, a/v — Н/НУ, c — отработал, f — исправил),
 * m — новая отметка, b — прежняя, i и p — иконка и реплика, s — предмет, d — занятие,
 * n — студент, a — средний по предмету, r — последние отметки.
 */
const SCRIPT = compactScript(`
const K={e:'c5',g:'c4',o:'c3',b:'c2',a:'cn',v:'cv',c:'c5',f:'c4',p:'cn'},k=K[D.t]||'cn',m=$('m');
m.className='m '+k;m.textContent=D.t=='c'?'✓':D.m;$('w').style.borderColor=TC[k];
if(D.b){const o=$('o');o.textContent=D.b;o.style.display=''}
$('p').textContent=D.i+' '+D.p;$('s').textContent=D.s;$('d').textContent=[D.d,D.n].filter(Boolean).join(' · ');
D.r.forEach((x,i)=>{const c=el('span','chip '+x[1],x[0]);c.style.animationDelay=.5+i*.06+'s';$('r').appendChild(c)});
if(D.a!=null){const a=$('a');a.textContent='Средний по предмету: ';a.appendChild(el('b',null,fm(D.a)))}
const F={e:()=>{boom(22);hap('s');m.className+=' bn'},g:()=>{m.className+=' bn';hap()},o:()=>{m.className+=' wb'},b:()=>{m.className+=' sh'},a:()=>{m.className+=' fl'},v:()=>{m.className+=' fl'},c:()=>{boom(12);hap('s')},f:()=>{boom(10);hap('s')}};
setTimeout(()=>{const f=F[D.t];if(f)f()},650);
`);

const KIND_CODE: Partial<Record<ChangeKind, string>> = {
  excellent: 'e',
  good: 'g',
  ok: 'o',
  bad: 'b',
  absence: 'a',
  'electronic-absence': 'a',
  'valid-absence': 'v',
  cleared: 'c',
  fixed: 'f',
  plain: 'p',
};

const TONE_CLASS: Partial<Record<MarkTone, string>> = {
  excellent: 'c5',
  good: 'c4',
  ok: 'c3',
  bad: 'c2',
  'valid-absence': 'cv',
};

/** Отметки по предмету до изменившегося занятия включительно: последней в ряду стоит новая. */
function recentMarks(grades: GradeEntry[], columnLabel: string): Array<[string, string]> {
  const index = grades.findIndex((grade) => grade.label === columnLabel);
  const upTo = index >= 0 ? grades.slice(0, index + 1) : grades;
  return upTo
    .filter((grade) => grade.value.trim())
    .slice(-9)
    .map((grade) => {
      const mark = classifyMarkValue(grade.value);
      return [truncate(mark.displayText, 4), TONE_CLASS[mark.tone] ?? 'cn'];
    });
}

/** Виджет уведомления об оценке; null — писать не о чем или не поместилось. */
export function gradeAlertWidget(change: JournalChange, data: JournalData | null): WidgetMessage | null {
  const parts = describeChangeParts(change);
  if (!parts) return null;

  const code = KIND_CODE[parts.kind] ?? 'p';
  const student = data?.students.find((item) => item.id === change.studentId);
  const subject = student?.subjects.find((item) => item.subjectName === change.subject);
  const recent = recentMarks(subject?.grades ?? [], change.columnLabel);

  const html = firstFitting(2, (level) => {
    const payload = {
      t: code,
      m: truncate(parts.afterText, 5),
      b: code === 'c' || code === 'f' ? truncate(parts.beforeText, 5) : '',
      i: parts.icon,
      p: truncate(parts.phrase, 60),
      s: truncate(change.subject, level ? 40 : 80),
      d: truncate(change.columnLabel, 20),
      n: truncate(shortName(change.studentName), 40),
      a: round2(subject?.average ?? null),
      r: level ? [] : recent,
    };
    return widgetDocument(CSS, BODY, [JS_BASE, JS_CONFETTI, `const D=${embedJson(payload)};`, SCRIPT].join('\n'));
  });
  if (!html) return null;

  return { html, caption: clampCaption([escapeHtml(parts.text)]) };
}
