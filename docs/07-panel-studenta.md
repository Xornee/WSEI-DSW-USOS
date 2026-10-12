# Panel studenta — desktop, jasny i ciemny

## Nawigacja i źródła

| Widok                | Dane lokalnie w GUI                                                 | Działania / szczegóły                                         |
| -------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------- |
| Przegląd             | Następne zajęcia, skróty, panel „Wymaga uwagi”                      | Przejście do odpowiedniej sekcji                              |
| Plan zajęć           | Tydzień, lista, szczegóły zajęć z istniejącego źródła               | Pusty plan nie jest zastępowany demonstracją                  |
| Moje zajęcia         | Aktualne grupy; wyszukiwane archiwum przedmiotów z historią ocen    | Pełne archiwum zapisów i katalog w USOSweb                    |
| Oceny końcowe        | Historia i filtrowanie ocen                                         | Istniejące źródło ocen                                        |
| Sprawdziany          | Tekst, tabele i pozycje udostępnione przez stronę sprawdzianów      | Pełne drzewo sprawdzianu i szczegóły w USOSweb                |
| Płatności            | Nierozliczone i rozliczone należności, wpłaty, konta, plany ratalne | Kopiowanie wybranej komórki; szczegóły w USOSweb              |
| Rejestracje          | Lista sesji rejestracji przypisanych do konta                       | Zapisy i zmiany grup wyłącznie w USOSweb                      |
| Wnioski i dokumenty  | Wnioski, decyzje, dyplomy                                           | Formularze, szczegóły i pobieranie dokumentów w USOSweb       |
| Przebieg studiów     | Etapy i jawne statusy zaliczenia                                    | ECTS wyłącznie jeśli źródło zawiera takie pola                |
| Mój profil           | Informacje o studencie i programach                                 | Bez lokalnej edycji danych konta                              |
| Aktualności          | Publiczne komunikaty uczelni, wyszukiwanie, rozwijanie treści       | Załączniki i źródła w nowej karcie                            |
| Kalendarz akademicki | Rzeczywiste cykle i daty z USOS API                                 | Nie zastępuje planu zajęć ani kalendarza egzaminów            |
| Kontakty             | Wyszukiwanie osób i jednostek po zatwierdzeniu formularza           | Profile i pełne dane kontaktowe w USOSweb                     |
| Strefa studenta      | Informacje o mLegitymacji i stypendiach oraz 8 sprawdzonych skrótów | Biblioteka, praktyki, instrukcje i pozostałe zasoby w USOSweb |

Oba motywy obejmują wszystkie widoki, tabele, stany błędów i puste sekcje. Wybrany motyw zapisuje się lokalnie (`usos-theme`) i jest stosowany przed renderowaniem React. Interfejs jest projektowany dla komputera; framework pozostaje React/Vite, nie Next.js.

## „Wymaga uwagi”

- Należności z dodatnią, jednoznacznie odczytaną kwotą oraz terminem zaległym lub w najbliższych 14 dniach.
- Rejestracje z jawnym statusem otwartym/aktywnym. Brak statusu nie oznacza otwartej rejestracji.
- Wnioski, których odczytana pozycja wskazuje konieczność uzupełnienia/poprawy.
- Nowe lub zmienione oceny względem zestawu zapamiętanego na tym urządzeniu. Pierwszy odczyt ustala punkt odniesienia, a nie udaje nowych ocen. Zapis zawiera tylko skróty SHA-256 wartości; komunikat można oznaczyć jako przeczytany. To lokalny wskaźnik zmiany, nie uczelniane powiadomienia push.
- Błędy poszczególnych źródeł pozostawiają ich status nieznany. Starsze dane są oznaczone. Przycisk odświeżania ponownie odczytuje wszystkie źródła panelu.

## Backend i odczyt

`GET /api/sections/:id` akceptuje wyłącznie identyfikatory z `shared/sections.ts`. Mapa zawiera konkretne akcje odczytane z menu i podstron instalacji uczelni. `GET /api/directory?q=…&kind=people|faculties` przyjmuje 2–80 znaków, odczytuje katalog przez ten sam klient sesji; wyszukiwanie nie jest wykonywane po każdym znaku. Wyniki katalogu są trzymane tylko w ograniczonej pamięci procesu (40 zapytań); widok pokazuje do 30 wierszy na tabelę i link do pełnych wyników.

Proxy nasłuchuje wyłącznie na `127.0.0.1`. Nowe prywatne moduły współdzielą istniejący klient, sesję i limit odstępu żądań. Żadne wywołanie lokalnego interfejsu nie wykonuje POST ani modyfikacji na koncie. Publiczne aktualności i cykle mają osobny klient bez cookies — opis w `06-frontend-i-publiczne-zrodla.md`.

Parser zwraca tekst i linki, nie HTML. Kontrolki formularzy i treści wykonywalne są usuwane; czytelne tabele wewnątrz formularzy i nagłówki ukryte wizualnie pozostają. Kwoty są przeliczane w groszach tylko przy jednoznacznym formacie i walucie; nieznana kwota daje „—”, nie zero. Suma jest prezentowana tylko przy jednej wspólnej walucie. Nowo tworzone pliki cache mają uprawnienia `0600`, a nowe katalogi cache `0700`; istniejące uprawnienia nie są zmieniane.

## Kalibracja i weryfikacja

Odczyty z 2026-09-14 potwierdziły strukturę należności, wpłat, decyzji oraz wyników katalogu osób i jednostek. Część modułów na podłączonym koncie jest obecnie pusta. Wypełnione przyszłe stany sprawdzianów, grup, rejestracji, wniosków i stypendiów są sprawdzone na syntetycznych strukturach, nie potwierdzone jako występujące na bieżącym koncie. Zmiana szablonu może wymagać ponownej kalibracji parsera. Brak danych nie jest uzupełniany fikcyjnymi pozycjami.

Testy: `npm test` (parsery, cache, walidacja wartości, istniejące moduły) oraz `npm run build` (TypeScript + produkcyjny frontend). Testy przeglądarkowe korzystają z oznaczonych, syntetycznych odpowiedzi prywatnych API i rzeczywistej publicznej treści aktualności. Sprawdzają wszystkie 14 widoków w obu motywach przy szerokościach 1280/1440/1920, audyt WCAG A/AA, zakładki, kopiowanie, wyszukiwanie, puste dane, błędy i wykrywanie zmian ocen. Stan rzeczywistego proxy jest sprawdzany osobno; testy z atrapami nie dowodzą działania żywej sesji.

Rollback źródeł, sumy SHA-256 i polecenia weryfikacyjne znajdują się w `.frontend-redesign/2026-09-14-full-student-workspace/`. Rollback nie cofa zmian wykonanych poza tą rewizją ani nie modyfikuje sesji USOS.
