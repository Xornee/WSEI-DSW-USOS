// Kontrakt miedzy proxy a frontem. Celowo NIE odwzorowuje HTML-a USOSweb —
// to jest ksztalt, ktory chcemy w GUI. Dzieki temu zamiana scrapingu na
// USOS API nie dotknie frontu.

export type Source = "live" | "cache" | "mock";

export interface Meta {
  source: Source;
  fetchedAt: string;
  /** true = dane z cache po wygasnieciu TTL (uczelnia niedostepna / sesja padla) */
  stale: boolean;
}

export type ApiResponse<T> =
  | { ok: true; data: T; error: null; meta: Meta }
  | { ok: false; data: null; error: string; meta: Meta };

export interface SessionStatus {
  loggedIn: boolean;
  userId: string | null;
  /** 'mock' gdy brak ciasteczka w .env — GUI dziala na danych demo */
  mode: "live" | "mock";
}

export interface Programme {
  name: string;
  stage: string | null;
  status: string | null;
}

export interface Student {
  id: string;
  /** Imie i nazwisko — nie ma go na stronie glownej, tylko na profilowej. */
  displayName: string | null;
  albumNumber: string | null;
  libraryCard: string | null;
  roles: readonly string[];
  faculty: string | null;
  /** Data wygasniecia dostepu do USOSweb, tak jak podaje uczelnia. */
  accessExpires: string | null;
  email: string | null;
  photoUrl: string | null;
  programmes: readonly Programme[];
}

export type ClassKind =
  "wyklad" | "cwiczenia" | "laboratorium" | "seminarium" | "lektorat" | "inne";

export interface ClassEntry {
  id: string;
  courseName: string;
  courseCode: string | null;
  kind: ClassKind;
  kindLabel: string | null;
  /** ISO 8601 z offsetem */
  start: string;
  end: string;
  room: string | null;
  building: string | null;
  lecturer: string | null;
  group: string | null;
  assessment?: string | null;
  notes?: string | null;
  sourceId?: string | null;
}

export interface TimetableSelection {
  state: "automatic" | "confirmed" | "choice_required" | "unresolved" | "public";
  trackId: string | null;
  candidates: readonly { trackId: string; title: string }[];
  message: string;
}

export interface Plan {
  personal?: PersonalPlan;
  selection?: TimetableSelection;
  from: string;
  to: string;
  entries: readonly ClassEntry[];
  timetable?: { trackId: string; title: string; url: string; timezone: string; from: string; to: string };
}

export interface PersonalPlan {
  scope: string;
  state: 'selected' | 'choice_required' | 'unambiguous' | 'outdated';
  message: string;
  choices: Record<string, string[]>;
  options: { key: string; courseName: string; kindLabel: string; groups: string[] }[];
}

export interface Announcement {
  id: string;
  title: string;
  date: string | null;
  body: string | null;
}

export interface Home {
  personalPlan?: Pick<PersonalPlan, 'state' | 'message'>;
  timetableSelection?: TimetableSelection;
  announcementsState?: "connected" | "not_connected";
  greeting: string | null;
  announcements: readonly Announcement[];
  nextClass: ClassEntry | null;
  todayCount: number;
}

export interface GradeValue {
  /** Forma zaliczenia: "Egzamin", "Laboratorium", "Ćwiczenia"... */
  component: string;
  /** Ocena tak, jak podaje uczelnia — z przecinkiem dziesietnym. */
  value: string;
  /** Wartosc liczbowa, gdy ocena jest liczba. Zaliczenia opisowe daja null. */
  numeric: number | null;
}

export interface GradedSubject {
  name: string;
  code: string | null;
  programme: string | null;
  grades: readonly GradeValue[];
}

export interface GradeCycle {
  /** Nazwa cyklu dydaktycznego, np. "Semestr zimowy 2025/26". */
  name: string;
  subjects: readonly GradedSubject[];
  /** Srednia z ocen liczbowych w cyklu; null gdy nie ma z czego liczyc. */
  average: number | null;
}

export interface Grades {
  cycles: readonly GradeCycle[];
  average: number | null;
  gradeCount: number;
}

/** Pole w opisie etapu. USOSweb miesza tekst, daty i statusy — rozrozniamy je. */
export interface StageField {
  label: string;
  /** Dla kind === 'date' jest to ISO (YYYY-MM-DD) prosto z atrybutu datetime. */
  value: string;
  kind: "text" | "date" | "status";
}

export interface StudyStage {
  name: string;
  code: string | null;
  fields: readonly StageField[];
}

export interface StudyProgramme {
  name: string;
  code: string | null;
  stages: readonly StudyStage[];
}

export interface Stages {
  programmes: readonly StudyProgramme[];
}

/** Plain data only: upstream HTML is never rendered directly. */
export interface UniversityLink {
  label: string;
  url: string;
}
export interface NewsArticle {
  id: string;
  title: string;
  paragraphs: readonly string[];
  links: readonly UniversityLink[];
}
export interface UniversityNews {
  articles: readonly NewsArticle[];
  sourceUrl: string;
}
export interface AcademicTerm {
  id: string;
  name: string;
  startDate: string;
  classesEndDate: string;
  finishDate: string;
}
export interface AcademicCalendar {
  terms: readonly AcademicTerm[];
  sourceUrl: string;
}
