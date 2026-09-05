import { describe, expect, it } from 'vitest';

import { classifyMarkValue, markToneToClass } from '@/lib/mark-classifier';

describe('classifyMarkValue', () => {
  it('красит настоящие оценки', () => {
    expect(classifyMarkValue('5')).toMatchObject({ tone: 'excellent', isColored: true });
    expect(classifyMarkValue('4')).toMatchObject({ tone: 'good', isColored: true });
    expect(classifyMarkValue('3')).toMatchObject({ tone: 'ok', isColored: true });
    expect(classifyMarkValue('2')).toMatchObject({ tone: 'bad', isColored: true });
  });

  it('красит точные отметки о пропусках', () => {
    expect(classifyMarkValue('н')).toMatchObject({ tone: 'absence', isColored: true });
    expect(classifyMarkValue('Н')).toMatchObject({ tone: 'absence', isColored: true });
    expect(classifyMarkValue('н/у')).toMatchObject({ tone: 'valid-absence', isColored: true });
    expect(classifyMarkValue('ЭН')).toMatchObject({ tone: 'electronic-absence', isColored: true });
  });

  // Главное правило журнала: служебные записи не должны выглядеть как оценки.
  it.each(['Н/ОТР', 'Н/У/ОТР', 'Нет оценок', 'Зачет', 'Незачет', 'Осв', 'б/о', 'ОП'])(
    'оставляет служебную запись «%s» без заливки',
    (value) => {
      const result = classifyMarkValue(value);
      expect(result.isColored).toBe(false);
      expect(result.tone).toBe('plain');
      expect(result.displayText).toBe(value);
    },
  );

  it('не красит служебные маркеры вида \\1 и показывает их как в Excel', () => {
    expect(classifyMarkValue('\\13')).toMatchObject({ tone: 'plain', isColored: false, displayText: '\\13' });
    expect(classifyMarkValue('/2')).toMatchObject({ tone: 'plain', isColored: false, displayText: '\\2' });
  });

  it('понимает латинские буквы, которыми иногда набирают Н и НУ', () => {
    expect(classifyMarkValue('H')).toMatchObject({ tone: 'absence', isColored: true });
    expect(classifyMarkValue('H/y')).toMatchObject({ tone: 'valid-absence', isColored: true });
  });

  it('обрабатывает несколько оценок в одной клетке', () => {
    expect(classifyMarkValue('4/5').isColored).toBe(true);
    expect(classifyMarkValue('2 3').isColored).toBe(true);
  });

  it('пустую клетку показывает прочерком без цвета', () => {
    expect(classifyMarkValue('')).toMatchObject({ tone: 'empty', displayText: '—', isColored: false });
    expect(classifyMarkValue(null)).toMatchObject({ tone: 'empty', isColored: false });
    expect(classifyMarkValue('   ')).toMatchObject({ tone: 'empty', isColored: false });
  });

  it('произвольный текст остаётся без заливки', () => {
    expect(classifyMarkValue('болел')).toMatchObject({ tone: 'plain', isColored: false });
    expect(classifyMarkValue('5 баллов за проект')).toMatchObject({ tone: 'plain', isColored: false });
  });

  it('каждому тону соответствует свой css-класс', () => {
    expect(markToneToClass('excellent')).toBe('mark--excellent');
    expect(markToneToClass('absence')).toBe('mark--absence');
    expect(markToneToClass('plain')).toBe('mark--plain');
  });
});
