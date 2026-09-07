export interface ParsedMark {
  numbers: number[];
  attendance: 'valid' | 'invalid' | 'electronic' | null;
}

export function parseMarkValue(value: unknown): ParsedMark {
  const empty: ParsedMark = { numbers: [], attendance: null };
  const text = String(value ?? '').trim().replace(/\u00a0/g, ' ');
  const key = text.toLowerCase().replace(/[hn]/g, 'н').replace(/[yu]/g, 'у').replace(/[\\|]/g, '/').replace(/\s/g, '').replace(/\.$/, '');
  if (key === 'н') return { numbers: [], attendance: 'invalid' };
  if (key === 'н/у' || key === 'ну') return { numbers: [], attendance: 'valid' };
  if (key === 'эн' || key === 'э/н') return { numbers: [], attendance: 'electronic' };
  if (/^[1-5][+-]?$/.test(text)) return { numbers: [Number(text[0])], attendance: null };
  if (/^[1-5][.,]\d+$/.test(text)) {
    const number = Number(text.replace(',', '.'));
    return number <= 5 ? { numbers: [number], attendance: null } : empty;
  }
  if (/^[1-5](?:[ /;]+[1-5])+$/.test(text)) return { numbers: text.match(/[1-5]/g)!.map(Number), attendance: null };
  return empty;
}
