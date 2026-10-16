import type { MiddlewareHandler } from 'hono'

/** The legacy proxy has one private upstream session: loopback binding alone is not an origin boundary. */
export function localBoundary(port: number): MiddlewareHandler {
  // Vite retains its original Host when forwarding /api to the legacy proxy.
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, '127.0.0.1:5173', 'localhost:5173'])
  return async (context, next) => {
    context.header('Cache-Control', 'no-store')
    context.header('X-Content-Type-Options', 'nosniff')
    context.header('Referrer-Policy', 'no-referrer')
    context.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
    const host = context.req.header('host')
    const origin = context.req.header('origin')
    if (!host || !hosts.has(host) || (origin && origin !== `http://${host}`) || context.req.header('sec-fetch-site') === 'cross-site')
      return context.json({ ok: false, data: null, error: 'Origin rejected' }, 403)
    await next()
  }
}
