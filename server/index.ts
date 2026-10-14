import { TrackCatalog, publicPlan, studyHints, trackSelection } from './usos/timetable-selection.mjs'
import { TimetableRepository, TimetableError } from './usos/timetable.mjs'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { AccountSectionsRepository } from './usos/account-sections.js'
import { isAccountSectionId } from '../shared/sections.js'
import { PublicUniversityRepository } from './usos/public-repository.js'
import type { ApiResponse } from '../shared/types.js'
import { loadActions } from './usos/actions.js'
import { loadConfig } from './usos/config.js'
import { SessionExpiredError, UsosClient } from './usos/client.js'
import {
  MockRepository,
  UsosWebRepository,
  type Result,
  type UsosRepository,
} from './usos/repository.js'

try {
  process.loadEnvFile(new URL('../.env', import.meta.url).pathname)
} catch {
  console.warn('[boot] Brak .env — startuje w trybie demo.')
}

const config = loadConfig()
const client = new UsosClient(config)
const repo: UsosRepository = client.configured
  ? new UsosWebRepository(
      client,
      loadActions(),
      config.cacheTtl,
      config.icalUrl,
    )
  : new MockRepository()

const timetable = new TimetableRepository({ defaultTrackId: process.env.TIMETABLE_TRACK_ID || '958' })
const trackCatalog = new TrackCatalog(timetable)
const app = new Hono()
const sections = new AccountSectionsRepository(client, config.cacheTtl)
const publicUniversity = new PublicUniversityRepository(config.cacheTtl)

/** Kazda odpowiedz w tej samej kopercie — front ma jedna sciezke obslugi bledu. */
function route<T>(path: string, load: (query: URLSearchParams) => Promise<Result<T>>) {
  app.get(path, async (c) => {
    try {
      const { value, meta } = await load(new URL(c.req.url).searchParams)
      return c.json<ApiResponse<T>>({
        ok: true,
        data: value,
        error: null,
        meta,
      })
    } catch (err) {
      const expired = err instanceof SessionExpiredError
      return c.json<ApiResponse<T>>(
        {
          ok: false,
          data: null,
          error: err instanceof Error ? err.message : 'Nieznany blad',
          meta: {
            source: 'live',
            fetchedAt: new Date().toISOString(),
            stale: false,
          },
        },
        expired ? 401 : 502,
      )
    }
  })
}

app.get('/api/sections/:id', async (c) => {
  const id = c.req.param('id')
  if (!isAccountSectionId(id))
    return c.json(
      {
        ok: false,
        data: null,
        error: 'Nieznana sekcja.',
        meta: {
          source: 'live',
          stale: false,
          fetchedAt: new Date().toISOString(),
        },
      },
      404,
    )
  try {
    const { value, meta } = await sections.section(id)
    return c.json({ ok: true, data: value, error: null, meta })
  } catch (error) {
    return c.json(
      {
        ok: false,
        data: null,
        error:
          error instanceof Error ? error.message : 'Źródło nie odpowiedziało.',
        meta: {
          source: 'live',
          stale: false,
          fetchedAt: new Date().toISOString(),
        },
      },
      error instanceof SessionExpiredError ? 401 : 502,
    )
  }
})
app.get('/api/directory', async (c) => {
  const query = (c.req.query('q') ?? '').trim()
  const kind = c.req.query('kind') ?? 'people'
  if (
    query.length < 2 ||
    query.length > 80 ||
    !['people', 'faculties'].includes(kind)
  )
    return c.json(
      {
        ok: false,
        data: null,
        error: 'Wpisz od 2 do 80 znaków i wybierz typ katalogu.',
        meta: {
          source: 'live',
          stale: false,
          fetchedAt: new Date().toISOString(),
        },
      },
      400,
    )
  try {
    const { value, meta } = await sections.directory(
      query,
      kind as 'people' | 'faculties',
    )
    return c.json({ ok: true, data: value, error: null, meta })
  } catch (error) {
    return c.json(
      {
        ok: false,
        data: null,
        error:
          error instanceof Error ? error.message : 'Katalog nie odpowiedział.',
        meta: {
          source: 'live',
          stale: false,
          fetchedAt: new Date().toISOString(),
        },
      },
      error instanceof SessionExpiredError ? 401 : 502,
    )
  }
})

app.get('/api/session', async (c) => c.json(await repo.session()))
app.get('/api/student-services', c => c.json({ ok: false, data: null,
  error: 'Wykrywanie modułów wymaga panelu połączonego z USOS przez login-pilot (Docker).',
  meta: { source: client.configured ? 'live' : 'mock', fetchedAt: new Date().toISOString(), stale: false } }, 409))
async function loadTimetable(query: URLSearchParams) {
  const selected = query.get('trackId') ?? undefined
  if (query.getAll('trackId').length > 1 || [...query.keys()].some(key => !['trackId', 'scope'].includes(key)) || query.getAll('scope').length > 1 || (query.has('scope') && query.get('scope') !== 'public')) throw new TimetableError(400, 'Nieprawidłowy wybór toku.')
  if (query.get('scope') === 'public' || !client.configured) return publicPlan(timetable, selected)
  const stages = await repo.stages()
  const candidates = await trackCatalog.candidates(studyHints(stages.value))
  const selection = trackSelection(candidates, selected)
  if (!selection.trackId) return { ok: true as const, data: { from: '', to: '', entries: [], selection }, error: null, meta: stages.meta }
  const result = await timetable.get(selection.trackId)
  if (!result.ok) throw new Error(result.error)
  return { ...result, data: { ...result.data, selection } }
}
route('/api/home', async (query) => {
  const [student, plan] = await Promise.all([repo.student(), loadTimetable(query)])
  const now = new Date()
  if (!plan.ok) throw new Error(plan.error)
  return { value: { greeting: student.value.displayName?.split(' ')[0] ?? null, timetableSelection: plan.data.selection, announcements: [], announcementsState: 'not_connected' as const, nextClass: plan.data.entries.find(entry => new Date(entry.start) > now) ?? null, todayCount: plan.data.entries.filter(entry => new Date(entry.start).toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' }) === now.toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })).length }, meta: plan.meta }
})
app.get('/api/plan', async (c) => {
  try { return c.json(await loadTimetable(new URL(c.req.url).searchParams)) }
  catch (error) {
    const status = error instanceof Error && 'status' in error && error.status === 400 ? 400 : 502
    return c.json({ ok: false, data: null, error: error instanceof Error ? error.message : 'Import planu nie powiódł się.', meta: { source: 'live', fetchedAt: new Date().toISOString(), stale: false } }, status)
  }
})
route('/api/student', () => repo.student())
route('/api/grades', () => repo.grades())
route('/api/stages', () => repo.stages())
route('/api/news', () => publicUniversity.news())
route('/api/terms', () => publicUniversity.terms())

serve(
  { fetch: app.fetch, port: config.port, hostname: '127.0.0.1' },
  ({ port }) => {
    const mode = client.configured
      ? 'LIVE (scraping USOSweb)'
      : 'DEMO (dane przykladowe)'
    console.log(`\n  usos-local proxy  ->  http://127.0.0.1:${port}`)
    console.log(`  tryb: ${mode}`)
    console.log(
      `  cache: ${config.cacheTtl}s, odstep miedzy requestami: ${config.minIntervalMs}ms\n`,
    )
  },
)
