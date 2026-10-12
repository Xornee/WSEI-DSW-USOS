import { Card } from './Card'

export function Metric({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode
  label: string
  value: string
  detail: string
}) {
  return (
    <Card className="metric">
      <div className="metric-heading">
        <span>{label}</span>
        {icon}
      </div>
      <p className="metric-value">{value}</p>
      <p className="metric-detail">{detail}</p>
    </Card>
  )
}
