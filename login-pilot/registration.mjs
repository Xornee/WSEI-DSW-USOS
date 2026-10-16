import { createHash, timingSafeEqual } from 'node:crypto';
import { AccountError } from './accounts.mjs';

/** A server-side admission gate, including the very first account. Never exposed to clients. */
export function registrationGate(code = '') {
  if (typeof code !== 'string' || (code && (Buffer.byteLength(code) < 16 || Buffer.byteLength(code) > 256 || /[\x00-\x1f\x7f]/.test(code))))
    throw new Error('Invalid registration code configuration');
  const digest = code ? createHash('sha256').update(code).digest() : null;
  return {
    enabled: Boolean(digest),
    require(value) {
      if (!digest) throw new AccountError(503, 'Rejestracja jest zamknięta. Administrator musi ustawić kod rejestracji.');
      if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 256 ||
          !timingSafeEqual(createHash('sha256').update(value).digest(), digest))
        throw new AccountError(403, 'Wymagany poprawny kod rejestracji od administratora.');
    },
  };
}
