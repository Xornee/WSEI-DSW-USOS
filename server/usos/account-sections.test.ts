import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountSectionsRepository, demoSection } from "./account-sections.js";
import type { UsosClient } from "./client.js";
import { readCache, writeCache } from "./cache.js";
import { isAccountSectionId } from "../../shared/sections.js";
vi.mock("./cache.js", () => ({
  readCache: vi.fn(),
  writeCache: vi.fn(),
  isFresh: (storedAt: number, ttl: number) =>
    Date.now() - storedAt < ttl * 1000,
}));
const html =
  '<main id="layout-main-content"><div class="usos-ui"><p>Nie masz żadnych pozycji.</p></div></main>';
const client = (
  configured = true,
  fetchAction = vi.fn().mockResolvedValue(html),
) => ({ configured, fetchAction }) as unknown as UsosClient;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readCache).mockResolvedValue(null);
  vi.mocked(writeCache).mockResolvedValue(undefined);
});
describe("account repository", () => {
  it("coalesces section requests and uses only the whitelisted source action", async () => {
    const source = client();
    const repo = new AccountSectionsRepository(source);
    const [a, b] = await Promise.all([
      repo.section("dues"),
      repo.section("dues"),
    ]);
    expect(a).toEqual(b);
    expect(source.fetchAction).toHaveBeenCalledOnce();
    expect(source.fetchAction).toHaveBeenCalledWith(
      "dodatki/platnosci/naleznosciNierozliczone",
    );
    expect(a.meta.source).toBe("live");
  });
  it("ignores ownerless disk cache and fetches authenticated data", async () => {
    vi.mocked(readCache).mockResolvedValue({
      value: demoSection("dues"),
      storedAt: Date.now(),
    });
    const source = client();
    expect(
      (await new AccountSectionsRepository(source).section("dues")).meta,
    ).toMatchObject({ source: "live", stale: false });
    expect(source.fetchAction).toHaveBeenCalledOnce();
    expect(readCache).not.toHaveBeenCalled();
    expect(writeCache).not.toHaveBeenCalled();
  });
  it("never serves ownerless data after a source failure", async () => {
    vi.mocked(readCache).mockResolvedValue({
      value: demoSection("dues"),
      storedAt: 0,
    });
    await expect(new AccountSectionsRepository(
      client(true, vi.fn().mockRejectedValue(new Error("offline")))
    ).section("dues")).rejects.toThrow('offline');
    expect(readCache).not.toHaveBeenCalled();
  });
  it("surfaces errors without inventing empty live data", async () =>
    await expect(
      new AccountSectionsRepository(
        client(true, vi.fn().mockRejectedValue(new Error("offline"))),
      ).section("dues"),
    ).rejects.toThrow("offline"));
  it("marks demo sections as mock and does not fetch", async () => {
    const source = client(false);
    const result = await new AccountSectionsRepository(source).section("dues");
    expect(result.meta.source).toBe("mock");
    expect(result.value.dues).toEqual([]);
    expect(source.fetchAction).not.toHaveBeenCalled();
  });
  it("caches directory queries in memory without disk writes", async () => {
    const source = client(
      true,
      vi
        .fn()
        .mockResolvedValue(
          html.replace("Nie masz żadnych pozycji.", "Nie znaleziono wyników."),
        ),
    );
    const repo = new AccountSectionsRepository(source);
    await repo.directory("Test", "people");
    const second = await repo.directory("Test", "people");
    expect(source.fetchAction).toHaveBeenCalledOnce();
    expect(source.fetchAction).toHaveBeenCalledWith(
      "katalog2/osoby/szukajOsoby",
      { _pattern: "Test" },
    );
    expect(second.meta.source).toBe("cache");
    expect(writeCache).not.toHaveBeenCalled();
  });
  it.each(["__proto__", "constructor", "https://example.com", "../private"])(
    "rejects non-section %s",
    (id) => expect(isAccountSectionId(id)).toBe(false),
  );
});
