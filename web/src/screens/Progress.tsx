import { ArrowUpRight, CheckCheck, GraduationCap, Hash } from 'lucide-react'
import type { Stages } from '../../../shared/types'
import { Card, CardHeader } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { Metric } from '../components/Metric'
import { PageHeader } from '../components/PageHeader'
import { ScreenSkeleton } from '../components/Skeleton'
import { StateBanner } from '../components/StateBanner'
import { useEndpoint } from '../lib/api'
import { isStagePassed } from '../lib/student-state'
import { StageRow } from './Student'

export function ProgressScreen() {
  const { data, meta, error, loading, reload } =
    useEndpoint<Stages>('/api/stages')
  const stages = data?.programmes.flatMap((programme) => programme.stages) ?? []
  const passed = stages.filter((stage) =>
    stage.fields.some(
      (field) => field.kind === 'status' && isStagePassed(field.value),
    ),
  ).length
  const ects = stages.flatMap((stage) =>
    stage.fields.filter((field) => /ECTS/i.test(field.label)),
  )
  return (
    <div className="screen">
      <PageHeader
        title="Przebieg studiów"
        eyebrow="TWOJA DROGA DO DYPLOMU"
        description="Etapy, zaliczenia i warunki podane przez uczelnię. Bez wyliczania nieudostępnionych danych."
        loading={loading}
        onReload={reload}
        extra={
          <a
            className="button button-secondary"
            href="https://usosweb.ideis.pl/kontroler.php?_action=dla_stud/studia/zaliczenia/index"
            target="_blank"
            rel="noopener noreferrer"
          >
            Etapy w USOSweb
            <ArrowUpRight size={14} />
          </a>
        }
      />
      <StateBanner meta={meta} error={error} onReload={reload} />
      {loading && !data && <ScreenSkeleton />}
      {data && (
        <>
          <div className="stats-grid">
            <Metric
              icon={<GraduationCap size={18} />}
              label="Etapy w źródle"
              value={String(stages.length)}
              detail="W pobranej historii przebiegu studiów"
            />
            <Metric
              icon={<CheckCheck size={18} />}
              label="Jawnie zaliczone"
              value={String(passed)}
              detail="Według statusów podanych przez uczelnię"
            />
            <Metric
              icon={<Hash size={18} />}
              label="Punkty ECTS"
              value={ects.length ? 'Zobacz etapy' : '—'}
              detail={
                ects.length
                  ? 'Pola ECTS są pokazane przy etapach'
                  : 'Źródło nie udostępnia punktów ECTS'
              }
            />
          </div>
          {data.programmes.map((programme, index) => (
            <Card key={index}>
              <CardHeader title={programme.name} hint={programme.code} />
              <ol className="stage-list">
                {programme.stages.map((stage, i) => (
                  <StageRow key={i} stage={stage} />
                ))}
              </ol>
            </Card>
          ))}
          {!stages.length && (
            <Card>
              <EmptyState
                title="Brak etapów w źródle"
                description="USOSweb nie zwrócił informacji o przebiegu studiów."
              />
            </Card>
          )}
          <p className="section-note">
            Brak punktów ECTS lub wymagań w źródle oznacza brak danych, nie zero
            punktów ani brak wymagań.
          </p>
        </>
      )}
    </div>
  )
}
