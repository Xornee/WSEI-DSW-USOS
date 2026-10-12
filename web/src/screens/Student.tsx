import {
  AtSign,
  Building2,
  CalendarClock,
  GraduationCap,
  IdCard,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Stages, StudyStage, Student } from "../../../shared/types";
import { Card, CardHeader } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { ScreenSkeleton } from "../components/Skeleton";
import { StateBanner } from "../components/StateBanner";
import { useEndpoint } from "../lib/api";
import { fmtDate, statusStyle } from "../lib/format";

export function StudentScreen() {
  const { data, meta, error, loading, reload } =
    useEndpoint<Student>("/api/student");
  return (
    <div className="screen">
      <PageHeader
        eyebrow="TWOJA PRZESTRZEŃ"
        title="Mój profil"
        description="Dane studenta i historia Twojej drogi na uczelni."
        loading={loading}
        onReload={reload}
      />
      <StateBanner meta={meta} error={error} onReload={reload} />
      {loading && !data && <ScreenSkeleton />}
      {data && (
        <>
          <Card className="profile-hero">
            <div className="profile-identity">
              <Avatar student={data} />
              <div>
                <p className="eyebrow">PROFIL STUDENTA</p>
                <h2>
                  {data.displayName ?? `Student ${data.albumNumber ?? data.id}`}
                </h2>
                <p>{data.faculty ?? "Jednostka uczelni nie została podana"}</p>
              </div>
            </div>
            <div className="profile-roles">
              {data.roles.map((role) => (
                <span key={role} className="chip tone-neutral">
                  <ShieldCheck size={14} />
                  {role}
                </span>
              ))}
            </div>
          </Card>
          <div className="profile-grid">
            <Card>
              <CardHeader
                title="Dane podstawowe"
                hint={<UserRound size={17} />}
              />
              <dl className="profile-details">
                <Detail
                  icon={<IdCard size={17} />}
                  label="Numer albumu"
                  value={data.albumNumber}
                  mono
                />
                <Detail
                  icon={<IdCard size={17} />}
                  label="Karta biblioteczna"
                  value={data.libraryCard}
                  mono
                />
                <Detail
                  icon={<Building2 size={17} />}
                  label="Jednostka"
                  value={data.faculty}
                />
                <Detail
                  icon={<CalendarClock size={17} />}
                  label="Dostęp do USOSweb do"
                  value={
                    data.accessExpires ? fmtDate(data.accessExpires) : null
                  }
                />
                <Detail
                  icon={<AtSign size={17} />}
                  label="E-mail"
                  value={data.email}
                />
              </dl>
              <div className="profile-source">
                <ShieldCheck size={14} />
                Dane pochodzą z profilu USOSweb.
              </div>
            </Card>
            <Card>
              <CardHeader
                title="Kierunki studiów"
                hint={<GraduationCap size={18} />}
              />
              {data.programmes.length ? (
                <div className="programme-list">
                  {data.programmes.map((programme, index) => (
                    <div
                      className="programme-item"
                      key={`${programme.name}-${index}`}
                    >
                      <span className="programme-icon">
                        <GraduationCap size={23} strokeWidth={1.5} />
                      </span>
                      <h3>{programme.name}</h3>
                      {programme.stage && <p>{programme.stage}</p>}
                      {programme.status && (
                        <span
                          className={`chip ${statusStyle(programme.status)}`}
                        >
                          {programme.status}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="Brak kierunków w profilu"
                  description="Szczegóły etapów studiów mogą być dostępne poniżej."
                />
              )}
            </Card>
          </div>
          <StagesSection />
        </>
      )}
    </div>
  );
}

function StagesSection() {
  const { data, meta, error, loading, reload } =
    useEndpoint<Stages>("/api/stages");
  return (
    <section className="stages-section" aria-labelledby="stages-title">
      <div className="section-heading">
        <div>
          <h2 id="stages-title">Przebieg studiów</h2>
          <p>Etapy i statusy zaliczeń z USOSweb.</p>
        </div>
      </div>
      <StateBanner meta={meta} error={error} onReload={reload} />
      {loading && !data && <ScreenSkeleton />}
      {data &&
        (data.programmes.length ? (
          data.programmes.map((programme, index) => (
            <Card key={`${programme.name}-${index}`} className="stages-card">
              <CardHeader
                title={programme.name}
                hint={programme.code && <code>{programme.code}</code>}
              />
              {programme.stages.length ? (
                <ol className="stage-list">
                  {programme.stages.map((stage, stageIndex) => (
                    <StageRow
                      key={`${stage.code ?? stage.name}-${stageIndex}`}
                      stage={stage}
                    />
                  ))}
                </ol>
              ) : (
                <EmptyState
                  title="Brak etapów"
                  description="Źródło nie zawiera etapów dla tego kierunku."
                />
              )}
            </Card>
          ))
        ) : (
          <Card>
            <EmptyState
              title="Brak etapów studiów"
              description="W pobranym źródle nie ma jeszcze informacji o zaliczeniach etapów."
            />
          </Card>
        ))}
    </section>
  );
}

export function StageRow({ stage }: { stage: StudyStage }) {
  return (
    <li className="stage-row">
      <span className="stage-marker">
        <GraduationCap size={17} />
      </span>
      <div className="stage-content">
        <h3>{stage.name}</h3>
        {stage.code && <code>{stage.code}</code>}
        <dl className="stage-fields">
          {stage.fields.map((field, index) => (
            <div key={`${field.label}-${index}`}>
              <dt>{field.label}</dt>
              <dd>
                {field.kind === "status" ? (
                  <span className={`chip ${statusStyle(field.value)}`}>
                    {field.value}
                  </span>
                ) : field.kind === "date" ? (
                  fmtDate(field.value)
                ) : (
                  field.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </li>
  );
}

function Detail({
  icon,
  label,
  value,
  mono = false,
}: {
  icon: ReactNode;
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div className="profile-detail">
      <dt>
        {icon}
        {label}
      </dt>
      <dd className={`${mono ? "mono" : ""} ${value ? "" : "muted"}`}>
        {value ?? "Nie podano"}
      </dd>
    </div>
  );
}

function Avatar({ student }: { student: Student }) {
  const label =
    student.displayName
      ?.trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .filter((_, index, all) => index === 0 || index === all.length - 1)
      .join("")
      .toUpperCase() ?? "?";
  return student.photoUrl ? (
    <img
      className="profile-avatar"
      src={student.photoUrl}
      alt="Zdjęcie profilowe"
    />
  ) : (
    <div className="profile-avatar">{label}</div>
  );
}
