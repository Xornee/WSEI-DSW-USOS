# Logowanie Google / Microsoft, 5 miejsc USOS i HTTPS na Azure

## Co działa i co trzeba skonfigurować

Platforma ma logowanie lokalne oraz OIDC Google i Microsoft. Dostawcy bez kompletnej konfiguracji są wyłączeni, a interfejs pokazuje „wymaga konfiguracji”. Nie ma jeszcze domeny, aplikacji OAuth ani wdrożenia Azure. Integracja jest testowana z podpisanymi odpowiedziami syntetycznego dostawcy; rzeczywisty test Google/Microsoft należy wykonać po rejestracji aplikacji.

**Pierwsze użycie:** uzyskaj kod od administratora → utwórz konto lokalne z kodem → profil `/account` → „Sposoby logowania” → potwierdź hasłem aplikacji → „Połącz Google” lub „Połącz Microsoft”. Następnie wyloguj się i skorzystaj z przycisku dostawcy. Nieznana tożsamość nie tworzy konta ani nie łączy się na podstawie emaila. Hasło lokalne i kod odzyskiwania pozostają dostępne. Odłączenie dostawcy wymaga hasła lokalnego.

Google/Microsoft uwierzytelniają **konto platformy**, nie sesję USOS. „Połącz USOS” nadal otwiera odizolowane Chromium i wymaga logowania/MFA uczelni. Tokeny Google/Entra nie są przekazywane do USOS. Konto Microsoft w zwykłej przeglądarce użytkownika nie udostępnia sesji osobnemu Chromium serwera.

## Jednoczesność i zasoby

- `PILOT_MAX_BROWSERS=5`: pięć osób jednocześnie przechodzi logowanie/MFA. Szósta otrzymuje komunikat zajętości i ponawia próbę; nie ma nieograniczonej kolejki.
- Rozpoczęcia są rozłożone co 1,2 s, ale wszystkie pięć logowań pozostaje równolegle aktywne.
- Chromium zamyka się po zweryfikowanym przekazaniu sesji. Zwykły dashboard używa oddzielnego jar HTTP, a nie Chromium. Dwadzieścia zalogowanych użytkowników nie oznacza dwudziestu przeglądarek.
- Limit sesji platformy to 32, a jednoczesne kosztowne operacje haseł lokalnych to 2. To oddzielne limity; nie jest to gwarancja wydajności 32 użytkowników.
- Porzucone logowanie zamyka się po 5 min bez aktywności lub 10 min od startu. Sam polling statusu nie przedłuża logowania. Konto platformy pozostaje zalogowane.
- Przeglądarka w trakcie zamykania i nieudane sprzątanie nadal zajmują miejsce; ponowienie nie omija limitu.
- Compose ma limit 1024 procesów/wątków: poprzednie 512 zostało osiągnięte przy próbie pięciu Chromium. Limit pamięci nadal wynosi 3 GiB, CPU 2, tmpfs 512 MiB i shm 256 MiB.
- Compose zachowuje sandbox Chromium, użytkownika 1000, read-only root, cap-drop i brak Docker socket. Pięć przeglądarek trzeba zmierzyć z prawdziwym MFA przed doborem Azure CPU/RAM; test strony-fixture nie modeluje kosztu strony Microsoft.

## Google

1. Utwórz projekt i skonfiguruj ekran zgody w Google Cloud. Dla trybu testowego dodaj odpowiednich użytkowników testowych.
2. Utwórz **OAuth client ID → Web application**.
3. Dodaj dokładny Authorized redirect URI: `https://HOST/api/auth/oauth/google/callback`, gdzie `HOST` zastępuje rzeczywista domena. Lokalnie: `http://127.0.0.1:8789/api/auth/oauth/google/callback` (inny port wymaga osobnego URI).
4. Ustaw po stronie serwera `GOOGLE_CLIENT_ID` i `GOOGLE_CLIENT_SECRET`. Nie dodawaj ich do frontendowych zmiennych `VITE_*`.

## Microsoft Entra

1. Utwórz App registration w **docelowym tenant**. Ta implementacja używa konkretnego tenant UUID; `common`, `organizations` i nazwa domeny tenant nie są akceptowane.
2. Authentication → Add platform → **Web**, nie SPA. Redirect URI: `https://HOST/api/auth/oauth/microsoft/callback`; lokalnie `http://127.0.0.1:8789/api/auth/oauth/microsoft/callback`.
3. Utwórz client secret i zapisz jego **value**, nie identyfikator secret. Ustaw datę rotacji/wygaśnięcia.
4. Ustaw `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` i `MICROSOFT_TENANT_ID` (Directory/tenant UUID). Dostęp użytkownika/gościa zależy od konfiguracji tenant i zgody. Ta wersja nie implementuje logowania dowolnego tenant ani automatycznego dostępu do uczelni.
5. Przepływ używa `openid profile email` i authorization code + PKCE. Nie wymaga Graph, `offline_access`, implicit grant ani haseł Microsoft wpisywanych w formularzu platformy.

## Konfiguracja lokalna / przyszłe Azure HTTPS

Skopiuj `.env.example` do ignorowanego `.env`. Puste pola pozostawiają dostawcę wyłączonego. `PILOT_PUBLIC_ORIGIN` ustaw na rzeczywisty origin `https://HOST` **bez ścieżki i końcowego slash**. Pole jest puste domyślnie, więc Compose używa lokalnego HTTP.

```fish
cp .env.example .env
chmod 600 .env
docker compose up -d --build
```

Do Azure wybierz jeden kontener/replikę albo pojedynczą VM z Compose; obecnie sesje USOS, OAuth state i potwierdzenia callbacku istnieją w RAM. Restart wylogowuje użytkowników. Wiele replik wymaga współdzielonego store/koordynacji sesji i globalnego limitu Chromium; samo uruchomienie kilku replik mnoży limit.

Ustaw sekret `PILOT_REGISTRATION_CODE` (16–256 bajtów); pusta konfiguracja zamyka rejestrację, także pierwszego administratora. Przed otwarciem publicznego ingress utwórz pierwsze konto administratora z poprawnym kodem przez prywatny dostęp. Pierwsze konto lokalne zostaje administratorem, więc nie wystawiaj pustej bazy publicznie. Włącz HTTPS i WSS, zachowaj `Host` zgodny z `PILOT_PUBLIC_ORIGIN`, zamknij bezpośredni ingress HTTP do backendu, wyłącz cache i rejestrowanie query string/body na trasach auth. Nie polegaj na dowolnym `X-Forwarded-Host`/`X-Forwarded-Proto`: serwer ich nie ufa. Dodaj trwały wolumen `/data/accounts` z backupem i uprawnieniami 1000:1000. Wstrzyknij sekrety z konfiguracji Azure/Key Vault zamiast obrazu lub repo. Nie zakładaj, że SQLite na dowolnym współdzielonym systemie plików jest odpowiedni do wielu replik.

Przy aktywacji sprawdź: oba powiązania → wylogowanie → oba logowania → odłączenie → hasło lokalne nadal działa → lock/recovery → osobne USOS/MFA → limit pięciu. Nie zapisuj tokenów/cookies/screencastów w raporcie.

## Mechanizmy ochrony

- Losowe, jednorazowe `state`, nonce i PKCE S256; korelacja z HttpOnly cookie przeglądarki. Flow wygasa po 5 min, wynik callbacku po maksymalnie 60 s.
- Callback GET i dokładny landing `/account?oauth=complete` przy nawigacji dokumentu są wyjątkami od blokady cross-site; żaden nie tworzy sesji. Weryfikuje state/cookie/provider i token, a dopiero POST z tej samej platformy kończy logowanie. Cookie aplikacji SameSite=Strict chroni przed cichą zmianą konta podczas redirectu.
- HTTPS: cookie aplikacji i korelacji mają `__Host-`, Secure, HttpOnly, Path=/, bez Domain. Cookie aplikacji: SameSite=Strict; cookie korelacji: Lax. Lokalny HTTP używa nieprefiksowanych cookies.
- JOSE weryfikuje RS256 ze stałego JWKS dostawcy, issuer, audience, iat/exp, nonce, azp oraz tenant Microsoft. Nie ufa jku/x5u/jwk wskazanemu w tokenie. JWKS ma ograniczony rozmiar, cache i single-flight.
- Powiązanie wymaga hasła lokalnego oraz tej samej aktualnej sesji/wersji zabezpieczeń przy zakończeniu. Tożsamość `(provider, issuer, sub)` ma unikalność w SQLite. Email i role dostawcy nie wybierają konta i nie nadają uprawnień.
- Zmiana tokenu sesji po powiązaniu zachowuje połączenie USOS tego samego właściciela. Nowe logowanie unieważnia poprzednią sesję. Lock/revoke/password/recovery i unlink nie pozwalają kończyć nieaktualnych powiązań.
- Origin/Host, ograniczenia body/tokenów, limity prób i operacji haseł, CSP, no-store, no-referrer, HSTS na origin HTTPS. Sekrety pozostają na backendzie; ID/access/refresh tokens nie są zapisywane w SQLite.

## Testy i zakres dowodu

```fish
npm ci
npm --prefix login-pilot ci
npm --prefix login-pilot run build:dashboard
npm test
npm --prefix login-pilot test
npm --prefix login-pilot run check
node scripts/check-publication.mjs
```

`login-pilot/test/social-login.test.mjs` obejmuje podpisane Google/MS, CSRF, replay, błędne claims/signature, provider mixup, konta i unikalność, zmianę konta, lock/unlink i host/cookies HTTPS. `login-capacity.test.mjs` obejmuje pięć rezerwacji, odrzucenie szóstej, dwadzieścia połączeń backendowych, zajętość podczas cleanup, porzucone MFA i walidację limitów. `social-ui.test.mjs` sprawdza rzeczywiste redirecty przeglądarki ze strony-fixture dostawcy, nie logowanie produkcyjne Google/Microsoft.

### Źródła protokołu

- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [Microsoft authorization code + PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
- [JOSE JWT/JWKS verification](https://github.com/panva/jose)

## Remediacja wykryta podczas audytu

Skan lockfile wykrył podatne `shell-quote` i `source-map-js` w narzędziach build/dev. Overrides przypinają wersje 1.12.0 i 1.2.2 bez zmiany głównych wersji aplikacji. Obraz aktualizuje OpenSSL i usuwa niewykorzystywane komponenty GStreamer dla WebKit oraz globalne npm/undici, których uruchomiona aplikacja nie używa. Aplikacja używa własnych zależności `/app`, a polecenie startu kontenera nadal jest `node server.mjs`. Test uruchomienia sandboxu i skan gotowego obrazu wykonuj po przebudowie; baza skanera i wynik są zależne od daty.
