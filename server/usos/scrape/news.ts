import { createHash } from "node:crypto";
import { load } from "cheerio";
import type {
  NewsArticle,
  UniversityLink,
  UniversityNews,
} from "../../../shared/types.js";
import { UNIVERSITY_NEWS_URL } from "../../../shared/university.js";
import { ParserNotCalibratedError } from "./errors.js";

export function publicLink(
  href: string,
  base = UNIVERSITY_NEWS_URL,
): string | null {
  try {
    const url = new URL(href, base);
    if (!["https:", "http:", "mailto:", "tel:"].includes(url.protocol))
      return null;
    if (url.username || url.password || url.pathname.startsWith("/cdn-cgi/"))
      return null;
    return url.href;
  } catch {
    return null;
  }
}

/** The public page separates notices with <hr>; migration metadata is not a publication date. */
export function parseNews(html: string): UniversityNews {
  const $ = load(html);
  const container = $("#layout-main-content > .usos-ui").first();
  if (!container.length) throw new ParserNotCalibratedError("aktualnosci");
  container
    .find(
      "script, style, iframe, object, embed, form, .wrtext, .grey, [hidden]",
    )
    .remove();
  container.find("br").replaceWith("\n");
  const articles: NewsArticle[] = [];
  let paragraphs: string[] = [];
  let links: UniversityLink[] = [];
  let heading = "";
  const flush = () => {
    if (paragraphs.length) {
      const firstLine = paragraphs[0]!.split("\n")[0]!.trim();
      const title =
        heading ||
        (firstLine.length <= 160 ? firstLine : `${firstLine.slice(0, 157)}…`);
      articles.push({
        id: createHash("sha256")
          .update(paragraphs.join("\n"))
          .digest("hex")
          .slice(0, 16),
        title,
        paragraphs,
        links,
      });
    }
    paragraphs = [];
    links = [];
    heading = "";
  };
  container.children().each((_, element) => {
    const node = $(element);
    if (element.tagName === "hr") {
      flush();
      return;
    }
    const text = node
      .text()
      .replace(/[^\S\n]+/g, " ")
      .replace(/\n\s*\n/g, "\n")
      .trim();
    if (!text) return;
    if (!paragraphs.length)
      heading = node.is("h1,h2,h3,h4")
        ? text
        : node.find("strong,b").first().text().trim();
    if (node.is("ul,ol"))
      node.children("li").each((__, li) => {
        paragraphs.push(`• ${$(li).text().replace(/\s+/g, " ").trim()}`);
      });
    else paragraphs.push(text);
    node
      .find("a[href]")
      .addBack("a[href]")
      .each((__, anchor) => {
        const url = publicLink($(anchor).attr("href") ?? "");
        if (url && !links.some((link) => link.url === url))
          links.push({
            label:
              $(anchor).text().replace(/\s+/g, " ").trim() ||
              new URL(url).hostname,
            url,
          });
      });
  });
  flush();
  if (!articles.length && container.text().trim())
    throw new ParserNotCalibratedError("aktualnosci");
  return { articles, sourceUrl: UNIVERSITY_NEWS_URL };
}
