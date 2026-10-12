import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import type { Stages } from '../../shared/types'
import { studyHints, parseTrackFilters, parseTrackCandidates, matchingTracks, trackSelection, TrackCatalog } from './timetable-selection.mjs'
import { TimetableRepository } from './timetable.mjs'
const filters = readFileSync(new URL('./timetable-fixtures/track-search.html', import.meta.url), 'utf8')
const catalog = readFileSync(new URL('./timetable-fixtures/track-candidates.html', import.meta.url), 'utf8')
const stages = (changes: { mode?: string; specialty?: string; semester?: number; cycle?: string; status?: string } = {}): Stages => ({ programmes: [{ name: `Informatyka stosowana, studia inżynierskie, ${changes.mode ?? 'niestacjonarne'}`, code: 'k-ins-In', stages: [{ name: `${changes.semester ?? 7} semestr, 4 rok; ${changes.specialty ?? 'Programowanie i analiza danych'}`, code: `INS-PIAD-In-E${changes.semester ?? 7}`, fields: [{ label: 'Cykl realizacji', value: changes.cycle ?? '2026/27Z', kind: 'text' }, { label: 'Status zaliczenia', value: changes.status ?? 'w trakcie', kind: 'status' }] }] }] })
const tracks = parseTrackCandidates(catalog)
describe('automatic track matching uses account study attributes, never default 958', () => {
  it('derives winter admission from current academic cycle minus the semester offset', () => {
    expect(studyHints(stages())[0]).toMatchObject({ cohortYear: 2023, admission: 'Z', mode: 'N', degree: 'engineering', specialty: 'Programowanie i analiza danych' })
    expect(studyHints(stages({ semester: 6, cycle: '2025/26L' }))[0]?.cohortYear).toBe(2023)
  })
  it('supports summer admissions rather than always assuming a winter intake', () => {
    expect(studyHints(stages({ semester: 6, cycle: '2026/27Z' }))[0]).toMatchObject({ cohortYear: 2023, admission: 'L' })
  })
  it('matches N programme, specialty, degree, intake to track 958 without a user ID/link', () => {
    const candidates = matchingTracks(studyHints(stages())[0]!, tracks)
    expect(candidates.map(track => track.trackId)).toEqual(['958'])
    expect(trackSelection(candidates)).toMatchObject({ state: 'automatic', trackId: '958' })
  })
  it('another account/attendance mode yields another track, not the shared default', () => {
    expect(matchingTracks(studyHints(stages({ specialty: 'Sieci komputerowe' }))[0]!, tracks).map(t => t.trackId)).toEqual(['959'])
    expect(matchingTracks(studyHints(stages({ mode: 'stacjonarne' }))[0]!, tracks).map(t => t.trackId)).toEqual(['954'])
  })
  it('does not choose a different cohort or degree when the right one is missing', () => {
    expect(matchingTracks({ ...studyHints(stages())[0]!, cohortYear: 2024 }, tracks)).toEqual([])
    expect(matchingTracks({ ...studyHints(stages())[0]!, degree: 'masters' }, tracks)).toEqual([])
  })
  it('does not guess when attendance mode is missing; exposes named candidates', () => {
    const options = matchingTracks({ ...studyHints(stages())[0]!, mode: null }, tracks)
    expect(trackSelection(options)).toMatchObject({ state: 'choice_required', trackId: null })
    expect(options.map(t => t.trackId).sort()).toEqual(['954', '958'])
    expect(trackSelection(options, '954').state).toBe('confirmed')
    expect(() => trackSelection(options, '959')).toThrow(/nie pasuje/)
  })
  it('missing active stages are unresolved, not silently assigned default 958', () => {
    expect(studyHints(stages({ status: 'zaliczony' }))).toEqual([])
    expect(trackSelection([])).toMatchObject({ state: 'unresolved', trackId: null })
  })
  it('ignores historical completed stages and chooses the latest active cycle', () => {
    const data = stages(); const programme = data.programmes[0]!
    expect(studyHints({ programmes: [{ ...programme, stages: [...stages({ semester: 1, cycle: '2023/24Z', status: 'zaliczony' }).programmes[0]!.stages, ...programme.stages] }] })).toHaveLength(1)
  })
  it('rejects inconsistent semester names/codes and impossible academic cycle years', () => {
    const data = stages(); const programme = data.programmes[0]!
    expect(studyHints({ programmes: [{ ...programme, stages: [{ ...programme.stages[0]!, code: 'INS-PIAD-In-E6' }] }] })).toEqual([])
    expect(studyHints(stages({ cycle: '2026/29Z' }))).toEqual([])
  })
})
describe('public track catalog is validated and cached independently of account data', () => {
  it('parses current public dropdown filters and all seven cohort candidates', () => {
    expect(parseTrackFilters(filters).programmes).toContainEqual({ id: '57854', title: 'Informatyka stosowana' })
    expect(tracks).toHaveLength(7)
  })
  it('fails closed for malformed data, arbitrary URLs and partial catalog pagination', () => {
    expect(() => parseTrackFilters('<html>Login</html>')).toThrow()
    expect(() => parseTrackCandidates(catalog.replace('Nabór', 'Changed'))).toThrow()
    expect(() => parseTrackCandidates(catalog.replace('/Plany/PlanyTokow/958', 'https://localhost/Plany/PlanyTokow/958'))).toThrow()
    expect(() => parseTrackCandidates(catalog.replace("'pageCount':1", "'pageCount':2"))).toThrow()
  })
  it('uses only public filter IDs, coalesces lookups and never sends account/profile data upstream', async () => {
    const calls: string[] = []
    const timetable = new TimetableRepository({ intervalMs: 0, fetchImpl: (async url => { calls.push(String(url)); return new Response(String(url).includes('Ukryj=True') ? filters : catalog) }) as typeof fetch })
    const repo = new TrackCatalog(timetable), hints = studyHints(stages())
    const [a, b] = await Promise.all([repo.candidates(hints), repo.candidates(hints)])
    expect(a).toEqual(b); expect(a[0]?.trackId).toBe('958'); expect(calls).toHaveLength(2)
    expect(new URL(calls[1]!).searchParams.get('kierunekId')).toBe('57854')
    expect(new URL(calls[1]!).searchParams.get('naborId')).toBe('78')
    expect(calls.join(' ')).not.toContain('Programowanie')
    await repo.candidates(studyHints(stages({ specialty: 'Sieci komputerowe' }))); expect(calls).toHaveLength(2)
  })
})
