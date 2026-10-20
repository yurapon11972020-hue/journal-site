import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getLectureStore, setLectureStoreForTests } from '@/lib/lecture-subscriptions';

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', '');
  setLectureStoreForTests(null);
});

afterEach(() => {
  setLectureStoreForTests(null);
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('отдельные подписки на лекции', () => {
  it('включает видеолекции и обычные лекции независимо для каждой группы', async () => {
    const store = getLectureStore();

    await store.setMode(42, 'ПД-24/1', 'video', true);
    expect(await store.get(42, 'ПД-24/1')).toMatchObject({ video: true, lecture: false });

    await store.setMode(42, 'ПД-24/1', 'lecture', true);
    await store.setMode(42, 'ПД-24/2', 'lecture', true);
    expect(await store.get(42, 'ПД-24/1')).toMatchObject({ video: true, lecture: true });
    expect(await store.listChats('ПД-24/1', 'video')).toEqual([42]);
    expect(await store.listChats('ПД-24/2', 'video')).toEqual([]);
    expect(await store.listChats('ПД-24/2', 'lecture')).toEqual([42]);
    expect(await store.listByChat(42)).toHaveLength(2);

    await store.setMode(42, 'ПД-24/1', 'video', false);
    expect(await store.get(42, 'ПД-24/1')).toMatchObject({ video: false, lecture: true });

    await store.setMode(42, 'ПД-24/1', 'lecture', false);
    expect(await store.get(42, 'ПД-24/1')).toBeNull();
    expect(await store.listChats('ПД-24/1', 'lecture')).toEqual([]);
  });

  it('не выдаёт два резервирования одной отправки, в том числе после отметки об успехе', async () => {
    const store = getLectureStore();

    expect(await store.claim('lesson-1', 42)).toBe(true);
    expect(await store.claim('lesson-1', 42)).toBe(false);
    expect(await store.claim('lesson-1', 43)).toBe(true);
    expect(await store.claim('lesson-2', 42)).toBe(true);

    await store.markSent('lesson-1', 42);
    await store.release('lesson-1', 42);
    expect(await store.claim('lesson-1', 42)).toBe(false);
  });

  it('повторяет явную ошибку отправки и восстанавливает застрявшее резервирование', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T10:00:00.000Z'));
    const store = getLectureStore();

    expect(await store.claim('lesson-1', 42)).toBe(true);
    await store.release('lesson-1', 42);
    expect(await store.claim('lesson-1', 42)).toBe(true);

    vi.advanceTimersByTime(15 * 60 * 1000 - 1);
    expect(await store.claim('lesson-1', 42)).toBe(false);
    vi.advanceTimersByTime(2);
    expect(await store.claim('lesson-1', 42)).toBe(true);
  });
});
