import type { JournalData } from '@/lib/types';
export interface JournalChange { kind: 'added' | 'changed' | 'removed'; student: string; subject: string; dateLabel: string; before?: string; after?: string; }
export function compareJournals(before: JournalData, after: JournalData): JournalChange[] {
  function entries(data: JournalData) {
    return new Map(data.students.flatMap((student) => student.subjects.flatMap((subject) => subject.grades.map((grade) => [student.key + '::' + grade.id, { value: grade.value, student: student.name, subject: subject.subjectName, dateLabel: grade.label }] as const))));
  }
  const old = entries(before), next = entries(after);
  const changes: JournalChange[] = [];
  for (const [key, mark] of next) {
    const previous = old.get(key);
    if (!previous) changes.push({ ...mark, kind: 'added', after: mark.value });
    else if (previous.value !== mark.value) changes.push({ ...mark, kind: 'changed', before: previous.value, after: mark.value });
  }
  for (const [key, mark] of old) if (!next.has(key)) changes.push({ ...mark, kind: 'removed', before: mark.value });
  return changes;
}
