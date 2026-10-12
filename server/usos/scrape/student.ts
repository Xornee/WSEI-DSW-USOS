import { load, type CheerioAPI } from 'cheerio'
import type { Student } from '../../../shared/types.js'
import { ParserNotCalibratedError } from './errors.js'

/**
 * Zrodlo: kafelek "Informacje o uzytkowniku" (`usos-frame#info-frame`)
 * na `home/index`. Czytamy po etykietach, nie po pozycji — USOSweb
 * zmienia kolejnosc pol miedzy rolami uzytkownika.
 */
const LABELS = {
  album: /numer\s+albumu/i,
  library: /karty?\s+bibliotecznej/i,
  roles: /role\s*\/\s*uprawnienia/i,
  access: /dost[eę]p\s+do\s+usosweb/i,
} as const

const clean = (text: string): string | null => {
  const v = text.replace(/\s+/g, ' ').trim()
  if (!v || /^brak\b/i.test(v)) return null
  return v
}

/** Zwraca tresc <b> z elementu listy, ktorego etykieta pasuje do wzorca. */
function valueByLabel($: CheerioAPI, items: ReturnType<CheerioAPI>, label: RegExp): string | null {
  const match = items.filter((_, el) => label.test($(el).text())).first()
  if (match.length === 0) return null
  const bold = match.find('b').first()
  if (bold.length > 0) return clean(bold.text())
  // Fallup: wartosc bywa tekstem po dwukropku, bez pogrubienia.
  return clean(match.text().split(':').slice(1).join(':'))
}

export function parseStudent(html: string): Student {
  const $ = load(html)
  const frame = $('#info-frame')
  if (frame.length === 0) throw new ParserNotCalibratedError('student')

  const items = frame.find('li')
  const rolesItem = items.filter((_, el) => LABELS.roles.test($(el).text())).first()
  const roles = rolesItem
    .find('li b')
    .map((_, el) => clean($(el).text()))
    .get()
    .filter((v): v is string => v !== null)

  const faculty = clean(frame.find('a[href*="pokazJednostke"]').first().text())

  return {
    id: html.match(/user_id:\s*['"]?(\d+)/)?.[1] ?? '',
    displayName: null, // dostepne dopiero na stronie profilowej
    albumNumber: valueByLabel($, items, LABELS.album),
    libraryCard: valueByLabel($, items, LABELS.library),
    roles,
    faculty,
    accessExpires: valueByLabel($, items, LABELS.access),
    email: null,
    photoUrl: null,
    programmes: [],
  }
}
