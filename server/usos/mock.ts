import type { ClassEntry, GradeCycle, Grades, Home, Plan, Stages, Student } from '../../shared/types.js'

/** Poniedzialek biezacego tygodnia, lokalnie. */
function mondayOf(d: Date): Date {
  const out = new Date(d)
  const shift = (out.getDay() + 6) % 7
  out.setDate(out.getDate() - shift)
  out.setHours(0, 0, 0, 0)
  return out
}

const at = (base: Date, dayOffset: number, h: number, m: number): string => {
  const d = new Date(base)
  d.setDate(d.getDate() + dayOffset)
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

interface Slot {
  day: number; from: [number, number]; to: [number, number]
  name: string; code: string; kindLabel: string
  room: string; building: string; lecturer: string; group: string
}

const SLOTS: readonly Slot[] = [
  { day: 0, from: [8, 0], to: [9, 30], name: 'Analiza matematyczna', code: 'MAT-101', kindLabel: 'Wykład', room: '204', building: 'Budynek A', lecturer: 'dr hab. Anna Kowalczyk', group: 'W1' },
  { day: 0, from: [9, 45], to: [11, 15], name: 'Programowanie obiektowe', code: 'INF-210', kindLabel: 'Laboratorium', room: 'Lab 3', building: 'Budynek C', lecturer: 'mgr inż. Piotr Nowak', group: 'L4' },
  { day: 1, from: [11, 30], to: [13, 0], name: 'Bazy danych', code: 'INF-230', kindLabel: 'Wykład', room: 'Aula II', building: 'Budynek A', lecturer: 'dr Marek Zieliński', group: 'W1' },
  { day: 2, from: [8, 0], to: [9, 30], name: 'Język angielski B2', code: 'JZ-B2', kindLabel: 'Lektorat', room: '118', building: 'Budynek B', lecturer: 'mgr Ewa Lis', group: 'A3' },
  { day: 2, from: [13, 15], to: [14, 45], name: 'Statystyka', code: 'MAT-220', kindLabel: 'Ćwiczenia', room: '305', building: 'Budynek A', lecturer: 'dr Tomasz Wróbel', group: 'C2' },
  { day: 3, from: [10, 0], to: [11, 30], name: 'Sieci komputerowe', code: 'INF-240', kindLabel: 'Laboratorium', room: 'Lab 1', building: 'Budynek C', lecturer: 'mgr inż. Jakub Adamski', group: 'L2' },
  { day: 4, from: [9, 0], to: [12, 0], name: 'Seminarium dyplomowe', code: 'SEM-400', kindLabel: 'Seminarium', room: '412', building: 'Budynek D', lecturer: 'prof. dr hab. Maria Dąbrowska', group: 'S1' },
]

const KIND_BY_LABEL: Record<string, ClassEntry['kind']> = {
  'Wykład': 'wyklad', 'Ćwiczenia': 'cwiczenia', 'Laboratorium': 'laboratorium',
  'Seminarium': 'seminarium', 'Lektorat': 'lektorat',
}

export function mockPlan(now = new Date()): Plan {
  const monday = mondayOf(now)
  const entries: ClassEntry[] = SLOTS.map((s, i) => ({
    id: `mock-${i}`,
    courseName: s.name,
    courseCode: s.code,
    kind: KIND_BY_LABEL[s.kindLabel] ?? 'inne',
    kindLabel: s.kindLabel,
    start: at(monday, s.day, s.from[0], s.from[1]),
    end: at(monday, s.day, s.to[0], s.to[1]),
    room: s.room,
    building: s.building,
    lecturer: s.lecturer,
    group: s.group,
  }))
  return { from: at(monday, 0, 0, 0), to: at(monday, 6, 23, 59), entries }
}

export function mockStudent(): Student {
  return {
    id: '1001',
    displayName: 'Jan Przykładowy',
    albumNumber: '100001',
    libraryCard: null,
    roles: ['student'],
    faculty: 'Wydział Studiów Stosowanych w Krakowie',
    accessExpires: '2027-03-30',
    email: null,
    photoUrl: null,
    programmes: [
      { name: 'Informatyka, studia I stopnia, stacjonarne', stage: 'Semestr 5', status: 'Aktywny' },
    ],
  }
}

export function mockHome(now = new Date()): Home {
  const plan = mockPlan(now)
  const upcoming = plan.entries.filter((e) => new Date(e.start) > now)
  const today = now.toDateString()
  return {
    greeting: 'Jan',
    nextClass: upcoming[0] ?? null,
    todayCount: plan.entries.filter((e) => new Date(e.start).toDateString() === today).length,
    announcements: [
      { id: 'a1', title: 'Rejestracja na przedmioty obieralne', date: null, body: 'Tura podstawowa rusza w przyszłym tygodniu.' },
      { id: 'a2', title: 'Przerwa techniczna USOSweb', date: null, body: 'Serwis może być niedostępny w nocy.' },
      { id: 'a3', title: 'Stypendia — termin składania wniosków', date: null, body: 'Wnioski przyjmowane są w dziekanacie.' },
    ],
  }
}

const numericValues = (subjects: GradeCycle['subjects']): number[] =>
  subjects.flatMap((s) => s.grades.map((g) => g.numeric).filter((n): n is number => n !== null))

const MOCK_CYCLES: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, string, string]>]> = [
  ['Semestr zimowy 2025/26', [
    ['Bazy danych', 'Egzamin', '4,5'],
    ['Programowanie obiektowe', 'Laboratorium', '5'],
    ['Analiza matematyczna', 'Egzamin', '4'],
  ]],
  ['Semestr letni 2024/25', [
    ['Sieci komputerowe', 'Laboratorium', '5'],
    ['Statystyka', 'Ćwiczenia', '3,5'],
  ]],
]

export function mockGrades(): Grades {
  const cycles: GradeCycle[] = MOCK_CYCLES.map(([name, rows]) => {
    const subjects = rows.map(([subject, component, value]) => ({
      name: subject,
      code: null,
      programme: null,
      grades: [{ component, value, numeric: Number(value.replace(',', '.')) as number | null }],
    }))
    const nums = numericValues(subjects)
    return { name, subjects, average: Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 }
  })
  const all = cycles.flatMap((c) => numericValues(c.subjects))
  return {
    cycles,
    average: Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 100) / 100,
    gradeCount: all.length,
  }
}

export function mockStages(): Stages {
  return {
    programmes: [{
      name: 'Informatyka Stosowana - studia I stopnia - niestacjonarne',
      code: 'k-ins-In',
      stages: [{
        name: '6 semestr, 3 rok; Programowanie i analiza danych',
        code: 'INS-PIAD-In-E6',
        fields: [
          { label: 'Cykl dydaktyczny', value: '2025/26L', kind: 'text' },
          { label: 'Data zaliczenia', value: '2026-09-30', kind: 'date' },
          { label: 'Status zaliczenia', value: 'w trakcie', kind: 'status' },
        ],
      }],
    }],
  }
}
