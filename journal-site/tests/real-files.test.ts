import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';

import { parseJournalWorkbook } from '@/lib/parseJournal';

/**
 * Проверка на настоящих журналах.
 *
 * Файлы лежат в .test-data и в репозиторий не попадают — там живые
 * фамилии студентов. Если папки нет, проверка пропускается.
 */
const dir = '.test-data';
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith('.xlsx')) : [];

/** Оценка — это цифра, «н» или «н/у». Всё длиннее — подпись из объединения. */
function looksLikeMark(value: string): boolean {
  return /^(\d([.,]\d)?|н|н\/у|осв|зач|незач)$/i.test(value.trim());
}

function parse(file: string) {
  const buffer = fs.readFileSync(path.join(dir, file));
  return parseJournalWorkbook(buffer, {
    buffer,
    source: 'local',
    sourceDetails: path.join(dir, file),
    fileName: file,
  });
}

describe.skipIf(files.length === 0)('настоящие журналы', () => {
  it.each(files)('%s: предмет называется так же, как в журнале', (file) => {
    const workbook = XLSX.read(fs.readFileSync(path.join(dir, file)));
    const data = parse(file);

    expect(data.subjects.length).toBeGreaterThan(0);

    for (const subject of data.subjects) {
      const sheet = workbook.Sheets[subject.sheetName];
      const header = String(sheet?.C1?.w ?? sheet?.C1?.v ?? '').trim();

      // Либо подпись из шапки листа, либо имя самой вкладки, если шапка
      // не заполнена. Ничего третьего сайт придумывать не должен.
      expect([header, subject.sheetName]).toContain(subject.subjectName);
    }
  });

  it.each(files)('%s: ни одна подпись не растеклась по строке', (file) => {
    const buffer = fs.readFileSync(path.join(dir, file));
    const data = parseJournalWorkbook(buffer, {
      buffer,
      source: 'local',
      sourceDetails: path.join(dir, file),
      fileName: file,
    });

    expect(data.groupName).toBeTruthy();
    expect(data.studentCount).toBeGreaterThan(0);

    const smeared: string[] = [];

    for (const student of data.students) {
      for (const subject of student.subjects) {
        const counts = new Map<string, number>();
        for (const grade of subject.grades) {
          if (looksLikeMark(grade.value)) {
            continue;
          }
          counts.set(grade.value, (counts.get(grade.value) ?? 0) + 1);
        }

        for (const [value, count] of counts) {
          if (count >= 3) {
            smeared.push(`${student.name} / ${subject.subjectName}: «${value}» ×${count}`);
          }
        }
      }
    }

    expect(smeared).toEqual([]);
  });
});
