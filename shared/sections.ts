export const ACCOUNT_SECTIONS = {
  dues: {
    title: "Należności nierozliczone",
    action: "dodatki/platnosci/naleznosciNierozliczone",
  },
  paid: {
    title: "Należności rozliczone",
    action: "dodatki/platnosci/naleznosciRozliczone",
  },
  remittances: {
    title: "Historia wpłat",
    action: "dodatki/platnosci/wplatyWszystkie",
  },
  accounts: {
    title: "Konta do wpłat",
    action: "dodatki/platnosci/kontaWirtualne",
  },
  installments: {
    title: "Plany ratalne",
    action: "dodatki/platnosci/planyRatalne",
  },
  courses: { title: "Moje zajęcia", action: "home/grupy" },
  tests: {
    title: "Sprawdziany i punkty",
    action: "dla_stud/studia/sprawdziany/index",
  },
  registrations: {
    title: "Moje rejestracje",
    action: "dla_stud/rejestracja/kalendarz",
  },
  applications: { title: "Wnioski", action: "dodatki/wnioski/index" },
  decisions: { title: "Decyzje", action: "dla_stud/studia/decyzje/index" },
  diplomas: { title: "Dyplomy", action: "dla_stud/studia/dyplomy/index" },
  scholarships: {
    title: "Stypendia",
    action: "dla_stud/studia/stypendia/stypendia",
  },
  card: { title: "mLegitymacja", action: "dla_stud/studia/mlegitymacja/index" },
} as const;
export type AccountSectionId = keyof typeof ACCOUNT_SECTIONS;
export const isAccountSectionId = (value: string): value is AccountSectionId =>
  Object.hasOwn(ACCOUNT_SECTIONS, value);
export const sectionUrl = (key: AccountSectionId) =>
  `https://usosweb.ideis.pl/kontroler.php?_action=${ACCOUNT_SECTIONS[key].action}`;

export interface SourceLink {
  label: string;
  url: string;
}
export interface SourceCell {
  text: string;
  links: SourceLink[];
}
export interface SourceTable {
  title: string;
  headers: string[];
  rows: SourceCell[][];
  footer: string[];
}
export interface SourceRecord {
  title: string;
  text: string;
  links: SourceLink[];
}
export interface PaymentDue {
  date: string | null;
  label: string;
  amount: string;
  cents: number | null;
  currency: string | null;
}
export interface AccountSection {
  id: AccountSectionId;
  title: string;
  sourceUrl: string;
  state: "ready" | "empty" | "information";
  messages: string[];
  tables: SourceTable[];
  records: SourceRecord[];
  links: SourceLink[];
  dues: PaymentDue[];
}
export interface DirectoryResult {
  query: string;
  kind: "people" | "faculties";
  tables: SourceTable[];
  messages: string[];
  sourceUrl: string;
  moreAvailable: boolean;
}
