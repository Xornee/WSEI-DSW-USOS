import { readLimitedText } from "./transport.mjs";
import type { Config } from './config.js'

export class SessionExpiredError extends Error {
  constructor() {
    super('Sesja USOSweb wygasla. Wklej swieze PHPSESSID do .env i zrestartuj proxy.')
    this.name = 'SessionExpiredError'
  }
}

export class NotConfiguredError extends Error {
  constructor() {
    super('Brak USOS_SESSION w .env — proxy dziala w trybie demo.')
    this.name = 'NotConfiguredError'
  }
}

/**
 * Klient USOSweb: jedno zapytanie naraz, ze stalym odstepem.
 * To nie jest optymalizacja — to warunek, zeby nasz klient byl dla uczelni
 * nieodroznialny od czlowieka klikajacego w UI.
 */
export class UsosClient {
  private chain: Promise<unknown> = Promise.resolve()
  private lastRequestAt = 0
  private pending = 0
  private owner: string | null = null

  constructor(private readonly config: Config) {}

  get configured(): boolean {
    return this.config.session !== null
  }

  /** Pobiera surowy HTML danej akcji USOSweb, kolejkujac i throttlujac. */
  async fetchAction(action: string, params: Record<string, string> = {}): Promise<string> {
    if (!this.config.session) throw new NotConfiguredError()
    if (this.pending >= 8) throw new Error('Za dużo zapytań do proxy.')
    this.pending++
    const queuedAt = Date.now()
    const run = this.chain.then(() => {
      if (Date.now() - queuedAt > 60_000) throw new Error('Przekroczono czas kolejki.')
      return this.execute(action, params)
    }).finally(() => { this.pending-- })
    // Lancuch nie moze sie zerwac przy bledzie jednego ogniwa.
    this.chain = run.catch(() => undefined)
    return run
  }

  private async execute(action: string, params: Record<string, string>): Promise<string> {
    await this.waitForSlot()
    const query = new URLSearchParams({ _action: action, ...params })
    const url = `${this.config.base}/kontroler.php?${query}`

    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
      headers: {
        cookie: `PHPSESSID=${this.config.session}`,
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'pl,en;q=0.8',
        'user-agent': 'usos-local/0.1 (osobisty klient studenta; jeden request na akcje)',
      },
    })
    this.lastRequestAt = Date.now()

    if ([301,302,303,307,308,401,403].includes(res.status)) throw new SessionExpiredError()
    if (!res.ok) throw new Error(`USOSweb zwrocil HTTP ${res.status} dla ${action}`)
    const html = await readLimitedText(res)
    const id = extractUserId(html)
    if (isLoggedOut(html) || !id || (this.owner && this.owner !== id)) throw new SessionExpiredError()
    this.owner = id
    return html
  }

  private async waitForSlot(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt
    const wait = this.config.minIntervalMs - elapsed
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  }
}

/**
 * USOSweb wstrzykuje w kazda strone `JSGLOBALS = { user_id: <id|null> }`.
 * `user_id: null` to najpewniejszy marker wylogowania, jaki daje ta aplikacja —
 * pewniejszy niz zgadywanie po URL-u przekierowania.
 */
export const isLoggedOut = (html: string): boolean => /user_id:\s*null/.test(html)

export const extractUserId = (html: string): string | null =>
  html.match(/user_id:\s*['"]?(\d+)/)?.[1] ?? null
