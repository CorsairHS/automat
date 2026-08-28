# Harness testów odporności dla modułu FreeNow — design

Data: 2026-08-28

## Cel

Trzecia iteracja harnessu testowego (po Bolcie i Uberze). `freenow.js` architektonicznie jest bliższy Boltowi niż Uberowi (wielostronicowa nawigacja: `/login` → `/dashboard` → `/earnings`, sprawdzanie zalogowania po URL, nie po elemencie DOM), ale wprowadza nowy element: pobierany plik to **archiwum ZIP** zawierające kilka wariantów CSV, które `freenow.js` realnie rozpakowuje przez `extract-zip` i wybiera wariant "WITH VAT" po nazwie pliku.

## Zakres (ustalony z użytkownikiem)

Cztery scenariusze:
1. **Happy path** — pełny login → link "Zarobki" → przełącznik "Zarobki z VAT" → daty → pobranie ZIP-a → rozpakowanie → znalezienie pliku WITH VAT.
2. **Sesja już zalogowana** — deep-link od razu ląduje zalogowany (analogicznie do Bolta).
3. **Duplikat linku "Zarobki"** — odtwarza realnie naprawiony bug (2026-08-19) i dokłada drugą, pokrewną kolizję, żeby fixture guardował obie własności, które faktycznie chroni `getByRole('link', { name: 'Zarobki', exact: true })`:
   - **kolizja po `href`** — dashboard ma DWA linki z `href="/earnings"` (menu "Zarobki" + "Szczegóły zarobków"). Weryfikuje, że dopasowanie po dokładnym tekście, nie po samym `href`, poprawnie omija tę kolizję. **Zweryfikowane mutation-testem**: naiwny selektor po samym `href` faktycznie napotyka na niejednoznaczność (`locator.click` z dwoma pasującymi elementami timeoutuje) — potwierdza to, że scenariusz tworzy prawdziwą, a nie pozorną kolizję.
   - **kolizja po podciągu tekstu** — dashboard ma TRZECI link, `<a href="/earnings-summary">Zarobki kierowcow</a>`, z innym `href`, ale tekstem zawierającym "Zarobki" jako podciąg. Guarduje `exact: true`: bez niego `getByRole('link', { name: 'Zarobki' })` dopasowałby niejednoznacznie zarówno "Zarobki", jak i "Zarobki kierowcow", więc regresja do niescisłego dopasowania po tekście zostałaby wykryta.
4. **Brak wariantu WITH VAT w archiwum** — ZIP nie zawiera pliku z `with_vat` w nazwie. Weryfikuje, że `freenow.js` rzuca czytelny, opisowy błąd (`throw new Error(...)`) zamiast cicho zwrócić zły plik lub zawiesić się.

## Nowy element: generowanie prawdziwego pliku ZIP bez nowej zależności

`freenow.js` woła `extractZip(zipPath, { dir: extractDir })` na PRAWDZIWYCH bajtach pobranego pliku — atrapa pod nazwą `.zip` (jak w Bolcie/Uberze dla CSV) by nie zadziałała, bo `extract-zip` faktycznie parsuje format ZIP.

`archiver` (biblioteka do zapisu ZIP-ów) jest już obecna w `node_modules` jako zależność przechodnia `electron-builder`, ale **nie jest zadeklarowana w `package.json`** — użycie jej wprost w testach byłoby kruche (aktualizacja `electron-builder` mogłaby ją usunąć bez ostrzeżenia). Zamiast dodawać nową zależność, `tests/mocks/zipBuilder.js` buduje ZIP ręcznie (metoda STORE — bez kompresji, z CRC32 liczonym samodzielnie) — format lokalnych nagłówków i centralnego katalogu dla wpisów bez kompresji jest krótki i dobrze udokumentowany. **Zweryfikowane bezpośrednio**: zbudowany w ten sposób plik został poprawnie rozpakowany przez prawdziwy `extract-zip` w tej samej sesji, zanim trafił do planu.

## Architektura mocka

Jak w Bolcie: `context.route()` przechwytuje `https://portal.free-now.com/**` wielostronicowo (każda "strona" to osobny URL: `/login`, `/dashboard`, `/earnings`, plus endpoint `/api/mock/earnings-export.zip` serwujący prawdziwe bajty ZIP). Deny-by-default catch-all (`context.route('**/*', route => route.abort('blockedbyclient'))`) rejestrowany PRZED specyficznym routem — ten sam wzorzec co w Bolcie/Uberze po finalnych review obu poprzednich iteracji.

**Komponenty:**
- `tests/mocks/zipBuilder.js` — `buildZip(entries)`, gdzie `entries: [{name, content}]`. Bez zależności od stanu scenariusza — czysta funkcja budująca bajty ZIP.
- `tests/mocks/freenowPortalMock.js` — `installFreenowMock(context, scenario)`, gdzie `scenario` to `{ credentials?, startLoggedIn?, duplicateEarningsLink?, includeWithVatFile?, csvWithVatContent?, csvWithoutVatContent? }`.
- `tests/freenow.stress.spec.js` — cztery testy, analogicznie do `tests/bolt.stress.spec.js`.

## Uproszczenia świadomie przyjęte na tę iterację

- Zakładka/przycisk "Company" na ekranie logowania (opcjonalny w `freenow.js`, kod sam sprawdza jego widoczność z timeoutem 2s i kontynuuje bez niego) nie jest renderowany w mocku — odzwierciedla aktualnie potwierdzony stan (komentarz w kodzie: "nie ma już osobnej zakładki/przycisku 'Company'"). Testy poniosą stały koszt ~2s na ten sprawdzian przy każdym logowaniu.
- Pola dat (`start-date-input`/`end-date-input`) w mocku nie mają żadnej logiki walidacji ani reakcji na wpisaną wartość — `freenow.js` tylko je wypełnia i naciska Enter, nie odczytuje ich z powrotem.
- Zawartość CSV wewnątrz ZIP-a jest arbitralna (nie odzwierciedla żadnego realnego formatu raportu FreeNow) — testy weryfikują tylko, że właściwy plik po nazwie zostaje wybrany, nie treść merytoryczną raportu.

## Poza zakresem tej iteracji

- PartnerTax admin — kolejna iteracja.
- Realny format CSV z FreeNow (kolumny, kodowanie) — nieistotny dla testowanej logiki wyboru wariantu.
