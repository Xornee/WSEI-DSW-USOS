import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LayoutGrid,
  List,
  MapPin,
  UserRound,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ClassEntry, Plan } from '../../../shared/types'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { ScreenSkeleton } from '../components/Skeleton'
import { StateBanner } from '../components/StateBanner'
import { useEndpoint } from '../lib/api'
import { timetablePlanPath, useTimetableTrack } from '../lib/timetable'
import {
  addDays,
  dateKey,
  dayMinutes,
  entriesOnDay,
  layoutEntries,
  startOfWeek,
  validEntries,
} from '../lib/calendar'
import { dayShort, fmtDate, hhmm, kindStyle } from '../lib/format'

const HOUR_PX = 76

export function PlanScreen() {
  const [track, selectTrack] = useTimetableTrack()
  const { data, meta, error, loading, reload } = useEndpoint<Plan>(timetablePlanPath(track))
  return (
    <div className="screen">
      <PageHeader
        eyebrow="DOBRZE ZAPLANOWANE"
        title="Plan zajęć"
        description="Cały tydzień z lotu ptaka. Kliknij zajęcia, żeby poznać szczegóły."
        loading={loading}
        onReload={reload}
      />
      <p className="timetable-automatic">Tok dobieramy automatycznie z Twoich danych USOS — bez wpisywania numeru ani linku.</p>
      <StateBanner meta={meta} error={error} onReload={reload} sourceLabel={data?.timetable ? "harmonogramu IDEIS Kraków" : "USOS — dopasowanie toku"} />
      {loading && !data && <ScreenSkeleton />}
      {data?.selection && (
        <Card className="timetable-selection" >
          <strong>{data.selection.state === 'automatic' ? 'Tok rozpoznany automatycznie' : data.selection.state === 'confirmed' ? 'Wybrany tok tego konta' : data.selection.state === 'public' ? 'Podgląd publicznego planu' : 'Dopasowanie toku'}</strong>
          <p role={data.selection.state === 'choice_required' || data.selection.state === 'unresolved' ? 'status' : undefined}>{data.selection.message}</p>
          {data.selection.state === 'public' && <a href="/">Połącz USOS i rozpoznaj mój tok →</a>}
          {data.selection.state === 'choice_required' && <div className="timetable-candidates">
            {data.selection.candidates.map(candidate => <button key={candidate.trackId} className="button button-secondary" disabled={loading} onClick={() => selectTrack(candidate.trackId)}>{candidate.title}</button>)}
          </div>}
          {track !== null && <button className="button button-secondary" onClick={() => selectTrack(null)}>Wróć do automatycznego dopasowania</button>}
        </Card>
      )}
      {data?.timetable && (
        <Card className="timetable-source">
          <strong>{data.timetable.title}</strong>
          <p>Plan toku {data.timetable.trackId} · cały semestr · {data.entries.length} zajęć · {data.timetable.timezone}</p>
          <a href={data.timetable.url} target="_blank" rel="noreferrer">Otwórz oryginalny harmonogram ↗</a>
          <p>Plan obejmuje grupy tego toku. Sprawdź oznaczenie swojej grupy w szczegółach zajęć.</p>
        </Card>
      )}
      {data && (!data.selection || data.timetable) && <Schedule key={`${data.timetable?.trackId}-${data.from}-${data.to}`} plan={data} />}
    </div>
  )
}

function Schedule({ plan }: { plan: Plan }) {
  const [group, setGroup] = useState('')
  const allEntries = validEntries(plan.entries)
  const groups = [...new Set(allEntries.map(entry => entry.group).filter((value): value is string => !!value))].sort()
  const entries = group ? allEntries.filter(entry => entry.group === group) : allEntries
  const todayWeek = startOfWeek(new Date())
  const firstWeek = entries.length
    ? startOfWeek(new Date(entries[0]!.start))
    : todayWeek
  const lastWeek = entries.length
    ? startOfWeek(
        new Date(Math.max(...entries.map((entry) => +new Date(entry.end) - 1))),
      )
    : todayWeek
  const [week, setWeek] = useState(
    () => new Date(Math.max(+firstWeek, Math.min(+todayWeek, +lastWeek))),
  )
  useEffect(() => {
    setWeek(new Date(Math.max(+firstWeek, Math.min(+todayWeek, +lastWeek))))
    setSelected(null)
  }, [group, +firstWeek, +lastWeek])
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [selected, setSelected] = useState<ClassEntry | null>(null)
  const days = Array.from({ length: 7 }, (_, index) => addDays(week, index))
  const weekEntries = entries.filter(
    (entry) =>
      +new Date(entry.start) < +addDays(week, 7) &&
      +new Date(entry.end) > +week,
  )
  const todayAvailable = +todayWeek >= +firstWeek && +todayWeek <= +lastWeek

  return (
    <>
      <div className="schedule-toolbar">
        <div className="week-controls">
          <div className="button-group">
            <button
              className="icon-button"
              aria-label="Poprzedni tydzień"
              disabled={+week <= +firstWeek}
              onClick={() => setWeek(addDays(week, -7))}
            >
              <ChevronLeft size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="Następny tydzień"
              disabled={+week >= +lastWeek}
              onClick={() => setWeek(addDays(week, 7))}
            >
              <ChevronRight size={17} />
            </button>
          </div>
          <h2>
            {dayShort(week.toISOString())} —{' '}
            {dayShort(addDays(week, 6).toISOString())}{' '}
            <span>{week.getFullYear()}</span>
          </h2>
          <button
            className="button button-secondary"
            disabled={!todayAvailable || +week === +todayWeek}
            onClick={() => setWeek(todayWeek)}
          >
            Dzisiaj
          </button>
        </div>
        <div className="segmented-control" aria-label="Widok planu">
          <button
            aria-pressed={view === 'grid'}
            onClick={() => setView('grid')}
          >
            <LayoutGrid size={15} />
            Tydzień
          </button>
          <button
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
          >
            <List size={16} />
            Lista
          </button>
        </div>
      </div>
      <div className="timetable-group">
        <label htmlFor="timetable-group">Grupa </label>
        <select id="timetable-group" value={group} onChange={event => setGroup(event.target.value)}>
          <option value="">Wszystkie grupy</option>
          {groups.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>
      <div className="schedule-meta">
        <span>{weekEntries.length} zajęć w tym tygodniu</span>
        <span>
          Pobrany zakres: {fmtDate(plan.from)} – {fmtDate(plan.to)}
        </span>
      </div>
      {entries.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarDays size={24} />}
            title="Twój plan jest pusty"
            description="W pobranym źródle nie ma zajęć. Odśwież, aby ponownie sprawdzić dane."
          />
        </Card>
      ) : view === 'grid' ? (
        <WeekGrid days={days} entries={weekEntries} onSelect={setSelected} />
      ) : (
        <Agenda days={days} entries={weekEntries} onSelect={setSelected} />
      )}
      <div className="schedule-legend">
        {(
          [
            'wyklad',
            'cwiczenia',
            'laboratorium',
            'seminarium',
            'lektorat',
            'inne',
          ] as const
        ).map((kind, index) => (
          <span key={kind}>
            <i className={kindStyle(kind).dot} />
            {
              [
                'Wykład',
                'Ćwiczenia',
                'Laboratorium',
                'Seminarium',
                'Lektorat',
                'Inne',
              ][index]
            }
          </span>
        ))}
      </div>
      {selected && (
        <ClassDialog entry={selected} onClose={() => setSelected(null)} />
      )}
    </>
  )
}

function WeekGrid({
  days,
  entries,
  onSelect,
}: {
  days: Date[]
  entries: ClassEntry[]
  onSelect: (entry: ClassEntry) => void
}) {
  const starts = days.flatMap((day) =>
    entriesOnDay(entries, day).map((entry) => dayMinutes(entry.start, day)),
  )
  const ends = days.flatMap((day) =>
    entriesOnDay(entries, day).map((entry) => dayMinutes(entry.end, day)),
  )
  const firstHour = Math.max(
    0,
    Math.min(8, Math.floor(Math.min(...starts) / 60)),
  )
  const lastHour = Math.min(24, Math.max(18, Math.ceil(Math.max(...ends) / 60)))
  const hours = Array.from(
    { length: lastHour - firstHour },
    (_, index) => firstHour + index,
  )
  return (
    <Card className="week-card">
      <div className="week-grid">
        <div className="week-corner">
          GMT{new Date().getTimezoneOffset() <= 0 ? '+' : ''}
          {-new Date().getTimezoneOffset() / 60}
        </div>
        {days.map((day) => (
          <div
            className={`day-heading ${dateKey(day) === dateKey(new Date()) ? 'is-today' : ''}`}
            key={dateKey(day)}
          >
            <span>{day.toLocaleDateString('pl-PL', { weekday: 'short' })}</span>
            <strong>{day.getDate()}</strong>
          </div>
        ))}
        <div className="hour-gutter" style={{ height: hours.length * HOUR_PX }}>
          {hours.map((hour) => (
            <span key={hour} style={{ top: (hour - firstHour) * HOUR_PX + 8 }}>
              {String(hour).padStart(2, '0')}:00
            </span>
          ))}
        </div>
        {days.map((day) => (
          <div
            key={dateKey(day)}
            className={`day-column ${dateKey(day) === dateKey(new Date()) ? 'is-today' : ''}`}
            style={{
              height: hours.length * HOUR_PX,
              backgroundSize: `100% ${HOUR_PX}px`,
            }}
          >
            {layoutEntries(entriesOnDay(entries, day)).map(
              ({ entry, column, columns }) => {
                const top =
                  (dayMinutes(entry.start, day) / 60 - firstHour) * HOUR_PX
                const height =
                  ((dayMinutes(entry.end, day) - dayMinutes(entry.start, day)) /
                    60) *
                  HOUR_PX
                return (
                  <button
                    key={entry.id}
                    className={`class-block ${kindStyle(entry.kind).chip}`}
                    style={{
                      top,
                      height: Math.max(12, height - 3),
                      left: `calc(${(column * 100) / columns}% + 4px)`,
                      width: `calc(${100 / columns}% - 8px)`,
                    }}
                    onClick={() => onSelect(entry)}
                    aria-label={`${entry.courseName}, ${hhmm(entry.start)}–${hhmm(entry.end)}, szczegóły`}
                  >
                    <span className="block-time">
                      {hhmm(entry.start)}–{hhmm(entry.end)}
                    </span>
                    <strong>{entry.courseName}</strong>
                    {height > 85 && (
                      <span className="block-room">
                        {entry.room ?? entry.kindLabel ?? 'Zajęcia'}
                      </span>
                    )}
                  </button>
                )
              },
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}

function Agenda({
  days,
  entries,
  onSelect,
}: {
  days: Date[]
  entries: ClassEntry[]
  onSelect: (entry: ClassEntry) => void
}) {
  if (!entries.length)
    return (
      <Card>
        <EmptyState
          title="Spokojny tydzień"
          description="W tym tygodniu nie ma zajęć w pobranym planie."
        />
      </Card>
    )
  return (
    <div className="agenda">
      {days.map((day) => {
        const items = entriesOnDay(entries, day)
        return (
          items.length > 0 && (
            <Card key={dateKey(day)}>
              <div className="agenda-heading">
                {day.toLocaleDateString('pl-PL', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
              </div>
              {items.map((entry) => (
                <button
                  className="agenda-row"
                  key={entry.id}
                  onClick={() => onSelect(entry)}
                >
                  <span className="agenda-time">
                    {hhmm(entry.start)}
                    <small>{hhmm(entry.end)}</small>
                  </span>
                  <span className="agenda-subject">
                    <strong>{entry.courseName}</strong>
                    <small>
                      {entry.lecturer ?? 'Prowadzący nie został podany'}
                    </small>
                  </span>
                  <span className={`chip ${kindStyle(entry.kind).chip}`}>
                    {entry.kindLabel ?? 'Zajęcia'}
                  </span>
                  <span className="agenda-room">
                    <MapPin size={15} />
                    {entry.room ?? 'Brak sali'}
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))}
            </Card>
          )
        )
      })}
    </div>
  )
}

function ClassDialog({
  entry,
  onClose,
}: {
  entry: ClassEntry
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    const opener = document.activeElement
    dialog?.showModal()
    return () => {
      dialog?.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])
  return (
    <dialog
      className="class-dialog"
      ref={ref}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      aria-labelledby="class-title"
    >
      <div className="dialog-content">
        <div className="dialog-top">
          <span className={`chip ${kindStyle(entry.kind).chip}`}>
            {entry.kindLabel ?? 'Zajęcia'}
          </span>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Zamknij szczegóły"
          >
            <X size={20} />
          </button>
        </div>
        <h2 id="class-title">{entry.courseName}</h2>
        {entry.courseCode && <p className="course-code">{entry.courseCode}</p>}
        <dl className="dialog-details">
          <div>
            <dt>
              <CalendarDays size={17} />
              Data
            </dt>
            <dd>
              {fmtDate(entry.start)}
              {dateKey(new Date(entry.start)) !==
                dateKey(new Date(entry.end)) && ` – ${fmtDate(entry.end)}`}
            </dd>
          </div>
          <div>
            <dt>
              <Clock3 size={17} />
              Godzina
            </dt>
            <dd>
              {hhmm(entry.start)}–{hhmm(entry.end)}
            </dd>
          </div>
          <div>
            <dt>
              <MapPin size={17} />
              Miejsce
            </dt>
            <dd>
              {[entry.room, entry.building].filter(Boolean).join(' · ') ||
                'Brak danych'}
            </dd>
          </div>
          <div>
            <dt>
              <UserRound size={17} />
              Prowadzący
            </dt>
            <dd>{entry.lecturer ?? 'Brak danych'}</dd>
          </div>
          {entry.group && (
            <div>
              <dt>Grupa</dt>
              <dd>{entry.group}</dd>
            </div>
          )}
          {entry.assessment && <div><dt>Zaliczenie</dt><dd>{entry.assessment}</dd></div>}
          {entry.notes && <div><dt>Uwagi</dt><dd>{entry.notes}</dd></div>}
          {entry.sourceId && <div><dt>ID zajęć w źródle</dt><dd>{entry.sourceId}</dd></div>}
        </dl>
        <button className="button button-primary" onClick={onClose}>
          Gotowe
        </button>
      </div>
    </dialog>
  )
}
