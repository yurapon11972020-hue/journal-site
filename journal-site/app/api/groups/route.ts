import { NextResponse } from 'next/server';

import { getJournalGroups } from '@/lib/journal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const groups = await getJournalGroups();

    return NextResponse.json({
      count: groups.length,
      groups: groups.map((group) => ({
        id: group.id,
        groupName: group.groupName,
        fileName: group.fileName,
        source: group.source,
        url: `/group/${group.id}`,
        journalUrl: `/api/journal?group=${encodeURIComponent(group.id)}`,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
