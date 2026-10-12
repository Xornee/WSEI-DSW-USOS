import { ArrowUpRight, BookOpen, Search } from 'lucide-react'
import { useState } from 'react'
import type { Grades } from '../../../shared/types'
import { Card, CardHeader } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { SectionData } from '../components/SourceData'
import { ScreenSkeleton } from '../components/Skeleton'
import { StateBanner } from '../components/StateBanner'
import type { AccountSection } from '../../../shared/sections'
import { useEndpoint } from '../lib/api'
import { gradeStyle } from '../lib/format'

export function CoursesScreen() {
  const [view, setView] = useState<'current' | 'archive'>('current')
  return (
    <div className="screen">
      <header className="page-header">
        <div>
          <p className="eyebrow">TWOJE PRZEDMIOTY</p>
          <h1>Moje zajęcia</h1>
          <p className="page-description">
            Bieżące grupy zajęciowe i historia przedmiotów z ocenami.
          </p>
        </div>
        <a
          className="button button-secondary"
          href="https://usosweb.ideis.pl/kontroler.php?_action=katalog2/przedmioty/index"
          target="_blank"
          rel="noopener noreferrer"
        >
          Katalog przedmiotów
          <ArrowUpRight size={14} />
        </a>
      </header>
      <div className="module-tabs" aria-label="Widok przedmiotów">
        <button
          aria-pressed={view === 'current'}
          onClick={() => setView('current')}
        >
          Bieżące zajęcia
        </button>
        <button
          aria-pressed={view === 'archive'}
          onClick={() => setView('archive')}
        >
          Archiwum ocen
        </button>
      </div>
      {view === 'current' ? <CurrentCourses /> : <CourseArchive />}
    </div>
  )
}
function CurrentCourses() {
  const { data, meta, error, loading, reload } = useEndpoint<AccountSection>(
    '/api/sections/courses',
  )
  return (
    <>
      <StateBanner meta={meta} error={error} onReload={reload} />
      {loading && <ScreenSkeleton />}
      {data && (
        <>
          <SectionData data={data} />
          <div className="registration-actions">
            <button
              className="button button-secondary"
              onClick={reload}
              disabled={loading}
            >
              Odśwież zajęcia
            </button>
            <a
              className="button button-secondary"
              href={data.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Zajęcia i archiwum w USOS
              <ArrowUpRight size={14} />
            </a>
          </div>
        </>
      )}
    </>
  )
}
function CourseArchive() {
  const { data, meta, error, loading, reload } =
    useEndpoint<Grades>('/api/grades')
  const [query, setQuery] = useState('')
  const cycles =
    data?.cycles
      .map((cycle) => ({
        ...cycle,
        subjects: cycle.subjects.filter((subject) =>
          `${subject.name} ${subject.code ?? ''}`
            .toLocaleLowerCase('pl-PL')
            .includes(query.toLocaleLowerCase('pl-PL')),
        ),
      }))
      .filter((cycle) => cycle.subjects.length) ?? []
  return (
    <>
      <StateBanner meta={meta} error={error} onReload={reload} />
      {loading && <ScreenSkeleton />}
      {data && (
        <>
          <div className="grades-toolbar">
            <label className="search-field">
              <Search size={17} />
              <span className="sr-only">Szukaj w archiwum przedmiotów</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Przedmiot lub kod…"
              />
            </label>
            <button className="button button-secondary" onClick={reload}>
              Odśwież archiwum
            </button>
          </div>
          <p className="section-note">
            To archiwum przedmiotów obecnych w historii ocen, nie pełna historia
            zapisów. Nie dodajemy nieznanych prowadzących, grup ani ECTS.
          </p>
          {cycles.map((cycle) => (
            <Card key={cycle.name}>
              <CardHeader title={cycle.name} />
              <div className="course-list">
                {cycle.subjects.map((subject, index) => (
                  <div className="course-row" key={index}>
                    <span className="quick-link-icon">
                      <BookOpen size={18} />
                    </span>
                    <div>
                      <h3>{subject.name}</h3>
                      <p>
                        {subject.code ?? 'Kod nie został podany'}
                        {subject.programme ? ` · ${subject.programme}` : ''}
                      </p>
                      <div className="course-grades">
                        {subject.grades.map((grade, i) => (
                          <span
                            key={i}
                            className={`chip ${gradeStyle(grade.numeric)}`}
                          >
                            {grade.component}: {grade.value}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
          {!cycles.length && (
            <Card>
              <EmptyState
                title="Brak pasujących przedmiotów"
                description="Zmień wyszukiwanie lub sprawdź, czy w źródle są archiwalne oceny."
              />
            </Card>
          )}
        </>
      )}
    </>
  )
}
