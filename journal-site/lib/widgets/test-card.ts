import {
  compactMarkup,
  compactScript,
  CSS_BASE,
  CSS_CONFETTI,
  JS_BASE,
  JS_CONFETTI,
  widgetDocument,
  type WidgetMessage,
} from './kit';

const CSS = CSS_BASE + CSS_CONFETTI + compactMarkup(`
body{text-align:center;padding:18px 14px 16px}
.e{font-size:56px;display:inline-block;animation:pop .7s cubic-bezier(.2,1.4,.4,1) both,sp 3s linear .7s infinite}
@keyframes sp{to{transform:rotate(360deg)}}
.t{font-weight:800;font-size:18px;margin:6px 0 2px}
#b{margin-top:12px}
`);

const BODY = compactMarkup(`
<div class="e">🎨</div><div class="t">Карточки работают</div><div class="h">Анимация, конфетти и кнопки внутри сообщения</div>
<button id="b" class="on">🎉 Ещё конфетти</button>
`);

const SCRIPT = compactScript(`
setTimeout(()=>{boom(18);hap('s')},600);
$('b').onclick=()=>{boom(18);hap('s')};
`);

/** Проверочная карточка для владельца бота: /widgets test. */
export function testWidget(): WidgetMessage {
  return {
    html: widgetDocument(CSS, BODY, [JS_BASE, JS_CONFETTI, SCRIPT].join('\n')),
    caption: '🎨 <b>Тестовая карточка.</b> Если вместо анимации написано, что сообщение не поддерживается, обнови Telegram.',
  };
}
