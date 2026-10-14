# Mój plan i sprawy uczelniane

## Co jest wdrożone

- Tok nadal jest dobierany automatycznie z programu, etapu i cyklu USOS. Nie wpisujesz numeru toku.
- Plan, Start i ICS korzystają z jednej funkcji filtrowania. Grupy wybierasz osobno dla przedmiotu i rodzaju zajęć; wspólne zajęcia bez grupy i zajęcia bez alternatyw pozostają widoczne.
- Gdy źródło daje kilka alternatyw, pokazujemy wszystkie i prosimy o wybór nazwanych grup. Nie nazywamy tego rozpoznaniem przynależności w USOS. Gdy grupa zniknie ze źródła, pokazujemy wszystkie alternatywy i komunikat o zmianie.
- SQLite `plan_preferences` przechowuje tylko preferencje grup. Klucz obejmuje lokalne konto, tożsamość USOS, tok i zakres semestru. Rozłączenie/ponowne logowanie zachowuje wybór dla tego samego zakresu; inne konto i semestr mają osobny wybór. Nie zapisujemy cookies ani linków iCal.
- `Pobierz plan ICS` eksportuje cały pobrany, przefiltrowany semestr, a nie tylko oglądany tydzień. Daty używają jawnego UTC, tekst jest escapowany i linie składane według RFC 5545. Publiczny `/schedule` eksportuje wszystkie grupy; nie odczytuje prywatnych preferencji.
- Menu mobilne oraz układy widoków działają również na telefonie; plan domyślnie wybiera listę. Tygodniową siatkę można przewijać poziomo.
- Nowy widok `Sprawy uczelniane` wykrywa rzeczywiste odnośniki bieżącego konta. Zasady i ograniczenia kalibracji opisuje [adapter workflowów](09-workflowy-w-aplikacji.md).

## API pilota

- `GET /api/plan` — dopasowany i przefiltrowany plan wraz z `personal` (`scope`, `state`, `choices`, `options`, `message`).
- `POST /api/plan/groups` — JSON `{scope, choices, trackId?}`; `choices` mapuje klucz opcji z odpowiedzi planu na niepustą listę dostępnych grup. Wymaga Origin, `X-USOS-Connection` i ponownej kontroli tożsamości. `{choices:{}}` przywraca cały plan. Zapis dotyczy wyłącznie lokalnej bazy, nigdy rejestracji uczelnianej.
- `GET /api/plan/export?trackId=...` — prywatny ICS aktualnego wyboru z tego samego konta; bez `trackId` używa doboru automatycznego.
- `GET /api/home` — ta sama selekcja dla liczby zajęć i najbliższego terminu, plus `personalPlan`.
- `GET /api/student-services` — inwentaryzacja menu bez wysyłania formularzy.

## Weryfikacja i dalsza praca

`login-pilot/test/student-parity.test.mjs` obejmuje niezależne grupy, zajęcia wspólne, izolację kont/toków/semestrów, zapis SQLite po ponownym otwarciu, zmiany oznaczeń, odrzucanie obcych wyborów, Origin/generację, brak zapisów do uczelni przy zmianie planu, UTC/DST/escapowanie/składanie ICS, wykrywanie menu, potwierdzone jednorazowe formularze oraz przeglądarkowe Plan→Start→ICS, szkice i mobile.

To testy z syntetycznym kontem i formularzami. Dla rzeczywistego IDEIS następny krok to inwentaryzacja po SSO/MFA i osobna kalibracja dostępnych formularzy, szczególnie kontrolek JS. Do dalszego wdrożenia pozostają: pełna ujednolicona karta przedmiotu z powiązanymi ocenami/grupami, oficjalna średnia i ECTS z autorytatywnych danych, trwałe szkice przez wygaśnięcie sesji oraz dedykowane adaptery JS dla usług, które ich wymagają. Nie dodajemy zgadywanych wartości ani pozornej integracji OAuth bez konfiguracji uczelni.

## Lokalny Docker

```sh
docker compose up --build -d
curl --fail http://127.0.0.1:8789/readyz
```

Konta pozostają w wolumenie `accounts`. Zmiana obrazu restartuje serwer i kończy aktywne sesje USOS; lokalne konta i preferencje pozostają. Nie używaj `docker compose down -v` do zwykłej aktualizacji.
