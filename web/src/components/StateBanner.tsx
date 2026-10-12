import {
  AlertCircle,
  Check,
  Database,
  FlaskConical,
  RefreshCw,
  WifiOff,
} from 'lucide-react'
import type { Meta } from '../../../shared/types'
import { ago } from '../lib/format'

export function StateBanner({
  meta,
  error,
  onReload,
  sourceLabel = 'USOS',
}: {
  meta: Meta | null
  error: string | null
  onReload: () => void
  sourceLabel?: string
}) {
  if (error)
    return (
      <div className="state-banner state-danger" role="alert">
        <AlertCircle size={17} />
        <div>
          <strong>Nie udało się pobrać danych.</strong>
          <p>{error}</p>
        </div>
        <button className="button button-secondary" onClick={onReload}>
          <RefreshCw size={14} />
          Ponów
        </button>
      </div>
    )
  if (!meta) return null
  if (meta.stale)
    return (
      <div className="state-banner state-warning" role="status">
        <WifiOff size={17} />
        <div>
          <strong>Wyświetlasz ostatnie zapisane dane.</strong>
          <p>{sourceLabel} nie odpowiedział. Zapis: {ago(meta.fetchedAt)}.</p>
        </div>
        <button className="button button-secondary" onClick={onReload}>
          Ponów
        </button>
      </div>
    )
  if (meta.source === 'mock')
    return (
      <div className="state-banner state-demo">
        <FlaskConical size={16} />
        <span>
          <strong>Wersja demonstracyjna</strong>
          <span className="banner-separator">/</span>Przeglądasz przykładowe
          dane, nie dane z Twojego konta.
        </span>
        <span className="small-badge">DEMO</span>
      </div>
    )
  return (
    <div className="data-freshness">
      {meta.source === 'cache' ? <Database size={13} /> : <Check size={13} />}
      <span>
        {meta.source === 'cache'
          ? 'Dane z pamięci podręcznej'
          : `Dane pobrane z ${sourceLabel}`}{' '}
        · {ago(meta.fetchedAt)}
      </span>
    </div>
  )
}
