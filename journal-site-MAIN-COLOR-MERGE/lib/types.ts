export type JournalSource = 'local' | 'yandex-private' | 'yandex-public' | 'yandex-public-cache';

export interface GradeEntry {
  column: string;
  monthLabel: string | null;
  dayLabel: string | null;
  label: string;
  value: string;
}

export interface AbsenceSummary {
  valid: number;
  invalid: number;
}

export interface LessonTopic {
  row: number;
  dateLabel: string;
  topic: string;
  extra: string | null;
}

export interface SubjectSummary {
  sheetName: string;
  subjectName: string;
  teacherName: string | null;
  average: number | null;
  absences: AbsenceSummary;
  grades: GradeEntry[];
  lessonTopics: LessonTopic[];
}

export interface StudentRecord {
  id: number;
  name: string;
  overallAverage: number | null;
  totalAbsences: AbsenceSummary;
  subjects: SubjectSummary[];
}

export interface SubjectMeta {
  sheetName: string;
  subjectName: string;
  teacherName: string | null;
}

export interface ReportCardRow {
  index: number;
  subjectName: string;
  session: string | null;
  average: number | null;
  averageLabel?: string | null;
  absences: AbsenceSummary;
  validAbsenceLabel?: string | null;
  invalidAbsenceLabel?: string | null;
}

export interface ReportCard {
  studentId: number;
  studentName: string;
  overallAverage: number | null;
  totalAbsences: AbsenceSummary;
  totalAbsenceCount: number;
  rows: ReportCardRow[];
}

export interface JournalData {
  groupName: string | null;
  source: JournalSource;
  sourceDetails: string;
  updatedAt: string;
  studentCount: number;
  subjectCount: number;
  subjects: SubjectMeta[];
  students: StudentRecord[];
  reportCards: ReportCard[];
}

export interface JournalGroupRef {
  id: string;
  groupName: string;
  fileName: string;
  filePath: string;
  source: JournalSource;
  sourceDetails: string;
}

export interface JournalFileResult {
  buffer: Buffer;
  source: JournalSource;
  sourceDetails: string;
  fileName?: string;
  groupNameHint?: string;
}
