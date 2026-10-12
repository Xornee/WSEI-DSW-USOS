# Architektura

## Dlaczego proxy, a nie sam frontend

USOSweb nie da się odpytać bezpośrednio z przeglądarki:

| Przeszkoda | Nagłówek / zachowanie | Skutek |
|---|---|---|
| Brak CORS | zero `Access-Control-Allow-*` | `fetch` z `localhost:5173` jest blokowany |
| Ciasteczko niedostępne dla JS | `Set-Cookie: PHPSESSID=...; HttpOnly` | strona nie odczyta własnej sesji |
| Zakaz osadzania | `X-Frame-Options: SAMEORIGIN` | iframe odpada |

Dlatego sesję trzyma proces lokalny, a front rozmawia wyłącznie z nim.

```
przeglądarka :5173  ──/api──▶  proxy :8080  ──cookie──▶  usosweb.ideis.pl
                                      └──────klucz──────▶  usosapps.ideis.pl (iCal)
```

Front woła `/api/...` na własnym origin, a Vite (`vite.config.ts`) przekazuje to
na `127.0.0.1:8080`. Problem CORS nie występuje, bo nie ma żądania cross-origin.

## Warstwy

```
shared/types.ts          kontrakt proxy ↔ front (jedno źródło prawdy dla obu stron)
server/
  index.ts               Hono: 6 endpointów, wspólna koperta odpowiedzi
  usos/config.ts         odczyt .env
  usos/client.ts         HTTP do USOSweb: kolejka, throttle, wykrywanie wylogowania
  usos/cache.ts          cache na dysku z TTL
  usos/repository.ts     UsosRepository: cache-first, fallback na stale, tryb demo
  usos/ical.ts           parser iCalendar (RFC 5545)
  usos/scrape/           parsery HTML, jeden plik na ekran
  usos/mock.ts           dane demo
web/src/
  lib/api.ts             useEndpoint — jedna ścieżka obsługi błędu
  screens/               Home, Plan, Grades, Student
  components/            Card, StateBanner, Skeleton
```

## UsosRepository

Interfejs w `server/usos/repository.ts` ma dwie implementacje:

- **`MockRepository`** — gdy w `.env` nie ma `USOS_SESSION`. Cała aplikacja
  działa na danych przykładowych, bez ruchu do uczelni.
- **`UsosWebRepository`** — dane prawdziwe.

Wybór zapada raz, przy starcie (`server/index.ts`), na podstawie obecności sesji.

To jest też droga wyjścia ze scrapingu: gdy dostaniesz consumer key do USOS API,
dopisujesz trzecią implementację i zmieniasz jedną linijkę. Kontrakt JSON i całe
GUI zostają nietknięte.

## Cache i degradacja

`UsosWebRepository.cached()` realizuje jedną zasadę: **nigdy nie pokazuj pustego
ekranu, jeśli masz cokolwiek**.

1. Jest świeży wpis w cache (młodszy niż `CACHE_TTL`)? Oddaj go, `source: "cache"`.
2. Nie ma? Pobierz z uczelni, zapisz, oddaj `source: "live"`.
3. Pobranie padło, ale jest **stary** wpis? Oddaj go z `stale: true` — front
   pokaże pasek „dane z cache sprzed X min".
4. Padło i nie ma nic? Dopiero wtedy błąd.

Cache leży w `.cache/*.json`, jeden plik na klucz. Kasowanie tych plików jest
bezpieczne — to tylko wymuszenie ponownego pobrania.

## Zasady wobec uczelni

Zaszyte w `UsosClient`, nie do obejścia przypadkiem:

- **Jedno zapytanie naraz.** Requesty idą przez łańcuch promisów, nigdy równolegle.
- **Minimum 1200 ms odstępu** (`MIN_INTERVAL_MS`).
- **Uczciwy `User-Agent`**, który mówi czym jest ten klient.
- **Cache 15 minut**, żeby hot-reload frontu nie generował ruchu.

Plan idzie do API, nie do USOSweba, więc nie obciąża aplikacji webowej wcale.

## Czego świadomie nie robimy

USOSweb wystawia `usosapiProxy.php` — wewnętrzny most do USOS API, z którego
korzysta jego własny JavaScript. Odpowiada on:

```
Invalid CSRF token. This is an internal service.
Do not use it as an API. Use official USOS API instead.
```

Token CSRF jest w źródle strony i dałoby się go dołożyć. Nie robimy tego:
endpoint sam nazywa swoje przeznaczenie i wskazuje właściwą drogę. Czytanie
stron renderowanych dla zalogowanego użytkownika to jedno, obchodzenie kontroli,
która mówi „nie tędy" — co innego.
