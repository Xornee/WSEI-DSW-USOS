# Dodawanie nowego modułu

Przepis wyprowadzony z dwóch zrobionych modułów (oceny, zaliczenia etapów).
Cały cykl to ~15 minut.

## 0. Sprawdź, czy moduł ma dane

Najważniejszy krok. Parser pisany na pusty ekran to parser pisany w ciemno —
nie ma czego zakotwiczyć, a testy przechodzą na własnych założeniach.

```bash
./scripts/capture.sh discover dla_stud/index      # wypisz akcje
./scripts/capture.sh grab <akcja> <nazwa>         # zrzuć stronę
```

```bash
grep -c '<tr' fixtures/<nazwa>.html
grep -c 'usos-frame-section' fixtures/<nazwa>.html
```

Zero wierszy i zero sekcji = moduł pusty. **Przerwij** i wróć, gdy się zapełni.
Zobacz inwentarz w [02-zrodla-danych.md](02-zrodla-danych.md).

## 1. Rozpoznaj strukturę

```bash
python3 - <<'PY'
import re, pathlib
html = pathlib.Path('fixtures/<nazwa>.html').read_text(encoding='utf-8', errors='replace')
print('section-title:', re.findall(r'section-title="([^"]+)"', html)[:5])
print('id ramek:', re.findall(r"<usos-frame[^>]*id='([^']+)'", html))
print('nagłówki th:', [re.sub(r'<[^>]*>','',x) for x in re.findall(r'<th\b.*?</th>', html, re.S)][:6])
PY
```

Szukasz **kotwicy**: `id` ramki, atrybutu `section-title`, nagłówków kolumn.
Klasy CSS w USOSwebie są prawie nieobecne — nie opieraj się na nich.
Nie opieraj się też na pozycji elementów, jeśli da się dopasować po etykiecie.

## 2. Typy w `shared/types.ts`

Dopisz kształt, który chcesz **w GUI**, a nie odwzorowanie HTML-a. To jest ten
sam kontrakt, który przetrwa ewentualne przejście na USOS API.

## 3. Parser w `server/usos/scrape/<nazwa>.ts`

Zasady, które się sprawdziły:

- Zacznij od kotwicy; **brak kotwicy → `throw new ParserNotCalibratedError('<nazwa>')`**.
  Nigdy nie zwracaj pustej struktury przy nierozpoznanej stronie.
- Wartości puste i teksty w rodzaju „brak danych" mapuj na `null`, nie na string.
- Czytaj po etykietach, nie po indeksach kolumn, gdy tylko się da.
- Osobno eksportuj małe czyste funkcje (`splitSubject`, `toNumeric`) — łatwo je
  przetestować bez zrzutu.

## 4. Testy w `server/usos/scrape/<nazwa>.test.ts`

Dwie warstwy:

**Syntetyczny HTML** — buduj go helperami w teście, po jednym przypadku na
zachowanie: poprawne dane, brak wartości, niekompletny wiersz, nierozpoznana
strona.

**Prawdziwy zrzut** — sprawdzaj **kształt, nie treść**. Zrzuty są prywatne
(`.gitignore`), więc test musi się pomijać, gdy pliku nie ma:

```ts
const FIXTURE = new URL('../../../fixtures/<nazwa>.html', import.meta.url).pathname
const run = existsSync(FIXTURE) ? describe : describe.skip

run('na prawdziwym zrzucie', () => {
  const parsed = parseX(readFileSync(FIXTURE, 'utf8'))
  it('znajduje pozycje', () => expect(parsed.items.length).toBeGreaterThan(0))
})
```

Asercje typu „średnia mieści się w skali 2–5" łapią błędy parsowania, nie
utrwalając Twoich ocen w repozytorium.

## 5. Podepnij do proxy

Cztery miejsca:

```ts
// server/usos/actions.ts — nazwa akcji z możliwością nadpisania w .env
<nazwa>: process.env.ACTION_<NAZWA>?.trim() || 'dla_stud/studia/<...>',

// server/usos/repository.ts — interfejs + obie implementacje
<nazwa>(): Promise<Result<X>>

// UsosWebRepository — cache załatwia całą resztę
<nazwa>(): Promise<Result<X>> {
  return this.cached('<nazwa>', async () =>
    parseX(await this.client.fetchAction(this.actions.<nazwa>)))
}

// server/index.ts — trasa
route('/api/<nazwa>', () => repo.<nazwa>())
```

Dopisz też `mock<Nazwa>()` w `server/usos/mock.ts`, żeby tryb demo pokazywał
ten ekran bez sesji.

## 6. Ekran

```tsx
const { data, meta, error, loading, reload } = useEndpoint<X>('/api/<nazwa>')
```

Zawsze renderuj `<StateBanner meta={meta} error={error} onReload={reload} />`
i `<ScreenSkeleton />` przy `loading` — wtedy tryb demo, cache i błędy obsługują
się same.

Nowa zakładka: dopisz wpis do `TABS` w `web/src/App.tsx`. Przy pięciu i więcej
pozycjach rozważ dołożenie treści do istniejącego ekranu zamiast nowej zakładki —
dolna nawigacja na telefonie robi się ciasna. Etapy trafiły z tego powodu
na ekran profilu.

## 7. Weryfikacja

```bash
npx tsc --noEmit
npm test
npm run dev
```

Na koniec sprawdź na żywo i **wypisuj tylko kształt**, nie swoje dane:

```bash
curl -s http://127.0.0.1:8080/api/<nazwa> | python3 -c "
import sys,json; d=json.load(sys.stdin)
print('ok=',d['ok'],'source=',d['meta']['source'])
print('pozycji:', len(d['data'].get('items', [])))"
```
