import { NextResponse } from 'next/server';

import { watchGroup } from '@/lib/grade-watch';
import { findJournalGroupById, getJournalDataByGroupId } from '@/lib/journal';
import { recoverPublicJournalFileFromBrowser } from '@/lib/yandex-disk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_WORKBOOK_BYTES = 20 * 1024 * 1024;

async function readLimitedWorkbook(request: Request): Promise<Buffer> {
  const declaredSize = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_WORKBOOK_BYTES) {
    throw new Error('Файл больше 20 МБ.');
  }

  const reader = request.body?.getReader();
  if (!reader) {
    throw new Error('Файл не передан.');
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > MAX_WORKBOOK_BYTES) {
      await reader.cancel();
      throw new Error('Файл больше 20 МБ.');
    }
    chunks.push(Buffer.from(value));
  }
  if (!total) {
    throw new Error('Файл пустой.');
  }
  return Buffer.concat(chunks, total);
}

export async function POST(request: Request) {
  const groupId = new URL(request.url).searchParams.get('group')?.trim();
  if (!groupId) {
    return NextResponse.json({ error: 'Не указана группа.' }, { status: 400 });
  }

  const group = await findJournalGroupById(groupId).catch(() => null);
  if (!group || group.source !== 'yandex-public-cache') {
    return NextResponse.json({ error: 'Группа не найдена.' }, { status: 404 });
  }

  try {
    const workbook = await readLimitedWorkbook(request);
    await recoverPublicJournalFileFromBrowser(group.filePath, workbook);

    // Страницу открываем сразу. Проверка оценок и доставка сообщений идут в
    // фоне; очередной минутный цикл также подхватит сохранённый журнал.
    void getJournalDataByGroupId(groupId).then((data) => watchGroup(groupId, group.groupName, data)).catch((error) => {
      console.error(`[уведомления] Не удалось проверить группу «${group.groupName}» после восстановления:`, error);
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось открыть файл.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
