import { describe, expect, it } from "vitest";
import {
  moneyValue,
  navigationLink,
  normalizedDate,
  parseAccountSection,
  parseDirectory,
} from "./sections.js";
const page = (body: string) =>
  `<main id="layout-main-content"><div class="usos-ui">${body}</div></main>`;
const payment =
  '<table><thead><tr><th></th><th>Termin płatności</th><th>Opis</th><th>Razem</th></tr></thead><tbody><tr><td></td><td>2026-10-01</td><td>Czesne testowe</td><td>1 234,50 <span class="note">PLN</span></td></tr></tbody><tfoot><tr><th colspan="4">Suma 1 234,50 PLN</th></tr></tfoot></table>';
describe("account section parser", () => {
  it("parses dates and cents without losing currency inside note span", () => {
    const result = parseAccountSection(page(payment), "dues");
    expect(result.state).toBe("ready");
    expect(result.dues).toEqual([
      {
        date: "2026-10-01",
        label: "Czesne testowe",
        amount: "1 234,50 PLN",
        cents: 123450,
        currency: "PLN",
      },
    ]);
    expect(result.tables[0]?.headers).toEqual([
      "Termin płatności",
      "Opis",
      "Razem",
    ]);
    expect(result.tables[0]?.rows).toHaveLength(1);
    expect(result.tables[0]?.footer).toEqual(["Suma 1 234,50 PLN"]);
  });
  it("keeps ambiguous amounts unknown instead of estimating totals", () =>
    expect(
      parseAccountSection(
        page(
          payment.replace(
            '1 234,50 <span class="note">PLN</span>',
            "100 PLN + 5 PLN",
          ),
        ),
        "dues",
      ).dues[0]?.cents,
    ).toBeNull());
  it("does not expose payment dues in unrelated sections", () =>
    expect(parseAccountSection(page(payment), "paid").dues).toEqual([]));
  it("preserves read-only tables inside forms but strips controls and hidden content", () => {
    const result = parseAccountSection(
      page(
        `<form>${payment}<input value="private-token"><button>Wykonaj</button></form><p hidden>secret</p><p class="wrhidden">secret</p><script>secret</script>`,
      ),
      "dues",
    );
    expect(result.tables[0]?.rows).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/private-token|secret|Wykonaj/);
  });
  it.each(["courses", "tests", "applications", "scholarships"] as const)(
    "keeps %s empty when the upstream says so",
    (id) =>
      expect(
        parseAccountSection(page("<p>Nie masz żadnych pozycji.</p>"), id).state,
      ).toBe("empty"),
  );
  it("recognizes header-only registration table as empty", () =>
    expect(
      parseAccountSection(
        page(
          "<p>Kalendarz rejestracji</p><table><tr><th>Stan</th><th>Nazwa</th></tr></table>",
        ),
        "registrations",
      ).state,
    ).toBe("empty"));
  it("preserves informational form descriptions without pretending they are records", () => {
    const result = parseAccountSection(
      page(
        "<p>Informacje o legitymacji</p><form><button>Zamów</button></form>",
      ),
      "card",
    );
    expect(result.state).toBe("information");
    expect(result.records).toEqual([]);
  });
  it("extracts decision records with read-only source links", () => {
    const result = parseAccountSection(
      page(
        '<usos-frame><ul><li><strong>Decyzja testowa</strong><p>Treść decyzji</p><a href="/kontroler.php?_action=dla_stud/studia/decyzje/szczegoly&amp;id=fixture">Szczegóły</a></li></ul></usos-frame>',
      ),
      "decisions",
    );
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.links[0]?.url).toContain("id=fixture");
  });
  it("rejects pages with no calibrated content container", () =>
    expect(() => parseAccountSection("<p>Zaloguj</p>", "dues")).toThrow());
});
describe("values and navigation", () => {
  it.each([
    ["0,00 zł", 0, "PLN"],
    ["-12,34 EUR", -1234, "EUR"],
    ["1\u00a0000.25 USD", 100025, "USD"],
  ])("parses %s", (text, cents, currency) =>
    expect(moneyValue(String(text))).toEqual({ cents, currency }),
  );
  it.each(["abc", "10 PLN + 20 PLN", "12,3 PLN", "9999999999999999999,99 PLN"])(
    "rejects ambiguous value %s",
    (text) => expect(moneyValue(text)).toBeNull(),
  );
  it.each(["2026-02-30", "invalid", "2026-13-01"])(
    "rejects invalid date %s",
    (text) => expect(normalizedDate(text)).toBeNull(),
  );
  it("keeps valid leap dates", () =>
    expect(normalizedDate("Do: 2028-02-29")).toBe("2028-02-29"));
  it.each([
    "javascript:alert(1)",
    "data:text/html,test",
    "https://user:pass@example.com",
    "/kontroler.php?_action=dodatki/mlegitymacja/dodaj",
    "/kontroler.php?_action=logout",
  ])("drops active or unsafe link %s", (href) =>
    expect(navigationLink(href)).toBeNull(),
  );
  it("strips credentials in query strings of source links", () => {
    const url = navigationLink(
      "/kontroler.php?_action=home/index&csrf=fixture&token=fixture&id=1",
    );
    expect(url).not.toMatch(/csrf|token/);
    expect(url).toContain("id=1");
  });
});
describe("directory parser", () => {
  it("retains visually hidden accessible column headings", () => {
    const result = parseDirectory(
      page(
        '<table><thead class="screen-reader-only"><tr><th>Nazwisko</th><th>Imiona</th></tr></thead><tbody><tr><td>Osoba testowa</td><td>Test</td></tr></tbody></table>',
      ),
      "test",
      "people",
    );
    expect(result.tables[0]?.headers).toEqual(["Nazwisko", "Imiona"]);
    expect(result.tables[0]?.rows).toHaveLength(1);
  });
  it("bounds displayed results and preserves query in the source link", () => {
    const result = parseDirectory(
      page(
        `<table><tr><th>Nazwa</th></tr>${"<tr><td>Jednostka testowa</td></tr>".repeat(35)}</table>`,
      ),
      "badanie & test",
      "faculties",
    );
    expect(result.tables[0]?.rows).toHaveLength(30);
    expect(result.moreAvailable).toBe(true);
    expect(new URL(result.sourceUrl).searchParams.get("_pattern")).toBe(
      "badanie & test",
    );
  });
  it("returns explicit empty searches", () =>
    expect(
      parseDirectory(page("<p>Nie znaleziono wyników.</p>"), "test", "people")
        .tables,
    ).toEqual([]));
  it("rejects an unrecognized search result instead of claiming zero matches", () =>
    expect(() =>
      parseDirectory(page("<p>Inny widok</p>"), "test", "people"),
    ).toThrow());
});
