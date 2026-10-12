import { RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'

export function PageHeader({
  eyebrow,
  title,
  description,
  loading,
  onReload,
  extra,
}: {
  eyebrow: string
  title: string
  description: string
  loading: boolean
  onReload: () => void
  extra?: ReactNode
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      <div className="page-header-actions">
        {extra}
        <button
          className="button button-secondary"
          onClick={onReload}
          disabled={loading}
        >
          <RefreshCw size={15} className={loading ? 'spin' : ''} />
          {loading ? 'Pobieranie…' : 'Odśwież'}
        </button>
      </div>
    </header>
  )
}
