import { describe, expect, it } from "vitest";
import { parseNews, publicLink } from "./news.js";

const page = (body: string) =>
  `<main id="layout-main-content"><div class="usos-ui"><div class="wrtext">ostatnia modyfikacja: 34 dni temu</div>${body}</div></main>`;

describe("public news parser", () => {
  it("splits notices on separators, preserves paragraphs and ignores page metadata", () => {
    const result = parseNews(
      page(
        "<hr><p><strong>Pierwszy komunikat</strong><br>Treść pierwsza.</p><hr><p>Drugi komunikat</p><p>Treść druga.</p>",
      ),
    );
    expect(result.articles).toHaveLength(2);
    expect(result.articles[0]?.title).toBe("Pierwszy komunikat");
    expect(result.articles[0]?.paragraphs).toEqual([
      "Pierwszy komunikat\nTreść pierwsza.",
    ]);
    expect(JSON.stringify(result)).not.toContain("34 dni");
  });
  it("returns stable identifiers derived from notice content", () => {
    const html = page("<p>Komunikat</p>");
    expect(parseNews(html).articles[0]?.id).toBe(
      parseNews(html).articles[0]?.id,
    );
  });
  it("preserves lists and safe attachment links without returning raw HTML", () => {
    const news = parseNews(
      page(
        '<h2>Tytuł</h2><ul><li>Pierwszy punkt</li><li>Drugi punkt</li></ul><p><a href="/plik.pdf">Pobierz PDF</a><a href="/plik.pdf">Duplikat</a></p>',
      ),
    );
    expect(news.articles[0]?.paragraphs).toContain("• Pierwszy punkt");
    expect(news.articles[0]?.links).toEqual([
      { label: "Pobierz PDF", url: "https://usosweb.ideis.pl/plik.pdf" },
    ]);
    expect(JSON.stringify(news)).not.toContain("<a");
  });
  it("drops executable content, forms and dangerous links", () => {
    const result = parseNews(
      page(
        '<p>Treść<img src=x onerror=alert(1)><a href="javascript:alert(1)">link</a></p><script>alert(2)</script><iframe src="https://example.com"></iframe><form>Formularz</form>',
      ),
    );
    expect(result.articles[0]?.links).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/onerror|alert\(2\)|Formularz/);
  });
  it("rejects changed templates rather than presenting false empty data", () => {
    expect(() => parseNews("<main>Inna struktura</main>")).toThrow(
      "skalibrowany",
    );
  });
  it("handles an explicitly empty content container", () => {
    expect(parseNews(page("")).articles).toEqual([]);
  });
  it.each([
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///tmp/test",
    "https://user:pass@example.com",
    "/cdn-cgi/l/email-protection",
  ])("rejects unsafe or unusable href %s", (href) => {
    expect(publicLink(href)).toBeNull();
  });
  it("accepts ordinary web, email and telephone links", () => {
    expect(publicLink("mailto:public@example.com")).toBe(
      "mailto:public@example.com",
    );
    expect(publicLink("tel:+48123456789")).toBe("tel:+48123456789");
    expect(publicLink("https://example.com/document.pdf")).toBe(
      "https://example.com/document.pdf",
    );
  });
});
