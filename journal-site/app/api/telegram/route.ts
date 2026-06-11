import { NextResponse } from 'next/server';

import { getJournalDataByPath, getJournalGroups } from '@/lib/journal';
import { answerCallback, editMessage, getWebhookSecret, sendMessage } from '@/lib/telegram';
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

async function buildScreen(action: string): Promise<BotScreen> {
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
  const expectedSecret = getWebhookSecret();
  if (expectedSecret) {
    const receivedSecret = request.headers.get('x-telegram-bot-api-secret-token');
    if (receivedSecret !== expectedSecret) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
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
        const screen = await buildScreen(action);
        const edited = await editMessage(chatId, messageId, screen.text, screen.buttons);
        if (!edited) {
          await sendMessage(chatId, screen.text, screen.buttons);
        }
      }
    } else if (update.message?.text) {
      const chatId = update.message.chat.id;
      const screen = await buildScreen('start');
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
