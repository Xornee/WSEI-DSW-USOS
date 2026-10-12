# WSEI-DSW-USOS

Lokalny panel USOSweb/IDEIS: plan zajęć, oceny, profil, przebieg studiów i pozostałe widoki studenta. React działa razem z lokalnym serwerem Node, a logowanie uczelniane odbywa się w odizolowanym Chromium.

**Najprostszy start: Docker Compose. Bez Minikube, bez kopiowania ciasteczek i bez gotowych kont.** Kopia zawiera kod, lockfile i syntetyczne testy, a nie bazę kont ani sesje autora.

## 1. Wymagania

- Docker z poleceniem `docker compose`: [oficjalna instalacja](https://docs.docker.com/compose/install/).
- Działający backend kontenerów Linux. Kopię przetestowano na Linux x86_64. Windows/macOS z Docker Desktop nie były sprawdzane w tej walidacji.
- Dostęp do Internetu do pobrania obrazów/pakietów oraz połączenia z IDEIS i logowaniem uczelnianym.
- Kilka GB wolnego dysku na obraz Chromium; kontener aplikacji ma limit 3 GB RAM i 2 CPU.
- Przeglądarka na komputerze. Interfejs i zdalny ekran logowania są desktop-first.

Sprawdź narzędzia:

```sh
docker version
docker compose version
```

Node i npm na hoście **nie są potrzebne do startu Dockerowego**.

## 2. Pobranie i pierwszy start

### ZIP przygotowany do publikacji

```sh
unzip usos-local-github.zip
cd usos-local-github
```

Jeśli pobierasz ZIP bezpośrednio z GitHuba, wejdź do rozpakowanego katalogu zawierającego `compose.yaml` — jego nazwa może być inna.

### Klonowanie repozytorium

Sklonuj publiczne repozytorium:

```sh
git clone https://github.com/Xornee/WSEI-DSW-USOS.git usos-local-github
cd usos-local-github
```

### Uruchomienie

Z katalogu projektu:

```sh
cp .env.example .env
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 180
docker compose ps
```

Pierwszy build pobiera zależności i obraz przeglądarki, więc trwa dłużej niż kolejne uruchomienia. Stan aplikacji powinien być `healthy`.

Otwórz dokładnie adres z `127.0.0.1`:

- **Konto / połączenie USOS:** http://127.0.0.1:8789/account
- **Plan:** http://127.0.0.1:8789/schedule#plan
- **Gotowość:** http://127.0.0.1:8789/readyz

`localhost` nie jest zamiennikiem skonfigurowanego adresu: aplikacja sprawdza zgodność Host/Origin.

## 3. Własne konto i automatyczny tok

1. Otwórz stronę konta i utwórz własne konto **tej aplikacji**. Pierwsze utworzone konto jest administratorem lokalnej instancji. Nie ma domyślnego loginu ani hasła.
2. Zaloguj się do aplikacji i przejdź do połączenia USOS. Kliknij przycisk uruchomienia Chromium.
3. W ekranie zdalnej przeglądarki przejdź przez właściwe logowanie uczelniane/Microsoft i MFA. Wpisujesz dane na stronie logowania, nie do pliku `.env`.
4. Po powrocie do USOS sprawdź połączenie przyciskiem w aplikacji, a następnie otwórz panel.
5. Plan automatycznie dobierze tok z aktywnego przebiegu studiów: kierunku, ścieżki, trybu i naboru wyliczonego z cyklu oraz semestru. Nie wpisujesz numeru ani linku toku.
6. Jeśli dane pasują do kilku toków, wybierasz nazwę z listy. Niepełne dane nie powodują przypisania przypadkowego toku.

Bez połączenia USOS dostępny jest jawnie oznaczony **publiczny podgląd** toku 958. To nie jest rozpoznanie osobistego planu. Publiczne źródło: [IDEIS Kraków — plany toków](https://harmonogram.krakow.ideis.pl/Plany/PlanyTokow/958).

Plan obejmuje grupy toku; filtr grup ogranicza widok. Rozpoznanie toku nie jest potwierdzeniem zapisania na każdą grupę. Oceny i profil wymagają własnej aktywnej sesji USOS. Restart kontenera zachowuje konta aplikacji, ale wymaga ponownego logowania i połączenia USOS.

Integracja korzysta z ustalonych serwisów `usosweb.ideis.pl` i `harmonogram.krakow.ideis.pl`. Obsługa innej uczelni wymaga dostosowania integracji, nie tylko zmiany adresu przeglądarki.

## 4. Konfiguracja i dane lokalne

`.env.example` zawiera tylko dwa niesekretne ustawienia:

| Ustawienie | Domyślnie | Znaczenie |
|---|---|---|
| `APP_PORT` | `8789` | Port na komputerze; kontener nadal używa 8789 |
| `TIMETABLE_TRACK_ID` | `958` | Tok publicznego podglądu bez połączenia USOS; nie nadpisuje automatycznego toku konta |

Jeśli port 8789 jest zajęty, zmień `APP_PORT=8790` w lokalnym `.env`, uruchom Compose ponownie i otwieraj `http://127.0.0.1:8790`.

SQLite z kontami powstaje dopiero po uruchomieniu w nazwanym wolumenie Compose `accounts`. Nie jest częścią kodu ani archiwum. Katalog danych w obrazie należy do UID 1000, więc pierwszy start z pustym wolumenem nie wymaga ręcznego `chown` hosta. [Opis wolumenów Docker](https://docs.docker.com/engine/storage/volumes/).

Standardowe komendy:

```sh
docker compose ps
docker compose logs --tail 100 app
docker compose stop
docker compose start
docker compose down
docker compose up -d --build --wait --wait-timeout 180
```

`down` zachowuje wolumen z kontami. Pełny reset danych tej instancji wykonuje `docker compose down --volumes`; usuwa konta z wolumenu tego projektu. Nie jest potrzebny przy aktualizacji.

Obraz uruchamia serwer jako UID 1000, z rootfs read-only, bez dodatkowych capabilities i bez montowania socketu Dockera/kubeconfig. Chromium korzysta z sandboxa. Po zmianie pliku seccomp zastosuj:

```sh
docker compose up -d --build --force-recreate --wait --wait-timeout 180
```

## 5. Rozwiązywanie typowych problemów

| Objaw | Kontrola / działanie |
|---|---|
| `Cannot connect to the Docker daemon` | Uruchom Docker i sprawdź `docker version` |
| Port zajęty | Ustaw inny `APP_PORT` w `.env`; użyj tego samego portu w URL |
| HTTP 403 pod `localhost` | Otwórz skonfigurowane `http://127.0.0.1:PORT` |
| Kontener nie jest `healthy` | Sprawdź `docker compose logs --tail 100 app` i `docker compose ps` |
| Chromium nie startuje | Sprawdź aktualny Docker i dostępne zasoby; zachowaj dostarczony profil seccomp i wymuś odtworzenie kontenera |
| Tylko publiczny plan | Zaloguj się do aplikacji, połącz USOS i sprawdź połączenie |
| Tok nie jest rozpoznany | Sprawdź aktywny etap studiów w USOS; dopasowanie potrzebuje aktualnego cyklu/semestru i kierunku |
| Logowanie wygasło po restarcie | Zaloguj się i połącz USOS ponownie; nie twórz konta od nowa |
| Uczelnia zmieniła HTML lub odpowiada błędem | Parser zwróci błąd zamiast udawać pusty plan; wymaga sprawdzenia integracji |

## 6. Development i testy

Dla pracy nad kodem: Node.js 24 i npm. Lockfile są częścią projektu.

```sh
npm ci
npm --prefix login-pilot ci
npm test
npm run build
npm run build:dashboard
npm run test:pilot
npm run check:publication
```

Testy parserów korzystają z syntetycznych plików w `server/usos/scrape/fixtures/`; nie potrzebują sesji ani prywatnych zrzutów. Publiczne fixture harmonogramu mają zanonimizowane dane prowadzących i syntetyczny stan callbacków.

Frontend / starszy proxy w trybie developerskim:

```sh
npm run dev
```

Frontend: `http://localhost:5173`; proxy: `http://127.0.0.1:8080`. Bez uczelnianej sesji prywatne ekrany tego starszego proxy używają danych demo, a plan korzysta z publicznego harmonogramu. To inna ścieżka niż pełna aplikacja kont w Dockerze.

Pełny serwer bez Dockera można uruchomić na Linux z Chromium pod `/usr/bin/chromium` (lub przez `CHROMIUM_PATH`):

```sh
npm run build:dashboard
env PILOT_PORT=8789 WORKER_BACKEND=local npm start
```

W tej ścieżce bibliotek systemowych Chromium nie dostarcza Docker. Pełną, świeżą instalację sprawdzono dla Docker Compose; testy uruchomiono na hoście Linux z już zainstalowanym Chromium.

`.env.legacy.example` dotyczy wyłącznie opcjonalnego starego proxy. Docker/interaktywne SSO nie wymagają kopiowania `PHPSESSID` ani prywatnego linku iCal.

## 7. Publikowanie na GitHubie

Wrzucaj **tę czystą kopię**, nie katalog działającej instalacji. Paczka nie zawiera `.env`, baz kont, prywatnych HTML, cookies, logów, screenshotów, historii audytów, `node_modules` ani wyników builda. Nie zawiera historii Git autora.

Po własnych zmianach, z katalogu projektu:

```sh
npm run check:publication
```

Przed publikacją uruchom również [Gitleaks](https://github.com/gitleaks/gitleaks); paczkę sprawdzono wersją 8.30.1:

```sh
gitleaks dir . --redact=100
```

`.gitignore` wyklucza lokalne `.env`, dane i prywatne zrzuty. Kopie `.env.example`/`.env.legacy.example` pozostają niesekretne. Check publikacyjny skanuje pliki przeznaczone do wersjonowania; zainicjalizowany Git uwzględnia także błędnie śledzone pliki ignorowane.

Utwórz puste repozytorium na GitHubie, podstaw jego rzeczywisty adres za `GITHUB_REPOSITORY_URL`, a następnie wykonaj samodzielnie:

```sh
git init -b main
git add .
git diff --cached --stat
git commit -m "Initial public source release"
git remote add origin GITHUB_REPOSITORY_URL
git push -u origin main
```

Te komendy są instrukcją publikacji — przygotowanie kopii nie wysyła projektu na GitHub.

## 8. Struktura i dokumentacja

```text
web/src/                       frontend React i widoki
shared/                        kontrakty API
login-pilot/                   aplikacja kont, SSO, Chromium, prywatne sesje
server/usos/                   importer IDEIS i parsery USOS
server/usos/scrape/fixtures/    wyłącznie syntetyczne dane testowe
Dockerfile, compose.yaml       lokalny runtime Docker
scripts/check-publication.mjs   kontrola plików przed publikacją
scripts/capture.sh             opcjonalne prywatne zrzuty developerskie
login-pilot/k8s/                wcześniejsza, opcjonalna implementacja Kubernetes
```

Aktualny start opisuje ten README. [Architektura](docs/01-architektura.md), [źródła danych](docs/02-zrodla-danych.md), [API](docs/03-api.md), [nowe moduły](docs/04-dodawanie-modulu.md), [problemy](docs/05-problemy.md), [frontend](docs/06-frontend-i-publiczne-zrodla.md), [panel](docs/07-panel-studenta.md), [harmonogram](docs/08-harmonogram-i-docker.md).

Pliki Kubernetes zachowano jako część projektu, ale zwykły start i testy npm nie uruchamiają klastra. Testy `*-live.mjs` są osobnymi, opt-in narzędziami, nie częścią instrukcji startu Dockerowego.
