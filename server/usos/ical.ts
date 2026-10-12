import ical from 'node-ical'
import type { ClassEntry, ClassKind, Plan } from '../../shared/types.js'
import { classifyKind } from './scrape/plan.js'

export const UNIVERSITY_TIMEZONE = 'Europe/Warsaw'

function validDate(value: string): boolean {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(value)
  if (!m) return false
  const [, y, mo, d, h = '00', mi = '00', sec = '00'] = m
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${sec}Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().replace(/[-:]/g, '').slice(0, 15) === `${y}${mo}${d}T${h}${mi}${sec}`
}

/** Explicit floating timezone, independent of the Node/container timezone. */
export function parseIcsDate(value: string, timezone = UNIVERSITY_TIMEZONE): string | null {
  if (!validDate(value)) return null
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone })
    const normalized = value.length === 8 ? `${value}T000000` : value
    const field = normalized.endsWith('Z') ? 'DTSTART' : `DTSTART;TZID=${timezone}`
    const parsed = ical.sync.parseICS(`BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:date-probe\n${field}:${normalized}\nEND:VEVENT\nEND:VCALENDAR`)
    const event = parsed['date-probe']
    if (event?.type !== 'VEVENT' || !event.start) return null
    if (!normalized.endsWith('Z')) {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' }).formatToParts(event.start)
      const values = Object.fromEntries(parts.map(part => [part.type,part.value]))
      if (`${values.year}${values.month}${values.day}T${values.hour}${values.minute}${values.second}` !== normalized) return null
    }
    return event.start.toISOString()
  } catch { return null }
}

/** USOS sklada SUMMARY jako "Nazwa przedmiotu - Typ zajec". Rozdzielamy ostrożnie. */
export function splitSummary(summary: string): { name: string; kindLabel: string | null } {
  const m = summary.match(/^(.*?)\s+-\s+([^-]+)$/)
  if (!m) return { name: summary, kindLabel: null }
  return { name: m[1]!.trim(), kindLabel: m[2]!.trim() }
}

const firstLine = (text: string): string | null => {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0)
  return line ?? null
}

/** Bounded RFC parser. Unsupported recurrence is rejected, never reported as an empty plan. */
export function parseIcal(raw: string): Plan {
  if (Buffer.byteLength(raw) > 2_000_000) throw new Error('Kalendarz przekracza limit rozmiaru.')
  const unfolded = raw.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '')
  if (!/^BEGIN:VCALENDAR$/m.test(unfolded) || !/^END:VCALENDAR$/m.test(unfolded))
    throw new Error('Nieprawidłowy format kalendarza.')
  if (/^(RRULE|RDATE|EXRULE|EXDATE|RECURRENCE-ID)[;:]/mi.test(unfolded))
    throw new Error('Kalendarz zawiera cykle lub wyjątki. Użyj eksportu pojedynczych wystąpień zajęć.')
  if ((unfolded.match(/^BEGIN:VEVENT$/gm) || []).length > 2000)
    throw new Error('Kalendarz zawiera zbyt wiele wydarzeń.')
  const lines = unfolded.split('\n').map(line => {
    if (!/^(DTSTART|DTEND)([;:])/i.test(line)) return line
    const colon = line.indexOf(':')
    const value = line.slice(colon + 1)
    if (!validDate(value)) throw new Error('Kalendarz zawiera nieprawidłową datę.')
    const zone = /;TZID="?([^";:]+)/i.exec(line)?.[1]
    if (zone) {
      try { new Intl.DateTimeFormat('en', { timeZone: zone }) }
      catch { throw new Error('Kalendarz zawiera nieznaną strefę czasową.') }
    }
    if (!parseIcsDate(value, zone || UNIVERSITY_TIMEZONE)) throw new Error('Kalendarz zawiera nieprawidłową datę lub godzinę zmiany czasu.')
    if (value.length === 8) return `${line.slice(0, colon).replace(/;VALUE=DATE/i,'')};TZID=${zone || UNIVERSITY_TIMEZONE}:${value}T000000`
    if (value.length > 8 && !value.endsWith('Z') && !zone)
      return `${line.slice(0, colon)};TZID=${UNIVERSITY_TIMEZONE}:${value}`
    return line
  })
  const events = ical.sync.parseICS(lines.join('\n'))
  const entries: ClassEntry[] = []
  for (const event of Object.values(events)) {
    if (event?.type !== 'VEVENT' || event.status === 'CANCELLED') continue
    if (!event.start || !event.end) continue
    const start = event.start.toISOString(), end = event.end.toISOString()
    if (end <= start) {
      if (!event.duration && end === start) continue
      throw new Error('Koniec zajęć musi następować po początku.')
    }
    const text = (value: unknown): string => typeof value === 'string' ? value :
      value && typeof value === 'object' && 'val' in value ? String(value.val) : ''
    const summary = text(event.summary).trim()
    const { name, kindLabel } = splitSummary(summary)
    entries.push({ id: event.uid, courseName: name || 'Zajęcia', courseCode: null,
      kind: classifyKind(kindLabel ?? summary) as ClassKind, kindLabel, start, end,
      room: text(event.location).trim() || null, building: null,
      lecturer: firstLine(text(event.description)), group: null })
  }
  entries.sort((a,b) => a.start.localeCompare(b.start))
  const from = entries[0]?.start ?? new Date().toISOString()
  const to = entries.reduce((latest, item) => item.end > latest ? item.end : latest, from)
  return { from, to, entries }
}
