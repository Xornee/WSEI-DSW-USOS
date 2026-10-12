import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicUniversityRepository, parseTerms } from "./public-repository.js";
import { readCache, writeCache } from "./cache.js";
vi.mock("./cache.js", () => ({
  readCache: vi.fn(),
  writeCache: vi.fn(),
  isFresh: (storedAt: number, ttl: number) =>
    Date.now() - storedAt < ttl * 1000,
}));
const term = {
  id: "2026/27Z",
  name: { pl: "Semestr zimowy" },
  start_date: "2026-10-01",
  end_date: "2027-02-20",
  finish_date: "2027-02-28",
};
const page =
  '<main id="layout-main-content"><div class="usos-ui"><p>Komunikat testowy</p></div></main>';
beforeEach(() => {
  vi.mocked(readCache).mockResolvedValue(null);
  vi.mocked(writeCache).mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("academic terms", () => {
  it("keeps classes end separate from term finish", () => {
    expect(parseTerms([term]).terms[0]).toEqual({
      id: "2026/27Z",
      name: "Semestr zimowy",
      startDate: "2026-10-01",
      classesEndDate: "2027-02-20",
      finishDate: "2027-02-28",
    });
  });
  it("returns empty results honestly", () =>
    expect(parseTerms([]).terms).toEqual([]));
  it.each([null, {}, [{ id: "x" }], [{ ...term, start_date: "invalid" }]])(
    "rejects malformed upstream data",
    (value) => expect(() => parseTerms(value)).toThrow(),
  );
});

describe("public repository", () => {
  it("coalesces concurrent reads and never sends session credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(page));
    vi.stubGlobal("fetch", fetcher);
    const repo = new PublicUniversityRepository();
    const [first, second] = await Promise.all([repo.news(), repo.news()]);
    expect(first).toEqual(second);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const options = fetcher.mock.calls[0]![1];
    expect(options.headers).not.toHaveProperty("cookie");
    expect(options.headers).not.toHaveProperty("authorization");
    expect(first.meta.source).toBe("live");
    expect(writeCache).toHaveBeenCalledOnce();
  });
  it("serves a fresh cache without making a network request", async () => {
    vi.mocked(readCache).mockResolvedValue({
      value: { articles: [], sourceUrl: "test" },
      storedAt: Date.now(),
    });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect((await new PublicUniversityRepository().news()).meta).toMatchObject({
      source: "cache",
      stale: false,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("marks stale data when upstream is unavailable", async () => {
    vi.mocked(readCache).mockResolvedValue({
      value: { articles: [], sourceUrl: "test" },
      storedAt: 0,
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    expect((await new PublicUniversityRepository().news()).meta).toMatchObject({
      source: "cache",
      stale: true,
    });
  });
  it("surfaces failures without fabricated news when no cache exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("bad", { status: 503 })),
    );
    await expect(new PublicUniversityRepository().news()).rejects.toThrow(
      "HTTP 503",
    );
  });
  it("requests only the known public terms endpoint with bounded year dates", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify([term])));
    vi.stubGlobal("fetch", fetcher);
    const result = await new PublicUniversityRepository().terms();
    expect(new URL(fetcher.mock.calls[0]![0]).origin).toBe(
      "https://usosapps.ideis.pl",
    );
    expect(result.value.terms).toHaveLength(1);
  });
});
