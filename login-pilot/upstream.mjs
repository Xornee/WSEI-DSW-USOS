import { CookieJar } from 'tough-cookie';
import { readLimitedBytes } from '../server/usos/transport.mjs';
const ORIGIN = 'https://usosweb.ideis.pl';
/** Bounded same-origin transport. Only the scoped USOS PHP cookie is retained. */
export async function createUsosRequest({ storageState, timeout = 20_000, userAgent }, fetcher = fetch) {
  const jar = new CookieJar();
  const controllers = new Set();
  let disposed = false;
  for (const cookie of storageState.cookies) {
    if (cookie.name !== 'PHPSESSID' || cookie.domain.replace(/^\./, '') !== 'usosweb.ideis.pl' ||
        !/^[A-Za-z0-9,-]{1,256}$/.test(cookie.value)) throw new Error('Invalid session cookie');
    await jar.setCookie(`PHPSESSID=${cookie.value}; Path=/; Secure; HttpOnly`, ORIGIN);
  }
  async function request(method, raw, { maxBytes = 2_000_000, signal, body } = {}) {
      const url = new URL(raw);
      if (disposed || url.origin !== ORIGIN || url.pathname !== '/kontroler.php' || url.username || url.password)
        throw new Error('Invalid USOS request');
      const controller = new AbortController(); controllers.add(controller);
      try {
        const response = await fetcher(url, {
          method,
          body: method === 'POST' ? body : undefined,
          redirect: 'manual',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeout), ...(signal ? [signal] : [])]),
          headers: { cookie: await jar.getCookieString(url.href), 'user-agent': userAgent || 'USOS-Local/0.2',
            ...(method === 'POST' ? { origin: ORIGIN, referer: url.href } : {}) },
        });
        // Cookies are scoped by the jar; store only the PHP session cookie.
        for (const value of response.headers.getSetCookie())
          if (/^PHPSESSID=/i.test(value)) await jar.setCookie(value, url.href);
        let bytes = await readLimitedBytes(response, maxBytes);
        if (disposed) throw new Error('USOS request disposed');
        return { status: () => response.status, text: async () => bytes.toString('utf8'), body: async () => bytes,
          headers: () => Object.fromEntries(['content-type', 'content-disposition', 'location'].map(name => [name, response.headers.get(name) || ''])),
          dispose: async () => { bytes = Buffer.alloc(0); } };
      } finally { controllers.delete(controller); }
  }
  return {
    get: (raw, options) => request('GET', raw, options),
    post: (raw, options) => request('POST', raw, options),
    async dispose() {
      disposed = true;
      for (const controller of controllers) controller.abort();
      controllers.clear();
      await jar.removeAllCookies();
    },
  };
}
