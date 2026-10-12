import type { ReactNode } from 'react'

export function Card({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`card ${className}`}>{children}</div>
}

export function CardHeader({
  title,
  hint,
}: {
  title: string
  hint?: ReactNode
}) {
  return (
    <div className="card-header">
      <h2>{title}</h2>
      {hint && <div className="card-hint">{hint}</div>}
    </div>
  )
}
