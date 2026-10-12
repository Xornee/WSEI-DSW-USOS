# Frontend: motywy i publiczne informacje uczelni

## Widoki

- Przegląd, plan zajęć, oceny i profil nadal korzystają z istniejącego proxy.
- **Aktualności** (`#news`, `GET /api/news`) czytają publiczną stronę USOSweb. Każdy komunikat można rozwinąć, wyszukać i otworzyć jego załączniki.
- **Kalendarz akademicki** (`#academic`, `GET /api/terms`) pokazuje cykle z oficjalnego USOS API: początek cyklu, ostatni dzień zajęć i ostatni dzień cyklu. To nie jest indywidualny plan studenta.
- **Strefa studenta** (`#resources`) zawiera osiem odnośników z oficjalnego menu: rejestracje, instrukcje, biblioteka, strefa studenta, praktyki, konkursy, ubezpieczenie i kontakt. Linki otwierają USOSweb w nowej karcie; nie są lokalnym zapisem na zajęcia.

Interfejs jest przeznaczony na desktop. Przycisk Jasny/Ciemny zapisuje wybór w `localStorage` pod kluczem `usos-theme`. Domyślnie pozostaje jasny. Motyw jest ustawiany przed pierwszym renderem; zablokowany storage nie wyłącza przełącznika. Zmiana synchronizuje się między kartami.

## Zweryfikowane źródła — 2026-09-14

- Indeks metod tej instalacji: https://usosapps.ideis.pl/services/apiref/method_index
- Metadane news: https://usosapps.ideis.pl/services/apiref/method?name=services/news/search
- Dokumentacja news: https://usosapps.ideis.pl/developers/api/services/news/#search
- Publiczna strona aktualności: https://usosweb.ideis.pl/kontroler.php?_action=news/default
- Metadane wyszukiwania cykli: https://usosapps.ideis.pl/services/apiref/method?name=services/terms/search
- Definicja cyklu: https://usosapps.ideis.pl/services/apiref/method?name=services/terms/term

`services/news/search` wymaga podpisu Consumer OAuth. Sam indeks metod nie jest kluczem do danych. Dlatego aktualności na tym etapie korzystają z publicznej strony HTML, bez sesji studenta. `services/terms/search` ignoruje Consumer i Token i działa anonimowo; integracja korzysta bezpośrednio z niego przez lokalne proxy.

API zwraca `end_date` jako ostatni dzień zajęć, a `finish_date` jako ostatni dzień cyklu. `is_active` oznacza flagę administracyjną, nie fakt, że dzisiaj trwają zajęcia; status na karcie wyliczamy z dat.

## Zachowanie i granice danych

Nowy publiczny klient nie przesyła cookies ani poświadczeń. Korzysta wyłącznie ze stałych adresów uczelni, kolejkuje żądania (minimum 1200 ms), łączy równoczesne odczyty jednego zasobu, ma timeout 15 sekund i cache 15 minut. Stare dane po błędzie pozostają jawnie oznaczone jako cache/stale. Istniejący klient konta studenta i jego limity pozostają niezmienione.

Parser aktualności jest zakotwiczony na `#layout-main-content > .usos-ui`; separatorem komunikatów jest `hr`. Metadane migracji i modyfikacji całej strony nie są datami publikacji artykułów. Backend zwraca tekst i sprawdzone linki, nigdy surowy HTML do wstrzyknięcia. Skrypty, formularze, iframe i protokoły wykonywalne są pomijane. Zmiana szablonu powoduje jawny błąd zamiast fałszywego pustego wyniku.

Pusty plan pozostaje pusty: aplikacja nie podmienia danych live na demo. Nowe publiczne sekcje działają także przy pustym planie lub wygasłej sesji. Treści publiczne mają własne metadane źródła, niezależne od trybu konta studenta.

## Sprawdzenie

```sh
npm test
npm run build
```

Testy obejmują parser aktualności, odrzucanie wykonywalnych linków, strukturę kalendarza akademickiego, cache, błędy, łączenie równoległych odczytów oraz brak cookies w publicznych zapytaniach. Dowody przeglądarkowe obu motywów i rollback są w katalogu `.frontend-redesign` odpowiedniej rewizji.
