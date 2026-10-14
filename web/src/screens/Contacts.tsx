import { ArrowUpRight, Building2, Search, UserRound } from "lucide-react";
import { useState } from "react";
import type { DirectoryResult } from "../../../shared/sections";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { SourceTableView } from "../components/SourceData";
import { ScreenSkeleton } from "../components/Skeleton";
import { StateBanner } from "../components/StateBanner";
import { WorkflowLink } from "../lib/workflows";
import { useEndpoint } from "../lib/api";

export function ContactsScreen() {
  const [kind, setKind] = useState<"people" | "faculties">("people");
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState<{
    query: string;
    kind: "people" | "faculties";
  } | null>(null);
  return (
    <div className="screen">
      <header className="page-header">
        <div>
          <p className="eyebrow">ZNAJDŹ WŁAŚCIWĄ OSOBĘ</p>
          <h1>Kontakty i jednostki</h1>
          <p className="page-description">
            Katalog pracowników oraz jednostek organizacyjnych uczelni.
          </p>
        </div>
        <WorkflowLink entry="contact" link={{label: "Kontakt z uczelnią", url: ""}} className="button button-secondary">
          Kontakt z uczelnią
          <ArrowUpRight size={14} />
        </WorkflowLink>
      </header>
      <div className="module-tabs" aria-label="Rodzaj katalogu">
        <button
          aria-pressed={kind === "people"}
          onClick={() => {
            setKind("people");
            setSubmitted(null);
          }}
        >
          <UserRound size={16} />
          Osoby
        </button>
        <button
          aria-pressed={kind === "faculties"}
          onClick={() => {
            setKind("faculties");
            setSubmitted(null);
          }}
        >
          <Building2 size={16} />
          Jednostki
        </button>
      </div>
      <form
        className="directory-search"
        onSubmit={(event) => {
          event.preventDefault();
          if (query.trim().length >= 2)
            setSubmitted({ query: query.trim(), kind });
        }}
      >
        <label className="search-field">
          <Search size={18} />
          <span className="sr-only">Wyszukiwanie w katalogu</span>
          <input
            value={query}
            minLength={2}
            maxLength={80}
            required
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              kind === "people" ? "Nazwisko lub imię…" : "Nazwa jednostki…"
            }
          />
        </label>
        <button
          className="button button-primary"
          type="submit"
          disabled={query.trim().length < 2}
        >
          Szukaj
        </button>
      </form>
      {submitted ? (
        <DirectoryResults
          key={`${submitted.kind}:${submitted.query}`}
          {...submitted}
        />
      ) : (
        <Card>
          <EmptyState
            icon={
              kind === "people" ? (
                <UserRound size={24} />
              ) : (
                <Building2 size={24} />
              )
            }
            title="Kogo szukasz?"
            description="Wpisz co najmniej 2 znaki i wybierz Szukaj. Zapytanie trafia do katalogu dopiero po zatwierdzeniu."
          />
        </Card>
      )}
      <p className="section-note">
        Pokazujemy dane udostępnione przez katalog uczelni. Profil i pełne dane
        kontaktowe otwierają się w aplikacji.
      </p>
    </div>
  );
}
function DirectoryResults({
  query,
  kind,
}: {
  query: string;
  kind: "people" | "faculties";
}) {
  const params = new URLSearchParams({ q: query, kind });
  const { data, meta, error, loading, reload } = useEndpoint<DirectoryResult>(
    `/api/directory?${params}`,
  );
  return (
    <>
      <StateBanner meta={meta} error={error} onReload={reload} />
      {loading && <ScreenSkeleton />}
      {data && (
        <>
          {data.messages.map((message, i) => (
            <p key={i} className="section-note">
              {message}
            </p>
          ))}
          {data.tables
            .filter((table) => table.rows.length)
            .map((table, i) => (
              <SourceTableView key={i} table={table} />
            ))}
          {!data.tables.some((table) => table.rows.length) && (
            <Card>
              <EmptyState
                title="Brak wyników w katalogu"
                description="Spróbuj innej nazwy lub przejdź do pełnych wyników poniżej."
              />
            </Card>
          )}
          <WorkflowLink link={{label: "Pełne wyniki", url: data.sourceUrl, workflow: data.workflow}} className="button button-secondary">
            {data.moreAvailable
              ? "Więcej wyników"
              : "Pełne wyniki"}
            <ArrowUpRight size={14} />
          </WorkflowLink>
        </>
      )}
    </>
  );
}
