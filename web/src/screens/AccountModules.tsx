import { ArrowUpRight, CalendarClock, CreditCard, Wallet } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { AccountSection, AccountSectionId } from '../../../shared/sections'
import { sectionUrl } from '../../../shared/sections'
import { Metric } from '../components/Metric'
import { PageHeader } from '../components/PageHeader'
import { SectionData } from '../components/SourceData'
import { ScreenSkeleton } from '../components/Skeleton'
import { StateBanner } from '../components/StateBanner'
import { useEndpoint } from '../lib/api'
import { WorkflowLink } from '../lib/workflows'
import { fmtDate } from '../lib/format'

export type ModuleTab = { id: AccountSectionId; label: string }
const PAYMENT_TABS: ModuleTab[] = [
  { id: 'dues', label: 'Do rozliczenia' },
  { id: 'paid', label: 'Rozliczone' },
  { id: 'remittances', label: 'Historia wpłat' },
  { id: 'accounts', label: 'Konta do wpłat' },
  { id: 'installments', label: 'Plany ratalne' },
]
const DOCUMENT_TABS: ModuleTab[] = [
  { id: 'applications', label: 'Wnioski' },
  { id: 'decisions', label: 'Decyzje' },
  { id: 'diplomas', label: 'Dyplomy' },
]

export function PaymentsScreen() {
  return (
    <AccountModule
      title="Płatności"
      eyebrow="FINANSE POD KONTROLĄ"
      description="Należności, historia wpłat i dane do przelewów — bez zmieniania czegokolwiek na koncie."
      tabs={PAYMENT_TABS}
      copyable
      renderExtra={(data) =>
        data.id === 'dues' ? <PaymentSummary data={data} /> : null
      }
    />
  )
}
export function DocumentsScreen() {
  return (
    <AccountModule
      title="Wnioski i dokumenty"
      eyebrow="SPRAWY DO ZAŁATWIENIA"
      description="Wnioski, decyzje i dyplomy. Formularze, szczegóły i pobieranie dokumentów w tej aplikacji."
      tabs={DOCUMENT_TABS}
    />
  )
}
export function TestsScreen() {
  return (
    <AccountModule
      title="Sprawdziany i punkty"
      eyebrow="POSTĘPY W SEMESTRZE"
      description="Wyniki cząstkowe i rozliczenia prowadzących. Oceny końcowe znajdziesz w osobnej zakładce."
      tabs={[{ id: 'tests', label: 'Moje sprawdziany' }]}
    />
  )
}
export function RegistrationsScreen() {
  return (
    <AccountModule
      title="Rejestracje"
      eyebrow="NIE PRZEGAP ZAPISÓW"
      description="Rejestracje przypisane do Twojego konta. Dostępne zapisy i zmiany grup wykonasz tutaj po potwierdzeniu."
      tabs={[{ id: 'registrations', label: 'Moje rejestracje' }]}
      renderExtra={() => (
        <div className="registration-actions">
          <WorkflowLink entry="registration-calendar" link={{label: "Pełny kalendarz rejestracji", url: ""}} className="button button-secondary">
            Pełny kalendarz rejestracji
            <ArrowUpRight size={14} />
          </WorkflowLink>
          <WorkflowLink entry="registration-subjects" link={{label: "Przedmioty i zapisy", url: ""}} className="button button-secondary">
            Przedmioty i zapisy
            <ArrowUpRight size={14} />
          </WorkflowLink>
        </div>
      )}
    />
  )
}

export function AccountModule({
  title,
  eyebrow,
  description,
  tabs,
  copyable = false,
  renderExtra,
}: {
  title: string
  eyebrow: string
  description: string
  tabs: ModuleTab[]
  copyable?: boolean
  renderExtra?: (data: AccountSection) => ReactNode
}) {
  const [selected, setSelected] = useState(tabs[0]!.id)
  return (
    <AccountModuleContent
      key={selected}
      title={title}
      eyebrow={eyebrow}
      description={description}
      tabs={tabs}
      selected={selected}
      setSelected={setSelected}
      copyable={copyable}
      renderExtra={renderExtra}
    />
  )
}
function AccountModuleContent({
  title,
  eyebrow,
  description,
  tabs,
  selected,
  setSelected,
  copyable,
  renderExtra,
}: {
  title: string
  eyebrow: string
  description: string
  tabs: ModuleTab[]
  selected: AccountSectionId
  setSelected: (id: AccountSectionId) => void
  copyable: boolean
  renderExtra?: (data: AccountSection) => ReactNode
}) {
  const { data, meta, error, loading, reload } = useEndpoint<AccountSection>(
    `/api/sections/${selected}`,
  )
  return (
    <div className="screen">
      <PageHeader
        title={title}
        eyebrow={eyebrow}
        description={description}
        loading={loading}
        onReload={reload}
        extra={
          <WorkflowLink entry={selected} link={{label: "Pełne szczegóły", url: sectionUrl(selected)}} className="button button-secondary">
            Szczegóły i działania
            <ArrowUpRight size={14} />
          </WorkflowLink>
        }
      />
      <div className="module-tabs" aria-label={`Sekcje: ${title}`}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            aria-pressed={selected === tab.id}
            onClick={() => setSelected(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <StateBanner meta={meta} error={error} onReload={reload} />
      {loading && !data && <ScreenSkeleton />}
      {data && (
        <>
          {renderExtra?.(data)}
          <SectionData data={data} copyable={copyable} />
          <p className="section-note">
            Źródło: {data.title} w USOSweb. Stan pochodzi z ostatniego pobrania;
            dostępne szczegóły i formularze otwierają się w aplikacji.
          </p>
        </>
      )}
    </div>
  )
}
function PaymentSummary({ data }: { data: AccountSection }) {
  const currencies = [
    ...new Set(
      data.dues
        .map((due) => due.currency)
        .filter((value): value is string => Boolean(value)),
    ),
  ]
  const known =
    data.dues.length > 0 &&
    currencies.length === 1 &&
    data.dues.every(
      (due) => due.cents !== null && due.currency === currencies[0],
    )
  const sum = known
    ? data.dues.reduce((total, due) => total + due.cents!, 0)
    : null
  const next = [...data.dues]
    .filter((due) => due.date && due.cents !== null && due.cents > 0)
    .sort((a, b) => a.date!.localeCompare(b.date!))[0]
  const amount =
    sum === null
      ? '—'
      : new Intl.NumberFormat('pl-PL', {
          style: 'currency',
          currency: currencies[0]!,
        }).format(sum / 100)
  return (
    <div className="stats-grid payment-stats">
      <Metric
        icon={<Wallet size={18} />}
        label="Łącznie wg listy USOS"
        value={amount}
        detail={
          known
            ? 'Suma pozycji w jednej walucie'
            : 'Brak jednoznacznej kwoty do zsumowania'
        }
      />
      <Metric
        icon={<CalendarClock size={18} />}
        label="Najwcześniejszy termin"
        value={next?.date ? fmtDate(next.date) : '—'}
        detail="Uwzględnia też zaległe należności"
      />
      <Metric
        icon={<CreditCard size={18} />}
        label="Pozycje należności"
        value={String(
          data.tables.reduce((count, table) => count + table.rows.length, 0),
        )}
        detail="Nierozliczone pozycje w pobranym źródle"
      />
    </div>
  )
}
