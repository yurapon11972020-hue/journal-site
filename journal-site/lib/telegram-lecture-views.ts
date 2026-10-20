import { createHash } from 'node:crypto';

import type { LectureSubscription } from '@/lib/lecture-subscriptions';
import { escapeHtml } from '@/lib/telegram';
import type { BotScreen } from '@/lib/telegram-views';

/** Постоянный короткий ключ группы для callback_data Telegram (не индекс списка). */
export function lectureGroupKey(groupName: string): string {
  return createHash('sha256').update(groupName).digest('base64url');
}

export function findLectureGroup(groups: string[], key: string): string | null {
  return groups.find((groupName) => lectureGroupKey(groupName) === key) ?? null;
}

export function lectureGroupsScreen(groups: string[], subscriptions: LectureSubscription[]): BotScreen {
  const active = new Map(subscriptions.map((item) => [item.groupName, item]));
  const buttons = groups.map((groupName) => {
    const subscription = active.get(groupName);
    const enabled = Boolean(subscription?.video || subscription?.lecture);
    return [{
      text: `${enabled ? '🔔' : '🎓'} ${groupName}`,
      callback_data: `ls:${lectureGroupKey(groupName)}`,
    }];
  });

  buttons.push([{ text: '⬅️ К журналу', callback_data: 'grp' }]);

  return {
    text: [
      '📅 <b>Напоминания о лекциях</b>',
      '',
      'Выбери группу. Внутри можно отдельно включить видеолекции и лекции в аудитории. Напоминание приходит примерно за 10 минут до начала.',
    ].join('\n'),
    buttons,
  };
}

export function lectureSettingsScreen(groupName: string, subscription: LectureSubscription | null): BotScreen {
  const key = lectureGroupKey(groupName);
  const video = Boolean(subscription?.video);
  const lecture = Boolean(subscription?.lecture);

  return {
    text: [
      `🔔 <b>Лекции — ${escapeHtml(groupName)}</b>`,
      '',
      'Включи один или оба вида напоминаний:',
      '📹 Видеолекции: время, предмет, преподаватель и ссылка на подключение.',
      '🏫 Лекции в аудитории: время, аудитория, предмет и преподаватель.',
      '',
      `Видеолекции: <b>${video ? 'включены' : 'выключены'}</b>`,
      `Обычные лекции: <b>${lecture ? 'включены' : 'выключены'}</b>`,
    ].join('\n'),
    buttons: [
      [{ text: `${video ? '✅' : '☐'} Видеолекции`, callback_data: `lv:${key}` }],
      [{ text: `${lecture ? '✅' : '☐'} Обычные лекции`, callback_data: `ll:${key}` }],
      [{ text: '⬅️ К группам', callback_data: 'lg' }],
    ],
  };
}
