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
  async login(input) {
    const username = usernameOf(input.username);
    const password = passwordOf(input.password);
    const user = this.db
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
  async securityAction(user, input, action) {
    // A valid app cookie alone is insufficient for credential operations.
    await this.login({ username: user.username, password: input.currentPassword });
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
  async recover(input) {
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
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const used = this.db.prepare('UPDATE account_security SET recovery_hash=NULL,disabled=0,version=version+1 WHERE user_id=? AND recovery_hash=?').run(user.id, security.recovery_hash);
      if (used.changes !== 1) throw new AccountError(401,'Kod został już wykorzystany.');
      this.db.prepare('UPDATE users SET salt=?,hash=? WHERE id=?').run(salt,hash,user.id);
      this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
    return publicUser(user);
  }
  close() {
    this.db.close();
  }
}
