import { describe, expect, it } from 'vitest';

import { formatGroupName, looksLikeGroupName, pickGroupName } from '@/lib/group-name';

describe('название группы', () => {
  it.each([
    ['ИСиП-24-1', 'ИСиП-24/1'],
    ['ИСиП 24/2', 'ИСиП-24/2'],
    ['ИБ-23/1', 'ИБ-23/1'],
    ['ПД 25/2', 'ПД-25/2'],
    ['РУПО 26/1', 'РУПО-26/1'],
    ['ИСиП(Р)-24-1', 'ИСиП(Р)-24/1'],
    ['ИБ_26_2', 'ИБ-26/2'],
  ])('%s приводится к виду %s', (input, expected) => {
    expect(formatGroupName(input)).toBe(expected);
  });

  it.each(['ИСиП-24-1', 'ИБ-23/1', 'ПД 25/2', 'РУПО 26/1'])('%s — это группа', (value) => {
    expect(looksLikeGroupName(value)).toBe(true);
  });

  it.each([
    '26/27-Д',
    '2026/2027',
    '2026-2027 учебный год',
    'Журнал 26/27',
    'Сентябрь 25/26',
    'Месяц',
    'Средний балл',
    '',
    'n2Ldf1ar5jbjJg',
  ])('%s группой не считается', (value) => {
    expect(looksLikeGroupName(value)).toBe(false);
  });

  it('шапка журнала главнее имени файла', () => {
    // Файл на Диске назван по группе, с которой его скопировали.
    expect(pickGroupName('ИСиП-26-2', 'ИБ 26/2')).toBe('ИБ-26/2');
    expect(pickGroupName('ИСиП-24-1', 'ИСиП 24/2')).toBe('ИСиП-24/2');
  });

  it('служебное имя файла тоже уступает шапке', () => {
    expect(pickGroupName('n2Ldf1ar5jbjJg', 'РУПО 26/1')).toBe('РУПО-26/1');
  });

  it('пустая шапка возвращает к имени файла', () => {
    expect(pickGroupName('ИСиП-24-1', '')).toBe('ИСиП-24/1');
    expect(pickGroupName('ИСиП-24-1', '26/27-Д')).toBe('ИСиП-24/1');
  });

  it('когда не подходит ничего, остаётся имя файла', () => {
    expect(pickGroupName('n2Ldf1ar5jbjJg', '26/27-Д')).toBe('n2Ldf1ar5jbjJg');
  });
});
