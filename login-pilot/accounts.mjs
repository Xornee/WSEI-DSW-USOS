import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { mkdirSync, chmodSync, openSync, closeSync } from "node:fs";
import { dirname } from "node:path";

const derive = promisify(scrypt);
const COST = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const publicUser = ({ id, username, name, role }) => ({
  id,
  username,
  name,
  role,
});
export class AccountError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function usernameOf(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_.-]{3,40}$/.test(value))
    throw new AccountError(
      400,
      "Login: 3–40 znaków (litery, cyfry, kropka, myślnik).",
    );
  return value.toLowerCase();
}
function passwordOf(value) {
  if (
    typeof value !== "string" ||
    [...value].length < 8 ||
    Buffer.byteLength(value) > 256
  )
    throw new AccountError(
      400,
      "Hasło aplikacji: minimum 8 znaków, maksimum 256 bajtów.",
    );
  return value;
}

function identityOf(identity) {
  if (!identity || !['google','microsoft'].includes(identity.provider) || typeof identity.issuer !== 'string' ||
      !identity.issuer || identity.issuer.length > 512 || typeof identity.subject !== 'string' || !identity.subject ||
      identity.subject.length > 256 || /[\x00-\x1f\x7f]/.test(identity.issuer + identity.subject))
    throw new AccountError(400, 'Nieprawidłowa tożsamość dostawcy.');
  return identity;
}

/** Durable app identities only. USOS cookies, calendar URLs and browser state never enter this store. */
export class AccountStore {
  constructor(path) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const fd = openSync(path, "a", 0o600);
      closeSync(fd);
      chmodSync(path, 0o600);
    }
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin','member')), salt TEXT NOT NULL, hash TEXT NOT NULL
      );`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS account_security (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      version INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 0,
      recovery_hash TEXT
    );`);
    this.dummySalt = randomBytes(16).toString("hex");
    this.db.exec(`CREATE TABLE IF NOT EXISTS plan_preferences (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scope TEXT NOT NULL, choices TEXT NOT NULL,
      PRIMARY KEY(user_id,scope)
    );`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS social_identities (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL CHECK(provider IN ('google','microsoft')), issuer TEXT NOT NULL, subject TEXT NOT NULL,
      PRIMARY KEY(provider,issuer,subject), UNIQUE(user_id,provider)
    );`);
  }
  hasUser(username) { return Boolean(this.db.prepare('SELECT 1 FROM users WHERE username=?').get(username)); }
  socialIdentities(userId) {
    return this.db.prepare('SELECT provider FROM social_identities WHERE user_id=? ORDER BY provider').all(userId).map(row => row.provider);
  }
  linkSocial(userId, identity) {
    identityOf(identity);
    const user = this.db.prepare('SELECT id FROM users WHERE id=?').get(userId);
    if (!user || this.security(userId).disabled) throw new AccountError(401, 'Zaloguj się ponownie.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.db.prepare('SELECT user_id FROM social_identities WHERE provider=? AND issuer=? AND subject=?')
        .get(identity.provider, identity.issuer, identity.subject);
      if (existing && existing.user_id !== userId) throw new AccountError(409, 'Ta tożsamość jest już powiązana z innym kontem.');
      if (this.socialIdentities(userId).includes(identity.provider) && !existing)
        throw new AccountError(409, 'Najpierw odłącz poprzednie konto tego dostawcy.');
      if (!existing) this.db.prepare('INSERT INTO social_identities VALUES (?,?,?,?)').run(userId, identity.provider, identity.issuer, identity.subject);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  loginSocial(identity) {
    identityOf(identity);
    const user = this.db.prepare(`SELECT users.* FROM users JOIN social_identities ON users.id=social_identities.user_id
      WHERE provider=? AND issuer=? AND subject=?`).get(identity.provider, identity.issuer, identity.subject);
    if (!user || this.security(user.id).disabled)
      throw new AccountError(401, 'Najpierw utwórz konto lokalne i powiąż dostawcę w swoim profilu. Zablokowane konto wymaga odzyskania dostępu.');
    return publicUser(user);
  }
  unlinkSocial(userId, provider) { this.db.prepare('DELETE FROM social_identities WHERE user_id=? AND provider=?').run(userId, provider); }
  planPreferences(userId) {
    return {
      get: scope => {
        const row = this.db.prepare('SELECT choices FROM plan_preferences WHERE user_id=? AND scope=?').get(userId, scope);
        return row ? JSON.parse(row.choices) : {};
      },
      set: (scope, choices) => {
        if (!/^[a-f0-9]{64}$/.test(scope) || Buffer.byteLength(JSON.stringify(choices)) > 50_000)
          throw new AccountError(400, 'Nieprawidłowy zakres planu.');
        this.db.prepare(`INSERT INTO plan_preferences VALUES (?,?,?)
          ON CONFLICT(user_id,scope) DO UPDATE SET choices=excluded.choices`).run(userId, scope, JSON.stringify(choices));
        // Bound historical semesters per local account, never touch credential tables.
        this.db.prepare(`DELETE FROM plan_preferences WHERE user_id=? AND rowid NOT IN
          (SELECT rowid FROM plan_preferences WHERE user_id=? ORDER BY rowid DESC LIMIT 24)`).run(userId, userId);
      },
    };
  }
  needsSetup() {
    return this.db.prepare("SELECT count(*) AS n FROM users").get().n === 0;
  }
  async register(input) {
    const username = usernameOf(input.username);
    const password = passwordOf(input.password);
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name))
      throw new AccountError(400, "Podaj nazwę profilu (1–80 znaków).");
    const salt = randomBytes(16).toString("hex");
    const hash = (await derive(password, salt, 64, COST)).toString("hex");
    // Keep unique usernames and first-account role assignment atomic after the async hash.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const first = this.needsSetup();
      if (
        this.db.prepare("SELECT id FROM users WHERE username=?").get(username)
      )
        throw new AccountError(409, "Wybierz inny login.");
      const user = {
        id: randomUUID(),
        username,
        name,
        role: first ? "admin" : "member",
      };
      this.db
        .prepare("INSERT INTO users VALUES (?,?,?,?,?,?)")
        .run(user.id, username, name, user.role, salt, hash);
      this.db.exec("COMMIT");
      return user;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  async login(input, forceFailure = false) {
    const username = usernameOf(input.username);
    let password;
    try { password = passwordOf(input.password); }
    catch { throw new AccountError(401, 'Nieprawidłowy login lub hasło.'); }
    const user = forceFailure ? undefined : this.db
      .prepare("SELECT * FROM users WHERE username=?")
      .get(username);
    const hash = await derive(password, user?.salt || this.dummySalt, 64, COST);
    const expected = user ? Buffer.from(user.hash, "hex") : Buffer.alloc(64);
    if (!timingSafeEqual(hash, expected) || !user || this.security(user.id).disabled)
      throw new AccountError(401, "Nieprawidłowy login lub hasło.");
    return publicUser(user);
  }
  security(id) {
    return this.db.prepare('SELECT version,disabled,recovery_hash FROM account_security WHERE user_id=?').get(id)
      || { version: 0, disabled: 0, recovery_hash: null };
  }
  async securityAction(user, input, action, beforeChange = () => {}) {
    // A valid app cookie alone is insufficient for credential operations.
    await this.login({ username: user.username, password: input.currentPassword });
    beforeChange(user.id);
    if (action === 'recovery-code') {
      const code = randomBytes(32).toString('hex');
      const hash = createHash('sha256').update(code).digest('hex');
      this.db.prepare(`INSERT INTO account_security(user_id,recovery_hash) VALUES (?,?)
        ON CONFLICT(user_id) DO UPDATE SET recovery_hash=excluded.recovery_hash`).run(user.id,hash);
      return { recoveryCode: code };
    }
    if (action === 'password') {
      const password = passwordOf(input.newPassword);
      const salt = randomBytes(16).toString('hex');
      const hash = (await derive(password,salt,64,COST)).toString('hex');
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.prepare('UPDATE users SET salt=?,hash=? WHERE id=?').run(salt,hash,user.id);
        this.bumpVersion(user.id);
        this.db.exec('COMMIT');
      } catch(error) { this.db.exec('ROLLBACK'); throw error; }
    } else if (action === 'lock') {
      if (!this.security(user.id).recovery_hash)
        throw new AccountError(409,'Najpierw utwórz i zachowaj kod odzyskiwania.');
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.bumpVersion(user.id);
        this.db.prepare('UPDATE account_security SET disabled=1 WHERE user_id=?').run(user.id);
        this.db.exec('COMMIT');
      } catch(error) { this.db.exec('ROLLBACK'); throw error; }
    } else if (action === 'revoke') this.bumpVersion(user.id);
    else throw new AccountError(400,'Nieznana operacja konta.');
    return { ok:true };
  }
  bumpVersion(id) {
    this.db.prepare(`INSERT INTO account_security(user_id,version) VALUES (?,1)
      ON CONFLICT(user_id) DO UPDATE SET version=version+1`).run(id);
  }
  async recover(input, beforeChange = () => {}) {
    const username = usernameOf(input.username);
    const password = passwordOf(input.newPassword);
    const user = this.db.prepare('SELECT * FROM users WHERE username=?').get(username);
    const security = user && this.security(user.id);
    const code = typeof input.recoveryCode === 'string' && /^[a-f0-9]{64}$/.test(input.recoveryCode)
      ? input.recoveryCode : '';
    const supplied = createHash('sha256').update(code).digest();
    const expected = security?.recovery_hash ? Buffer.from(security.recovery_hash,'hex') : Buffer.alloc(32);
    if (!timingSafeEqual(supplied,expected) || !code || !user)
      throw new AccountError(401,'Nieprawidłowy login lub kod odzyskiwania.');
    const salt = randomBytes(16).toString('hex');
    const hash = (await derive(password,salt,64,COST)).toString('hex');
    beforeChange(user.id);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const used = this.db.prepare('UPDATE account_security SET recovery_hash=NULL,disabled=0,version=version+1 WHERE user_id=? AND recovery_hash=?').run(user.id, security.recovery_hash);
      if (used.changes !== 1) throw new AccountError(401,'Kod został już wykorzystany.');
      this.db.prepare('UPDATE users SET salt=?,hash=? WHERE id=?').run(salt,hash,user.id);
      // Recovery is a compromise boundary: previously linked providers must be reverified.
      this.db.prepare('DELETE FROM social_identities WHERE user_id=?').run(user.id);
      this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
    return publicUser(user);
  }
  close() {
    this.db.close();
  }
}
