# Rozwiązywanie problemów

## GUI pokazuje „Tryb demo", choć wkleiłeś ciasteczko

Tryb zapada **przy starcie procesu**. Jeśli edytowałeś `.env` przy działającym
serwerze, zrestartuj go — `Ctrl+C`, potem `npm run dev`.

To najczęstsza pułapka: stary proces trzyma stare zmienne i nic nie sygnalizuje.

## Błąd 401 / „Sesja USOSweb wygasła"

`PHPSESSID` wygasa — USOSweb i SSO mają własne limity. Weź świeże ciasteczko
(DevTools → Application → Cookies → `usosweb.ideis.pl` → `PHPSESSID` → Value)
i zrestartuj proxy.

Szybkie sprawdzenie, czy sesja żyje:

```bash
./scripts/capture.sh discover
```

Wypisze `user_id`, albo powie `!! Sesja nieaktywna (user_id: null)`.

Automatyzacji logowania celowo nie ma — oznaczałaby trzymanie hasła i dużo
kruchego kodu wokół SSO.

## `capture.sh`: `parse error near '&'`

Wartość w `.env` zawiera `&` i nie jest w apostrofach. Skrypt sourcuje ten plik
przez powłokę, więc `&` rozdziela komendy.

```bash
USOS_ICAL_URL='https://...?lang=pl&user_id=...&key=...'
```

Node (`process.loadEnvFile`) radzi sobie bez apostrofów, powłoka nie — stąd
objaw „w przeglądarce działa, a skrypt się wywala".

## `EADDRINUSE: address already in use :::8080`

Proxy już działa w innym terminalu. Albo je zatrzymaj, albo wystartuj na innym
porcie:

```bash
PORT=8099 npx tsx server/index.ts
```

Uwaga: jeśli tego nie zauważysz, żądania obsłuży **stary** proces ze starą
konfiguracją, a objawy będą wyglądały na błąd w kodzie.

## Pasek „dane z cache sprzed X min"

Pobranie się nie udało, więc proxy oddało ostatni znany stan zamiast pustego
ekranu. Przyczyna jest w logu serwera (`[repo] <klucz>: pobranie nieudane`).
Zwykle to wygasła sesja.

Wymuszenie ponownego pobrania:

```bash
rm -f .cache/*.json
```

Kasowanie cache jest bezpieczne — to nie jest źródło prawdy.

## „Parser ekranu X nie jest jeszcze skalibrowany"

Parser nie znalazł swojej kotwicy w HTML-u. Dwie możliwości:

1. **Moduł jest pusty** — najczęstsze. Sprawdź stronę w przeglądarce.
2. **USOSweb zmienił strukturę** — zrzuć stronę ponownie
   (`./scripts/capture.sh grab <akcja> <nazwa>`) i porównaj kotwicę.

Ten błąd jest celowy: parser woli powiedzieć „nie umiem" niż zwrócić pustą
strukturę, która wygląda jak „brak danych".

## Plan jest pusty

Sprawdź, czy w USOSwebie widzisz zajęcia. Poza semestrem feed zwraca poprawny,
pusty kalendarz — `entries: []` to wynik, nie awaria.

Surowy feed:

```bash
bash -c 'set -a; . ./.env; set +a; curl -s "$USOS_ICAL_URL" | head -20'
```

Powinien zacząć się od `BEGIN:VCALENDAR`. Jeśli zwraca HTML albo błąd — klucz
został unieważniony, weź nowy link z USOSweba.

## E-mail zawsze `null`

To nie błąd. USOSweb ma ustawienie „Kto może oglądać mój adres e-mail". Jeśli
stoi na „Tylko ja", adresu nie ma w HTML-u strony profilowej i nie ma go skąd
wziąć. Zmienisz to w PREFERENCJE PRYWATNOŚCI.

## Testy przechodzą u Ciebie, a padną u kogoś innego

Nie padną. Testy na prawdziwych zrzutach pomijają się, gdy `fixtures/` jest
puste (`existsSync ? describe : describe.skip`). Zrzuty są w `.gitignore`,
bo zawierają dane osobowe.
