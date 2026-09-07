import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseJournalWorkbook } from '@/lib/parseJournal';
function parse(name: string) {
  const buffer = readFileSync(new URL('./fixtures/' + name, import.meta.url));
  return parseJournalWorkbook(buffer, { buffer, source: 'local', sourceDetails: 'fixture' });
}
describe('сохранённые обезличенные fixtures', () => {
  it('обычный XLSX', () => expect(parse('journal-normal.xlsx')).toMatchObject({ studentCount: 3, subjectCount: 2 }));
  it('журнал без оценок сохраняет занятия', () => { const data = parse('journal-empty.xlsx'); expect(data.students[0].subjects[0].grades).toEqual([]); expect(data.subjects[0].lessons).toHaveLength(6); });
  it('страница входа не становится успешным журналом', () => expect(() => parse('journal-login-page.html')).toThrow(/авторизац/));
});
