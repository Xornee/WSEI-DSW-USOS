export interface Config {
  base: string
  session: string | null
  port: number
  cacheTtl: number
  /** Prywatny link z USOSweb: Plan zajec -> eksport. Autoryzuje sam w sobie. */
  icalUrl: string | null
  /** Minimalny odstep miedzy requestami do uczelni. Nie schodz nizej. */
  minIntervalMs: number
}

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function loadConfig(): Config {
  const session = process.env.USOS_SESSION?.trim()
  return {
    base: process.env.USOS_BASE?.trim() || 'https://usosweb.ideis.pl',
    session: session && session.length > 0 ? session : null,
    port: num(process.env.PORT, 8080),
    cacheTtl: num(process.env.CACHE_TTL, 900),
    icalUrl: process.env.USOS_ICAL_URL?.trim() || null,
    minIntervalMs: num(process.env.MIN_INTERVAL_MS, 1200),
  }
}
