export const UNIVERSITY_NEWS_URL =
  "https://usosweb.ideis.pl/kontroler.php?_action=news/default";
export const UNIVERSITY_TERMS_URL =
  "https://usosapps.ideis.pl/services/terms/search";

/** URLs taken from the public USOSweb navigation, verified 2026-09-14. */
export const UNIVERSITY_RESOURCES = [
  {
    id: "registration",
    title: "Kalendarz rejestracji",
    category: "Studia",
    description: "Terminy tur i zapisy na zajęcia w USOSweb.",
    url: "https://usosweb.ideis.pl/kontroler.php?_action=news/rejestracje/index",
    icon: "calendar",
  },
  {
    id: "instructions",
    title: "Instrukcje USOSweb",
    category: "Pomoc",
    description: "Poradniki i instrukcje korzystania z systemu uczelni.",
    url: "https://usosweb.ideis.pl/kontroler.php?_action=news/default&panel=DOMYSLNY&file=instrukcje.html",
    icon: "book",
  },
  {
    id: "library",
    title: "Biblioteka cyfrowa",
    category: "Materiały",
    description: "Publikacje i zasoby biblioteczne dla studentów.",
    url: "https://usosweb.ideis.pl/kontroler.php?_action=news/default&panel=DOMYSLNY&file=biblioteka.html",
    icon: "library",
  },
  {
    id: "student-zone",
    title: "Strefa studenta i doktoranta",
    category: "Studia",
    description: "Informacje organizacyjne i sprawy studenckie.",
    url: "https://usosweb.ideis.pl/kontroler.php?_action=news/default&panel=DOMYSLNY&file=strefa.html",
    icon: "graduation",
  },
  {
    id: "internships",
    title: "Praktyki zawodowe",
    category: "Rozwój",
    description: "Zasady organizacji i realizacji praktyk.",
    url: "https://usosweb.ideis.pl/kontroler.php?_action=news/default&panel=DOMYSLNY&file=realizacja_praktyk.html",
    icon: "briefcase",
  },
  {
    id: "competitions",
    title: "Konkursy dla studentów",
    category: "Rozwój",
    description: "Inicjatywy i możliwości rozwoju poza zajęciami.",
    url: "https://usosweb.ideis.pl/kontroler.php?_action=news/default&panel=DOMYSLNY&file=konkursy_dla_studentow.html",
    icon: "award",
  },
  {
    id: "insurance",
    title: "Ubezpieczenie zdrowotne",
    category: "Studia",
    description: "Informacje o ubezpieczeniu zdrowotnym studentów.",
    url: "https://usosweb.ideis.pl/kontroler.php?_action=news/default&panel=DOMYSLNY&file=ubezpieczenia.html",
    icon: "shield",
  },
  {
    id: "contact",
    title: "Kontakt z uczelnią",
    category: "Pomoc",
    description: "Oficjalne dane kontaktowe i jednostki uczelni.",
    url: "https://usosweb.ideis.pl/kontroler.php?_action=news/kontakt",
    icon: "contact",
  },
] as const;
