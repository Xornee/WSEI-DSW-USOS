import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseStages, splitCoded } from './stages.js'

const pair = (label: string, value: string) => `<div><div>${label}:</div><div>${value}</div></div>`

const page = (stages: string, programme = 'Informatyka Stosowana [k-ins-In]') => `
  <usos-frame class="aktywny">
    <h2 slot="title">${programme}</h2>
    ${stages}
  </usos-frame>`

const stage = (title: string, pairs: string) => `
  <usos-frame-section section-title="${title}">
    <div class="inline-keyvalue-list">${pairs}</div>
  </usos-frame-section>`

const HTML = page(
  stage('6 semestr, 3 rok; Programowanie i analiza danych [INS-PIAD-In-E6]',
    pair('Cykl dydaktyczny', '2025/26L') +
    pair('Data zaliczenia', '<local-time datetime="2026-09-30" format="date"></local-time>') +
    pair('Status zaliczenia', "<usos-tag slim color='2'>w trakcie</usos-tag>")),
)

describe('parseStages', () => {
  it('czyta program wraz z kodem', () => {
    const [prog] = parseStages(HTML).programmes
    expect(prog).toMatchObject({ name: 'Informatyka Stosowana', code: 'k-ins-In' })
  })

  it('czyta etap z atrybutu section-title', () => {
    const stage = parseStages(HTML).programmes[0]!.stages[0]!
    expect(stage.name).toBe('6 semestr, 3 rok; Programowanie i analiza danych')
    expect(stage.code).toBe('INS-PIAD-In-E6')
  })

  it('rozpoznaje typ kazdej wartosci', () => {
    expect(parseStages(HTML).programmes[0]!.stages[0]!.fields).toEqual([
      { label: 'Cykl dydaktyczny', value: '2025/26L', kind: 'text' },
      { label: 'Data zaliczenia', value: '2026-09-30', kind: 'date' },
      { label: 'Status zaliczenia', value: 'w trakcie', kind: 'status' },
    ])
  })

  it('date bierze z atrybutu datetime, nie z tresci elementu', () => {
    const field = parseStages(HTML).programmes[0]!.stages[0]!.fields[1]!
    expect(field.value).toBe('2026-09-30')
  })

  it('pomija ramki bez listy par (dialogi, naglowki)', () => {
    const withDialog = '<usos-dialog><usos-frame><h2 slot="title">Potwierdzenie</h2></usos-frame></usos-dialog>' + HTML
    expect(parseStages(withDialog).programmes).toHaveLength(1)
  })

  it('pomija niekompletne pary', () => {
    const broken = page(stage('Etap [E1]', '<div><div>Sama etykieta:</div></div>' + pair('Cykl', '2024/25Z')))
    expect(parseStages(broken).programmes[0]!.stages[0]!.fields).toEqual([
      { label: 'Cykl', value: '2024/25Z', kind: 'text' },
    ])
  })

  it('odmawia gdy na stronie nie ma zadnych etapow', () => {
    expect(() => parseStages('<html><body>Brak danych</body></html>')).toThrow(/nie jest jeszcze skalibrowany/)
  })
})

describe('splitCoded', () => {
  it('oddziela kod', () => expect(splitCoded('Etap [E6]')).toEqual({ name: 'Etap', code: 'E6' }))
  it('puste nawiasy daja null', () => expect(splitCoded('Etap []')).toEqual({ name: 'Etap', code: null }))
  it('bez nawiasow zwraca sama nazwe', () =>
    expect(splitCoded('Etap')).toEqual({ name: 'Etap', code: null }))
})

const FIXTURE = new URL('./fixtures/zaliczenia.html', import.meta.url).pathname
const run = existsSync(FIXTURE) ? describe : describe.skip

run('na syntetycznym przykładzie zaliczenia/index', () => {
  const s = parseStages((existsSync(FIXTURE) ? readFileSync(FIXTURE, 'utf8') : ''))

  it('znajduje program z etapami', () => {
    expect(s.programmes.length).toBeGreaterThan(0)
    expect(s.programmes.every((p) => p.name.length > 0 && p.stages.length > 0)).toBe(true)
  })

  it('nie zostawia nawiasow w nazwach', () => {
    expect(s.programmes.every((p) => !p.name.includes('['))).toBe(true)
    expect(s.programmes.every((p) => p.stages.every((st) => !st.name.includes('[')))).toBe(true)
  })

  it('kazdy etap ma opisane pola', () => {
    const fields = s.programmes.flatMap((p) => p.stages.flatMap((st) => st.fields))
    expect(fields.length).toBeGreaterThan(0)
    expect(fields.every((f) => f.label.length > 0 && f.value.length > 0)).toBe(true)
  })

  it('daty sa w formacie ISO', () => {
    const dates = s.programmes.flatMap((p) => p.stages.flatMap((st) => st.fields)).filter((f) => f.kind === 'date')
    expect(dates.every((d) => /^\d{4}-\d{2}-\d{2}/.test(d.value))).toBe(true)
  })
})
