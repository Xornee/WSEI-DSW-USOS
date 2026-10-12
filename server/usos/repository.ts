import { readLimitedText } from "./transport.mjs";
import type { Grades, Home, Meta, Plan, SessionStatus, Stages, Student } from '../../shared/types.js'
import type { Actions } from './actions.js'
import { extractUserId, NotConfiguredError, UsosClient } from './client.js'
import { parseIcal } from './ical.js'
import { mockGrades, mockHome, mockPlan, mockStages, mockStudent } from './mock.js'
import { parseGrades } from './scrape/grades.js'
import { parseStages } from './scrape/stages.js'
import { parseDisplayName, parseEmail } from './scrape/profile.js'
import { parseStudent } from './scrape/student.js'

export interface Result<T> { value: T; meta: Meta }

export interface UsosRepository {
  session(): Promise<SessionStatus>
  home(): Promise<Result<Home>>
  plan(): Promise<Result<Plan>>
  student(): Promise<Result<Student>>
  grades(): Promise<Result<Grades>>
  stages(): Promise<Result<Stages>>
}

const meta = (source: Meta['source'], stale = false, fetchedAt = new Date()): Meta => ({
  source,
  stale,
  fetchedAt: fetchedAt.toISOString(),
})

export class MockRepository implements UsosRepository {
  async session(): Promise<SessionStatus> {
    return { loggedIn: false, userId: null, mode: 'mock' }
  }
  async home() { return { value: mockHome(), meta: meta('mock') } }
  async plan() { return { value: mockPlan(), meta: meta('mock') } }
  async student() { return { value: mockStudent(), meta: meta('mock') } }
  async grades() { return { value: mockGrades(), meta: meta('mock') } }
  async stages() { return { value: mockStages(), meta: meta('mock') } }
}

export class UsosWebRepository implements UsosRepository {
  constructor(
    private readonly client: UsosClient,
    private readonly actions: Actions,
    private readonly ttl: number,
    private readonly icalUrl: string | null,
  ) {}

  async session(): Promise<SessionStatus> {
    try {
      const html = await this.client.fetchAction(this.actions.home)
      return { loggedIn: true, userId: extractUserId(html), mode: 'live' }
    } catch (err) {
      if (err instanceof NotConfiguredError) return { loggedIn: false, userId: null, mode: 'mock' }
      return { loggedIn: false, userId: null, mode: 'live' }
    }
  }

  /**
   * Plan pochodzi z oficjalnego feedu iCal USOS API, nie ze scrapingu —
   * widget w USOSwebie renderuje sie po stronie klienta i w HTML-u go nie ma.
   */
  plan(): Promise<Result<Plan>> {
    return this.cached('plan', async () => {
      if (!this.icalUrl) {
        throw new Error(
          'Brak USOS_ICAL_URL w .env. W USOSwebie: Plan zajęć → eksport → skopiuj odnośnik.',
        )
      }
      const res = await fetch(this.icalUrl, { headers: { accept: 'text/calendar' }, redirect: 'error', signal: AbortSignal.timeout(15_000) })
      if (!res.ok) throw new Error(`Feed iCal zwrocil HTTP ${res.status}`)
      return parseIcal(await readLimitedText(res))
    })
  }

  student(): Promise<Result<Student>> {
    return this.cached('student', async () => {
      const base = parseStudent(
        await this.client.fetchAction(this.actions.student ?? this.actions.home),
      )
      return base.id ? this.withProfile(base) : base
    })
  }

  /** Imie i e-mail sa opcjonalnym wzbogaceniem — ich brak nie psuje profilu. */
  private async withProfile(base: Student): Promise<Student> {
    try {
      const html = await this.client.fetchAction(this.actions.profile, { os_id: base.id })
      return { ...base, displayName: parseDisplayName(html), email: parseEmail(html) }
    } catch (err) {
      console.warn('[repo] strona profilowa niedostepna, zostaje profil podstawowy.', err)
      return base
    }
  }

  grades(): Promise<Result<Grades>> {
    return this.cached('grades', async () =>
      parseGrades(await this.client.fetchAction(this.actions.grades)),
    )
  }

  stages(): Promise<Result<Stages>> {
    return this.cached('stages', async () =>
      parseStages(await this.client.fetchAction(this.actions.stages)),
    )
  }

  /** Strona glowna to zestawienie — nie ma wlasnego zrodla, wiec nie ma czego psuc. */
  async home(): Promise<Result<Home>> {
    const [plan, student] = await Promise.all([this.plan(), this.student()])
    const now = new Date()
    const entries = plan.value.entries

    return {
      value: {
        greeting: student.value.displayName?.split(' ')[0] ?? null,
        nextClass: entries.find((e) => new Date(e.start) > now) ?? null,
        todayCount: entries.filter((e) => new Date(e.start).toDateString() === now.toDateString()).length,
        announcements: [],
        announcementsState: "not_connected",
      },
      meta: plan.meta.stale || student.meta.stale ? { ...plan.meta, stale: true } : plan.meta,
    }
  }

  /** Private legacy responses are never persisted or used as an auth-error fallback. */
  private async cached<T>(_key: string, fetcher: () => Promise<T>): Promise<Result<T>> {
    return { value: await fetcher(), meta: meta('live') }
  }
}
