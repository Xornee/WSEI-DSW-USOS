import {
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  ChevronRight,
  Command,
  GraduationCap,
  LayoutDashboard,
  Newspaper,
  CalendarRange,
  Library,
  Moon,
  Wallet,
  ClipboardList,
  FileText,
  ListChecks,
  ContactRound,
  TrendingUp,
  NotebookPen,
  Sun,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  PaymentsScreen,
  DocumentsScreen,
  TestsScreen,
  RegistrationsScreen,
} from "./screens/AccountModules";
import { CoursesScreen } from "./screens/Courses";
import { ContactsScreen } from "./screens/Contacts";
import { ProgressScreen } from "./screens/Progress";
import { useTheme } from "./lib/theme";
import { NewsScreen } from "./screens/News";
import { AcademicScreen } from "./screens/Academic";
import { ResourcesScreen } from "./screens/Resources";
import { useSession } from "./lib/api";
import { GradesScreen } from "./screens/Grades";
import { HomeScreen } from "./screens/Home";
import { PlanScreen } from "./screens/Plan";
import { StudentScreen } from "./screens/Student";

const TABS = [
  {
    id: "home",
    label: "Przegląd",
    icon: LayoutDashboard,
    group: "NA CO DZIEŃ",
  },
  { id: "plan", label: "Plan zajęć", icon: CalendarDays, group: "NA CO DZIEŃ" },
  {
    id: "courses",
    label: "Moje zajęcia",
    icon: BookOpen,
    group: "NA CO DZIEŃ",
  },
  {
    id: "grades",
    label: "Oceny końcowe",
    icon: GraduationCap,
    group: "NA CO DZIEŃ",
  },
  {
    id: "tests",
    label: "Sprawdziany",
    icon: NotebookPen,
    group: "NA CO DZIEŃ",
  },
  { id: "payments", label: "Płatności", icon: Wallet, group: "TWOJE SPRAWY" },
  {
    id: "registrations",
    label: "Rejestracje",
    icon: ClipboardList,
    group: "TWOJE SPRAWY",
  },
  {
    id: "documents",
    label: "Wnioski i dokumenty",
    icon: FileText,
    group: "TWOJE SPRAWY",
  },
  {
    id: "progress",
    label: "Przebieg studiów",
    icon: TrendingUp,
    group: "TWOJE SPRAWY",
  },
  {
    id: "student",
    label: "Mój profil",
    icon: UserRound,
    group: "TWOJE SPRAWY",
  },
  { id: "news", label: "Aktualności", icon: Newspaper, group: "UCZELNIA" },
  {
    id: "academic",
    label: "Kalendarz akademicki",
    icon: CalendarRange,
    group: "UCZELNIA",
  },
  { id: "contacts", label: "Kontakty", icon: ContactRound, group: "UCZELNIA" },
  {
    id: "resources",
    label: "Strefa studenta",
    icon: Library,
    group: "UCZELNIA",
  },
] as const;

type TabId = (typeof TABS)[number]["id"];

const publicSchedule = document.querySelector('meta[name="usos-public-plan"]')?.getAttribute("content") === "true";

function currentTab(): TabId {
  if (publicSchedule) return "plan";
  return (
    TABS.find((tab) => tab.id === window.location.hash.slice(1))?.id ?? "home"
  );
}

export default function App() {
  const [active, setActive] = useState<TabId>(currentTab);
  const session = useSession(!publicSchedule);
  const { theme, toggleTheme } = useTheme();
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const update = () => setActive(currentTab());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  useEffect(() => {
    document.title = `${TABS.find((tab) => tab.id === active)!.label} · USOS lokalnie`;
    mainRef.current?.scrollTo({ top: 0 });
  }, [active]);

  const status = publicSchedule ? "Plan publiczny · bez logowania" : !session
    ? "Status połączenia nieznany"
    : session.mode === "mock"
      ? "Dane demonstracyjne"
      : session.loggedIn
        ? "Sesja USOS aktywna"
        : "Sesja USOS nieaktywna";

  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Przejdź do treści
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href="#home"
          aria-label="USOS lokalnie — strona główna"
        >
          <span className="brand-mark">
            <Command size={22} strokeWidth={1.8} />
          </span>
          <span className="brand-name">
            usos<span className="brand-suffix"> / lokalnie</span>
          </span>
        </a>
        <div className="workspace-label">
          <span className="workspace-icon">
            <GraduationCap size={19} />
          </span>
          <div>
            <strong>Przestrzeń studenta</strong>
            <span>Wszystko w jednym miejscu</span>
          </div>
        </div>
        <nav className="side-nav" aria-label="Nawigacja główna">
          {["NA CO DZIEŃ", "TWOJE SPRAWY", "UCZELNIA"].filter(group => !publicSchedule || group === "NA CO DZIEŃ").map((group) => (
            <div className="nav-group" key={group}>
              <p className="nav-label">{group}</p>
              {TABS.filter((tab) => tab.group === group && (!publicSchedule || tab.id === "plan")).map(
                ({ id, label, icon: Icon }) => (
                  <a
                    key={id}
                    href={`#${id}`}
                    className={`nav-item ${active === id ? "is-active" : ""}`}
                    aria-current={active === id ? "page" : undefined}
                  >
                    <Icon size={17} strokeWidth={1.7} />
                    <span>{label}</span>
                    {active === id && <span className="nav-dot" />}
                  </a>
                ),
              )}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <BookOpen size={19} strokeWidth={1.5} />
            <strong>
              Mniej szukania.
              <br />
              Więcej studiowania.
            </strong>
            <p>Twój USOS w prostszej odsłonie.</p>
          </div>
          <div className="connection-status" role="status">
            <span
              className={`status-dot ${session?.mode === "live" && session.loggedIn ? "connected" : ""}`}
            />
            <span>{status}</span>
          </div>
          <span className="sidebar-version">
            Lokalny panel studenta <span>v0.1</span>
          </span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Przestrzeń studenta</span>
            <ChevronRight size={14} />
            <strong>{TABS.find((tab) => tab.id === active)!.label}</strong>
          </div>
          <div className="topbar-actions">
            <button
              className="theme-toggle button button-secondary"
              onClick={toggleTheme}
              aria-label={
                theme === "dark" ? "Włącz tryb jasny" : "Włącz tryb ciemny"
              }
              aria-pressed={theme === "dark"}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              {theme === "dark" ? "Jasny" : "Ciemny"}
            </button>
            <span className="local-badge">
              <span />
              LOCAL
            </span>
            <a
              className="avatar-button"
              href={publicSchedule ? "/account" : "#student"}
              aria-label="Przejdź do mojego profilu"
            >
              <UserRound size={17} />
            </a>
          </div>
        </header>
        <main
          className="main-content"
          id="main-content"
          ref={mainRef}
          tabIndex={-1}
        >
          <div className="page-content">
            {active === "home" && (
              <HomeScreen userId={session?.userId ?? null} />
            )}
            {active === "plan" && <PlanScreen />}
            {active === "grades" && <GradesScreen />}
            {active === "student" && <StudentScreen />}
            {active === "news" && <NewsScreen />}
            {active === "academic" && <AcademicScreen />}
            {active === "resources" && <ResourcesScreen />}
            {active === "payments" && <PaymentsScreen />}
            {active === "courses" && <CoursesScreen />}
            {active === "tests" && <TestsScreen />}
            {active === "registrations" && <RegistrationsScreen />}
            {active === "documents" && <DocumentsScreen />}
            {active === "progress" && <ProgressScreen />}
            {active === "contacts" && <ContactsScreen />}
            <footer className="page-footer">
              <span>
                USOS lokalnie <span className="footer-separator">/</span> Twoja
                przestrzeń do studiowania
              </span>
              <a href="#plan">
                Zaplanuj swój tydzień <ArrowUpRight size={13} />
              </a>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}
