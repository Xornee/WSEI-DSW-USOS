# Aplikacja kont i interaktywne połączenie USOS

Aktualną instrukcją uruchomienia z czystej kopii jest [główny README](../README.md). Rekomendowany runtime: Docker Compose z katalogu głównego, bez Minikube.

Ten moduł obsługuje konta aplikacji, izolowany Chromium, interaktywne logowanie uczelniane/Microsoft/MFA, sprawdzenie sesji i panel React. Prywatna sesja i cache należą do konkretnego połączenia; publiczne dane harmonogramu można współdzielić.

Plan dobiera tok automatycznie z aktywnych etapów studiów w USOS. Przy kilku dopasowaniach pokazuje nazwy kandydatów; bez USOS pokazuje jawny podgląd publiczny. Eksport iCal jest zachowany wyłącznie jako starsza ścieżka kompatybilności.

## Lokalny development

Z katalogu głównego: Node 24; dla interaktywnego Chromium bez Dockera Linux i `/usr/bin/chromium` lub `CHROMIUM_PATH`.

```sh
npm ci
npm --prefix login-pilot ci
npm run build:dashboard
env PILOT_PORT=8789 WORKER_BACKEND=local npm start
```

Bez `PILOT_PORT` serwer tego modułu używa portu 8788. Root Docker Compose używa portu z `.env` i wewnętrznego 8789.

## Testy

```sh
npm --prefix login-pilot test
npm --prefix login-pilot run check
```

Testy mają syntetyczne konta i izolowane bazy. Skrypty `*-live.mjs` nie wchodzą do zwykłego `npm test`; mogą wykonywać działania na wskazanym środowisku, dlatego są uruchamiane osobno.

## Dane

W Dockerze konta trafiają do nazwanego wolumenu Compose, w bezpośrednim Node do lokalnego `.data/`. Hasła kont są przechowywane jako scrypt, a sesje aplikacji/USOS pozostają w pamięci. Restart wymaga ponownego logowania, ale nie tworzenia kont od nowa.

Zdalny viewer przesyła obraz i zdarzenia klawiatury/myszy. Lokalny menedżer haseł, sprzętowe passkeys, upload/download plików i clipboard-copy-out nie są implementowane. Dostępność logowania zależy także od reguł uczelnianego SSO/MFA.

Starszą implementację workerów Kubernetes zachowano w [k8s/](k8s/README.md). Nie jest uruchamiana przez root Compose.
