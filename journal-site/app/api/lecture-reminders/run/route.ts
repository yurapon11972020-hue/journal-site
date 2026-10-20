import { NextResponse } from 'next/server';

import { kickBroadcastDrain } from '@/lib/broadcast-scheduler';
import { verifyLectureCronToken } from '@/lib/lecture-cron-auth';
import { runLectureReminders } from '@/lib/lecture-reminders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Внешний будильник бесплатного Render, защищённый GitHub OIDC. */
export async function POST(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(authorization);
  if (!match || !(await verifyLectureCronToken(match[1]))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    await runLectureReminders();
    void kickBroadcastDrain().catch((error) => {
      console.error('[broadcast] Проверка очереди не удалась:', error);
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[lecture-reminders] Scheduled check failed: ${message}`);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
