# Bezpieczeństwo aplikacji

## Zweryfikowane granice

- Rejestracja wymaga `PILOT_REGISTRATION_CODE`; pusta konfiguracja zamyka rejestrację. Kod i sekrety OAuth należą wyłącznie do lokalnego `.env` / magazynu sekretów.
- Google/Microsoft służą logowaniu do platformy po powiązaniu z kontem lokalnym. Nie zastępują logowania/MFA USOS. Powiązania nie wynikają z adresu e-mail.
- Odzyskanie konta zużywa jednorazowy kod, zmienia hasło, unieważnia sesje i usuwa powiązania Google/Microsoft w jednej transakcji. Po odzyskaniu trzeba powiązać dostawców ponownie.
- Limity logowania obejmują rzeczywiste źródło połączenia i konto. Nie ufamy dowolnym nagłówkom `X-Forwarded-For`. Liczniki istniejących kont nie podlegają ewikcji przez losowe nazwy.
- Zmiany danych konta wymagają ponownego potwierdzenia sekretu i nie przerywają trwającej operacji USOS.
- Host, Origin, cookies właściciela i bieżące połączenie USOS ograniczają HTTP/WebSocket. Starszy serwer developerski ma osobną lokalną granicę Host/Origin.
- Publiczny import planów ma limit współbieżności i prób zarówno dla anonimowych, jak i zalogowanych użytkowników; pozostawia miejsce dla automatycznego planu właściciela.
- Docker dopuszcza 5 równoczesnych logowań/MFA; po udanym przekazaniu sesji osobny jar HTTP zastępuje Chromium. Błąd zamykania przeglądarki zachowuje jej referencję do ponownego sprzątania.
- Lokalny Chromium używa serwerowego proxy CONNECT: wyłącznie HTTPS/443, publiczne adresy, walidacja wszystkich wyników DNS i połączenie do sprawdzonego adresu numerycznego. Loopback, sieci prywatne, link-local, metadata i konserwatywnie zakresy przejściowe IPv6 są blokowane. Brak automatycznego obejścia proxy.
- Kubernetes jest oddzielnym, nieuruchamianym domyślnie wariantem: zdalny Chromium polega na NetworkPolicy, nie proxy aplikacji. Domyślna i maksymalna konfiguracja dostarczonego wariantu wynosi 2, zgodnie z jego obecną quota. Docker nadal ma 5.
- Formularze używają serwerowych, jednorazowych capability i pól ukrytych. Tożsamość i czas ważności są ponownie sprawdzane przed faktycznym zapisem. Zmiany wymagają lokalnego potwierdzenia; timeout nie powoduje automatycznego ponowienia.
- Parametry tokenów/kluczy/callback nie trafiają do metadanych nawigacji. Ambiwalentne query i selektory list w obszarach zapisu wymagają potwierdzenia; dokładne statyczne zasoby uczelni zachowują odczyt.
- Upload obsługuje obecnie PDF, PNG, JPEG, GIF zgodne z `accept`, rozszerzeniem, MIME i sygnaturą. Brak `accept`, archiwa/Office i inne nieobsługiwane kontrolki są oznaczone jako wymagające kalibracji. Sygnatura nie stanowi skanu antywirusowego ani gwarancji poprawności całego dokumentu.

## Testy lokalne

Wymagany Node zgodny z `engines`, `npm ci` w katalogu głównym i `login-pilot`, oraz sandboxowany Chromium (`/usr/bin/chromium` dla testów lokalnych).

```sh
npm run build
npm --prefix login-pilot run build:dashboard
npm test
npm --prefix login-pilot test
```

`login-pilot/test/security-audit.test.mjs` zawiera testy recovery, dwóch wariantów przeciążenia limitera, stanu busy, GET/CSRF, uploadów, wygasania capability, sprzątania Chromium i proxy. `social-login.test.mjs` obejmuje unieważnienie już zweryfikowanych proof po recovery obu dostawców. `server/security.test.ts` sprawdza starszy serwer lokalny.

## Przed publicznym Azure

HTTPS i dokładny `PILOT_PUBLIC_ORIGIN` są wymagane poza loopback. Domena, konfiguracja aplikacji OAuth, callbacki, zaufany reverse proxy, limity na brzegu, HSTS/TLS, kopie zapasowe i monitoring wymagają walidacji na rzeczywistym środowisku. Ten audyt lokalny nie jest dowodem wdrożenia Azure ani pełnej zgodności ASVS.

Wariant Docker ma jeden kontener i wspólny systemowy UID aplikacji/Chromium. Proxy ogranicza SSRF z sieci przeglądarki, ale nie zastępuje izolacji procesów po hipotetycznej ucieczce z sandboxa. Przed publiczną wielodostępną instalacją zalecane są odseparowane workery i egress na poziomie sieci. Semantyka rzeczywistych formularzy USOS wymaga kalibracji na uprawnionym koncie: testy syntetyczne nie dowodzą działania ani braku skutków ubocznych nieudokumentowanych endpointów uczelni.
