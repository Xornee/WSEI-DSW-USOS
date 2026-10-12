# Źródła danych

## Co skąd pochodzi

| Ekran | Źródło | Postać | Dlaczego tak |
|---|---|---|---|
| Plan zajęć | `usosapps.ideis.pl/services/tt/upcoming_ical` | iCalendar | Widget w USOSwebie renderuje się po stronie klienta — w HTML-u planu nie ma nic. Feed iCal to oficjalny eksport USOS API o stabilnym formacie. |
| Oceny | `dla_stud/studia/oceny/index` | HTML | Tabela renderowana po stronie serwera. |
| Zaliczenia etapów | `dla_stud/studia/zaliczenia/index` | HTML | Sekcje `usos-frame-section` z listą par etykieta/wartość. |
| Profil | `home/index` + `katalog2/osoby/pokazOsobe` | HTML | Album, role i jednostka w kafelku `#info-frame`; imię i nazwisko w `<title>` strony profilowej. |
| Strona główna | zestawienie z planu i profilu | — | Nie ma własnego źródła, więc nie ma czego zepsuć. |

## Plan zajęć — skąd wziąć link

USOSweb sam wydaje link do feedu, przeznaczony dla zewnętrznych kalendarzy:

**PLAN ZAJĘĆ → eksport → skopiuj odnośnik**

Link ma postać `.../services/tt/upcoming_ical?lang=pl&user_id=<id>&key=<klucz>`
i **jest poświadczeniem** — kto go ma, widzi Twój plan. Trzymaj go lokalnie
w `.env`, nie commituj, a w razie potrzeby unieważnij w USOSwebie
(PLANY UŻYTKOWNIKA → publiczny link do planu).

W `.env` wartość **musi być w apostrofach**, bo zawiera `&`, a `scripts/capture.sh`
sourcuje ten plik przez powłokę:

```bash
USOS_ICAL_URL='https://usosapps.ideis.pl/services/tt/upcoming_ical?lang=pl&user_id=...&key=...'
```

## Zakotwiczenie parserów

USOSweb prawie nie używa klas CSS, więc parsery trzymają się rzeczy stabilnych:

| Parser | Kotwica | Co daje odporność |
|---|---|---|
| `scrape/student.ts` | `#info-frame`, dopasowanie po **etykietach** | Przetrwa zmianę kolejności pól i różnice między rolami użytkownika. |
| `scrape/grades.ts` | `#oceny`, atrybut `section-title` | Nazwa cyklu jest w atrybucie, nie w treści — nie zależy od układu nagłówków. |
| `scrape/stages.ts` | `usos-frame` zawierający `.inline-keyvalue-list` | Pomija dialogi i nagłówki; pary czyta generycznie, bez listy oczekiwanych etykiet. |
| `scrape/profile.ts` | `<title>` | Najprostsze stabilne miejsce z imieniem; e-mail bywa ukryty ustawieniem prywatności. |

Parsery, które nie znajdą swojej kotwicy, **rzucają `ParserNotCalibratedError`**
zamiast zwracać pusty obiekt. Cicha pustka wygląda jak „brak danych" i maskuje
awarię; jawny błąd trafia na pasek w GUI.

## Inwentarz modułów „Dla studentów"

Stan sprawdzony na żywym koncie — puste moduły nie mają struktury, na której
dałoby się oprzeć parser, więc nie zostały zbudowane.

| Moduł | Akcja | Stan | Podpięte |
|---|---|---|---|
| Oceny końcowe | `dla_stud/studia/oceny/index` | ma dane | tak |
| Zaliczenia etapów | `dla_stud/studia/zaliczenia/index` | ma dane | tak |
| Sprawdziany | `dla_stud/studia/sprawdziany/index` | pusty | nie |
| Podpięcia | `dla_stud/studia/podpiecia/lista` | pusty | nie |
| Decyzje | `dla_stud/studia/decyzje/index` | pusty | nie |
| Dyplomy | `dla_stud/studia/dyplomy/index` | pusty | nie |
| Grupy dziekańskie | `dla_stud/studia/grupyDziekanskie` | pusty | nie |
| Rankingi | `dla_stud/studia/rankingi` | pusty | nie |
| Stypendia | `dla_stud/studia/stypendia/stypendia` | pusty | nie |
| Ankiety | `dla_stud/studia/ankiety/index` | pusty | nie |
| mLegitymacja | `dla_stud/studia/mlegitymacja/index` | niesprawdzony | nie |
| Rejestracje | `dla_stud/rejestracja/*` | niesprawdzone | nie |
| Spotkania | `dla_stud/spotkania/wyborJednostki` | niesprawdzony | nie |

„Pusty" znaczy: zero tabel i sekcji, zwykle z komunikatem w stylu „nie jesteś
zapisany na żadne zajęcia". Sprawdziany zapełnią się po starcie semestru —
wtedy warto do nich wrócić, bo to jedyny moduł zmieniający się w trakcie roku.

Listę akcji w swojej instalacji wypiszesz sam:

```bash
./scripts/capture.sh discover dla_stud/index
```
