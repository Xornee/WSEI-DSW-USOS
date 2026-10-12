import { createHash } from "node:crypto";
import {
  ACCOUNT_SECTIONS,
  type AccountSection,
  type AccountSectionId,
  type DirectoryResult,
} from "../../shared/sections.js";
import { isFresh } from "./cache.js";
import type { UsosClient } from "./client.js";
import type { Result } from "./repository.js";
import { parseAccountSection, parseDirectory } from "./scrape/sections.js";

export class AccountSectionsRepository {
  private readonly pending = new Map<string, Promise<Result<AccountSection>>>();
  private readonly searches = new Map<
    string,
    { value: Result<DirectoryResult>; at: number }
  >();
  constructor(
    private readonly client: UsosClient,
    private readonly ttl = 900,
  ) {}
  section(id: AccountSectionId): Promise<Result<AccountSection>> {
    const pending = this.pending.get(id);
    if (pending) return pending;
    const run = this.loadSection(id);
    this.pending.set(id, run);
    void run.finally(() => this.pending.delete(id)).catch(() => undefined);
    return run;
  }
  private async loadSection(
    id: AccountSectionId,
  ): Promise<Result<AccountSection>> {
    if (!this.client.configured)
      return {
        value: demoSection(id),
        meta: {
          source: "mock",
          stale: false,
          fetchedAt: new Date().toISOString(),
        },
      };
    const value = parseAccountSection(await this.client.fetchAction(ACCOUNT_SECTIONS[id].action), id);
    return { value, meta: { source: 'live', stale: false, fetchedAt: new Date().toISOString() } };
  }
  async directory(
    query: string,
    kind: DirectoryResult["kind"],
  ): Promise<Result<DirectoryResult>> {
    if (!this.client.configured)
      return {
        value: {
          query,
          kind,
          tables: [],
          messages: ["Wyszukiwarka katalogu wymaga podłączenia sesji USOSweb."],
          sourceUrl:
            "https://usosweb.ideis.pl/kontroler.php?_action=katalog2/index",
          moreAvailable: false,
        },
        meta: {
          source: "mock",
          stale: false,
          fetchedAt: new Date().toISOString(),
        },
      };
    const key = createHash("sha256").update(`${kind}:${query}`).digest("hex");
    const cached = this.searches.get(key);
    if (cached && isFresh(cached.at, this.ttl))
      return {
        ...cached.value,
        meta: { ...cached.value.meta, source: "cache" },
      };
    const action =
      kind === "people"
        ? "katalog2/osoby/szukajOsoby"
        : "katalog2/jednostki/szukajJednostki";
    const html = await this.client.fetchAction(action, { _pattern: query });
    const result: Result<DirectoryResult> = {
      value: parseDirectory(html, query, kind),
      meta: {
        source: "live",
        stale: false,
        fetchedAt: new Date().toISOString(),
      },
    };
    if (this.searches.size >= 40)
      this.searches.delete(this.searches.keys().next().value!);
    this.searches.set(key, { value: result, at: Date.now() });
    return result;
  }
}

export function demoSection(id: AccountSectionId): AccountSection {
  return {
    id,
    title: ACCOUNT_SECTIONS[id].title,
    sourceUrl: `https://usosweb.ideis.pl/kontroler.php?_action=${ACCOUNT_SECTIONS[id].action}`,
    state: "empty",
    messages: [
      "Wersja demonstracyjna — brak przykładowych pozycji w tej sekcji.",
    ],
    tables: [],
    records: [],
    links: [],
    dues: [],
  };
}
