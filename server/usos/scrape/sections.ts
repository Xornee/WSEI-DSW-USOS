import { load, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import {
  ACCOUNT_SECTIONS,
  sectionUrl,
  type AccountSection,
  type AccountSectionId,
  type DirectoryResult,
  type PaymentDue,
  type SourceCell,
  type SourceLink,
  type SourceTable,
} from "../../../shared/sections.js";
import { ParserNotCalibratedError } from "./errors.js";

const clean = (text: string) =>
  text
    .replace(/\u00a0/g, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
const short = (text: string) => clean(text).replace(/\s+/g, " ");

export function navigationLink(href: string): string | null {
  try {
    const url = new URL(href, "https://usosweb.ideis.pl/kontroler.php");
    if (url.username || url.password) return null;
    if (["mailto:", "tel:"].includes(url.protocol)) return url.href;
    if (!["https:", "http:"].includes(url.protocol)) return null;
    if (url.pathname.startsWith("/cdn-cgi/")) return null;
    if (url.hostname === "usosweb.ideis.pl") {
      const action = url.searchParams.get("_action") ?? "";
      if (
        /(?:usun|dodaj|zapisz|wyloguj|logout|unregister|register|delete|accept|potwierdz)/i.test(
          action,
        )
      )
        return null;
      for (const key of [...url.searchParams.keys()])
        if (/token|session|callback|csrf/i.test(key))
          url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return null;
  }
}

function linksOf($: CheerioAPI, element: AnyNode): SourceLink[] {
  const links: SourceLink[] = [];
  $(element)
    .find("a[href],usos-link[href],usos-module-link-tile[href]")
    .addBack("[href]")
    .each((_, a) => {
      const url = navigationLink($(a).attr("href") ?? "");
      const label =
        short($(a).text()) || $(a).attr("title") || "Otwórz szczegóły";
      if (url && !links.some((link) => link.url === url))
        links.push({ label, url });
    });
  return links;
}

function prepare(html: string, screen: string) {
  const $ = load(html);
  const main = $("#layout-main-content > .usos-ui").first();
  if (!main.length) throw new ParserNotCalibratedError(screen);
  main
    .find(
      "script,style,link,iframe,object,embed,dialog,help-dialog,usos-tooltip,input,select,textarea,button,.wrhidden,[hidden]",
    )
    .remove();
  main.find("[style]").each((_, node) => {
    if (/display\s*:\s*none/i.test($(node).attr("style") ?? ""))
      $(node).remove();
  });
  main.find("br").replaceWith("\n");
  return { $, main };
}

export function moneyValue(
  text: string,
): { cents: number; currency: string } | null {
  const match = short(text).match(
    /^(-?\d[\d ]*[,.]\d{2})\s*(PLN|zł|EUR|USD)$/i,
  );
  if (!match) return null;
  const [whole, fraction] = match[1]!
    .replace(/ /g, "")
    .replace(",", ".")
    .split(".");
  const negative = whole!.startsWith("-");
  const cents = Math.abs(Number(whole)) * 100 + Number(fraction);
  return Number.isSafeInteger(cents)
    ? {
        cents: negative ? -cents : cents,
        currency:
          match[2]!.toLowerCase() === "zł" ? "PLN" : match[2]!.toUpperCase(),
      }
    : null;
}

export function normalizedDate(text: string): string | null {
  const value = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)?.[0];
  if (!value) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function parseTables(
  $: CheerioAPI,
  main: ReturnType<CheerioAPI>,
): { tables: SourceTable[]; dues: PaymentDue[] } {
  const tables: SourceTable[] = [];
  const dues: PaymentDue[] = [];
  main
    .find("table")
    .filter((_, t) => $(t).parents("table").length === 0)
    .each((index, table) => {
      const trs = $(table)
        .find("tr")
        .filter((_, tr) => $(tr).closest("table")[0] === table);
      const heading = trs
        .filter((_, tr) => $(tr).children("th").length > 0)
        .first();
      if (!heading.length) return;
      const columns = heading
        .children("th,td")
        .map((_, cell) => short($(cell).text()))
        .get();
      const rows: SourceCell[][] = [];
      const footer: string[] = [];
      const dateIndex = columns.findIndex((label) =>
        /Termin płatności/i.test(label),
      );
      const amountIndex = columns.findIndex((label) => /^Razem$/i.test(label));
      trs.each((_, tr) => {
        if (tr === heading[0]) return;
        const cells = $(tr).children("th,td");
        if (cells.length === 0) return;
        if (
          cells.filter("th").length ||
          cells
            .toArray()
            .some((cell) => Number($(cell).attr("colspan") ?? 1) > 1)
        ) {
          const value = short($(tr).text());
          if (value) footer.push(value);
          return;
        }
        const values = cells
          .toArray()
          .map((cell) => ({
            text: clean($(cell).text()),
            links: linksOf($, cell),
          }));
        if (values.some((cell) => cell.text || cell.links.length))
          rows.push(values);
        if (dateIndex >= 0 && amountIndex >= 0) {
          const amountCell = cells.eq(amountIndex).clone();
          const amount = short(amountCell.text());
          const parsed = moneyValue(amount);
          dues.push({
            date: normalizedDate(cells.eq(dateIndex).text()),
            label:
              values[columns.findIndex((x) => /^Opis$/i.test(x))]?.text ||
              "Należność",
            amount,
            cents: parsed?.cents ?? null,
            currency: parsed?.currency ?? null,
          });
        }
      });
      const width = Math.max(columns.length, ...rows.map((row) => row.length));
      const visible = Array.from({ length: width }, (_, i) => i).filter(
        (i) =>
          columns[i] ||
          rows.some((row) => row[i]?.text || row[i]?.links.length),
      );
      const parentTitle = short(
        $(table)
          .closest("usos-frame")
          .children('[slot="title"],span')
          .first()
          .text(),
      );
      tables.push({
        title: parentTitle || `Zestawienie ${index + 1}`,
        headers: visible.map((i) => columns[i] || "Szczegóły"),
        rows: rows.map((row) =>
          visible.map((i) => row[i] ?? { text: "", links: [] }),
        ),
        footer,
      });
    });
  return { tables, dues };
}

export function parseAccountSection(
  html: string,
  id: AccountSectionId,
): AccountSection {
  const { $, main } = prepare(html, id);
  const { tables, dues } = parseTables($, main);
  const records: AccountSection["records"] = [];
  main
    .find("usos-frame > ul > li, .inline-keyvalue-list")
    .filter((_, el) => $(el).parents("table").length === 0)
    .each((_, el) => {
      const text = clean($(el).text());
      if (text)
        records.push({
          title:
            short($(el).find("h2,h3,h4,strong,b").first().text()) ||
            "Informacja z USOS",
          text,
          links: linksOf($, el),
        });
    });
  const content = main.clone();
  content
    .find(
      'table,usos-frame > ul,.inline-keyvalue-list,h1,h2,[slot="title"],usos-module-link-tile-container',
    )
    .remove();
  const messages: string[] = [];
  content
    .find("p,.warning,.notice,.info-message,usos-notice")
    .filter((_, el) => $(el).parents("p").length === 0)
    .each((_, el) => {
      const text = clean($(el).text());
      if (text && !messages.includes(text)) messages.push(text);
    });
  if (!messages.length) {
    const text = clean(content.text());
    if (text) messages.push(text);
  }
  const significant = short(content.text());
  const hasRecords =
    tables.some((table) => table.rows.length > 0) || records.length > 0;
  const empty =
    /nie (?:masz|ma|jesteś|koordynujesz)|brak (?:informacji|należności|danych|wniosków|pozycji)|nie znaleziono/i.test(
      significant,
    );
  return {
    id,
    title: ACCOUNT_SECTIONS[id].title,
    sourceUrl: sectionUrl(id),
    state: hasRecords
      ? "ready"
      : empty || !significant || (id === "registrations" && tables.length > 0)
        ? "empty"
        : "information",
    messages,
    tables,
    records,
    links: linksOf($, main[0]!),
    dues: id === "dues" ? dues : [],
  };
}

export function parseDirectory(
  html: string,
  query: string,
  kind: DirectoryResult["kind"],
): DirectoryResult {
  const { $, main } = prepare(html, "katalog");
  const { tables } = parseTables($, main);
  const action =
    kind === "people"
      ? "katalog2/osoby/szukajOsoby"
      : "katalog2/jednostki/szukajJednostki";
  const url = new URL("https://usosweb.ideis.pl/kontroler.php");
  url.search = new URLSearchParams({
    _action: action,
    _pattern: query,
  }).toString();
  const moreAvailable = main
    .find("a")
    .toArray()
    .some((a) => /następn|dalej/i.test($(a).text()));
  if (
    !tables.length &&
    !/nie znalezion|brak wynik|żadn|znaleziono.*0/i.test(short(main.text()))
  )
    throw new ParserNotCalibratedError("katalog");
  return {
    query,
    kind,
    tables: tables.map((table) => ({
      ...table,
      rows: table.rows.slice(0, 30),
    })),
    messages: [],
    sourceUrl: url.href,
    moreAvailable:
      moreAvailable || tables.some((table) => table.rows.length > 30),
  };
}
