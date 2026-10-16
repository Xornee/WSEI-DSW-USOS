import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { jwtVerify, createLocalJWKSet, decodeProtectedHeader } from 'jose';
import { readLimitedText } from '../server/usos/transport.mjs';

export class SocialLoginError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const digest = value => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const setting = (value, limit = 8192) => typeof value === 'string' && value.length <= limit && !/[\x00-\x20\x7f]/.test(value) ? value : '';

export function socialConfiguration(env = process.env) {
  const tenant = setting(env.MICROSOFT_TENANT_ID, 36).toLowerCase();
  return {
    google: { clientId: setting(env.GOOGLE_CLIENT_ID, 256), clientSecret: setting(env.GOOGLE_CLIENT_SECRET) },
    microsoft: { clientId: setting(env.MICROSOFT_CLIENT_ID, 256), clientSecret: setting(env.MICROSOFT_CLIENT_SECRET),
      tenant: /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(tenant) ? tenant : '' },
  };
}

/** Production endpoints are fixed. Constructor-only transport/endpoint injection is for fixtures. */
export class SocialLogin {
  constructor({ config = socialConfiguration(), fetcher = fetch, providersForTests = null, ttlMs = 5 * 60_000 } = {}) {
    this.fetcher = fetcher; this.ttlMs = ttlMs; this.flows = new Map(); this.keys = new Map(); this.pendingKeys = new Map();
    const tenant = config.microsoft?.tenant || '';
    this.providers = providersForTests || {
      google: { ...config.google, label: 'Google', issuer: 'https://accounts.google.com', issuers: ['https://accounts.google.com', 'accounts.google.com'],
        authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', jwks: 'https://www.googleapis.com/oauth2/v3/certs' },
      microsoft: { ...config.microsoft, label: 'Microsoft', issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
        issuers: [`https://login.microsoftonline.com/${tenant}/v2.0`], authorize: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
        token: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, jwks: `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys` },
    };
  }
  available(id) {
    const p = this.providers[id];
    return !!p?.clientId && !!p.clientSecret && (id !== 'microsoft' || !!p.tenant);
  }
  publicProviders() {
    return ['google', 'microsoft'].map(id => ({ id, label: this.providers[id]?.label || id, enabled: this.available(id),
      message: this.available(id) ? 'Połącz dostawcę w profilu, a potem loguj się jednym kliknięciem.' : 'Wymaga konfiguracji aplikacji OAuth przez administratora.' }));
  }
  prune() { for (const [state, flow] of this.flows) if (flow.expires <= Date.now()) this.flows.delete(state); }
  cancelOwner(userId, provider) {
    for (const [state, flow] of this.flows) if (flow.owner?.userId === userId && flow.provider === provider) this.flows.delete(state);
  }
  begin(id, origin, action = 'login', owner = null) {
    if (!['google', 'microsoft'].includes(id) || !this.available(id)) throw new SocialLoginError(503, 'Ten dostawca wymaga konfiguracji OAuth.');
    if (!['login', 'link'].includes(action) || (action === 'link' && !owner)) throw new SocialLoginError(400, 'Nieprawidłowy cel logowania.');
    const base = new URL(origin);
    if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname)))
      throw new SocialLoginError(503, 'Logowanie OAuth wymaga HTTPS lub lokalnego adresu loopback.');
    this.prune();
    if (this.flows.size >= 256) throw new SocialLoginError(429, 'Za dużo rozpoczętych logowań. Spróbuj później.');
    const state = random(), browser = random(), nonce = random(), verifier = randomBytes(32).toString('base64url');
    const redirectUri = `${origin}/api/auth/oauth/${id}/callback`, p = this.providers[id];
    this.flows.set(state, { provider: id, action, owner, browserHash: digest(browser), nonce, verifier, redirectUri, expires: Date.now() + this.ttlMs });
    const url = new URL(p.authorize);
    const params = { client_id: p.clientId, response_type: 'code', response_mode: 'query', scope: 'openid profile email', redirect_uri: redirectUri,
      state, nonce, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', prompt: 'select_account' };
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    return { url: url.href, browser, state };
  }
  consume(id, state, browser) {
    if (typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state) || typeof browser !== 'string' || !/^[a-f0-9]{64}$/.test(browser))
      throw new SocialLoginError(403, 'Logowanie nie jest powiązane z tą przeglądarką. Rozpocznij je ponownie.');
    const flow = this.flows.get(state);
    if (!flow || flow.expires <= Date.now()) { this.flows.delete(state); throw new SocialLoginError(410, 'Logowanie wygasło lub zostało już wykorzystane.'); }
    if (flow.provider !== id || !equal(flow.browserHash, digest(browser))) throw new SocialLoginError(403, 'Nieprawidłowe powiązanie logowania.');
    this.flows.delete(state); // Consume before network access; callbacks/timeouts are never replayed.
    return flow;
  }
  async json(url, options = {}) {
    let response;
    try {
      response = await this.fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { accept: 'application/json', ...options.headers } });
      if (response.status !== 200 || !(response.headers.get('content-type') || '').includes('application/json'))
        throw new Error('Invalid provider response');
      const result = JSON.parse(await readLimitedText(response, 200_000));
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid provider data');
      return result;
    } catch { throw new SocialLoginError(502, 'Dostawca nie potwierdził logowania. Rozpocznij je ponownie.'); }
    finally { await response?.body?.cancel().catch(() => {}); }
  }
  async keySet(id, force = false) {
    const old = this.keys.get(id);
    if (old && ((!force && Date.now() - old.at < 15 * 60_000) || (force && Date.now() - old.at < 60_000))) return old.value;
    if (this.pendingKeys.has(id)) return this.pendingKeys.get(id);
    const run = (async () => {
      const data = await this.json(this.providers[id].jwks);
      if (!Array.isArray(data.keys) || !data.keys.length || data.keys.length > 50) throw new SocialLoginError(502, 'Nieprawidłowe klucze dostawcy.');
      const value = createLocalJWKSet(data); this.keys.set(id, { value, at: Date.now() }); return value;
    })();
    this.pendingKeys.set(id, run);
    try { return await run; } finally { this.pendingKeys.delete(id); }
  }
  async verify(id, flow, code) {
    if (typeof code !== 'string' || !code || code.length > 4096 || /[\x00-\x1f\x7f]/.test(code)) throw new SocialLoginError(400, 'Nieprawidłowy kod logowania.');
    const p = this.providers[id];
    const data = await this.json(p.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: p.clientId, client_secret: p.clientSecret,
        redirect_uri: flow.redirectUri, code, code_verifier: flow.verifier }) });
    try {
      if (typeof data.id_token !== 'string' || data.id_token.length > 32_000) throw new Error();
      const header = decodeProtectedHeader(data.id_token);
      if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid || header.kid.length > 256 || header.jku || header.x5u || header.jwk) throw new Error();
      const options = { issuer: p.issuers, audience: p.clientId, algorithms: ['RS256'], clockTolerance: 5, maxTokenAge: '10m',
        requiredClaims: ['iss', 'sub', 'aud', 'iat', 'exp', 'nonce'] };
      let verified;
      try { verified = await jwtVerify(data.id_token, await this.keySet(id), options); }
      catch (error) {
        if (error.code !== 'ERR_JWKS_NO_MATCHING_KEY') throw error;
        verified = await jwtVerify(data.id_token, await this.keySet(id, true), options);
      }
      const claims = verified.payload;
      if (!equal(claims.nonce, flow.nonce) || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 256 || /[\x00-\x1f\x7f]/.test(claims.sub) ||
          (claims.azp !== undefined && claims.azp !== p.clientId) || (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== p.clientId) ||
          (id === 'microsoft' && claims.tid?.toLowerCase() !== p.tenant.toLowerCase())) throw new Error();
      // Email/name/roles are not identity keys and never select, merge, create or elevate local accounts.
      return { provider: id, issuer: p.issuer, subject: claims.sub };
    } catch (error) {
      if (error instanceof SocialLoginError) throw error;
      throw new SocialLoginError(403, 'Nieprawidłowe potwierdzenie tożsamości dostawcy.');
    }
  }
  clear() { this.flows.clear(); this.keys.clear(); this.pendingKeys.clear(); }
}
