# Sprawy studenta wewnątrz aplikacji

## Przepływ

Moduł → lokalne szczegóły → formularz → podsumowanie → osobne potwierdzenie → odpowiedź uczelni. UI nie oznacza samego HTTP 200 jako zaakceptowania sprawy: pokazuje komunikat i stan zwrócony przez uczelnię. Nawigacja korzysta z hashy `#workflow/entry/...` i `#workflow/target/...`, więc działa wstecz/dalej bez opuszczania aplikacji.

Widoki: płatności, wnioski/decyzje/dyplomy, sprawdziany, rejestracje, zajęcia/katalog, kontakty, przebieg studiów, mLegitymacja/stypendia, aktualności oraz podstrony strefy studenta. Odnośniki do innych usług (np. poczta lub osobny portal) zachowują swój właściwy adres.

## API wieloużytkownikowego serwera `login-pilot`

- `GET /api/workflows?entry=<id>`: stały punkt wejścia znany aplikacji.
- `GET /api/workflows?target=<opaque>&refresh=0|1`: szczegóły odnośnika odkrytego na stronie tej sesji. `refresh=1` odczytuje stan; nigdy nie ponawia POST.
- `POST /api/workflows/submit`: JSON `{formId, fields: {name: string[]}, confirmed: boolean}` lub multipart z JSON w `payload` i plikami w `file:<name>`.
- `GET /api/workflows/download?target=<opaque>`: dokument z własnej sesji; plik jest pobierany przez backend i zwracany jako attachment, bez przekierowania przeglądarki.

POST wymaga zgodnego Origin oraz `X-USOS-Connection` z aktualnego panelu. Identyfikatory spraw/formularzy są losowe, ważne 10 minut i powiązane z jednym połączeniem. Zmiana konta, rozłączenie lub wygaśnięcie niszczy je. Serwer nie przyjmuje adresu docelowego, metody, cookies ani ukrytych pól od klienta.

## Formularze i dokumenty

Obsługiwane pola: tekst, e-mail, liczba, data, telefon, URL, textarea, select (także wiele wartości), checkbox, radio, załącznik. Zachowane są nazwy, domyślne wartości, wymagane pola, opcje, readonly oraz wybrany przycisk formularza. Ukryte pola/CSRF pozostają w pamięci serwera. Wyszukiwanie GET nie wymaga potwierdzenia zmiany; POST i rozpoznane odnośniki zmieniające stan wymagają potwierdzenia.

Przed wysłaniem sprawdzana jest tożsamość sesji. Akcja jest jednorazowa, także przy niejednoznacznym błędzie po wysłaniu; brak automatycznych ponowień. Po zmianie cache panelu jest unieważniany. Dozwolone zapisy obejmują formularze wniosków, rejestracji, stypendiów i mLegitymacji odkryte w tej sesji, nie dowolne akcje systemu.

Jeden załącznik: do 5 MB; całe żądanie: do 10 MB; dokument: do 8 MB. PDF wymaga poprawnego początku `%PDF-`. Dokumenty zwracające stronę logowania nie są zapisywane jako pozorny PDF. Redirect po POST jest akceptowany wyłącznie do odczytowej strony tego samego hosta.

## Granica potwierdzonego działania

Testy obejmują syntetyczne formularze wniosku, rejestracji, wyszukiwania oraz pobranie PDF. Nie wykonują zapisów na prawdziwym koncie. Rzeczywiste formularze uczelni wymagają sprawdzenia po własnym SSO/MFA. JavaScript/AJAX, niestandardowe web components, formularze hasła i zewnętrzne bramki nie są odtwarzane jako udawane działające kontrolki: UI pokazuje informację o potrzebie kalibracji. Przycisk otwierający USOS nie służy do zamaskowania brakującej implementacji.

## Sprawdzenie lokalne

```sh
npm ci
npm --prefix login-pilot ci
npm run build
npm --prefix login-pilot run build:dashboard
npm test
npm --prefix login-pilot test
```

`login-pilot/test/workflows.test.mjs` sprawdza izolację kont, Origin/generację, potwierdzanie zmian, walidację pól, pojedyncze wykonanie, brak ponawiania po timeout, utratę sesji, redirect, upload i pobieranie. Test React/Chromium przechodzi od modułu do wyniku czynności bez nawigowania do USOSweb. Układ strony, źródła danych i parsowanie bazowe pozostają oddzielone od adaptera workflowów.
