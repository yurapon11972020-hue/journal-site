import { NextResponse } from 'next/server';
import { getJournalDataByPath, getJournalGroups, findJournalGroupById } from '@/lib/journal';
import { getAccessGrant, tokenFromRequest } from '@/lib/access';
import { allowedGroups } from '@/lib/group-access';
import { JournalError, publicJournalError } from '@/lib/journal-errors';
import { isSameOrigin, withinRateLimit } from '@/lib/rate-limit';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

async function respond(request: Request, force: boolean) {
  try {
    const grant = await getAccessGrant(tokenFromRequest(request));
    if (!grant) throw new JournalError('JOURNAL_AUTH_REQUIRED', 401);
    const groups = allowedGroups(await getJournalGroups(), grant);
    const id = new URL(request.url).searchParams.get('group')?.trim();
    const group = id ? await findJournalGroupById(id) : groups[0];
    if (!group || !groups.some((entry) => entry.id === group.id)) throw new JournalError('JOURNAL_NOT_FOUND', 404);
    if (force && !withinRateLimit('refresh:' + group.id, 4, 60000)) return NextResponse.json({ error: 'Подождите минуту перед следующим обновлением.' }, { status: 429, headers: { ...headers, 'Retry-After': '60' } });
    return NextResponse.json(await getJournalDataByPath(group.filePath, { force }), { headers });
  } catch (error) {
    const safe = publicJournalError(error);
    return NextResponse.json({ code: safe.code, error: safe.error }, { status: safe.status, headers });
  }
}
export async function GET(request: Request) { return respond(request, false); }
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Недопустимый источник запроса.' }, { status: 403, headers });
  return respond(request, true);
}
