import { NextResponse } from 'next/server';

import { getJournalDataByPath, getJournalGroups } from '@/lib/journal';
import { getSubscriptionStore, type Subscription } from '@/lib/subscriptions';
import { answerCallback, editMessage, getWebhookSecret, safeCompare, sendMessage } from '@/lib/telegram';
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
    chat: { id: number };
    text?: string;
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: {
      chat: { id: number };
      message_id: number;
    };
  };
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

async function buildScreen(action: string, chatId: number): Promise<BotScreen> {
  try {
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

  try {
    if (update.callback_query) {
      const query = update.callback_query;
      const chatId = query.message?.chat.id;
      const messageId = query.message?.message_id;
      const action = query.data || 'grp';

      // Сразу отвечаем телеграму, чтобы кнопка не «крутилась».
      await answerCallback(query.id);

      if (chatId && messageId) {
        const screen = await buildScreen(action, chatId);
        const edited = await editMessage(chatId, messageId, screen.text, screen.buttons);
        if (!edited) {
          await sendMessage(chatId, screen.text, screen.buttons);
        }
      }
    } else if (update.message?.text) {
      const chatId = update.message.chat.id;
      const screen = await buildScreen('start', chatId);
      await sendMessage(chatId, screen.text, screen.buttons);
    }
  } catch (error) {
    console.error('[telegram] Ошибка обработки апдейта:', error);
  }

  // Всегда отвечаем 200, иначе Telegram будет бесконечно повторять апдейт.
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    hint: 'Это webhook телеграм-бота. Для подключения открой /api/telegram/setup',
  });
}
