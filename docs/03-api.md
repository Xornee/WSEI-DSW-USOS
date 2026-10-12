# API proxy

Baza: `http://127.0.0.1:8080` (przez Vite: `/api/...` na `localhost:5173`).

## Koperta odpowiedzi

Każdy endpoint poza `/api/session` zwraca ten sam kształt, więc front ma jedną
ścieżkę obsługi błędu (`web/src/lib/api.ts`).

```ts
type ApiResponse<T> =
  | { ok: true;  data: T;    error: null;   meta: Meta }
  | { ok: false; data: null; error: string; meta: Meta }

interface Meta {
  source: 'live' | 'cache' | 'mock'
  fetchedAt: string   // ISO 8601
  stale: boolean      // dane z cache po wygaśnięciu TTL
}
```

Kody: `200` sukces, `401` sesja wygasła (`SessionExpiredError`), `502` pozostałe
błędy pobierania.

Kombinacja `source`/`stale` decyduje o pasku w GUI:

| source | stale | Co widzi użytkownik |
|---|---|---|
| `live` | `false` | nic — dane świeże |
| `cache` | `false` | nic — w granicach TTL |
| `cache` | `true` | żółty pasek „dane z cache sprzed X min" |
| `mock` | `false` | niebieski pasek „tryb demo" |

## Endpointy

### `GET /api/session`

Jedyny bez koperty — służy do ustalenia trybu pracy.

```ts
interface SessionStatus {
  loggedIn: boolean
  userId: string | null
  mode: 'live' | 'mock'
}
```

### `GET /api/plan`

```ts
interface Plan {
  from: string              // ISO
  to: string
  entries: ClassEntry[]
}

interface ClassEntry {
  id: string
  courseName: string
  courseCode: string | null
  kind: 'wyklad' | 'cwiczenia' | 'laboratorium' | 'seminarium' | 'lektorat' | 'inne'
  kindLabel: string | null  // etykieta tak, jak podaje uczelnia
  start: string             // ISO
  end: string
  room: string | null
  building: string | null
  lecturer: string | null
  group: string | null
}
```

Pusty feed daje `entries: []` — to poprawny wynik, nie błąd.

### `GET /api/grades`

```ts
interface Grades {
  cycles: GradeCycle[]
  average: number | null    // średnia ze wszystkich ocen liczbowych
  gradeCount: number
}

interface GradeCycle {
  name: string              // "Semestr zimowy 2025/26"
  subjects: GradedSubject[]
  average: number | null
}

interface GradedSubject {
  name: string
  code: string | null
  programme: string | null  // null dla przedmiotów niepodpiętych
  grades: GradeValue[]
}

interface GradeValue {
  component: string         // "Egzamin", "Laboratorium", "Ćwiczenia"
  value: string             // tak jak podaje uczelnia, z przecinkiem
  numeric: number | null    // null dla ocen opisowych ("zal")
}
```

Średnie liczone są **wyłącznie z ocen liczbowych**. Zaliczenia opisowe są
widoczne, ale nie wpływają na wynik — inaczej zaniżałyby średnią.

### `GET /api/stages`

```ts
interface Stages { programmes: StudyProgramme[] }

interface StudyProgramme {
  name: string
  code: string | null
  stages: StudyStage[]
}

interface StudyStage {
  name: string
  code: string | null
  fields: StageField[]
}

interface StageField {
  label: string                        // etykieta prosto z USOSweb
  value: string                        // dla 'date' — ISO z atrybutu datetime
  kind: 'text' | 'date' | 'status'
}
```

Pola są czytane generycznie, bez listy oczekiwanych etykiet — uczelnia może
dodać własne i pojawią się same.

### `GET /api/student`

```ts
interface Student {
  id: string
  displayName: string | null   // ze strony profilowej
  albumNumber: string | null
  libraryCard: string | null
  roles: string[]
  faculty: string | null
  accessExpires: string | null
  email: string | null         // null gdy ukryty ustawieniem prywatności
  photoUrl: string | null
  programmes: Programme[]
}
```

Pobranie strony profilowej jest **opcjonalnym wzbogaceniem**: gdy padnie,
endpoint zwraca profil podstawowy zamiast błędu.

### `GET /api/home`

```ts
interface Home {
  greeting: string | null    // imię, gdy znane
  announcements: Announcement[]
  nextClass: ClassEntry | null
  todayCount: number
}
```

Składane z `/api/plan` i `/api/student` — nie ma własnego źródła.
`announcements` jest na razie zawsze puste (`news/default` niepodpięty).
