import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseGrades, splitSubject, toNumeric } from './grades.js'

const page = (sections: string) => `<usos-frame id="oceny">${sections}</usos-frame>`

const section = (title: string, rows: string) => `
  <usos-frame-section section-title="${title}" expandable expanded>
    <table>
      <tr><th>Przedmiot</th><th>Program</th><th>Ocena</th><th>Akcje</th></tr>
      ${rows}
    </table>
  </usos-frame-section>`

const row = (subject: string, programme: string, grades: string) =>
  `<tr><td>${subject}</td><td>${programme}</td><td>${grades}</td><td>akcje</td></tr>`

const grade = (component: string, value: string) =>
  `<div> ${component}: <span style="font-weight:bold"> ${value} </span> </div>`

describe('parseGrades', () => {
  const html = page(
    section('Semestr zimowy 2025/26',
      row('Inżynieria danych [IN-101]', '(niepodpięty)', grade('Konwersatorium', '5') + grade('Laboratorium', '4,5')) +
      row('Język angielski []', '(niepodpięty)', grade('Ćwiczenia', '4'))),
  )

  it('czyta nazwe cyklu z atrybutu section-title', () => {
    expect(parseGrades(html).cycles[0]!.name).toBe('Semestr zimowy 2025/26')
  })

  it('czyta przedmioty wraz z kodem', () => {
    const [first, second] = parseGrades(html).cycles[0]!.subjects
    expect(first).toMatchObject({ name: 'Inżynieria danych', code: 'IN-101' })
    expect(second).toMatchObject({ name: 'Język angielski', code: null })
  })

  it('rozbija komorke na forme zaliczenia i ocene', () => {
    expect(parseGrades(html).cycles[0]!.subjects[0]!.grades).toEqual([
      { component: 'Konwersatorium', value: '5', numeric: 5 },
      { component: 'Laboratorium', value: '4,5', numeric: 4.5 },
    ])
  })

  it('"niepodpiety" traktuje jak brak programu, nie jak nazwe', () => {
    expect(parseGrades(html).cycles[0]!.subjects[0]!.programme).toBeNull()
  })

  it('liczy srednia z ocen liczbowych', () => {
    const g = parseGrades(html)
    expect(g.cycles[0]!.average).toBe(4.5) // (5 + 4,5 + 4) / 3
    expect(g.average).toBe(4.5)
    expect(g.gradeCount).toBe(3)
  })

  it('pomija oceny opisowe przy sredniej, ale je zachowuje', () => {
    const opisowa = page(section('Cykl', row('Praktyka []', '(niepodpięty)', grade('Zaliczenie', 'zal'))))
    const g = parseGrades(opisowa)
    expect(g.cycles[0]!.subjects[0]!.grades[0]).toMatchObject({ value: 'zal', numeric: null })
    expect(g.average).toBeNull()
    expect(g.gradeCount).toBe(0)
  })

  it('pomija cykle bez przedmiotow', () => {
    expect(parseGrades(page(section('Pusty', ''))).cycles).toHaveLength(0)
  })

  it('odmawia gdy kafelka ocen nie ma', () => {
    expect(() => parseGrades('<html><body>nic</body></html>')).toThrow(/nie jest jeszcze skalibrowany/)
  })
})

describe('splitSubject', () => {
  it('oddziela kod w nawiasach kwadratowych', () => {
    expect(splitSubject('Bazy danych [BD-2]')).toEqual({ name: 'Bazy danych', code: 'BD-2' })
  })
  it('puste nawiasy daja null zamiast pustego kodu', () => {
    expect(splitSubject('Statystyka []')).toEqual({ name: 'Statystyka', code: null })
  })
  it('brak nawiasow zostawia nazwe bez zmian', () => {
    expect(splitSubject('Seminarium')).toEqual({ name: 'Seminarium', code: null })
  })
})

describe('toNumeric', () => {
  it('czyta przecinek dziesietny', () => expect(toNumeric('4,5')).toBe(4.5))
  it('czyta liczbe calkowita', () => expect(toNumeric('5')).toBe(5))
  it('opisowa ocena daje null', () => expect(toNumeric('zal')).toBeNull())
})

const FIXTURE = new URL('./fixtures/grades.html', import.meta.url).pathname
const run = existsSync(FIXTURE) ? describe : describe.skip

// Przykład zawiera wyłącznie syntetyczne oceny.
run('na syntetycznym przykładzie oceny/index', () => {
  const g = parseGrades((existsSync(FIXTURE) ? readFileSync(FIXTURE, 'utf8') : ''))

  it('znajduje cykle dydaktyczne', () => {
    expect(g.cycles.length).toBeGreaterThan(0)
    expect(g.cycles.every((c) => c.name.length > 0)).toBe(true)
  })

  it('kazdy cykl ma przedmioty z nazwami', () => {
    expect(g.cycles.every((c) => c.subjects.length > 0)).toBe(true)
    expect(g.cycles.every((c) => c.subjects.every((s) => s.name.length > 0))).toBe(true)
  })

  it('nie zostawia pustych nawiasow w nazwach', () => {
    expect(g.cycles.every((c) => c.subjects.every((s) => !s.name.includes('[')))).toBe(true)
  })

  it('oceny maja forme zaliczenia i wartosc', () => {
    const all = g.cycles.flatMap((c) => c.subjects.flatMap((s) => s.grades))
    expect(all.length).toBeGreaterThan(0)
    expect(all.every((x) => x.component.length > 0 && x.value.length > 0)).toBe(true)
  })

  it('srednia miesci sie w polskiej skali ocen', () => {
    expect(g.average).not.toBeNull()
    expect(g.average!).toBeGreaterThanOrEqual(2)
    expect(g.average!).toBeLessThanOrEqual(5)
  })
})
