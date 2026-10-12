import type { ClassEntry } from '../../../shared/types'

export function startOfWeek(value: Date): Date {
  const result = new Date(value)
  result.setHours(0, 0, 0, 0)
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7))
  return result
}

export function addDays(value: Date, count: number): Date {
  const result = new Date(value)
  result.setDate(result.getDate() + count)
  return result
}

export const dateKey = (value: Date) =>
  `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`

export function validEntries(entries: readonly ClassEntry[]): ClassEntry[] {
  return entries
    .filter(
      (entry) =>
        Number.isFinite(+new Date(entry.start)) &&
        +new Date(entry.end) > +new Date(entry.start),
    )
    .sort((a, b) => +new Date(a.start) - +new Date(b.start))
}

export function entriesOnDay(
  entries: readonly ClassEntry[],
  day: Date,
): ClassEntry[] {
  return entries.filter(
    (entry) =>
      +new Date(entry.start) < +addDays(day, 1) && +new Date(entry.end) > +day,
  )
}

export function dayMinutes(iso: string, day: Date): number {
  const value = new Date(iso)
  if (value <= day) return 0
  if (value >= addDays(day, 1)) return 1440
  return value.getHours() * 60 + value.getMinutes()
}

interface PositionedEntry {
  entry: ClassEntry
  column: number
  columns: number
}

/** Separate concurrent classes into columns; keep chained overlaps in one group. */
export function layoutEntries(
  entries: readonly ClassEntry[],
): PositionedEntry[] {
  const sorted = validEntries(entries)
  const result: PositionedEntry[] = []
  let group: PositionedEntry[] = []
  let columnEnds: number[] = []
  let groupEnd = -Infinity
  const flush = () => {
    result.push(
      ...group.map((item) => ({ ...item, columns: columnEnds.length })),
    )
    group = []
    columnEnds = []
  }
  for (const entry of sorted) {
    const start = +new Date(entry.start)
    const end = +new Date(entry.end)
    if (start >= groupEnd) flush()
    let column = columnEnds.findIndex((value) => value <= start)
    if (column === -1) column = columnEnds.length
    columnEnds[column] = end
    group.push({ entry, column, columns: 1 })
    groupEnd = Math.max(groupEnd, end)
  }
  flush()
  return result
}
