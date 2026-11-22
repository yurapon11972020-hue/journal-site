import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { runPendingBroadcasts } from '@/lib/broadcast-delivery';
import { runScheduledGradeWatch, scheduledActivity } from '@/lib/grade-watch-scheduled';
import { runLectureReminders } from '@/lib/lecture-reminders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const expected = process.env.JOURNAL_CRON_SECRET?.trim();
  const received = request.headers.get('authorization')?.replace(/^Bearer /i, '');
  if (!expected || !received) return false;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
}

/** Вызывается только запланированной функцией Netlify. */
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ ok: false }, { status: 401 });
  if (!process.env.DATABASE_URL?.trim() || !process.env.TELEGRAM_BOT_TOKEN?.trim()) {
    return NextResponse.json({ ok: true, skipped: 'bot_not_configured' });
  }

  let activity: Awaited<ReturnType<typeof scheduledActivity>>;
  try {
    activity = await scheduledActivity();
  } catch (error) {
    console.error('[cron] Не удалось проверить подписки:', error);
    return NextResponse.json({ ok: false, error: 'database_unavailable' }, { status: 503 });
  }

  const [lectures, grades, broadcast] = await Promise.allSettled([
    activity.lectures ? runLectureReminders() : Promise.resolve(null),
    activity.grades ? runScheduledGradeWatch() : Promise.resolve(null),
    activity.broadcast ? runPendingBroadcasts(12) : Promise.resolve(null),
  ]);

  for (const [name, result] of [['lectures', lectures], ['grades', grades], ['broadcast', broadcast]] as const) {
    if (result.status === 'rejected') console.error(`[cron] ${name}:`, result.reason);
  }

  const ok = lectures.status === 'fulfilled' && grades.status === 'fulfilled' && broadcast.status === 'fulfilled';
  return NextResponse.json({
    ok,
    lectures: lectures.status === 'fulfilled' ? lectures.value : null,
    grades: grades.status === 'fulfilled' ? grades.value : null,
    broadcast: broadcast.status === 'fulfilled' ? broadcast.value : null,
  }, { status: ok ? 200 : 503 });
}
