# Harmonogram IDEIS i Docker

Pełna, aktualna instrukcja pobrania, pierwszego startu, kont, konfiguracji, testów i publikacji: [README](../README.md).

## Źródło planu

Importer używa stałego hosta `harmonogram.krakow.ideis.pl`. Publiczna strona toku pokazuje domyślnie jeden dzień, dlatego backend odczytuje zakres „Cały semestr” i wykonuje publiczny filtr tabeli DevExpress. Parser weryfikuje zakres, daty, godziny, kolumny i kompletność odpowiedzi. Strefa czasu: Europe/Warsaw.

## Automatyczne dopasowanie

`GET /api/plan` i `GET /api/home` rozpoznają tok połączonego konta z kierunku, aktywnej ścieżki, trybu, stopnia i naboru wyliczonego z cyklu/semestru. Publiczna wyszukiwarka toków dostarcza aktualne identyfikatory filtrów. Dopasowanie pozostaje w zakresie połączenia; nie ma globalnego wyboru konta w localStorage.

`Plan.selection.state` rozróżnia `automatic`, `confirmed`, `choice_required`, `unresolved` i `public`. Bez sesji `/schedule` pokazuje oznaczony publiczny podgląd. `scope=public` jawnie żąda publicznego planu; `trackId` jest opcjonalnym wyborem z dopasowanych kandydatów konta.

Cache publiczny: 15 minut, ograniczona liczba wpisów i współdzielenie trwających zapytań. Żądania upstream są serializowane co najmniej co 1200 ms; nie wysyłają danych osobowych ani credentials do wyszukiwarki.

## Runtime

Docker Compose ustawia `WORKER_BACKEND=local` i osobne Chromium w kontenerze. Named volume `accounts` powstaje pusty i pozostaje po `docker compose down`. Nie kopiujemy bazy ani kubeconfig autora. Port hosta ustala `APP_PORT`; canonical origin zawsze odpowiada temu portowi na `127.0.0.1`.

Profil `docker/chromium-seccomp.json` bazuje na domyślnym Moby z dopuszczeniami potrzebnymi Chromium. Rootfs jest read-only, proces ma UID1000 i cap-drop ALL. Po zmianie profilu trzeba odtworzyć kontener (`--force-recreate`), bo zmiana samej zawartości pliku nie musi zmienić konfiguracji Compose.
