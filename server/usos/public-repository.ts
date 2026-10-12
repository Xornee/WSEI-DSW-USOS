import { readLimitedText } from "./transport.mjs";
import type {
  AcademicCalendar,
  AcademicTerm,
  UniversityNews,
} from "../../shared/types.js";
import {
  UNIVERSITY_NEWS_URL,
  UNIVERSITY_TERMS_URL,
} from "../../shared/university.js";
import { isFresh, readCache, writeCache } from "./cache.js";
import type { Result } from "./repository.js";
import { parseNews } from "./scrape/news.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseTerms(value: unknown): AcademicCalendar {
  if (!Array.isArray(value))
    throw new Error("Kalendarz uczelni zwrócił nieoczekiwany format danych.");
  const terms: AcademicTerm[] = value.map((term: unknown) => {
    if (!isRecord(term) || typeof term.id !== "string" || !isRecord(term.name))
      throw new Error("Niepełne dane cyklu dydaktycznego.");
    for (const key of ["start_date", "end_date", "finish_date"]) {
      if (
        typeof term[key] !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(term[key]) ||
        (!Number.isFinite(Date.parse(term[key])) || new Date(term[key]).toISOString().slice(0, 10) !== term[key])
      )
        throw new Error("Nieprawidłowa data cyklu dydaktycznego.");
    }
    if (String(term.start_date) > String(term.end_date) || String(term.end_date) > String(term.finish_date))
      throw new Error("Odwrócony zakres cyklu dydaktycznego.");
    const name =
      typeof term.name.pl === "string"
        ? term.name.pl
        : typeof term.name.en === "string"
          ? term.name.en
          : term.id;
    return {
      id: term.id,
      name,
      startDate: term.start_date as string,
      classesEndDate: term.end_date as string,
      finishDate: term.finish_date as string,
    };
  });
  return {
    terms: terms.sort(
      (a, b) =>
        a.startDate.localeCompare(b.startDate) ||
        a.finishDate.localeCompare(b.finishDate),
    ),
    sourceUrl: UNIVERSITY_TERMS_URL,
  };
}

/** Public university sources: no session cookies, no arbitrary target URLs, no account operations. */
export class PublicUniversityRepository {
  private chain: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;
  private readonly pending = new Map<string, Promise<Result<unknown>>>();
  constructor(private readonly ttl = 900) {}

  news(): Promise<Result<UniversityNews>> {
    return this.cached("public-news-v1", async () =>
      parseNews(await this.get(UNIVERSITY_NEWS_URL)),
    );
  }

  terms(): Promise<Result<AcademicCalendar>> {
    const today = new Date();
    const academicYear =
      today.getMonth() >= 9 ? today.getFullYear() : today.getFullYear() - 1;
    const url = new URL(UNIVERSITY_TERMS_URL);
    url.searchParams.set("min_finish_date", `${academicYear}-10-01`);
    url.searchParams.set("max_start_date", `${academicYear + 2}-09-30`);
    return this.cached(`public-terms-${academicYear}`, async () =>
      parseTerms(JSON.parse(await this.get(url.href))),
    );
  }

  private async get(url: string): Promise<string> {
    const run = this.chain.then(async () => {
      const delay = 1200 - (Date.now() - this.lastRequestAt);
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(15000),
          redirect: "error",
          headers: {
            accept: "text/html,application/json",
            "user-agent":
              "usos-local/0.1 (public university information; cached)",
          },
        });
        if (!response.ok)
          throw new Error(
            `Publiczne źródło uczelni zwróciło HTTP ${response.status}.`,
          );
        const body = await readLimitedText(response);
        if (body.length > 2_000_000)
          throw new Error(
            "Odpowiedź źródła uczelni przekracza limit rozmiaru.",
          );
        return body;
      } finally {
        this.lastRequestAt = Date.now();
      }
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  private cached<T>(key: string, load: () => Promise<T>): Promise<Result<T>> {
    const pending = this.pending.get(key);
    if (pending) return pending as Promise<Result<T>>;
    const run = this.loadCached(key, load);
    this.pending.set(key, run);
    void run.finally(() => this.pending.delete(key)).catch(() => undefined);
    return run;
  }

  private async loadCached<T>(
    key: string,
    load: () => Promise<T>,
  ): Promise<Result<T>> {
    const cached = await readCache<T>(key);
    const fromCache = (stale: boolean): Result<T> => ({
      value: cached!.value,
      meta: {
        source: "cache",
        stale,
        fetchedAt: new Date(cached!.storedAt).toISOString(),
      },
    });
    if (cached && isFresh(cached.storedAt, this.ttl)) return fromCache(false);
    try {
      const value = await load();
      await writeCache(key, value);
      return {
        value,
        meta: {
          source: "live",
          stale: false,
          fetchedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      if (cached) return fromCache(true);
      throw error instanceof Error
        ? error
        : new Error("Publiczne źródło uczelni nie odpowiedziało.");
    }
  }
}
