import { BookOpen, GraduationCap, Hash, Search, X } from 'lucide-react'
import { useState } from 'react'
import type { GradeCycle, Grades } from '../../../shared/types'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { ScreenSkeleton } from '../components/Skeleton'
import { StateBanner } from '../components/StateBanner'
import { useEndpoint } from '../lib/api'
import { fmtAverage, gradeStyle } from '../lib/format'
import { Metric } from '../components/Metric'

export function GradesScreen() {
  const { data, meta, error, loading, reload } =
    useEndpoint<Grades>('/api/grades')
  return (
    <div className="screen">
      <PageHeader
        eyebrow="EFEKTY TWOJEJ PRACY"
        title="Oceny i zaliczenia"
        description="Wyniki, przedmioty i semestry. Wszystko czarno na białym."
        loading={loading}
        onReload={reload}
      />
      <StateBanner meta={meta} error={error} onReload={reload} />
      {loading && !data && <ScreenSkeleton />}
      {data && <Gradebook grades={data} />}
    </div>
  )
}

function Gradebook({ grades }: { grades: Grades }) {
  const [query, setQuery] = useState('')
  const [cycleName, setCycleName] = useState('')
  const normalized = query.trim().toLocaleLowerCase('pl-PL')
  const cycles = grades.cycles
    .filter((cycle) => !cycleName || cycle.name === cycleName)
    .map((cycle) => ({
      ...cycle,
      subjects: cycle.subjects.filter((subject) =>
        `${subject.name} ${subject.code ?? ''} ${subject.programme ?? ''}`
          .toLocaleLowerCase('pl-PL')
          .includes(normalized),
      ),
    }))
    .filter((cycle) => cycle.subjects.length > 0)
  const count = cycles.reduce((sum, cycle) => sum + cycle.subjects.length, 0)
  return (
    <>
      <div className="stats-grid">
        <Metric
          icon={<GraduationCap size={18} />}
          label="Średnia ocen"
          value={fmtAverage(grades.average)}
          detail="Średnia ze wszystkich ocen liczbowych"
        />
        <Metric
          icon={<Hash size={18} />}
          label="Oceny liczbowe"
          value={String(grades.gradeCount).padStart(2, '0')}
          detail="Bez zaliczeń opisowych"
        />
        <Metric
          icon={<BookOpen size={18} />}
          label="Cykle dydaktyczne"
          value={String(grades.cycles.length).padStart(2, '0')}
          detail="W pobranej historii ocen"
        />
      </div>
      <div className="grades-toolbar">
        <label className="search-field">
          <Search size={17} />
          <span className="sr-only">Szukaj przedmiotu</span>
          <input
            placeholder="Szukaj przedmiotu lub kodu…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              className="search-clear"
              aria-label="Wyczyść wyszukiwanie"
              onClick={() => setQuery('')}
            >
              <X size={15} />
            </button>
          )}
        </label>
        <label className="cycle-filter">
          <span className="sr-only">Cykl dydaktyczny</span>
          <select
            value={cycleName}
            onChange={(event) => setCycleName(event.target.value)}
          >
            <option value="">Wszystkie cykle</option>
            {grades.cycles.map((cycle) => (
              <option key={cycle.name} value={cycle.name}>
                {cycle.name}
              </option>
            ))}
          </select>
        </label>
        <span className="muted" role="status">
          Przedmioty: {count}
        </span>
      </div>
      {cycles.map((cycle) => (
        <CycleTable key={cycle.name} cycle={cycle} />
      ))}
      {!count && (
        <Card>
          <EmptyState
            title={
              query || cycleName
                ? 'Brak pasujących przedmiotów'
                : 'Jeszcze bez ocen'
            }
            description={
              query || cycleName
                ? 'Zmień wyszukiwaną nazwę lub wybierz inny cykl dydaktyczny.'
                : 'Oceny pojawią się tutaj, kiedy będą dostępne w źródle.'
            }
          />
          {(query || cycleName) && (
            <div className="empty-actions">
              <button
                className="button button-secondary"
                onClick={() => {
                  setQuery('')
                  setCycleName('')
                }}
              >
                Wyczyść filtry
              </button>
            </div>
          )}
        </Card>
      )}
      <p className="section-note">
        Średnie dotyczą wszystkich ocen w danym cyklu, niezależnie od filtrów.
        Nie są oficjalną średnią ważoną ECTS.
      </p>
    </>
  )
}

function CycleTable({ cycle }: { cycle: GradeCycle }) {
  return (
    <Card className="grade-cycle">
      <div className="cycle-heading">
        <span className="cycle-icon">
          <BookOpen size={17} />
        </span>
        <h2>{cycle.name}</h2>
        <span className="muted">Średnia cyklu</span>
        <span className={`grade-value ${gradeStyle(cycle.average)}`}>
          {fmtAverage(cycle.average)}
        </span>
      </div>
      <table className="grades-table">
        <caption className="sr-only">Oceny — {cycle.name}</caption>
        <thead>
          <tr>
            <th scope="col">Przedmiot</th>
            <th scope="col">Forma zaliczenia</th>
            <th scope="col">Ocena</th>
          </tr>
        </thead>
        <tbody>
          {cycle.subjects.flatMap((subject, subjectIndex) => {
            const values = subject.grades.length
              ? subject.grades
              : [{ component: '—', value: '—', numeric: null }]
            return values.map((grade, index) => (
              <tr key={`${subjectIndex}-${index}`}>
                {index === 0 && (
                  <th scope="row" rowSpan={values.length}>
                    <strong>{subject.name}</strong>
                    {(subject.code || subject.programme) && (
                      <small>
                        {[subject.code, subject.programme]
                          .filter(Boolean)
                          .join(' · ')}
                      </small>
                    )}
                  </th>
                )}
                <td>{grade.component}</td>
                <td>
                  <span className={`grade-value ${gradeStyle(grade.numeric)}`}>
                    {grade.value}
                  </span>
                </td>
              </tr>
            ))
          })}
        </tbody>
      </table>
    </Card>
  )
}
