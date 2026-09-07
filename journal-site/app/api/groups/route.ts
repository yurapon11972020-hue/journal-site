import { NextResponse } from 'next/server';
import { getJournalGroups } from '@/lib/journal';
import { getAccessGrant, tokenFromRequest } from '@/lib/access';
import { allowedGroups, groupView } from '@/lib/group-access';
import { publicJournalError } from '@/lib/journal-errors';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: Request) {
  const grant = await getAccessGrant(tokenFromRequest(request));
  if (!grant) return NextResponse.json({ code: 'JOURNAL_AUTH_REQUIRED', error: 'Войдите по коду своей группы.' }, { status: 401, headers });
  try {
    const groups = allowedGroups(await getJournalGroups(), grant);
    return NextResponse.json({ count: groups.length, groups: groups.map((group) => ({ ...groupView(group), url: '/group/' + group.id, journalUrl: '/api/journal?group=' + encodeURIComponent(group.id) })) }, { headers });
  } catch (error) {
    const safe = publicJournalError(error);
    return NextResponse.json({ code: safe.code, error: safe.error }, { status: safe.status, headers });
  }
}
