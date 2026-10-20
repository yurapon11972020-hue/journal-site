import { NextResponse } from 'next/server';

import { getJournalDataByPath, getJournalGroups } from '@/lib/journal';
import { kickBroadcastDrain } from '@/lib/broadcast-scheduler';
import { getBroadcastStore } from '@/lib/broadcast-store';
import { getScheduleData } from '@/lib/lecture-sources';
import { getLectureStore, type LectureMode } from '@/lib/lecture-subscriptions';
import { getSubscriptionStore, type Subscription } from '@/lib/subscriptions';
import { answerCallback, deleteMessage, editMessage, getWebhookSecret, safeCompare, sendMessage } from '@/lib/telegram';
import { findLectureGroup, lectureGroupsScreen, lectureSettingsScreen } from '@/lib/telegram-lecture-views';
import {
  notifyMenuScreen,
  notifyStudentScreen,
  notifySubjectsScreen,
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
} from '@/lib/telegram-views';
import type { JournalData, JournalGroupRef } from '@/lib/types';

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
    };
  };
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

async function findSubscription(
  chatId: number,
  groupId: string,
  studentId: number,
): Promise<Subscription | null> {
  const list = await chatSubscriptions(chatId, groupId);
  return list.find((item) => item.studentId === studentId) ?? null;
}

/** Раздел лекций получает группы из расписания и не обращается к Excel журнала. */
async function buildLectureScreen(action: string, chatId: number): Promise<BotScreen> {
  const schedule = await getScheduleData();
  const groups = [...schedule.groups].sort((a, b) => a.localeCompare(b, 'ru'));
  const store = getLectureStore();

  if (action === 'lg') {
    return lectureGroupsScreen(groups, await store.listByChat(chatId));
  }

  const [kind, key] = action.split(':');
  const groupName = findLectureGroup(groups, key || '');
  if (!groupName) {
    return lectureGroupsScreen(groups, await store.listByChat(chatId));
  }

  if (kind === 'lv' || kind === 'll') {
    const mode: LectureMode = kind === 'lv' ? 'video' : 'lecture';
    const current = await store.get(chatId, groupName);
    await store.setMode(chatId, groupName, mode, !current?.[mode]);
  }

  return lectureSettingsScreen(groupName, await store.get(chatId, groupName));
}

async function buildScreen(action: string, chatId: number): Promise<BotScreen> {
  try {
    if (action === 'lg' || /^(ls|lv|ll):/.test(action)) {
      return await buildLectureScreen(action, chatId);
    }

    const groups = await getJournalGroups();

    if (action === 'grp' || action === 'start') {
      // Если группа всего одна — сразу открываем её журнал без лишнего экрана.
      if (groups.length === 1) {
        const { data, gi, group } = await loadGroupData(groups, 0);
        return groupMenuScreen(data, gi, groups.length, group);
      }
      return groupsScreen(groups);
    }

    const parts = action.split(':');
    const kind = parts[0];
    const gi = Number.parseInt(parts[1] ?? '0', 10) || 0;
    const a = Number.parseInt(parts[2] ?? '0', 10) || 0;
    const b = Number.parseInt(parts[3] ?? '0', 10) || 0;

    switch (kind) {
      case 'g': {
        const { data, group } = await loadGroupData(groups, gi);
        return groupMenuScreen(data, gi, groups.length, group);
      }
      case 's': {
        const { data } = await loadGroupData(groups, gi);
        return studentsScreen(data, gi);
      }
      case 'c': {
        const { data } = await loadGroupData(groups, gi);
        return studentCardScreen(data, gi, a);
      }
      case 'm': {
        const { data } = await loadGroupData(groups, gi);
        return studentGradesScreen(data, gi, a);
      }
      case 'n': {
        const { data } = await loadGroupData(groups, gi);
        return studentAbsencesScreen(data, gi, a);
      }
      case 'r': {
        const { data } = await loadGroupData(groups, gi);
        return ratingScreen(data, gi);
      }
      case 'p': {
        const { data } = await loadGroupData(groups, gi);
        return subjectsScreen(data, gi);
      }
      case 'ps': {
        const { data } = await loadGroupData(groups, gi);
        return subjectDetailScreen(data, gi, a);
      }
      case 't': {
        const { data } = await loadGroupData(groups, gi);
        return subjectTopicsScreen(data, gi, a, b);
      }

      // ---- уведомления об оценках ----
      case 'w': {
        const { data, group } = await loadGroupData(groups, gi);
        return notifyMenuScreen(data, gi, await chatSubscriptions(chatId, group.id));
      }
      case 'wp': {
        const { data, group } = await loadGroupData(groups, gi);
        return notifyStudentScreen(data, gi, a, await findSubscription(chatId, group.id, a));
      }
      case 'wa': {
        const { data, group } = await loadGroupData(groups, gi);
        const student = data.students.find((item) => item.id === a);
        if (student) {
          // Пустой список предметов означает «все».
          await getSubscriptionStore().save({
            chatId,
            groupId: group.id,
            studentId: student.id,
            studentName: student.name,
            subjects: [],
          });
        }
        return notifyMenuScreen(data, gi, await chatSubscriptions(chatId, group.id));
      }
      case 'ws': {
        const { data, group } = await loadGroupData(groups, gi);
        return notifySubjectsScreen(data, gi, a, await findSubscription(chatId, group.id, a));
      }
      case 'wt': {
        const { data, group } = await loadGroupData(groups, gi);
        const student = data.students.find((item) => item.id === a);
        const name = subjectNames(data)[b];

        if (student && name) {
          const store = getSubscriptionStore();
          const current = await findSubscription(chatId, group.id, a);
          const chosen = new Set(current?.subjects ?? []);

          if (chosen.has(name)) {
            chosen.delete(name);
          } else {
            chosen.add(name);
          }

          if (chosen.size) {
            await store.save({
              chatId,
              groupId: group.id,
              studentId: student.id,
              studentName: student.name,
              subjects: [...chosen],
            });
          } else {
            // Сняли последнюю галочку — это то же самое, что отписаться.
            await store.remove(chatId, group.id, student.id);
          }
        }

        return notifySubjectsScreen(data, gi, a, await findSubscription(chatId, group.id, a));
      }
      case 'wd': {
        const { data, group } = await loadGroupData(groups, gi);
        await getSubscriptionStore().remove(chatId, group.id, a);
        return notifyMenuScreen(data, gi, await chatSubscriptions(chatId, group.id));
      }
      default: {
        if (groups.length === 1) {
          const { data, gi: safeGi, group } = await loadGroupData(groups, 0);
          return groupMenuScreen(data, safeGi, groups.length, group);
        }
        return groupsScreen(groups);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return errorScreen(message);
  }
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
        const edited = await editMessage(chatId, messageId, screen.text, screen.buttons);
        if (!edited) {
          await sendMessage(chatId, screen.text, screen.buttons);
        }
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
        await sendMessage(chatId, screen.text, screen.buttons);
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
