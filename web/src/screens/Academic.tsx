import { CalendarCheck2, CalendarDays, Clock3 } from "lucide-react";
import type { AcademicCalendar, AcademicTerm } from "../../../shared/types";
import { Card, CardHeader } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { ScreenSkeleton } from "../components/Skeleton";
import { StateBanner } from "../components/StateBanner";
import { useEndpoint } from "../lib/api";
import { fmtDate } from "../lib/format";

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function AcademicScreen() {
  const { data, meta, error, loading, reload } =
    useEndpoint<AcademicCalendar>("/api/terms");
  const today = localToday();
  return (
    <div className="screen">
      <PageHeader
        eyebrow="SZERSZA PERSPEKTYWA"
        title="Kalendarz akademicki"
        description="Początek semestru, koniec zajęć i rozliczenie cyklu. Ważne daty w jednym miejscu."
        loading={loading}
        onReload={reload}
      />
      <StateBanner meta={meta} error={error} onReload={reload} />
      {loading && !data && <ScreenSkeleton />}
      {data && (
        <>
          <div className="news-intro">
            <span className="news-intro-icon">
              <CalendarCheck2 size={23} />
            </span>
            <div>
              <strong>Daty prosto z USOS API</strong>
              <p>
                Publiczne cykle dydaktyczne uczelni. To nie jest indywidualny
                plan zajęć.
              </p>
            </div>
            <a className="button button-secondary" href="#plan">
              Mój plan zajęć
            </a>
          </div>
          <div className="term-grid">
            {data.terms.map((term) => (
              <TermCard key={term.id} term={term} today={today} />
            ))}
          </div>
          {!data.terms.length && (
            <Card>
              <EmptyState
                icon={<CalendarDays size={24} />}
                title="Brak cykli w wybranym zakresie"
                description="Źródło uczelni nie zwróciło cykli dydaktycznych. Sprawdź ponownie później."
              />
            </Card>
          )}
          <p className="section-note">
            Koniec zajęć i koniec cyklu mogą się różnić. Okres pomiędzy nimi
            pokazujemy osobno; dokładne terminy sesji i rejestracji sprawdzisz w
            komunikatach uczelni.
          </p>
        </>
      )}
    </div>
  );
}

function TermCard({ term, today }: { term: AcademicTerm; today: string }) {
  const status =
    today < term.startDate
      ? ["Nadchodzący", "tone-blue"]
      : today > term.finishDate
        ? ["Zakończony", "tone-neutral"]
        : today > term.classesEndDate
          ? ["Okres rozliczeniowy", "tone-amber"]
          : ["W trakcie", "tone-green"];
  return (
    <Card className="term-card">
      <CardHeader
        title={term.name}
        hint={<span className={`chip ${status[1]}`}>{status[0]}</span>}
      />
      <code className="term-code">{term.id}</code>
      <dl className="term-dates">
        <div>
          <dt>
            <CalendarDays size={16} />
            Początek cyklu
          </dt>
          <dd>{fmtDate(term.startDate)}</dd>
        </div>
        <div>
          <dt>
            <CalendarCheck2 size={16} />
            Ostatni dzień zajęć
          </dt>
          <dd>{fmtDate(term.classesEndDate)}</dd>
        </div>
        <div>
          <dt>
            <Clock3 size={16} />
            Koniec cyklu
          </dt>
          <dd>{fmtDate(term.finishDate)}</dd>
        </div>
      </dl>
    </Card>
  );
}
