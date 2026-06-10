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
  studentsScreen,
  subjectDetailScreen,
  subjectsScreen,
  type BotScreen,
} from '@/lib/telegram-views';
import type { JournalData } from '@/lib/types';

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

async function loadGroupData(gi: number): Promise<{ data: JournalData; gi: number }> {
  const groups = await getJournalGroups();
  const group = groups[gi] ?? groups[0];
  if (!group) {
    throw new Error('Список групп пуст. Проверь ссылку на Яндекс.Диск.');
  }
  const data = await getJournalDataByPath(group.filePath);
  return { data, gi: groups[gi] ? gi : 0 };
}

async function buildScreen(action: string): Promise<BotScreen> {
  try {
    if (action === 'grp' || action === 'start') {
      const groups = await getJournalGroups();
      return groupsScreen(groups);
    }

    const [kind, giRaw, extraRaw] = action.split(':');
    const gi = Number.parseInt(giRaw ?? '0', 10) || 0;
    const extra = Number.parseInt(extraRaw ?? '0', 10) || 0;

    switch (kind) {
      case 'g': {
        const { data } = await loadGroupData(gi);
        return groupMenuScreen(data, gi);
      }
      case 's': {
        const { data } = await loadGroupData(gi);
        return studentsScreen(data, gi, extra);
      }
      case 'c': {
        const { data } = await loadGroupData(gi);
        return studentCardScreen(data, gi, extra);
      }
      case 'n': {
        const { data } = await loadGroupData(gi);
        return studentAbsencesScreen(data, gi, extra);
      }
      case 'r': {
        const { data } = await loadGroupData(gi);
        return ratingScreen(data, gi);
      }
      case 'p': {
        const { data } = await loadGroupData(gi);
        return subjectsScreen(data, gi);
      }
      case 'ps': {
        const { data } = await loadGroupData(gi);
        return subjectDetailScreen(data, gi, extra);
      }
      default: {
        const groups = await getJournalGroups();
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
