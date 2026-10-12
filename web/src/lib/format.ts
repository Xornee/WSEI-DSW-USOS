import type { ClassKind } from '../../../shared/types'

const pl = 'pl-PL'

export const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString(pl, { hour: '2-digit', minute: '2-digit' })

export const dayName = (iso: string) =>
  new Date(iso).toLocaleDateString(pl, { weekday: 'long' })

export const dayShort = (iso: string) =>
  new Date(iso).toLocaleDateString(pl, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })

export const minutesOfDay = (iso: string) => {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

export const isSameDay = (a: string, b: Date) =>
  new Date(a).toDateString() === b.toDateString()

export function relativeTo(iso: string, now = new Date()): string {
  const diff = Math.round((new Date(iso).getTime() - now.getTime()) / 60000)
  if (diff < 0) return 'trwa lub minęło'
  if (diff < 60) return `za ${diff} min`
  const hours = Math.floor(diff / 60)
  if (hours < 24) return `za ${hours} h ${diff % 60} min`
  return `za ${Math.floor(hours / 24)} dni`
}

export function ago(iso: string, now = new Date()): string {
  const mins = Math.round((now.getTime() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'przed chwilą'
  if (mins < 60) return `${mins} min temu`
  const h = Math.floor(mins / 60)
  return h < 24 ? `${h} h temu` : `${Math.floor(h / 24)} dni temu`
}

interface KindStyle {
  dot: string
  chip: string
}

const STYLES: Record<ClassKind, KindStyle> = {
  wyklad: { dot: 'dot-blue', chip: 'tone-blue' },
  cwiczenia: { dot: 'dot-green', chip: 'tone-green' },
  laboratorium: { dot: 'dot-amber', chip: 'tone-amber' },
  seminarium: { dot: 'dot-rose', chip: 'tone-rose' },
  lektorat: { dot: 'dot-sky', chip: 'tone-sky' },
  inne: { dot: 'dot-neutral', chip: 'tone-neutral' },
}

export const kindStyle = (kind: ClassKind): KindStyle =>
  STYLES[kind] ?? STYLES.inne

export const initials = (first: string, last: string) =>
  `${first.charAt(0)}${last.charAt(0)}`.toUpperCase()

/** Kolor oceny wg polskiej skali; oceny opisowe dostaja neutralny. */
export function gradeStyle(numeric: number | null): string {
  if (numeric === null) return 'tone-neutral'
  if (numeric >= 4.5) return 'tone-green'
  if (numeric >= 4) return 'tone-blue'
  if (numeric >= 3) return 'tone-amber'
  return 'tone-rose'
}

export const fmtAverage = (v: number | null): string =>
  v === null ? '—' : v.toFixed(2).replace('.', ',')

export const fmtDate = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('pl-PL', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
}

/** Kolor statusu etapu — USOSweb opisuje je slownie, wiec dopasowujemy wzorcem. */
export function statusStyle(value: string): string {
  // Negative forms must be checked before their positive substrings.
  if (
    /nie[\s-]*zalicz|nie[\s-]*zdan|nie[\s-]*ukończ|skreśl|powtarz|nieaktywn/i.test(
      value,
    )
  )
    return 'tone-rose'
  if (/zaliczon|zdan|ukończ|aktywn/i.test(value)) return 'tone-green'
  if (/trakcie|oczekuj|w toku/i.test(value)) return 'tone-amber'
  return 'tone-neutral'
}
