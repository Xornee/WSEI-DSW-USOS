import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Clock3,
  Coffee,
  GraduationCap,
  MapPin,
  UserRound,
} from "lucide-react";
import type { Home } from "../../../shared/types";
import { AttentionPanel } from "../components/Attention";
import { Metric } from "../components/Metric";
import { Card, CardHeader } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { ScreenSkeleton } from "../components/Skeleton";
import { StateBanner } from "../components/StateBanner";
import { useEndpoint } from "../lib/api";
import { timetableHomePath, useTimetableTrack } from "../lib/timetable";
import { dayName, fmtDate, hhmm, kindStyle, relativeTo } from "../lib/format";

export function HomeScreen({ userId = null }: { userId?: string | null }) {
  const [track] = useTimetableTrack();
  const { data, meta, error, loading, reload } = useEndpoint<Home>(timetableHomePath(track));
  return (
    <div className="screen">
      <PageHeader
        eyebrow="TWÓJ DZIEŃ, W JEDNYM MIEJSCU"
        title={
          data?.greeting ? `Cześć, ${data.greeting}.` : "Dobrze Cię widzieć."
        }
        description="Zobacz, co przed Tobą. Resztę masz pod kontrolą."
        loading={loading}
        onReload={reload}
        extra={
          <span className="header-date">
            <CalendarDays size={15} />
            {new Date().toLocaleDateString("pl-PL", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </span>
        }
      />
      <StateBanner meta={meta} error={error} onReload={reload} />
      {loading && !data && <ScreenSkeleton />}
      <AttentionPanel userId={userId} />
      {data?.timetableSelection && ['choice_required', 'unresolved'].includes(data.timetableSelection.state) && <Card className="timetable-selection"><strong>Plan oczekuje na dopasowanie toku</strong><p>{data.timetableSelection.message}</p><a href="#plan">Otwórz dopasowanie planu →</a></Card>}
      {data && (
        <>
          <div className="stats-grid">
            <Metric
              icon={<CalendarDays size={18} />}
              label="Zajęcia dzisiaj"
              value={data.timetableSelection && !data.timetableSelection.trackId ? "—" : String(data.todayCount).padStart(2, "0")}
              detail={
                data.timetableSelection && !data.timetableSelection.trackId
                  ? "Tok oczekuje na dopasowanie"
                  : data.todayCount
                  ? "W Twoim planie na dziś"
                  : "Dzisiaj bez zajęć w planie"
              }
            />
            <Metric
              icon={<Clock3 size={18} />}
              label="Najbliższy start"
              value={data.nextClass ? hhmm(data.nextClass.start) : "—"}
              detail={
                data.timetableSelection && !data.timetableSelection.trackId
                  ? "Otwórz dopasowanie planu"
                  : data.nextClass
                  ? `${dayName(data.nextClass.start)}, ${new Date(data.nextClass.start).toLocaleDateString("pl-PL", { day: "numeric", month: "long" })}`
                  : "Brak nadchodzących zajęć"
              }
            />
            <Metric
              icon={<Bell size={18} />}
              label="Ogłoszenia"
              value={data.announcementsState === "not_connected" ? "—" : String(data.announcements.length).padStart(2, "0")}
              detail={data.announcementsState === "not_connected" ? "Zobacz zakładkę Aktualności" : "Informacje w Twoim panelu"}
            />
          </div>
          <div className="dashboard-grid">
            <div className="dashboard-primary">
              <NextClass home={data} />
              <Card className="announcements-card">
                <CardHeader
                  title="Warto wiedzieć"
                  hint={
                    <span className="count-badge">
                      {data.announcementsState === "not_connected" ? "—" : data.announcements.length}
                    </span>
                  }
                />
                {data.announcements.length ? (
                  <ul className="announcement-list">
                    {data.announcements.map((announcement) => (
                      <li key={announcement.id}>
                        <span className="announcement-icon">
                          <Bell size={16} />
                        </span>
                        <div>
                          <h3>{announcement.title}</h3>
                          {announcement.body && <p>{announcement.body}</p>}
                          {announcement.date && (
                            <time dateTime={announcement.date}>
                              {fmtDate(announcement.date)}
                            </time>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState
                    icon={<Bell size={21} />}
                    title={data.announcementsState === "not_connected" ? "Ogłoszenia w zakładce Aktualności" : "Jesteś na bieżąco"}
                    description={data.announcementsState === "not_connected" ? "Ten skrót nie pobiera ogłoszeń. Otwórz Aktualności, aby sprawdzić komunikaty uczelni." : "W tym źródle nie ma teraz żadnych ogłoszeń."}
                  />
                )}
              </Card>
            </div>
            <div className="dashboard-secondary">
              <CalendarPreview next={data.nextClass?.start ?? null} />
              <Card>
                <CardHeader title="Na skróty" />
                <div className="quick-links">
                  <QuickLink
                    href="#plan"
                    icon={<CalendarDays size={18} />}
                    title="Plan zajęć"
                    description="Twój tydzień na uczelni"
                  />
                  <QuickLink
                    href="#grades"
                    icon={<GraduationCap size={18} />}
                    title="Oceny i zaliczenia"
                    description="Wszystkie wyniki w jednym miejscu"
                  />
                  <QuickLink
                    href="#student"
                    icon={<UserRound size={18} />}
                    title="Mój profil"
                    description="Dane studenta i przebieg studiów"
                  />
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function NextClass({ home }: { home: Home }) {
  const next = home.nextClass;
  if (home.timetableSelection && !home.timetableSelection.trackId) return <Card><CardHeader title="Plan oczekuje na dopasowanie" /><p>{home.timetableSelection.message}</p><a className="button button-secondary" href="#plan">Otwórz dopasowanie toku</a></Card>;
  return (
    <Card className="next-class">
      <CardHeader
        title="Następne w planie"
        hint={
          <a className="text-link" href="#plan">
            Cały plan <ArrowUpRight size={14} />
          </a>
        }
      />
      {next ? (
        <>
          <div className="next-class-body">
            <div className="next-class-label">
              <span className={`chip ${kindStyle(next.kind).chip}`}>
                {next.kindLabel ?? "Zajęcia"}
              </span>
              <span className="muted">{relativeTo(next.start)}</span>
            </div>
            <h2>{next.courseName}</h2>
            {next.courseCode && (
              <p className="course-code">{next.courseCode}</p>
            )}
            <div className="class-time">
              <Clock3 size={18} />
              <strong>
                {hhmm(next.start)}
                <span>—</span>
                {hhmm(next.end)}
              </strong>
              <span className="class-time-divider" />
              <span>
                {new Date(next.start).toLocaleDateString("pl-PL", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </span>
            </div>
            <div className="class-details">
              <span>
                <MapPin size={16} />
                {[next.room, next.building].filter(Boolean).join(" · ") ||
                  "Sala nie została podana"}
              </span>
              <span>
                <UserRound size={16} />
                {next.lecturer ?? "Prowadzący nie został podany"}
              </span>
            </div>
          </div>
          <div className="next-class-footer">
            <span>
              {next.group
                ? `Grupa ${next.group}`
                : "Szczegóły z Twojego planu zajęć"}
            </span>
            <a className="button button-primary" href="#plan">
              Przejdź do planu <ArrowRight size={15} />
            </a>
          </div>
        </>
      ) : (
        <EmptyState
          icon={<Coffee size={25} />}
          title="Chwila dla Ciebie"
          description="Brak kolejnych zajęć w pobranym planie. Sprawdź plan, aby zobaczyć dostępny zakres dat."
        />
      )}
    </Card>
  );
}

function CalendarPreview({ next }: { next: string | null }) {
  const today = new Date();
  const date = next ? new Date(next) : today;
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const count = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const sameMonth =
    today.getFullYear() === date.getFullYear() &&
    today.getMonth() === date.getMonth();
  return (
    <Card className="mini-calendar">
      <CardHeader
        title={date.toLocaleDateString("pl-PL", {
          month: "long",
          year: "numeric",
        })}
        hint={<CalendarDays size={16} />}
      />
      <div className="mini-calendar-grid" aria-label="Kalendarz miesiąca">
        {["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"].map((day) => (
          <span className="calendar-weekday" key={day}>
            {day}
          </span>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <span key={`empty-${i}`} />
        ))}
        {Array.from({ length: count }, (_, i) => {
          const day = i + 1;
          return (
            <span
              key={day}
              className={`calendar-date ${sameMonth && today.getDate() === day ? "calendar-today" : ""} ${next && date.getDate() === day ? "calendar-next" : ""}`}
              aria-label={`${day}${sameMonth && today.getDate() === day ? ", dzisiaj" : ""}${next && date.getDate() === day ? ", najbliższe zajęcia" : ""}`}
            >
              {day}
            </span>
          );
        })}
      </div>
      <div className="calendar-legend">
        <span>
          <i className="legend-today" />
          Dzisiaj
        </span>
        <span>
          <i className="legend-next" />
          Najbliższe zajęcia
        </span>
      </div>
    </Card>
  );
}

function QuickLink({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <a className="quick-link" href={href}>
      <span className="quick-link-icon">{icon}</span>
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <ArrowUpRight size={16} />
    </a>
  );
}
