import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Момент запуска процесса — видно, когда сервис последний раз перезапускался. */
const startedAt = new Date();

/**
 * Какая сборка сейчас работает.
 *
 * Нужна, чтобы отличить «правка не работает» от «правка не доехала»:
 * без этого единственный способ проверить — сверять поведение сайта
 * на глаз. Render кладёт коммит и ветку в переменные окружения сам.
 *
 * Секретов не отдаёт: коммит и ветка и так видны в публичном репозитории.
 */
export async function GET() {
  const commit = process.env.RENDER_GIT_COMMIT?.trim() || null;

  return NextResponse.json({
    commit,
    shortCommit: commit ? commit.slice(0, 7) : null,
    branch: process.env.RENDER_GIT_BRANCH?.trim() || null,
    repo: process.env.RENDER_GIT_REPO_SLUG?.trim() || null,
    startedAt: startedAt.toISOString(),
    // Подсказка на случай, если что-то «не поменялось»: сверить этот
    // коммит с тем, что лежит в ветке на GitHub.
    hint: commit
      ? 'Сверь shortCommit с последним коммитом ветки на GitHub — если не совпал, сборка старая.'
      : 'Сборка запущена не на Render: коммит неизвестен.',
  });
}
