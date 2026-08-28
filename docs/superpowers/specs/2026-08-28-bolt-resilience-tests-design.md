# Harness testów odporności dla modułu Bolt — design

Data: 2026-08-28

## Cel

Projekt (`ARCHITEKTURA.md`) nie ma dziś żadnej automatycznej infrastruktury testowej dla flow automatyzacji Playwright — tylko ręczne testy na żywym koncie klienta. Celem tego harnessu jest wykrywanie regresji i luk odpornościowych w module Bolt (`src/main/automation/platforms/bolt.js`) bez ryzyka związanego z uderzaniem w prawdziwe konto (ban/rate-limiting/wykrycie bota) i bez zależności od dostępności prawdziwego panelu partnera.

Bolt jest pierwszym celem (pilotaż) — jedyny moduł już zweryfikowany na żywym koncie, więc najlepszy kandydat do ustalenia wzorca, który później powielimy dla Uber/FreeNow/PartnerTax.

## Podejście: black-box przez przechwytywanie sieci

Testy **nie modyfikują** `bolt.js`. Zamiast tego przechwytują żądania HTTP do `https://fleets.bolt.eu/**` przez Playwrightowe `context.route()` i serwują w locie wygenerowany HTML/JS imitujący panel Bolta. Dzięki temu `syncBoltAccount()` uruchamia się dokładnie tak samo jak na produkcji — jedyną różnicą jest to, co odpowiada "serwer".

**Why:** black-box testing przez routing sieciowy pozwala testować prawdziwy, niezmieniony kod produkcyjny (włącznie z prawdziwymi selektorami Playwright, `waitForAuthStateToSettle`, timingami) zamiast testować atrapę logiki. Jest to też jedyne podejście zgodne z decyzją użytkownika, żeby nie dotykać prawdziwych kont Bolt w testach.

## Komponenty

### `tests/mocks/boltFleetMock.js`

Eksportuje `installBoltMock(context, scenario)`. Instaluje handlery route dla:
- `**/login*` (GET) — strona logowania z polami `#email` / `#current-password` i przyciskiem "Zaloguj się" (inline JS sprawdza dane logowania po submit i przekierowuje na URL raportu).
- `**/{orgId}/finances/reports/driverEarnings*` — strona raportu z:
  - inputem `placeholder="d MMM - d MMM"`,
  - fałszywym kalendarzem generującym komórki `.react-datepicker__day` (bez `--outside-month` dla bieżącego miesiąca) po kliknięciu inputu,
  - przyciskiem "Pobierz" otwierającym menu z pozycją zawierającą tekst "Eksport CSV danych finansowych kierowcy",
  - linkiem `<a download>` wskazującym na endpoint CSV, przechwytywany osobnym route handlerem.

Parametry `scenario`:
- `startLoggedIn: boolean` — czy deep-link od razu ląduje na stronie raportu (pomija formularz logowania).
- `networkDelayMs: number` — sztuczne opóźnienie (ms) dodawane do każdej odpowiedzi mocka, do testowania wyścigów w `waitForAuthStateToSettle`.
- `expireAfterDateSelected: boolean` — gdy `true`, kliknięcie linku pobierania CSV zwraca przekierowanie na `/login` zamiast pliku (symulacja wygaśnięcia sesji w trakcie flow).
- `credentials: { email, password }` — dane, które mock akceptuje jako poprawne (formularz logowania odrzuca inne).

### `tests/bolt.stress.spec.js`

Testy uruchamiane przez wbudowany runner `playwright test` (moduł `playwright/test` jest już dostępny przez zależność `playwright` w `package.json` — nie dodajemy nowej zależności). Każdy test:
1. Uruchamia Chromium (`chromium.launch()`), tworzy `BrowserContext`.
2. Woła `installBoltMock(context, scenario)`.
3. Woła realny `syncBoltAccount({ context, account, downloadDir, statusCallback })` z `src/main/automation/platforms/bolt.js`, gdzie `account.fields` zawiera `orgId`/`email`/`password` zgodne z mockiem, a `downloadDir` to katalog tymczasowy (`fs.mkdtempSync`), sprzątany po teście.
4. Asertuje wynik.

### `playwright.config.js` (root)

Minimalna konfiguracja: `testDir: './tests'`. Bez innych przeglądarek niż chromium (jedyna zainstalowana przez `postinstall`).

### `package.json`

Nowy skrypt: `"test": "playwright test"`.

## Scenariusze testowe

| # | Scenariusz | `scenario` config | Oczekiwany wynik |
|---|---|---|---|
| 1 | Happy path | `{ startLoggedIn: false }` | `syncBoltAccount` resolves; plik CSV istnieje na dysku z oczekiwaną zawartością/nazwą |
| 2 | Sesja już zalogowana | `{ startLoggedIn: true }` | resolves bez żadnej interakcji z polami logowania (asercja: mock nie zanotował żądania do formularza logowania) |
| 3 | Sesja wygasa w trakcie | `{ startLoggedIn: true, expireAfterDateSelected: true }` | `syncBoltAccount` **rzuca błędem** (nie wisi w nieskończoność) — dokumentuje dzisiejszą lukę: `bolt.js` nie ma obsługi wygaśnięcia sesji mid-flow. Timeout testu podniesiony (`test.setTimeout(150_000)`), bo funkcja czeka na wbudowany w kodzie 120s timeout downloadu, zanim rzuci błąd. **Świadomie nie skracamy** tego przez zmianę `bolt.js` — koszt czasu wykonania akceptowalny dla harnessu odporności uruchamianego okazjonalnie, nie w pętli dev. |
| 4 | Wolne ładowanie SPA | `{ startLoggedIn: false, networkDelayMs: 2000 }` | resolves poprawnie mimo opóźnień — weryfikuje, że `waitForAuthStateToSettle` nie ocenia stanu przedwcześnie |

## Błędy / luki, które ten harness ujawnia

Scenariusz 3 najprawdopodobniej **faluje już teraz** względem "ładnego" zachowania (funkcja rzuca dopiero po pełnym 120s timeoutcie zamiast wykryć przekierowanie na `/login` wcześniej i zgłosić czytelny błąd typu "sesja wygasła"). To oczekiwany, udokumentowany wynik tej iteracji — naprawa `bolt.js` jest osobnym zadaniem, poza zakresem tego harnessu.

## Poza zakresem tej iteracji

- Uber, FreeNow, PartnerTax admin — dodajemy analogiczny harness w kolejnej iteracji, po ustabilizowaniu wzorca na Bolcie.
- Testy na żywych kontach (smoke testy przed wydaniem) — osobny, ręcznie odpalany proces, nieobjęty tym designem.
- CI — projekt nie ma dziś CI; testy uruchamiane lokalnie przez `npm test`.
