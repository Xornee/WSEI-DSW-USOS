import { CookieJar } from 'tough-cookie';
import { readLimitedText } from '../server/usos/transport.mjs';
const ORIGIN = 'https://usosweb.ideis.pl';
/** A tiny APIRequestContext-compatible, bounded GET transport. No Microsoft cookies. */
export async function createUsosRequest({ storageState, timeout = 20_000, userAgent }, fetcher = fetch) {
  const jar = new CookieJar();
  const controllers = new Set();
  let disposed = false;
  for (const cookie of storageState.cookies) {
    if (cookie.name !== 'PHPSESSID' || cookie.domain.replace(/^\./, '') !== 'usosweb.ideis.pl' ||
        !/^[A-Za-z0-9,-]{1,256}$/.test(cookie.value)) throw new Error('Invalid session cookie');
    await jar.setCookie(`PHPSESSID=${cookie.value}; Path=/; Secure; HttpOnly`, ORIGIN);
  }
  return {
    async get(raw, { maxBytes = 2_000_000, signal } = {}) {
      const url = new URL(raw);
      if (disposed || url.origin !== ORIGIN || url.pathname !== '/kontroler.php' || url.username || url.password)
        throw new Error('Invalid USOS request');
      const controller = new AbortController(); controllers.add(controller);
      try {
        const response = await fetcher(url, {
          redirect: 'manual',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeout), ...(signal ? [signal] : [])]),
          headers: { cookie: await jar.getCookieString(url.href), 'user-agent': userAgent || 'USOS-Local/0.2' },
        });
        // Cookies are scoped by the jar; store only the PHP session cookie.
        for (const value of response.headers.getSetCookie())
          if (/^PHPSESSID=/i.test(value)) await jar.setCookie(value, url.href);
        let body = await readLimitedText(response, maxBytes);
        if (disposed) throw new Error('USOS request disposed');
        return { status: () => response.status, text: async () => body, dispose: async () => { body = ''; } };
      } finally { controllers.delete(controller); }
    },
    async dispose() {
      disposed = true;
      for (const controller of controllers) controller.abort();
      controllers.clear();
      await jar.removeAllCookies();
    },
  };
}
