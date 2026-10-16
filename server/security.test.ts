import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { localBoundary } from './security.js'
function fixture() {
  const app = new Hono()
  let calls = 0
  app.use('*', localBoundary(8080))
  app.get('/api/student', c => { calls++; return c.json({ fixture: 'private student data' }) })
  return { app, calls: () => calls }
}
describe('legacy local-origin security boundary', () => {
  it.each(['127.0.0.1:8080', 'localhost:8080', '127.0.0.1:5173', 'localhost:5173'])('preserves canonical/Vite Host %s', async host => {
    const { app } = fixture()
    const r = await app.request('http://' + host + '/api/student', { headers: { host, origin: 'http://' + host } })
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
  })
  it.each(['attacker.test', 'attacker.test:8080', '127.0.0.1:8080.attacker.test', '127.0.0.1:8081', 'localhost'])('rejects rebinding/noncanonical Host %s before private handler', async host => {
    const { app, calls } = fixture()
    const r = await app.request('http://127.0.0.1:8080/api/student', { headers: { host } })
    expect(r.status).toBe(403)
    expect(await r.text()).not.toContain('private student data')
    expect(calls()).toBe(0)
  })
  it.each(['https://attacker.test', 'null', 'http://127.0.0.1:5173'])('rejects foreign or opaque Origin %s', async origin => {
    const { app, calls } = fixture()
    expect((await app.request('http://127.0.0.1:8080/api/student', { headers: { host: '127.0.0.1:8080', origin } })).status).toBe(403)
    expect(calls()).toBe(0)
  })
  it('rejects cross-site and untrusted forwarded authority; allows headerless local CLI only with real Host', async () => {
    const { app, calls } = fixture()
    expect((await app.request('http://127.0.0.1:8080/api/student', { headers: { host: '127.0.0.1:8080', 'sec-fetch-site': 'cross-site' } })).status).toBe(403)
    expect((await app.request('http://127.0.0.1:8080/api/student', { headers: { host: 'attacker.test', 'x-forwarded-host': '127.0.0.1:8080' } })).status).toBe(403)
    expect((await app.request('http://127.0.0.1:8080/api/student', { headers: { host: '127.0.0.1:8080' } })).status).toBe(200)
    expect(calls()).toBe(1)
  })
})
