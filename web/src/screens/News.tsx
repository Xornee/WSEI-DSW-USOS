import {
  ArrowUpRight,
  ChevronDown,
  FileText,
  Newspaper,
  Search,
} from "lucide-react";
import { useState } from "react";
import type { NewsArticle, UniversityNews } from "../../../shared/types";
import { UNIVERSITY_NEWS_URL } from "../../../shared/university";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { ScreenSkeleton } from "../components/Skeleton";
import { StateBanner } from "../components/StateBanner";
import { WorkflowLink } from "../lib/workflows";
import { useEndpoint } from "../lib/api";

export function NewsScreen() {
  const { data, meta, error, loading, reload } =
    useEndpoint<UniversityNews>("/api/news");
  const [query, setQuery] = useState("");
  const articles =
    data?.articles.filter((article) =>
      `${article.title} ${article.paragraphs.join(" ")}`
        .toLocaleLowerCase("pl-PL")
        .includes(query.trim().toLocaleLowerCase("pl-PL")),
    ) ?? [];
  return (
    <div className="screen">
      <PageHeader
        eyebrow="Z ŻYCIA UCZELNI"
        title="Aktualności"
        description="Komunikaty, ważne informacje i możliwości, których warto nie przegapić."
        loading={loading}
        onReload={reload}
        extra={
          <WorkflowLink entry="news" link={{label: "Pełna tablica komunikatów", url: UNIVERSITY_NEWS_URL}} className="button button-secondary">
            Pełna tablica komunikatów <ArrowUpRight size={15} />
          </WorkflowLink>
        }
      />
      <StateBanner meta={meta} error={error} onReload={reload} />
      {loading && !data && <ScreenSkeleton />}
      {data && (
        <>
          <div className="news-intro">
            <span className="news-intro-icon">
              <Newspaper size={23} />
            </span>
            <div>
              <strong>Tablica informacyjna DSW Ideis</strong>
              <p>
                Publiczne komunikaty z USOSweb — niezależnie od sesji konta
                studenta.
              </p>
            </div>
            <span className="chip tone-neutral">
              {data.articles.length} komunikatów
            </span>
          </div>
          <div className="grades-toolbar">
            <label className="search-field">
              <Search size={17} />
              <span className="sr-only">Szukaj aktualności</span>
              <input
                placeholder="Szukaj w komunikatach…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <span className="muted" role="status">
              Wyniki: {articles.length}
            </span>
          </div>
          <div className="news-list">
            {articles.map((article, index) => (
              <NewsCard key={article.id} article={article} index={index} />
            ))}
          </div>
          {!articles.length && (
            <Card>
              <EmptyState
                icon={<Newspaper size={24} />}
                title={
                  query
                    ? "Brak pasujących komunikatów"
                    : "Brak aktualności w źródle"
                }
                description={
                  query
                    ? "Spróbuj innego hasła lub wyczyść wyszukiwanie."
                    : "Odśwież komunikaty później."
                }
              />
              {query && (
                <div className="empty-actions">
                  <button
                    className="button button-secondary"
                    onClick={() => setQuery("")}
                  >
                    Wyczyść wyszukiwanie
                  </button>
                </div>
              )}
            </Card>
          )}
          <p className="section-note">
            Kolejność zgodna ze stroną uczelni. Źródło nie podaje dat publikacji
            poszczególnych komunikatów. Treść komunikatów i dalsze kroki otwierają się tutaj.
          </p>
        </>
      )}
    </div>
  );
}

function NewsCard({ article, index }: { article: NewsArticle; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const preview =
    article.paragraphs.find((paragraph) => paragraph !== article.title) ??
    article.paragraphs[0] ??
    "";
  return (
    <article className="card news-card">
      <div className="news-card-marker">
        <FileText size={18} />
        <span>{String(index + 1).padStart(2, "0")}</span>
      </div>
      <div className="news-card-content">
        <div className="news-card-label">KOMUNIKAT UCZELNI</div>
        <h2>{article.title}</h2>
        {!expanded && <p className="news-excerpt">{preview}</p>}
        {expanded && (
          <div className="news-body" id={`article-${article.id}`}>
            {article.paragraphs.map((paragraph, paragraphIndex) => (
              <p key={paragraphIndex}>{paragraph}</p>
            ))}
            {article.links.length > 0 && (
              <div className="news-attachments">
                <h3>Linki i załączniki</h3>
                {article.links.map((link) => (
                  <WorkflowLink key={link.url} link={link}>
                    {link.label}
                    <ArrowUpRight size={14} />
                  </WorkflowLink>
                ))}
              </div>
            )}
            <WorkflowLink entry="news" link={{label: "Pełna tablica komunikatów", url: UNIVERSITY_NEWS_URL}} className="text-link">
              Pełna tablica komunikatów <ArrowUpRight size={14} />
            </WorkflowLink>
          </div>
        )}
        <button
          className="news-expand"
          aria-expanded={expanded}
          aria-controls={expanded ? `article-${article.id}` : undefined}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Zwiń komunikat" : "Przeczytaj komunikat"}
          <ChevronDown size={15} className={expanded ? "rotate-up" : ""} />
        </button>
      </div>
    </article>
  );
}
