import {
  ArrowUpRight,
  Award,
  BookOpen,
  BriefcaseBusiness,
  CalendarDays,
  ContactRound,
  GraduationCap,
  Library,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { UNIVERSITY_RESOURCES } from "../../../shared/university";
import type {
  AccountSection,
  AccountSectionId,
} from "../../../shared/sections";
import { WorkflowLink } from "../lib/workflows";
import { useEndpoint } from "../lib/api";
import { SectionData } from "../components/SourceData";
import { ScreenSkeleton } from "../components/Skeleton";
import { StateBanner } from "../components/StateBanner";
import { EmptyState } from "../components/EmptyState";

const ICONS = {
  calendar: CalendarDays,
  book: BookOpen,
  library: Library,
  graduation: GraduationCap,
  briefcase: BriefcaseBusiness,
  award: Award,
  shield: ShieldCheck,
  contact: ContactRound,
};

export function ResourcesScreen() {
  const [view, setView] = useState<"links" | "card" | "scholarships">("links");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Wszystkie");
  const resources = UNIVERSITY_RESOURCES.filter(
    (resource) =>
      (category === "Wszystkie" || resource.category === category) &&
      `${resource.title} ${resource.description}`
        .toLocaleLowerCase("pl-PL")
        .includes(query.trim().toLocaleLowerCase("pl-PL")),
  );
  return (
    <div className="screen">
      <header className="page-header">
        <div>
          <p className="eyebrow">PRZYDATNE POD RĘKĄ</p>
          <h1>Strefa studenta</h1>
          <p className="page-description">
            Biblioteka, praktyki, rejestracje i pomoc. Mniej szukania po
            stronach uczelni.
          </p>
        </div>
      </header>
      <div className="module-tabs" aria-label="Sekcje strefy studenta">
        {[
          { id: "links", label: "Przydatne linki" },
          { id: "card", label: "mLegitymacja" },
          { id: "scholarships", label: "Stypendia" },
        ].map((tab) => (
          <button
            key={tab.id}
            aria-pressed={view === tab.id}
            onClick={() => setView(tab.id as typeof view)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {view !== "links" ? (
        <EssentialData key={view} id={view} />
      ) : (
        <>
          <div className="news-intro">
            <span className="news-intro-icon">
              <GraduationCap size={24} />
            </span>
            <div>
              <strong>Sprawy i informacje uczelniane</strong>
              <p>
                Każda karta otwiera treść w aplikacji. Zmiany na koncie
                wymagają osobnego potwierdzenia.
              </p>
            </div>
          </div>
          <div className="resource-toolbar">
            <label className="search-field">
              <Search size={17} />
              <span className="sr-only">Szukaj zasobów</span>
              <input
                value={query}
                placeholder="Czego szukasz?"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="resource-filters" aria-label="Kategorie zasobów">
              {["Wszystkie", "Studia", "Materiały", "Rozwój", "Pomoc"].map(
                (value) => (
                  <button
                    key={value}
                    aria-pressed={category === value}
                    onClick={() => setCategory(value)}
                  >
                    {value}
                  </button>
                ),
              )}
            </div>
          </div>
          <div className="resource-grid">
            {resources.map((resource) => {
              const Icon = ICONS[resource.icon];
              return (
                <WorkflowLink key={resource.id} entry={`resource:${resource.id}`} link={{label: resource.title, url: resource.url}} className="card resource-card">
                  <div className="resource-card-top">
                    <span className="quick-link-icon">
                      <Icon size={21} />
                    </span>
                    <span className="chip tone-neutral">
                      {resource.category}
                    </span>
                  </div>
                  <h2>{resource.title}</h2>
                  <p>{resource.description}</p>
                  <div className="resource-card-footer">
                    Otwórz tutaj <ArrowUpRight size={16} />
                  </div>
                </WorkflowLink>
              );
            })}
          </div>
          {!resources.length && (
            <div className="card">
              <EmptyState
                title="Brak pasujących zasobów"
                description="Wybierz inną kategorię lub zmień wyszukiwanie."
              />
              <div className="empty-actions">
                <button
                  className="button button-secondary"
                  onClick={() => {
                    setCategory("Wszystkie");
                    setQuery("");
                  }}
                >
                  Wyczyść filtry
                </button>
              </div>
            </div>
          )}
          <p className="section-note">
            Linki pochodzą z menu uczelnianego USOSweb. Zawartość i dostępność
            podstron zależą od uczelni.
          </p>
        </>
      )}
    </div>
  );
}

function EssentialData({ id }: { id: AccountSectionId }) {
  const { data, meta, error, loading, reload } = useEndpoint<AccountSection>(
    `/api/sections/${id}`,
  );
  return (
    <>
      <StateBanner meta={meta} error={error} onReload={reload} />
      {loading && <ScreenSkeleton />}
      {data && (
        <>
          <SectionData data={data} />
          <div className="registration-actions">
            <button className="button button-secondary" onClick={reload}>
              Odśwież
            </button>
            <WorkflowLink entry={id} link={{label: `Szczegóły: ${data.title}`, url: data.sourceUrl}} className="button button-secondary">
              Szczegóły: {data.title}
              <ArrowUpRight size={14} />
            </WorkflowLink>
          </div>
        </>
      )}
    </>
  );
}
