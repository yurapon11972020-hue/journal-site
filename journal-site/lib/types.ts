export type JournalSource = 'local' | 'yandex-private' | 'yandex-public' | 'yandex-public-cache';

export interface LessonColumn {
  id: string;
  column: string;
  monthLabel: string | null;
  dayLabel: string | null;
  label: string;
  date: string | null;
  dateKey: string | null;
  datePrecision: 'day' | 'month-day' | 'unknown';
}

export interface GradeEntry extends LessonColumn {
  value: string;
  numericValues: number[];
  attendance: 'valid' | 'invalid' | 'electronic' | null;
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
  date?: string | null;
  dateKey?: string | null;
}

export interface SubjectSummary {
  sheetName: string;
  subjectName: string;
  teacherName: string | null;
  average: number | null;
  absences: AbsenceSummary;
  grades: GradeEntry[];
  lessonTopics: LessonTopic[];
  lessons: LessonColumn[];
  gradeCount: number;
}

export interface StudentRecord {
  id: number;
  key: string;
  name: string;
  overallAverage: number | null;
  totalAbsences: AbsenceSummary;
  subjects: SubjectSummary[];
}

export interface SubjectMeta {
  sheetName: string;
  subjectName: string;
  teacherName: string | null;
  lessons: LessonColumn[];
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
  origin?: 'source' | 'calculated';
}

export interface ReportCard {
  studentId: number;
  studentName: string;
  overallAverage: number | null;
  totalAbsences: AbsenceSummary;
  totalAbsenceCount: number;
  rows: ReportCardRow[];
  origin?: 'source' | 'calculated';
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
  sync?: { stale: boolean; checkedAt: string; errorCode?: string; error?: string; nextRefreshAt?: string };
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
  fetchedAt?: string;
  sync?: JournalData['sync'];
}

export type JournalGroupView = Pick<JournalGroupRef, 'id' | 'groupName' | 'fileName' | 'source'>;
