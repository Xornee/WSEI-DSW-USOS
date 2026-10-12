import { useEffect, useState } from 'react'
import type { ApiResponse, Meta, SessionStatus } from '../../../shared/types'

export interface Loaded<T> {
  data: T | null
  meta: Meta | null
  error: string | null
  loading: boolean
  reload: () => void
}

/** Jedna sciezka obslugi dla kazdego endpointu — koperta z proxy jest spojna. */
export function useEndpoint<T>(path: string): Loaded<T> {
  const [state, setState] = useState<Omit<Loaded<T>, 'reload'>>({
    data: null,
    meta: null,
    error: null,
    loading: true,
  })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 75_000)
    setState((s) => ({ ...s, loading: true }))

    fetch(path, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json()
        if (!body || typeof body.ok !== 'boolean' || !body.meta || typeof body.meta.fetchedAt !== 'string' ||
            (body.ok && body.data == null) || (!body.ok && typeof body.error !== 'string'))
          throw new Error('Nieprawidłowa odpowiedź serwera')
        if (!res.ok && body.ok) throw new Error('Serwer nie zwrócił danych')
        return body as ApiResponse<T>
      })
      .then((body) => {
        clearTimeout(timeout)
        if (cancelled) return
        setState(
          body.ok
            ? { data: body.data, meta: body.meta, error: null, loading: false }
            : {
                data: null,
                meta: body.meta,
                error: body.error,
                loading: false,
              },
        )
      })
      .catch((err: unknown) => {
        clearTimeout(timeout)
        if (cancelled) return
        const msg = err instanceof Error ? err.message : 'Proxy nie odpowiada'
        setState({ data: null, meta: null, error: msg, loading: false })
      })

    return () => {
      cancelled = true
      clearTimeout(timeout)
      controller.abort()
    }
  }, [path, nonce])

  return { ...state, reload: () => setNonce((n) => n + 1) }
}

export function useSession(enabled = true): SessionStatus | null {
  const [session, setSession] = useState<SessionStatus | null>(null)
  useEffect(() => {
    if (!enabled) return
    fetch('/api/session')
      .then((r) => r.json() as Promise<SessionStatus>)
      .then(setSession)
      .catch(() => setSession(null))
  }, [enabled])
  return session
}
