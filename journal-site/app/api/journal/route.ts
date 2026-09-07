import { NextResponse } from 'next/server';

import { getJournalData, getJournalDataByGroupId } from '@/lib/journal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    // /api/journal — первая группа, /api/journal?group=<id> — конкретная группа.
    const groupId = new URL(request.url).searchParams.get('group')?.trim();
    const data = groupId ? await getJournalDataByGroupId(groupId) : await getJournalData();
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
