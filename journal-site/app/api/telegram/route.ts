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
import { isAccessConfigured, safeEquals } from '@/lib/access';
import { allowedGroups } from '@/lib/group-access';
import { publicJournalError, logJournalEvent } from '@/lib/journal-errors';
import { withinRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface TelegramUpdate {
  update_id?: number;
  message?: {
    chat: { id: number; type?: string };
    from?: { id: number };
    text?: string;
  };
  callback_query?: {
    id: string;
    data?: string;
    from?: { id: number };
    message?: {
      chat: { id: number; type?: string };
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

async function buildScreen(action: string, scope: string): Promise<BotScreen> {
  try {
    const groups = allowedGroups(await getJournalGroups(), { scope });

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
    const message = publicJournalError(error).error;
    return errorScreen(message);
  }
}

export async function POST(request: Request) {
  // Бот повторяет модель доступа сайта. Пока коды групп не настроены,
  // журнал открыт всем, и бот отвечает как раньше — без секрета webhook
  // и без белого списка чатов: закрывать бота, когда сам сайт открыт,
  // ничего не защищает, а работать он при этом перестаёт.
  const journalIsOpen = !isAccessConfigured();
  const expectedSecret = getWebhookSecret();

  if (!expectedSecret && !journalIsOpen) return NextResponse.json({ ok: false }, { status: 503 });

  if (expectedSecret) {
    const receivedSecret = request.headers.get('x-telegram-bot-api-secret-token');
    if (!receivedSecret || !safeEquals(receivedSecret, expectedSecret)) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (!update || typeof update !== 'object') return NextResponse.json({ ok: false }, { status: 400 });
  const chat = update.message?.chat ?? update.callback_query?.message?.chat;
  const from = update.message?.from ?? update.callback_query?.from;
  if (!chat || chat.type !== 'private' || from?.id !== chat.id || !Number.isSafeInteger(chat.id)) return NextResponse.json({ ok: true });
  let configuredScope: unknown;
  try { configuredScope = JSON.parse(process.env.TELEGRAM_GROUP_ACCESS || '{}')[String(chat.id)]; } catch { return NextResponse.json({ ok: false }, { status: 503 }); }

  const hasChatGrant = typeof configuredScope === 'string' && Boolean(configuredScope) && configuredScope !== '*';
  // Чат не в списке: при открытом журнале показываем все группы, как раньше.
  if (!hasChatGrant && !journalIsOpen) return NextResponse.json({ ok: true });
  const scope = hasChatGrant ? (configuredScope as string) : '*';

  if (!withinRateLimit(`telegram:${chat.id}`, 20, 60000)) return NextResponse.json({ ok: true });
  if (Number.isSafeInteger(update.update_id) && !withinRateLimit(`update:${update.update_id}`, 1, 300000)) return NextResponse.json({ ok: true });

  try {
    if (update.callback_query) {
      const query = update.callback_query;
      const chatId = query.message?.chat.id;
      const messageId = query.message?.message_id;
      const action = query.data || 'grp';

      // Сразу отвечаем телеграму, чтобы кнопка не «крутилась».
      await answerCallback(query.id);

      if (chatId && messageId) {
        const screen = await buildScreen(action, scope);
        const edited = await editMessage(chatId, messageId, screen.text, screen.buttons);
        if (!edited) {
          await sendMessage(chatId, screen.text, screen.buttons);
        }
      }
    } else if (update.message?.text) {
      const chatId = update.message.chat.id;
      const screen = await buildScreen('start', scope);
      await sendMessage(chatId, screen.text, screen.buttons);
    }
  } catch (error) {
    logJournalEvent('telegram_failed', { code: publicJournalError(error).code });
  }

  // Всегда отвечаем 200, иначе Telegram будет бесконечно повторять апдейт.
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    hint: 'Webhook Telegram.',
  });
}
