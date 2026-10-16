import { TrackCatalog, studyHints, trackSelection } from '../server/usos/timetable-selection.mjs';
import { readLimitedText } from "../server/usos/transport.mjs";
import { tsImport } from "tsx/esm/api";
import { accountId } from "./browser.mjs";
import { load } from "cheerio";
import { WorkflowConnection, workflowUrl, WorkflowError } from './workflows.mjs';
import { personalizePlan, planScope, groupOptions, validateChoices, PlanPreferenceError } from './personal-plan.mjs';
import { discoverStudentServices } from './student-services.mjs';

export function exportCalendarUrl(html, expectedAccount) {
  const fields = load(html)("#plan_export_link");
  if (fields.length !== 1)
    throw new DashboardError(
      502,
      "USOS nie zwrócił jednoznacznego linku eksportu.",
    );
  const value = fields.attr("value");
  if (!value || value.length > 3000)
    throw new DashboardError(502, "Brak poprawnego linku eksportu.");
  return calendarUrl(value, expectedAccount);
}

const { parseStudent } = await tsImport(
  "../server/usos/scrape/student.ts",
  import.meta.url,
);
const { parseDisplayName, parseEmail } = await tsImport(
  "../server/usos/scrape/profile.ts",
  import.meta.url,
);
const { parseGrades } = await tsImport(
  "../server/usos/scrape/grades.ts",
  import.meta.url,
);
const { parseStages } = await tsImport(
  "../server/usos/scrape/stages.ts",
  import.meta.url,
);
const { parseAccountSection, parseDirectory } = await tsImport(
  "../server/usos/scrape/sections.ts",
  import.meta.url,
);
const { ACCOUNT_SECTIONS } = await tsImport(
  "../shared/sections.ts",
  import.meta.url,
);
const { parseNews } = await tsImport(
  "../server/usos/scrape/news.ts",
  import.meta.url,
);
const { parseTerms } = await tsImport(
  "../server/usos/public-repository.ts",
  import.meta.url,
);
const { parseIcal: decodeIcal } = await tsImport("../server/usos/ical.ts", import.meta.url);

function parseIcal(body) {
  try { return decodeIcal(body); }
  catch { throw new DashboardError(502, 'Nieprawidłowy lub nieobsługiwany kalendarz. Eksport musi zawierać pojedyncze wystąpienia zajęć, bez reguł cyklicznych.'); }
}

export class DashboardError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Round-robin across owners; a noisy connection cannot fill the entire queue.
export function createScheduler(interval = 1200) {
  const queues = new Map();
  let running = false, last = 0, count = 0;
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (queues.size) {
        const [owner, jobs] = queues.entries().next().value;
        const job = jobs.shift();
        queues.delete(owner);
        if (jobs.length) queues.set(owner, jobs);
        count--;
        clearTimeout(job.timer);
        job.signal?.removeEventListener('abort', job.cancel);
        try {
          job.signal?.throwIfAborted();
          const wait = interval - (Date.now() - last);
          if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
          job.signal?.throwIfAborted();
          job.resolve(await job.run());
        } catch (error) { job.reject(error); }
        finally { last = Date.now(); }
      }
    } finally { running = false; }
  }
  return function schedule(run, { owner = 'default', signal } = {}) {
    if ((queues.get(owner)?.length || 0) >= 8 || count >= 256)
      throw new DashboardError(429, 'Za dużo zapytań tego konta. Spróbuj ponownie.');
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new DashboardError(401, 'Połączenie zamknięte.'));
      const job = { run, resolve, reject, signal };
      job.cancel = () => {
        const jobs = queues.get(owner);
        const index = jobs?.indexOf(job) ?? -1;
        if (index < 0) return;
        jobs.splice(index, 1); count--;
        if (!jobs.length) queues.delete(owner);
        clearTimeout(job.timer);
        signal?.removeEventListener('abort', job.cancel);
        reject(new DashboardError(503, 'Zapytanie anulowane lub przekroczono czas kolejki.'));
      };
      job.timer = setTimeout(job.cancel, 60_000);
      signal?.addEventListener('abort', job.cancel, { once: true });
      const jobs = queues.get(owner) || [];
      jobs.push(job); queues.set(owner, jobs); count++;
      queueMicrotask(() => void drain());
    });
  };
}

export function calendarUrl(raw, expectedAccount) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new DashboardError(400, "Nieprawidłowy link iCal.");
  }
  if (
    url.origin !== "https://usosapps.ideis.pl" ||
    url.pathname.replace(/\/$/, "") !== "/services/tt/upcoming_ical" ||
    url.username ||
    url.password ||
    url.hash ||
    url.searchParams.getAll("user_id").length !== 1 ||
    url.searchParams.get("user_id") !== expectedAccount ||
    !url.searchParams.get("key") ||
    url.searchParams.getAll("key").length !== 1 ||
    [...url.searchParams.keys()].some(
      (key) => !["user_id", "key", "lang"].includes(key),
    )
  ) {
    throw new DashboardError(
      400,
      "Wklej link eksportu iCal USOS tej uczelni i tego samego konta.",
    );
  }
  return url.href;
}

const envelope = (data, source = "live", at = Date.now()) => ({
  ok: true,
  data,
  error: null,
  meta: { source, fetchedAt: new Date(at).toISOString(), stale: false },
});

/** Lifetime and all caches belong to one verified worker, never the app/global .cache. */
export class DashboardConnection {
  constructor(
    worker,
    { schedule = createScheduler(), fetchPublic = fetch, ttl = 60_000, timetable = null, trackCatalog = null, planPreferences = null } = {},
  ) {
    this.worker = worker;
    const preferences = new Map();
    this.planPreferences = planPreferences || { get: scope => preferences.get(scope) || {}, set: (scope, value) => preferences.set(scope, value) };
    this.timetable = timetable;
    this.trackCatalog = trackCatalog ?? (timetable ? new TrackCatalog(timetable) : null);
    this.controller = new AbortController();
    const owner = Symbol('connection');
    this.schedule = run => schedule(run, { owner, signal: this.controller.signal });
    this.fetchPublic = fetchPublic;
    this.ttl = ttl;
    this.cache = new Map();
    this.pending = new Map();
    this.closed = false;
    this.ical = null;
    this.calendarState = "not_connected";
    this.autoPending = null;
    this.lastAutoAttempt = 0;
    this.workflows = new WorkflowConnection(this);
  }
  assertConnected() {
    if (
      this.closed ||
      this.worker.state !== "connected" ||
      !this.worker.api ||
      !this.worker.expectedAccount
    ) {
      this.cache.clear();
      this.workflows?.clear();
      throw new DashboardError(
        401,
        "Sesja wygasła. Połącz USOS ponownie na stronie logowania.",
      );
    }
  }
  close() {
    this.closed = true;
    this.controller.abort();
    this.ical = null;
    this.cache.clear();
    this.pending.clear();
    this.workflows.clear();
    this.calendarState = "not_connected";
  }
  async connectCalendarAutomatically() {
    this.assertConnected();
    if (this.ical) return true;
    if (this.autoPending) return this.autoPending;
    if (Date.now() - this.lastAutoAttempt < 30_000)
      throw new DashboardError(
        429,
        "Odczekaj 30 sekund przed ponownym pobraniem kalendarza.",
      );
    this.lastAutoAttempt = Date.now();
    this.calendarState = "connecting";
    const run = (async () => {
      try {
        // Revalidate account using a full page. The export endpoint intentionally
        // returns only an HTML fragment and has no JSGLOBALS user_id marker.
        await this.privatePage("home/index");
        const link = await this.schedule(async () => {
          this.assertConnected();
          const url =
            "https://usosweb.ideis.pl/kontroler.php?_action=home/eksportujPlan";
          this.worker.record("GET", url);
          let response;
          try {
            response = await this.worker.api.get(url, { maxRedirects: 0, maxBytes: 100_000, signal: this.controller.signal });
            const html = await response.text();
            this.assertConnected();
            if (
              [301, 302, 303, 307, 308, 401, 403].includes(response.status()) ||
              /\buser_id\s*:\s*null/.test(html) ||
              (accountId(html) &&
                accountId(html) !== this.worker.expectedAccount)
            ) {
              this.worker.state = "expired";
              this.close();
              await this.worker.api.dispose();
              this.worker.api = null;
              throw new DashboardError(
                401,
                "Sesja USOS wygasła. Zaloguj się ponownie.",
              );
            }
            if (response.status() !== 200 || html.length > 100_000)
              throw new DashboardError(
                502,
                "Eksport kalendarza nie odpowiedział poprawnie.",
              );
            return exportCalendarUrl(html, this.worker.expectedAccount);
          } finally {
            await response?.dispose().catch(() => {});
          }
        });
        await this.setCalendar(link);
        return true;
      } catch (error) {
        if (
          this.closed ||
          this.worker.state !== "connected" ||
          (error instanceof DashboardError && error.status === 401)
        )
          throw error;
        // Never expose upstream exception strings, HTML, or the credential URL.
        this.calendarState = "error";
        return false;
      }
    })();
    this.autoPending = run;
    try {
      return await run;
    } finally {
      this.autoPending = null;
    }
  }
  async privatePage(action, params = {}) {
    const url = new URL("https://usosweb.ideis.pl/kontroler.php");
    url.search = new URLSearchParams({ _action: action, ...params }).toString();
    return this.privatePageUrl(url.href);
  }
  async privatePageUrl(raw, { method = 'GET', body, mutation = false, includeUrl = false, beforeRequest } = {}) {
    return this.schedule(async () => {
      this.assertConnected();
      let url = new URL(raw);
      if (url.origin !== 'https://usosweb.ideis.pl' || url.pathname !== '/kontroler.php' || url.username || url.password)
        throw new WorkflowError(400, 'Nieprawidłowy adres źródła.');
      beforeRequest?.();
      this.worker.record(method, url.href);
      let response;
      try {
        response = await this.worker.api[method === 'POST' ? 'post' : 'get'](url.href, { body, maxRedirects: 0, signal: this.controller.signal });
        // Post/Redirect/Get stays within a read-only, fixed-origin destination.
        if (mutation && [302, 303].includes(response.status())) {
          const location = response.headers?.().location;
          if (!location) throw new WorkflowError(502, 'Sprawdź status sprawy — odpowiedź operacji jest niejednoznaczna.');
          url = workflowUrl(location, url.href);
          await response.dispose();
          response = await this.worker.api.get(url.href, { maxRedirects: 0, signal: this.controller.signal });
        }
        const html = await response.text();
        this.assertConnected();
        if (
          [301, 302, 303, 307, 308, 401, 403].includes(response.status()) ||
          (response.status() === 200 &&
            accountId(html) !== this.worker.expectedAccount)
        ) {
          this.worker.state = "expired";
          this.close();
          await this.worker.api.dispose();
          this.worker.api = null;
          throw new DashboardError(
            401,
            "Sesja USOS wygasła lub konto się zmieniło. Zaloguj się ponownie.",
          );
        }
        if (response.status() !== 200)
          throw new DashboardError(502, "USOS nie zwrócił danych tej strony.");
        if (html.length > 2_000_000)
          throw new DashboardError(502, "Odpowiedź USOS jest zbyt duża.");
        return includeUrl ? { html, url: url.href } : html;
      } finally {
        await response?.dispose().catch(() => {});
      }
    });
  }
  async publicBody(url) {
    return this.schedule(async () => {
      this.assertConnected();
      this.worker.record("GET", url);
      const response = await this.fetchPublic(url, {
        redirect: "error",
        signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(15_000)]),
      });
      if (!response.ok)
        throw new DashboardError(
          502,
          "Źródło uczelni nie odpowiedziało poprawnie.",
        );
      const body = await readLimitedText(response);
      this.assertConnected();
      if (body.length > 2_000_000)
        throw new DashboardError(502, "Odpowiedź uczelni jest zbyt duża.");
      return body;
    });
  }
  async cached(key, load) {
    this.assertConnected();
    const old = this.cache.get(key);
    if (old && Date.now() - old.at < this.ttl)
      return envelope(old.value, "cache", old.at);
    if (this.pending.has(key)) return this.pending.get(key);
    const run = (async () => {
      const value = await load();
      this.assertConnected();
      if (this.cache.size >= 64)
        this.cache.delete(this.cache.keys().next().value);
      const at = Date.now();
      this.cache.set(key, { value, at });
      return envelope(value, "live", at);
    })();
    this.pending.set(key, run);
    try {
      return await run;
    } finally {
      if (this.pending.get(key) === run) this.pending.delete(key);
    }
  }
  async setCalendar(raw) {
    this.assertConnected();
    if (typeof raw !== "string" || raw.length > 3000)
      throw new DashboardError(400, "Nieprawidłowy link iCal.");
    const url = calendarUrl(raw.trim(), this.worker.expectedAccount);
    const body = await this.publicBody(url);
    if (!body.includes("BEGIN:VCALENDAR"))
      throw new DashboardError(502, "Źródło nie zwróciło kalendarza iCal.");
    const plan = parseIcal(body);
    this.assertConnected();
    this.ical = url;
    this.calendarState = "connected";
    this.cache.delete("home");
    this.cache.set("plan", { value: plan, at: Date.now() });
    return { calendarConfigured: true };
  }
  async student() {
    return this.cached("student", async () => {
      const base = parseStudent(await this.privatePage("home/index"));
      if (!base.id || base.id !== this.worker.expectedAccount)
        throw new DashboardError(
          502,
          "Profil nie pasuje do podłączonego konta.",
        );
      try {
        const html = await this.privatePage("katalog2/osoby/pokazOsobe", {
          os_id: base.id,
        });
        return {
          ...base,
          displayName: parseDisplayName(html),
          email: parseEmail(html),
        };
      } catch (error) {
        if (error instanceof DashboardError && error.status === 401)
          throw error;
        return base;
      }
    });
  }
  stages() {
    return this.cached("stages", async () => parseStages(await this.privatePage("dla_stud/studia/zaliczenia/index")));
  }
  async rawPlan(requestedId) {
    this.assertConnected();
    if (this.timetable) {
      const selection = await this.cached("timetable-selection", async () => {
        const stages = await this.stages();
        return this.trackCatalog.candidates(studyHints(stages.data));
      });
      const choice = trackSelection(selection.data, requestedId);
      if (!choice.trackId) return envelope({ from: "", to: "", entries: [], selection: choice });
      const result = await this.timetable.get(choice.trackId);
      this.assertConnected();
      return { ...result, data: { ...result.data, selection: choice } };
    }
    return this.cached("plan", async () => {
      if (!this.ical)
        throw new DashboardError(
          409,
          "Plan niepodłączony dla tego konta. Na stronie logowania dodaj swój link iCal. Brak połączenia nie oznacza pustego planu.",
        );
      const body = await this.publicBody(this.ical);
      if (!body.includes("BEGIN:VCALENDAR"))
        throw new DashboardError(502, "Źródło nie zwróciło kalendarza iCal.");
      return parseIcal(body);
    });
  }
  async plan(requestedId) {
    const result = await this.rawPlan(requestedId);
    this.assertConnected();
    if (!result.data.from || !result.data.to) return result;
    const scope = planScope(result.data, this.worker.expectedAccount);
    return { ...result, data: personalizePlan(result.data, this.worker.expectedAccount, this.planPreferences.get(scope)) };
  }
  async setPlanGroups(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        Object.keys(input).some(key => !['trackId', 'scope', 'choices'].includes(key)) ||
        (input.trackId !== undefined && (typeof input.trackId !== 'string' || !/^[1-9]\d{0,5}$/.test(input.trackId))))
      throw new PlanPreferenceError(400, 'Nieprawidłowy wybór planu.');
    await this.privatePage('home/index');
    const result = await this.rawPlan(input.trackId);
    this.assertConnected();
    const scope = planScope(result.data, this.worker.expectedAccount);
    if (!result.data.from || !result.data.to || input.scope !== scope)
      throw new PlanPreferenceError(409, 'Zakres planu zmienił się. Odśwież plan przed zapisaniem grup.');
    const choices = validateChoices(input.choices, groupOptions(result.data.entries));
    this.planPreferences.set(scope, choices);
    return { ...result, data: personalizePlan(result.data, this.worker.expectedAccount, choices) };
  }
  async handle(url) {
    this.assertConnected();
    const path = url.pathname;
    if (path === '/api/student-services') {
      const html = await this.privatePage('dla_stud/index');
      return envelope(discoverStudentServices(html, this.workflows, 'https://usosweb.ideis.pl/kontroler.php?_action=dla_stud/index'));
    }
    if (path === '/api/workflows') {
      if ([...url.searchParams.keys()].some(key => !['entry', 'target', 'refresh'].includes(key)) ||
          [...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length !== 1) ||
          (url.searchParams.has('refresh') && !['0', '1'].includes(url.searchParams.get('refresh'))))
        throw new WorkflowError(400, 'Nieprawidłowy wybór sprawy.');
      const target = url.searchParams.get('target'), refresh = url.searchParams.get('refresh') === '1';
      const page = await this.workflows.open({ entry: url.searchParams.get('entry'), target, refresh });
      const cachedAt = target && !refresh && this.workflows.targets.get(target)?.resultAt;
      return envelope(page, cachedAt ? 'cache' : 'live', cachedAt || Date.now());
    }
    if (path === "/api/session")
      return {
        loggedIn: true,
        userId: this.worker.expectedAccount,
        mode: "live",
      };
    if (path === "/api/student") return this.student();
    if (path === "/api/plan") return this.plan(url.searchParams.get("trackId") ?? undefined);
    if (path === "/api/home") {
      const [student, plan] = await Promise.all([this.student(), this.plan(url.searchParams.get("trackId") ?? undefined)]);
      const now = new Date();
      return envelope({
        greeting: student.data.displayName?.split(" ")[0] ?? null,
        timetableSelection: plan.data.selection,
        personalPlan: plan.data.personal && { state: plan.data.personal.state, message: plan.data.personal.message },
        nextClass:
          plan.data.entries.find((entry) => new Date(entry.start) > now) ??
          null,
        todayCount: plan.data.entries.filter(
          (entry) =>
            new Date(entry.start).toLocaleDateString("en-CA", { timeZone: "Europe/Warsaw" }) === now.toLocaleDateString("en-CA", { timeZone: "Europe/Warsaw" }),
        ).length,
        announcements: [],
        announcementsState: "not_connected",
      });
    }
    if (path === "/api/grades")
      return this.cached("grades", async () =>
        parseGrades(await this.privatePage("dla_stud/studia/oceny/index")),
      );
    if (path === "/api/stages")
      return this.stages();
    if (path.startsWith("/api/sections/")) {
      const id = path.slice("/api/sections/".length);
      if (!Object.hasOwn(ACCOUNT_SECTIONS, id))
        throw new DashboardError(404, "Nieznana sekcja.");
      return this.cached(`section:${id}`, async () => {
        const html = await this.privatePage(ACCOUNT_SECTIONS[id].action);
        return this.workflows.decorate(parseAccountSection(html, id), html,
          `https://usosweb.ideis.pl/kontroler.php?_action=${ACCOUNT_SECTIONS[id].action}`);
      });
    }
    if (path === "/api/directory") {
      const query = (url.searchParams.get("q") || "").trim(),
        kind = url.searchParams.get("kind") || "people";
      if (
        query.length < 2 ||
        query.length > 80 ||
        !["people", "faculties"].includes(kind)
      )
        throw new DashboardError(
          400,
          "Wpisz 2–80 znaków i poprawny typ katalogu.",
        );
      return this.cached(`directory:${kind}:${query}`, async () => {
        const html = await this.privatePage(
            kind === "people"
              ? "katalog2/osoby/szukajOsoby"
              : "katalog2/jednostki/szukajJednostki",
            { _pattern: query },
          );
        const data = parseDirectory(html, query, kind);
        return this.workflows.decorate(data, html, data.sourceUrl);
      });
    }
    if (path === "/api/news")
      return this.cached("news", async () => {
        const url = 'https://usosweb.ideis.pl/kontroler.php?_action=news/default';
        const html = await this.publicBody(url);
        return this.workflows.decorate(parseNews(html), html, url);
      });
    if (path === "/api/terms")
      return this.cached("terms", async () => {
        const today = new Date(),
          year =
            today.getMonth() >= 9
              ? today.getFullYear()
              : today.getFullYear() - 1;
        return parseTerms(
          JSON.parse(
            await this.publicBody(
              `https://usosapps.ideis.pl/services/terms/search?min_finish_date=${year}-10-01&max_start_date=${year + 2}-09-30`,
            ),
          ),
        );
      });
    throw new DashboardError(404, "Nieznana strona API.");
  }
}
