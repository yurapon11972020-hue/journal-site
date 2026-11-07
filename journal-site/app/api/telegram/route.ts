import { NextResponse } from 'next/server';

import { lastGradeWatchRun, type WatchResult } from '@/lib/grade-watch';
import { getJournalDataByPath, getJournalGroups } from '@/lib/journal';
import { kickBroadcastDrain } from '@/lib/broadcast-scheduler';
import { getBroadcastStore } from '@/lib/broadcast-store';
import { getScheduleData } from '@/lib/lecture-sources';
import { getLectureStore, type LectureMode } from '@/lib/lecture-subscriptions';
import { getSubscriptionStore, type Subscription } from '@/lib/subscriptions';
import {
  answerCallback,
  deleteMessage,
  editMessage,
  editReplyMarkup,
  escapeHtml,
  getWebhookSecret,
  safeCompare,
  sendMessage,
  sendWidget,
  widgetDeliveryNote,
  type InlineButton,
} from '@/lib/telegram';
import { findLectureGroup, lectureGroupsScreen, lectureSettingsScreen } from '@/lib/telegram-lecture-views';
import {
  notifyMenuScreen,
  notifyStudentScreen,
  notifySubjectsScreen,
  studentNameKey,
  subjectNames,
} from '@/lib/telegram-notify-views';
import {
  errorScreen,
  groupMenuScreen,
  groupsScreen,
  ratingScreen,
  studentAbsencesScreen,
  studentCardScreen,
  studentGradesScreen,
  studentsScreen,
  subjectDetailScreen,
  subjectsScreen,
  subjectTopicsScreen,
  type BotScreen,
  type WidgetToggle,
} from '@/lib/telegram-views';
import type { JournalData, JournalGroupRef } from '@/lib/types';
import {
  chatWidgetsState,
  setChatWidgets,
  setGlobalWidgets,
  widgetsAllowedByEnv,
  widgetsEnabledFor,
  widgetsEnabledGlobally,
} from '@/lib/widget-settings';
import { calculatorWidget } from '@/lib/widgets/calculator';
import type { WidgetMessage } from '@/lib/widgets/kit';
import { ratingWidget } from '@/lib/widgets/rating';
import {
  absencesWidget,
  gradesWidget,
  groupWidget,
  homeWidget,
  lectureGroupsWidget,
  lectureSettingsWidget,
  notifyMenuWidget,
  notifyStudentWidget,
  notifySubjectsWidget,
  studentsWidget,
  subjectDetailWidget,
  subjectsWidget,
  topicsWidget,
} from '@/lib/widgets/screens';
import { studentCardWidget } from '@/lib/widgets/student-card';
import { testWidget } from '@/lib/widgets/test-card';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface TelegramUpdate {
  message?: {
    message_id?: number;
    from?: { id: number };
    chat: { id: number; type?: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: {
      chat: { id: number; type?: string };
      message_id: number;
      text?: string;
      /** Есть у сообщения-виджета (HTMLBubbles): его текст не отредактировать. */
      widget?: unknown;
    };
  };
}

/** /notify_status — что было на последней проверке оценок. */
function gradeWatchStatus(): string {
  const run = lastGradeWatchRun();
  if (!run) {
    return '🔔 С последнего перезапуска сервера проверки оценок ещё не было: она идёт после очередного обновления журналов.';
  }
  const time = new Date(run.at).toLocaleTimeString('ru-RU', { timeZone: 'Asia/Yekaterinburg', hour: '2-digit', minute: '2-digit' });
  const total = (pick: (item: WatchResult) => number | undefined) => run.results.reduce((sum, item) => sum + (pick(item) ?? 0), 0);
  const restructured = run.results.filter((item) => item.restructured).map((item) => item.groupName);
  return [
    `🔔 Последняя проверка оценок в ${time}: групп ${run.results.length}, изменений ${total((item) => item.changes)}, отправлено ${total((item) => item.messages)}.`,
    `Повторов не отправлено: ${total((item) => item.duplicates)}, отметок с поправленной датой: ${total((item) => item.moved)}.`,
    restructured.length ? `Журнал перестроен, снимок обновлён без рассылки: ${restructured.map(escapeHtml).join(', ')}.` : '',
  ].filter(Boolean).join('\n');
}

/** Владелец бота — тот же Telegram ID, что у рассылки. */
function ownerChatId(): number | null {
  const rawId = process.env.TELEGRAM_BROADCAST_ADMIN_ID?.trim() ?? '';
  if (!/^\d+$/.test(rawId)) return null;
  const id = Number(rawId);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * /widgets — состояние, /widgets on|off — общий выключатель анимированных карточек,
 * /widgets test — прислать владельцу проверочную карточку и сказать, что ответил Telegram.
 */
async function widgetCommandReply(chatId: number, argument?: string): Promise<string> {
  if (argument === 'test') {
    const delivery = await sendWidget(chatId, testWidget(), undefined, { ignorePause: true });
    if (delivery === 'sent') {
      return '✅ Telegram принял тестовую карточку — она выше. Если вместо анимации написано, что сообщение не поддерживается, обнови Telegram на этом устройстве.';
    }
    return delivery === 'unknown'
      ? `⏳ Telegram не ответил вовремя — карточка могла прийти, а могла и нет. ${widgetDeliveryNote()}`
      : `❌ Telegram не принял тестовую карточку. ${widgetDeliveryNote()}`;
  }
  if (argument === 'on' || argument === 'off') {
    try {
      await setGlobalWidgets(argument === 'on');
    } catch (error) {
      console.error('[карточки] Не удалось сохранить общий выключатель:', error);
      return '⚠️ Не получилось сохранить выбор: база данных недоступна. Попробуй ещё раз через минуту.';
    }
  }
  if (!widgetsAllowedByEnv()) {
    return '🎨 Анимированные карточки выключены переменной TELEGRAM_WIDGETS на сервере — бот присылает обычные сообщения.';
  }
  const state = (await widgetsEnabledGlobally())
    ? '🎨 Анимированные карточки включены для всех. Выключить: /widgets off'
    : '🎨 Анимированные карточки выключены для всех — бот присылает обычные сообщения, как раньше. Включить: /widgets on';
  return `${state}\n\n${widgetDeliveryNote()}\nПроверить сейчас: /widgets test`;
}

/** Рассылка включается только при ID владельца и пароле в окружении Render. */
function broadcastCredentials(): { adminId: number; password: string } | null {
  const rawId = process.env.TELEGRAM_BROADCAST_ADMIN_ID?.trim() ?? '';
  const password = process.env.TELEGRAM_BROADCAST_PASSWORD?.trim() ?? '';
  if (!/^\d+$/.test(rawId) || password.length < 16) return null;
  const adminId = Number(rawId);
  return Number.isSafeInteger(adminId) && adminId > 0 ? { adminId, password } : null;
}

/** Пароль отдельным сообщением разрешает ровно одно следующее сообщение. */
async function handleBroadcastMessage(message: NonNullable<TelegramUpdate['message']>): Promise<boolean> {
  const { chat, from, message_id: messageId } = message;
  if (chat.type !== 'private' || from?.id !== chat.id) return false;
  const text = message.text?.trim() ?? '';

  if (/^\/myid(?:@[\w]+)?$/i.test(text)) {
    await sendMessage(chat.id, `Ваш Telegram ID: <code>${chat.id}</code>`);
    return true;
  }

  if (/^\/notify_status(?:@[\w]+)?$/i.test(text) && ownerChatId() === chat.id) {
    await sendMessage(chat.id, gradeWatchStatus());
    return true;
  }

  const widgetCommand = /^\/widgets(?:@[\w]+)?(?:\s+(on|off|test))?$/i.exec(text);
  if (widgetCommand && ownerChatId() === chat.id) {
    await sendMessage(chat.id, await widgetCommandReply(chat.id, widgetCommand[1]?.toLowerCase()));
    return true;
  }

  const credentials = broadcastCredentials();
  if (!credentials || chat.id !== credentials.adminId) return false;

  if (/^\/broadcast_status(?:@[\w]+)?$/i.test(text)) {
    const status = await getBroadcastStore().latestStatus(chat.id);
    await sendMessage(chat.id, status
      ? `Рассылка №${status.jobId}: отправлено ${status.sent}, ошибок ${status.failed}, осталось ${status.pending} из ${status.recipientCount}.`
      : 'Рассылок ещё не было.');
    return true;
  }

  if (/^\/cancel(?:@[\w]+)?$/i.test(text)) {
    await getBroadcastStore().cancel(chat.id);
    await sendMessage(chat.id, 'Подготовка рассылки отменена.');
    return true;
  }

  if (messageId && safeCompare(text, credentials.password)) {
    const newlyArmed = await getBroadcastStore().arm(chat.id, messageId);
    if (newlyArmed) {
      await deleteMessage(chat.id, messageId);
      await sendMessage(chat.id, 'Пароль принят. Отправьте одно сообщение в течение 5 минут — бот перешлёт его всем своим пользователям. Для отмены: /cancel');
    }
    return true;
  }

  // Команды не могут стать случайным содержимым массового сообщения.
  if (text.startsWith('/') || !messageId) return false;

  const queued = await getBroadcastStore().enqueueArmedMessage(chat.id, messageId);
  if (!queued) return false;

  if (queued.created) {
    await sendMessage(chat.id, `Рассылка №${queued.jobId} поставлена в очередь для ${queued.recipientCount} чатов. Ход отправки: /broadcast_status`);
    void kickBroadcastDrain().catch((error) => {
      console.error('[broadcast] Не удалось начать отправку:', error);
    });
  }
  return true;
}

async function rememberPrivateChat(chatId: number, chatType?: string): Promise<void> {
  if (chatType !== 'private') return;
  try {
    await getBroadcastStore().rememberChat(chatId, chatType);
  } catch (error) {
    // Недоступность списка адресатов не должна ломать обычный журнал.
    console.error('[broadcast] Не удалось сохранить чат:', error);
  }
}

async function loadGroupData(groups: JournalGroupRef[], gi: number): Promise<{ data: JournalData; gi: number; group: JournalGroupRef }> {
  const group = groups[gi] ?? groups[0];
  if (!group) {
    throw new Error('Список групп пуст. Проверь ссылку на Яндекс.Диск.');
  }
  const data = await getJournalDataByPath(group.filePath);
  return { data, gi: groups[gi] ? gi : 0, group };
}

/** Подписки этого чата на эту группу. */
async function chatSubscriptions(chatId: number, groupId: string): Promise<Subscription[]> {
  const all = await getSubscriptionStore().listByChat(chatId);
  return all.filter((item) => item.groupId === groupId);
}

/** У старой ссылки ИСиП(Р)-24/1 и нового файла один ID группы, а номера строк могли измениться. */
const REPLACED_ISIP_R_GROUP_ID = 'X0p3qpi4K5zZhKZU';

function normalizedStudentName(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru').replace(/ё/g, 'е');
}

function currentStudent(data: JournalData, studentId: number): JournalData['students'][number] | null {
  const student = data.students.find((item) => item.id === studentId);
  if (!student) return null;
  return data.students.filter((item) => normalizedStudentName(item.name) === normalizedStudentName(student.name)).length === 1
    ? student
    : null;
}

function matchingSubscriptions(
  list: Subscription[], groupId: string, data: JournalData, studentId: number,
): Subscription[] {
  if (groupId !== REPLACED_ISIP_R_GROUP_ID) {
    return list.filter((item) => item.studentId === studentId);
  }
  const student = currentStudent(data, studentId);
  return student ? list.filter((item) => normalizedStudentName(item.studentName) === normalizedStudentName(student.name)) : [];
}

function mergedSubscription(matches: Subscription[], studentId: number): Subscription | null {
  if (!matches.length) return null;
  const [first] = matches;
  return {
    ...first,
    studentId,
    subjects: matches.some((item) => !item.subjects.length)
      ? []
      : [...new Set(matches.flatMap((item) => item.subjects))],
  };
}

function validStudentButton(groupId: string, data: JournalData, studentId: number, key?: string, subjectIndex?: number): boolean {
  if (groupId !== REPLACED_ISIP_R_GROUP_ID) return true;
  const student = currentStudent(data, studentId);
  const subjectName = subjectIndex === undefined ? undefined : subjectNames(data)[subjectIndex];
  // Старые кнопки содержат только номер строки: после смены Excel он небезопасен.
  return !!student && (subjectIndex === undefined || !!subjectName)
    && key === studentNameKey(student.name, subjectName);
}

function freeSubscriptionId(list: Subscription[], desiredId: number): number {
  const taken = new Set(list.map((item) => item.studentId));
  if (!taken.has(desiredId)) return desiredId;
  let free = -1;
  while (taken.has(free)) free -= 1;
  return free;
}

/** Прикрепляет к экрану его карточку, если карточки в этом чате включены. */
function withWidget(
  screen: BotScreen,
  widgets: boolean,
  build: () => WidgetMessage | null,
  widgetButtons?: InlineButton[][],
): BotScreen {
  if (!widgets) return screen;
  try {
    const widget = build();
    return widget ? { ...screen, widget, widgetButtons } : screen;
  } catch (error) {
    // Сломанная карточка не должна ломать экран: остаётся текст.
    console.error('[карточки] Не удалось собрать карточку:', error);
    return screen;
  }
}

async function notificationMenu(data: JournalData, gi: number, groupId: string, chatId: number, widgets: boolean): Promise<BotScreen> {
  const list = await chatSubscriptions(chatId, groupId);
  if (groupId !== REPLACED_ISIP_R_GROUP_ID) {
    return withWidget(notifyMenuScreen(data, gi, list), widgets, () => notifyMenuWidget(data, list));
  }

  const visible: Subscription[] = [];
  const missing: Subscription[] = [];
  const usedNames = new Set<string>();
  for (const subscription of list) {
    const name = normalizedStudentName(subscription.studentName);
    const student = data.students.find((item) => normalizedStudentName(item.name) === name);
    if (!student || !currentStudent(data, student.id)) {
      missing.push(subscription);
      continue;
    }
    if (usedNames.has(name)) continue;
    usedNames.add(name);
    const merged = mergedSubscription(matchingSubscriptions(list, groupId, data, student.id), student.id);
    if (merged) visible.push(merged);
  }

  const screen = notifyMenuScreen(data, gi, visible, true);
  if (missing.length) {
    screen.text += `\n\n<b>Подписки, которых нет в новом списке:</b>`;
    for (const subscription of missing) {
      screen.text += `\n• ${escapeHtml(subscription.studentName)}`;
      screen.buttons.splice(-1, 0, [{
        text: `🔕 Убрать: ${subscription.studentName.slice(0, 26)}`,
        callback_data: `wo:${gi}:${subscription.studentId}:${studentNameKey(subscription.studentName)}`,
      }]);
    }
  }
  return withWidget(screen, widgets, () => notifyMenuWidget(data, visible));
}

async function refreshedNotificationMenu(data: JournalData, gi: number, groupId: string, chatId: number, widgets: boolean): Promise<BotScreen> {
  const screen = await notificationMenu(data, gi, groupId, chatId, widgets);
  screen.text = `Кнопки обновлены после замены журнала. Выбери студента ещё раз.\n\n${screen.text}`;
  return screen;
}

/** Раздел лекций получает группы из расписания и не обращается к Excel журнала. */
async function buildLectureScreen(action: string, chatId: number, widgets: boolean): Promise<BotScreen> {
  const schedule = await getScheduleData();
  const groups = [...schedule.groups].sort((a, b) => a.localeCompare(b, 'ru'));
  const store = getLectureStore();
  const groupsList = async () => {
    const subscriptions = await store.listByChat(chatId);
    return withWidget(lectureGroupsScreen(groups, subscriptions), widgets, () => lectureGroupsWidget(groups, subscriptions));
  };

  if (action === 'lg') {
    return groupsList();
  }

  const [kind, key] = action.split(':');
  const groupName = findLectureGroup(groups, key || '');
  if (!groupName) {
    return groupsList();
  }

  const toggled = kind === 'lv' || kind === 'll';
  if (toggled) {
    const mode: LectureMode = kind === 'lv' ? 'video' : 'lecture';
    const current = await store.get(chatId, groupName);
    await store.setMode(chatId, groupName, mode, !current?.[mode]);
  }

  const screen = withWidget(lectureSettingsScreen(groupName, await store.get(chatId, groupName)), widgets, () => lectureSettingsWidget(groupName));
  return toggled ? { ...screen, sameScreen: true } : screen;
}

/** Кнопка карточек в меню; null — карточки выключены для всех, кнопка не нужна. */
async function widgetToggleFor(chatId: number, back: string): Promise<WidgetToggle | null> {
  const on = await chatWidgetsState(chatId);
  return on === null ? null : { on, back };
}

async function buildScreen(action: string, chatId: number): Promise<BotScreen> {
  try {
    if (action.startsWith('wx|')) {
      const current = await chatWidgetsState(chatId);
      if (current !== null) {
        await setChatWidgets(chatId, !current);
      }
      const back = action.slice(3);
      return await buildScreen(back && !back.startsWith('wx|') ? back : 'start', chatId);
    }

    const widgets = await widgetsEnabledFor(chatId);

    if (action === 'lg' || /^(ls|lv|ll):/.test(action)) {
      return await buildLectureScreen(action, chatId, widgets);
    }

    const groups = await getJournalGroups();

    if (action === 'grp' || action === 'start') {
      // Если группа всего одна — сразу открываем её журнал без лишнего экрана.
      if (groups.length === 1) {
        const { data, gi, group } = await loadGroupData(groups, 0);
        return withWidget(groupMenuScreen(data, gi, groups.length, group, await widgetToggleFor(chatId, 'g:0')), widgets, () => groupWidget(data));
      }
      return withWidget(groupsScreen(groups, await widgetToggleFor(chatId, 'grp')), widgets, () => homeWidget(groups.length));
    }

    const parts = action.split(':');
    const kind = parts[0];
    const gi = Number.parseInt(parts[1] ?? '0', 10) || 0;
    const a = Number.parseInt(parts[2] ?? '0', 10) || 0;
    const b = Number.parseInt(parts[3] ?? '0', 10) || 0;

    switch (kind) {
      case 'g': {
        const { data, group } = await loadGroupData(groups, gi);
        return withWidget(groupMenuScreen(data, gi, groups.length, group, await widgetToggleFor(chatId, `g:${gi}`)), widgets, () => groupWidget(data));
      }
      case 's': {
        const { data } = await loadGroupData(groups, gi);
        return withWidget(studentsScreen(data, gi), widgets, () => studentsWidget(data));
      }
      case 'c': {
        const { data } = await loadGroupData(groups, gi);
        const screen = studentCardScreen(data, gi, a);
        const calculator = widgets && calculatorWidget(data, a)
          ? [[{ text: '🧮 Калькулятор оценок', callback_data: `k:${gi}:${a}` }], ...screen.buttons]
          : screen.buttons;
        return withWidget(screen, widgets, () => studentCardWidget(data, a), calculator);
      }
      // «k» — калькулятор из карточки; без карточек вместо него обычный табель.
      case 'k': {
        const { data } = await loadGroupData(groups, gi);
        return withWidget(studentCardScreen(data, gi, a), widgets, () => calculatorWidget(data, a), [
          [{ text: '⬅️ К табелю', callback_data: `c:${gi}:${a}` }],
        ]);
      }
      case 'm': {
        const { data } = await loadGroupData(groups, gi);
        return withWidget(studentGradesScreen(data, gi, a), widgets, () => gradesWidget(data, a));
      }
      case 'n': {
        const { data } = await loadGroupData(groups, gi);
        return withWidget(studentAbsencesScreen(data, gi, a), widgets, () => absencesWidget(data, a));
      }
      case 'r': {
        const { data } = await loadGroupData(groups, gi);
        return withWidget(ratingScreen(data, gi), widgets, () => ratingWidget(data));
      }
      case 'p': {
        const { data } = await loadGroupData(groups, gi);
        return withWidget(subjectsScreen(data, gi), widgets, () => subjectsWidget(data));
      }
      case 'ps': {
        const { data } = await loadGroupData(groups, gi);
        return withWidget(subjectDetailScreen(data, gi, a), widgets, () => subjectDetailWidget(data, a));
      }
      case 't': {
        const { data } = await loadGroupData(groups, gi);
        return withWidget(subjectTopicsScreen(data, gi, a, b), widgets, () => topicsWidget(data, a, b));
      }

      // ---- уведомления об оценках ----
      case 'w': {
        const { data, group } = await loadGroupData(groups, gi);
        return notificationMenu(data, gi, group.id, chatId, widgets);
      }
      case 'wp': {
        const { data, group } = await loadGroupData(groups, gi);
        if (!validStudentButton(group.id, data, a, parts[3])) {
          return refreshedNotificationMenu(data, gi, group.id, chatId, widgets);
        }
        const matches = matchingSubscriptions(await chatSubscriptions(chatId, group.id), group.id, data, a);
        const subscription = mergedSubscription(matches, a);
        return withWidget(
          notifyStudentScreen(data, gi, a, subscription, group.id === REPLACED_ISIP_R_GROUP_ID),
          widgets,
          () => notifyStudentWidget(data, a, subscription),
        );
      }
      case 'wa': {
        const { data, group } = await loadGroupData(groups, gi);
        if (!validStudentButton(group.id, data, a, parts[3])) {
          return refreshedNotificationMenu(data, gi, group.id, chatId, widgets);
        }
        const student = data.students.find((item) => item.id === a);
        if (student) {
          // Пустой список предметов означает «все».
          const store = getSubscriptionStore();
          const list = await chatSubscriptions(chatId, group.id);
          const matches = matchingSubscriptions(list, group.id, data, a);
          const storageId = matches[0]?.studentId ?? freeSubscriptionId(list, student.id);
          await store.save({
            chatId,
            groupId: group.id,
            studentId: storageId,
            studentName: student.name,
            subjects: [],
          });
          for (const duplicate of matches.slice(1)) {
            await store.remove(chatId, group.id, duplicate.studentId);
          }
        }
        return notificationMenu(data, gi, group.id, chatId, widgets);
      }
      case 'ws': {
        const { data, group } = await loadGroupData(groups, gi);
        if (!validStudentButton(group.id, data, a, parts[3])) {
          return refreshedNotificationMenu(data, gi, group.id, chatId, widgets);
        }
        const matches = matchingSubscriptions(await chatSubscriptions(chatId, group.id), group.id, data, a);
        return withWidget(
          notifySubjectsScreen(data, gi, a, mergedSubscription(matches, a), group.id === REPLACED_ISIP_R_GROUP_ID),
          widgets,
          () => notifySubjectsWidget(data, a),
        );
      }
      case 'wt': {
        const { data, group } = await loadGroupData(groups, gi);
        if (!validStudentButton(group.id, data, a, parts[4], b)) {
          return refreshedNotificationMenu(data, gi, group.id, chatId, widgets);
        }
        const student = data.students.find((item) => item.id === a);
        const name = subjectNames(data)[b];

        if (student && name) {
          const store = getSubscriptionStore();
          const list = await chatSubscriptions(chatId, group.id);
          const matches = matchingSubscriptions(list, group.id, data, a);
          const current = mergedSubscription(matches, a);
          const chosen = new Set(current?.subjects ?? []);

          if (chosen.has(name)) {
            chosen.delete(name);
          } else {
            chosen.add(name);
          }

          if (chosen.size) {
            const storageId = matches[0]?.studentId ?? freeSubscriptionId(list, student.id);
            await store.save({
              chatId,
              groupId: group.id,
              studentId: storageId,
              studentName: student.name,
              subjects: [...chosen],
            });
          } else {
            // Сняли последнюю галочку — это то же самое, что отписаться.
            for (const subscription of matches) {
              await store.remove(chatId, group.id, subscription.studentId);
            }
          }
          if (chosen.size) {
            for (const duplicate of matches.slice(1)) {
              await store.remove(chatId, group.id, duplicate.studentId);
            }
          }
        }

        const matches = matchingSubscriptions(await chatSubscriptions(chatId, group.id), group.id, data, a);
        const screen = withWidget(
          notifySubjectsScreen(data, gi, a, mergedSubscription(matches, a), group.id === REPLACED_ISIP_R_GROUP_ID),
          widgets,
          () => notifySubjectsWidget(data, a),
        );
        return { ...screen, sameScreen: true };
      }
      case 'wd': {
        const { data, group } = await loadGroupData(groups, gi);
        if (!validStudentButton(group.id, data, a, parts[3])) {
          return refreshedNotificationMenu(data, gi, group.id, chatId, widgets);
        }
        const matches = matchingSubscriptions(await chatSubscriptions(chatId, group.id), group.id, data, a);
        for (const subscription of matches) {
          await getSubscriptionStore().remove(chatId, group.id, subscription.studentId);
        }
        return notificationMenu(data, gi, group.id, chatId, widgets);
      }
      case 'wo': {
        const { data, group } = await loadGroupData(groups, gi);
        if (group.id !== REPLACED_ISIP_R_GROUP_ID) return notificationMenu(data, gi, group.id, chatId, widgets);
        const list = await chatSubscriptions(chatId, group.id);
        const orphan = list.find((item) => item.studentId === a && studentNameKey(item.studentName) === parts[3]);
        const safelyMatched = orphan && data.students.some((item) =>
          normalizedStudentName(item.name) === normalizedStudentName(orphan.studentName) && currentStudent(data, item.id),
        );
        if (orphan && !safelyMatched) await getSubscriptionStore().remove(chatId, group.id, orphan.studentId);
        return notificationMenu(data, gi, group.id, chatId, widgets);
      }
      default: {
        if (groups.length === 1) {
          const { data, gi: safeGi, group } = await loadGroupData(groups, 0);
          return withWidget(groupMenuScreen(data, safeGi, groups.length, group, await widgetToggleFor(chatId, `g:${safeGi}`)), widgets, () => groupWidget(data));
        }
        return withWidget(groupsScreen(groups, await widgetToggleFor(chatId, 'grp')), widgets, () => homeWidget(groups.length));
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return errorScreen(message);
  }
}

/**
 * Показывает экран: карточкой, если она есть, иначе текстом.
 * Экран заменяет сообщение, на кнопку которого нажали, — в чате остаётся одно меню.
 */
async function showScreen(
  chatId: number,
  screen: BotScreen,
  source?: { messageId: number; fromWidget: boolean },
): Promise<void> {
  if (screen.widget) {
    const buttons = screen.widgetButtons ?? screen.buttons;
    // Переключатель под карточкой: меняются только галочки в кнопках, карточка остаётся.
    if (source?.fromWidget && screen.sameScreen && await editReplyMarkup(chatId, source.messageId, buttons)) {
      return;
    }
    const delivery = await sendWidget(chatId, screen.widget, buttons);
    if (delivery === 'sent') {
      if (source) await deleteMessage(chatId, source.messageId);
      return;
    }
    // Ответа нет, но карточка могла прийти: старое меню оставляем, текст не дублируем.
    if (delivery === 'unknown') return;
  }

  if (source && !source.fromWidget && await editMessage(chatId, source.messageId, screen.text, screen.buttons)) {
    return;
  }
  await sendMessage(chatId, screen.text, screen.buttons);
  // Текст карточки не отредактировать: новый экран пришёл отдельно, а её убираем.
  if (source?.fromWidget) await deleteMessage(chatId, source.messageId);
}

export async function POST(request: Request) {
  // Секрет обязателен: без него любой, кто знает адрес сайта, может
  // притвориться Телеграмом и заставить бота отправить журнал в чужой чат.
  const expectedSecret = getWebhookSecret();
  if (!expectedSecret) {
    console.error('[telegram] Не задан TELEGRAM_WEBHOOK_SECRET — бот не отвечает. Добавь переменную и открой /api/telegram/setup.');
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  const receivedSecret = request.headers.get('x-telegram-bot-api-secret-token');
  if (!receivedSecret || !safeCompare(receivedSecret, expectedSecret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  let adminBroadcastUpdate = false;
  try {
    if (update.callback_query) {
      const query = update.callback_query;
      const chatId = query.message?.chat.id;
      const messageId = query.message?.message_id;
      const action = query.data || 'grp';

      // Сразу отвечаем телеграму, чтобы кнопка не «крутилась».
      await answerCallback(query.id);

      if (chatId && messageId) {
        await rememberPrivateChat(chatId, query.message?.chat.type);
        const screen = await buildScreen(action, chatId);
        await showScreen(chatId, screen, { messageId, fromWidget: query.message?.widget !== undefined });
      }
    } else if (update.message) {
      const chatId = update.message.chat.id;
      adminBroadcastUpdate = update.message.chat.type === 'private'
        && update.message.from?.id === chatId
        && broadcastCredentials()?.adminId === chatId;
      await rememberPrivateChat(chatId, update.message.chat.type);
      if (await handleBroadcastMessage(update.message)) {
        return NextResponse.json({ ok: true });
      }
      if (update.message.text) {
        const command = update.message.text.trim().split(/\s+/)[0];
        const screen = await buildScreen(/^\/lectures(?:@[\w]+)?$/i.test(command) ? 'lg' : 'start', chatId);
        await showScreen(chatId, screen);
      }
    }
  } catch (error) {
    console.error('[telegram] Ошибка обработки апдейта:', error);
    // Telegram повторит апдейт, если база не успела сохранить секретную
    // рассылку. Хранилище узнает повтор по ID сообщения и не создаст дубль.
    if (adminBroadcastUpdate) {
      return NextResponse.json({ ok: false }, { status: 503 });
    }
  }

  // Обычные ошибки журнала не должны заставлять Telegram повторять апдейт.
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    hint: 'Это webhook телеграм-бота. Для подключения открой /api/telegram/setup',
  });
}
