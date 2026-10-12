import { Inbox } from 'lucide-react'
import type { ReactNode } from 'react'

export function EmptyState({
  title,
  description,
  icon = <Inbox size={23} />,
}: {
  title: string
  description: string
  icon?: ReactNode
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  )
}
