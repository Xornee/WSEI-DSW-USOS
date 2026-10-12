import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseTrackGrid, parseTrackPage, TimetableRepository, trackId, warsawInstant } from './timetable.mjs'
const page = readFileSync(new URL('./timetable-fixtures/track.html', import.meta.url), 'utf8')
const grid = readFileSync(new URL('./timetable-fixtures/semester.html', import.meta.url), 'utf8')
const info = parseTrackPage(page)
describe('IDEIS Kraków timetable', () => {
  it('reads current semester and track metadata without evaluating scripts', () => {
    expect(info.trackId).toBe('958'); expect(info.from).toBe('2026-10-01'); expect(info.to).toBe('2027-02-21')
    expect(info.title).toContain('Programowanie i analiza danych')
  })
  it('imports the complete captured semester rather than the default one-day view', () => {
    const plan = parseTrackGrid(grid, info)
    expect(plan.entries).toHaveLength(49)
    expect(new Set(plan.entries.map(entry => entry.start.slice(0, 10))).size).toBe(32)
    expect(plan.entries.every(entry => entry.group && entry.lecturer && entry.room && entry.assessment && entry.sourceId)).toBe(true)
    expect(plan.timetable?.timezone).toBe('Europe/Warsaw')
    expect(new Set(plan.entries.map(entry => entry.id)).size).toBe(49)
  })
  it('converts summer and winter wall-clock times correctly even on UTC servers', () => {
    expect(warsawInstant('2026-10-09', '17:30')).toBe('2026-10-09T15:30:00.000Z')
    expect(warsawInstant('2026-11-09', '8:10')).toBe('2026-11-09T07:10:00.000Z')
  })
  it.each([['2026-02-30', '12:00'], ['2026-03-29', '02:30'], ['2026-10-09', '24:00'], ['2026-10-09', '12:75']])('rejects invalid dates/times %s %s', (date, time) => {
    expect(() => warsawInstant(date, time)).toThrow()
  })
  it.each(['0', '-1', '958/../x', 'https://127.0.0.1/', '958?x', '9999999', ''])('rejects arbitrary targets %s', value => {
    expect(() => trackId(value)).toThrow()
  })
  it('fails closed for broken pages, missing columns, missing dates and partial pagination', () => {
    expect(() => parseTrackPage('<html>Login</html>')).toThrow()
    expect(() => parseTrackGrid(grid.replace('Czas od', 'Changed'), info)).toThrow()
    expect(() => parseTrackGrid(grid.replaceAll('Data Zajęć:', 'Changed:'), info)).toThrow()
    expect(() => parseTrackGrid(grid + "<script>const state={'pageCount':9,'pageIndex':0}</script>", info)).toThrow()
    expect(parseTrackGrid(grid + "<script>const state={'pageCount':9,'pageIndex':-1}</script>", info).entries).toHaveLength(49)
  })
  it('coalesces requests, caches public data and sends the exact full-semester filter without cookies', async () => {
    const calls: { url: string; options?: RequestInit }[] = []
    const repository = new TimetableRepository({ intervalMs: 0, fetchImpl: (async (url, options) => {
      calls.push({ url: String(url), options })
      return new Response(calls.length === 1 ? page : grid)
    }) as typeof fetch })
    const [a, b] = await Promise.all([repository.get(), repository.get()])
    expect(a).toEqual(b); expect(calls).toHaveLength(2)
    expect(calls[1]!.url).toBe('https://harmonogram.krakow.ideis.pl/Plany/PlanyTokowGridCustom/958')
    expect(calls[1]!.options?.method).toBe('POST')
    expect((calls[1]!.options?.body as URLSearchParams).get('parametry')).toBe('2026-10-01;2027-02-21;3;958')
    expect(calls.every(call => call.options?.redirect === 'error' && call.options?.credentials === 'omit')).toBe(true)
    expect((await repository.get()).meta.source).toBe('cache'); expect(calls).toHaveLength(2)
  })
  it('rejects upstream failures and oversized bodies instead of inventing an empty plan', async () => {
    const bad = new TimetableRepository({ intervalMs: 0, fetchImpl: (async () => new Response('error', { status: 500 })) as typeof fetch })
    await expect(bad.get()).rejects.toThrow()
    const huge = new TimetableRepository({ intervalMs: 0, fetchImpl: (async () => new Response('x'.repeat(2000001))) as typeof fetch })
    await expect(huge.get()).rejects.toThrow()
  })
})
