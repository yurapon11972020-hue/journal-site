import { escapeHtml, type InlineButton } from '@/lib/telegram';
import type { Subscription } from '@/lib/subscriptions';
import type { BotScreen } from '@/lib/telegram-views';
import type { JournalData } from '@/lib/types';

/** «Иванов Иван Иванович» → «Иванов И.И.» — в кнопку длинное не влезает. */
function shortName(fullName: string): string {
  const parts = fullName.split(' ').filter(Boolean);
  if (parts.length <= 1) {
    return fullName;
  }
  return `${parts[0]} ${parts.slice(1).map((part) => `${part[0]}.`).join('')}`;
}

/** Названия предметов в том порядке, в каком они идут в журнале. */
export function subjectNames(data: JournalData): string[] {
  return data.subjects.map((subject) => subject.subjectName);
}

function describeSubscription(subscription: Subscription, total: number): string {
  if (!subscription.subjects.length) {
    return `все предметы (${total})`;
  }
  if (subscription.subjects.length <= 3) {
    return subscription.subjects.join(', ');
  }
  return `${subscription.subjects.length} предметов`;
}

/** Первый экран: кого уже слушаем и кнопка выбрать себя. */
export function notifyMenuScreen(
  data: JournalData,
  gi: number,
  subscriptions: Subscription[],
): BotScreen {
  const total = data.subjects.length;
  const lines = [
    '🔔 <b>Уведомления об оценках</b>',
    '━━━━━━━━━━━━━━━',
  ];

  if (subscriptions.length) {
    lines.push('Сейчас слежу за:');
    for (const subscription of subscriptions) {
      lines.push(
        `• <b>${escapeHtml(subscription.studentName)}</b> — ${escapeHtml(describeSubscription(subscription, total))}`,
      );
    }
    lines.push('');
    lines.push('<i>Как появится новая оценка или пропуск — напишу сюда.</i>');
  } else {
    lines.push('Найди себя в списке — и я буду писать, как только');
    lines.push('в журнале появится твоя оценка или пропуск.');
  }

  const buttons: InlineButton[][] = [];

  for (const subscription of subscriptions) {
    buttons.push([
      {
        text: `⚙️ ${shortName(subscription.studentName)}`,
        callback_data: `wp:${gi}:${subscription.studentId}`,
      },
      {
        text: '🔕 Отключить',
        callback_data: `wd:${gi}:${subscription.studentId}`,
      },
    ]);
  }

  const subscribedIds = new Set(subscriptions.map((subscription) => subscription.studentId));
  const rest = [...data.students]
    .filter((student) => !subscribedIds.has(student.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  for (const student of rest) {
    buttons.push([
      {
        text: `👤 ${shortName(student.name)}`,
        callback_data: `wp:${gi}:${student.id}`,
      },
    ]);
  }

  buttons.push([{ text: '⬅️ Назад', callback_data: `g:${gi}` }]);

  return { text: lines.join('\n'), buttons };
}

/** Второй экран: все предметы или выбрать конкретные. */
export function notifyStudentScreen(
  data: JournalData,
  gi: number,
  studentId: number,
  subscription: Subscription | null,
): BotScreen {
  const student = data.students.find((item) => item.id === studentId);

  if (!student) {
    return {
      text: '🔔 Студент не найден — возможно, журнал обновился.',
      buttons: [[{ text: '⬅️ Назад', callback_data: `w:${gi}` }]],
    };
  }

  const total = data.subjects.length;
  const lines = [
    `🔔 <b>${escapeHtml(student.name)}</b>`,
    '━━━━━━━━━━━━━━━',
  ];

  if (subscription) {
    lines.push(`Сейчас: <b>${escapeHtml(describeSubscription(subscription, total))}</b>`);
  } else {
    lines.push('Подписки пока нет. Выбери, о чём писать.');
  }

  const allActive = subscription !== null && subscription.subjects.length === 0;

  const buttons: InlineButton[][] = [
    [{ text: `${allActive ? '✅' : '📚'} Все предметы`, callback_data: `wa:${gi}:${studentId}` }],
    [{ text: '🎯 Выбрать предметы', callback_data: `ws:${gi}:${studentId}` }],
  ];

  if (subscription) {
    buttons.push([{ text: '🔕 Отключить уведомления', callback_data: `wd:${gi}:${studentId}` }]);
  }

  buttons.push([{ text: '⬅️ Назад', callback_data: `w:${gi}` }]);

  return { text: lines.join('\n'), buttons };
}

/** Третий экран: предметы с галочками. */
export function notifySubjectsScreen(
  data: JournalData,
  gi: number,
  studentId: number,
  subscription: Subscription | null,
): BotScreen {
  const names = subjectNames(data);
  const chosen = new Set(subscription?.subjects ?? []);

  const lines = [
    '🎯 <b>Выбери предметы</b>',
    '━━━━━━━━━━━━━━━',
    chosen.size
      ? `Отмечено: <b>${chosen.size}</b> из ${names.length}`
      : 'Пока ничего не отмечено — нажимай на нужные.',
    '',
    '<i>Нажатие включает и выключает предмет.</i>',
  ];

  const buttons: InlineButton[][] = names.map((name, index) => [
    {
      text: `${chosen.has(name) ? '✅' : '▫️'} ${name}`,
      callback_data: `wt:${gi}:${studentId}:${index}`,
    },
  ]);

  buttons.push([{ text: '⬅️ Назад', callback_data: `wp:${gi}:${studentId}` }]);

  return { text: lines.join('\n'), buttons };
}
