import { describe, expect, it } from 'vitest'
import { parseIcal, parseIcsDate, splitSummary } from './ical.js'

/** Ksztalt odpowiedzi upcoming_ical przy braku zajec — zweryfikowany na zywym feedzie. */
const EMPTY = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//USOS//NONSGML USOSAPI//EN',
  'X-WR-CALNAME:Plan zajęć',
  'X-WR-TIMEZONE:Europe/Warsaw',
  'X-PUBLISHED-TTL:PT1H',
  'END:VCALENDAR',
].join('\r\n')

const withEvents = (...events: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events, 'END:VCALENDAR'].join('\r\n')

const EVENT = [
  'BEGIN:VEVENT',
  'UID:usos-123@usosapps.ideis.pl',
  'DTSTART:20261006T080000Z',
  'DTEND:20261006T093000Z',
  'SUMMARY:Analiza matematyczna - Wykład',
  'LOCATION:Sala 204',
  'DESCRIPTION:dr hab. Anna Kowalczyk',
  'END:VEVENT',
].join('\r\n')

describe('parseIcal', () => {
  it('pusty kalendarz daje plan bez zajec zamiast bledu', () => {
    const plan = parseIcal(EMPTY)
    expect(plan.entries).toHaveLength(0)
  })

  it('czyta wydarzenie i mapuje na wpis planu', () => {
    const [entry] = parseIcal(withEvents(EVENT)).entries
    expect(entry).toMatchObject({
      id: 'usos-123@usosapps.ideis.pl',
      courseName: 'Analiza matematyczna',
      kindLabel: 'Wykład',
      kind: 'wyklad',
      room: 'Sala 204',
      lecturer: 'dr hab. Anna Kowalczyk',
    })
    expect(entry!.start).toBe('2026-10-06T08:00:00.000Z')
  })

  it('pomija wydarzenia bez ram czasowych', () => {
    const broken = ['BEGIN:VEVENT', 'SUMMARY:Bez godzin', 'END:VEVENT'].join('\r\n')
    expect(parseIcal(withEvents(broken)).entries).toHaveLength(0)
  })

  it('sortuje chronologicznie niezaleznie od kolejnosci w pliku', () => {
    const later = EVENT.replace('20261006T080000Z', '20261008T080000Z').replace('20261006T093000Z', '20261008T093000Z').replace('usos-123', 'usos-999')
    const names = parseIcal(withEvents(later, EVENT)).entries.map((e) => e.id)
    expect(names).toEqual(['usos-123@usosapps.ideis.pl', 'usos-999@usosapps.ideis.pl'])
  })

  it('skleja linie zawiniete wg RFC 5545', () => {
    const folded = EVENT.replace(
      'SUMMARY:Analiza matematyczna - Wykład',
      'SUMMARY:Analiza matema\r\n tyczna - Wykład',
    )
    expect(parseIcal(withEvents(folded)).entries[0]!.courseName).toBe('Analiza matematyczna')
  })

  it('odwraca escapowanie przecinkow i nowych linii', () => {
    const esc = EVENT.replace('DESCRIPTION:dr hab. Anna Kowalczyk', 'DESCRIPTION:dr Nowak\\, PhD\\nGrupa L4')
    expect(parseIcal(withEvents(esc)).entries[0]!.lecturer).toBe('dr Nowak, PhD')
  })

  it('radzi sobie z parametrem TZID przy dacie', () => {
    const tz = EVENT.replace('DTSTART:20261006T080000Z', 'DTSTART;TZID=Europe/Warsaw:20261006T100000')
    expect(parseIcal(withEvents(tz)).entries[0]!.start).toBeTruthy()
  })
})

describe('parseIcsDate', () => {
  it('czyta znacznik UTC', () => {
    expect(parseIcsDate('20261006T080000Z')).toBe('2026-10-06T08:00:00.000Z')
  })
  it('czyta sama date', () => {
    expect(parseIcsDate('20261006')).toBeTruthy()
  })
  it('odrzuca smieci', () => {
    expect(parseIcsDate('jutro')).toBeNull()
  })
})

describe('splitSummary', () => {
  it('rozdziela nazwe i typ zajec', () => {
    expect(splitSummary('Bazy danych - Laboratorium')).toEqual({
      name: 'Bazy danych', kindLabel: 'Laboratorium',
    })
  })
  it('zostawia calosc gdy nie ma separatora', () => {
    expect(splitSummary('Seminarium')).toEqual({ name: 'Seminarium', kindLabel: null })
  })
  it('nie gubi myslnika wewnatrz nazwy przedmiotu', () => {
    expect(splitSummary('Fizyka kwantowa - teoria - Wykład')).toEqual({
      name: 'Fizyka kwantowa - teoria', kindLabel: 'Wykład',
    })
  })
})
