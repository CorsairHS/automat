# Automat do wgrywania raportów Uber/Bolt/Freenow do PartnerTax Admin

Notatka podsumowująca ustalenia z rozmowy o architekturze projektu. Dokument roboczy — do rozwijania w miarę postępu prac.

## Cel

Aplikacja desktopowa (.exe) dystrybuowana partnerom, która:
1. Loguje się do paneli partnerskich Uber, Bolt, Freenow.
2. Pobiera z nich wymagane raporty (rozliczeniowe / przejazdów).
3. Loguje się do PartnerTax admin.
4. Wgrywa pobrane pliki bezpośrednio przez UI PartnerTax admin (nie przez API/webhook).

## Kluczowe decyzje architektoniczne

### 1. Aplikacja lokalna (.exe), nie serwer centralny
Dane logowania partnera (Uber, Bolt, Freenow, PartnerTax) przechowywane są **lokalnie na komputerze partnera**, nie na współdzielonym serwerze.

**Why:** Przechowywanie haseł wielu partnerów centralnie to duże ryzyko bezpieczeństwa i odpowiedzialności prawnej — wyciek jednej bazy ujawniłby dane logowania wszystkich partnerów do wielu platform. Model lokalny ogranicza blast radius pojedynczego incydentu do jednego partnera.

**How to apply:** Hasła trzymane w systemowym magazynie danych logowania (Windows Credential Manager / DPAPI), nigdy jako plain text w plikach konfiguracyjnych.

### 2. Automatyzacja przeglądarki: Playwright, nie Selenium
**Why:** Playwright lepiej radzi sobie z nowoczesnymi SPA (Uber, Bolt, Freenow, prawdopodobnie też PartnerTax admin), ma mniejszy "bot fingerprint" i jest aktywniej rozwijany niż Selenium.

### 3. Upload do PartnerTax admin: przez UI, nie przez API/webhook
W przeciwieństwie do istniejącej wtyczki (`novapartner/wtyczka`), która wysyła dane do PartnerTax przez webhooki n8n, ten projekt **nie ma** takiego połączenia — automat sam loguje się do PartnerTax admin i wgrywa pliki bezpośrednio przez formularz w UI.

**Why:** Brak na ten moment dostępu/integracji API do PartnerTax admin po stronie partnera realizującego ten projekt.

**How to apply:** Moduł uploadu (`uploadToPartnerTax(files)`) zostaje zbudowany jako ostatni element, gdy będzie dostępny wgląd do systemu (URL logowania, formularz uploadu, wymagane pola/metadane przy wgrywaniu pliku). Do tego czasu implementowany jako stub/interfejs.

### 4. Stack: Electron + Playwright
**Why:** Pozwala reużyć logikę JS z istniejącej wtyczki (`content.js`, `freenow-content.js`, `background.js`) niemal bez przepisywania — tylko `chrome.*` API zamienione na Playwright/Node, bez zmiany języka.

## Co reużyć z istniejącej wtyczki (`D:\PartnerTax\novapartner\wtyczka`)

Wtyczka to rozszerzenie Chrome (Manifest V3, vanilla JS) + backend n8n + PostgreSQL, które już rozwiązuje część problemu pobierania danych z Uber/Bolt/Freenow (ale wysyła je przez webhooki n8n, nie do PartnerTax admin przez UI).

- **Logika FreeNow** — przechwycenie tokena Bearer + `companyId` z ruchu strony i odtworzenie wywołań API zamiast scrapowania DOM. Stabilniejsze niż klikanie w UI, warte przeniesienia 1:1 do modelu Playwright.
- **Logika parsowania raportów Uber** — rozpoznawanie typów raportów (`payments_driver`, `trip_activity`) i dedup po ID.
- **Bolt** — obsługiwany całkowicie po stronie serwera przez oficjalne Fleet Integration API (OAuth2 client_credentials, n8n, CRON co 30 min). Nie wymaga automatyzacji przeglądarki — można przenieść tę integrację bezpośrednio.
- **Podejście do dedupu** — wtyczka trzyma listę już wysłanych raportów lokalnie (`chrome.storage.local`), żeby nie wysyłać duplikatów. Analogiczny mechanizm potrzebny w .exe.

**Czego NIE da się przenieść wprost:** wtyczka zakłada, że użytkownik jest już zalogowany w przeglądarce do Uber/Freenow — nie robi prawdziwego loginu. W .exe trzeba to dopisać od zera (Playwright + obsługa 2FA, gdzie przy kodzie z SMS/e-mail automat otwiera widoczne okno przeglądarki i czeka na ręczne wpisanie kodu przez partnera).

## Proces wgrywania — ustalony na callu z klientem (2026-08-18)

Klient pokazał na żywo cały przepływ ręczny, który automat ma zastąpić. Klient ma **2 firmy** (Unity Drive, Da Investment) działające w tym samym mieście (Wrocław) — czyli **wgrywa dane z 2 kont per platforma**. To potwierdza, że model musi wspierać wiele kont na platformę, nie jedno.

- **Bolt**: Finanse → Zarobki na kierowcę → wybór okresu → pobierz "Zarobki na kierowcę" → eksport CSV. **Ustalone (2026-08-18): pobieramy przez przeglądarkę (eksport CSV z panelu), nie przez Fleet API.** PartnerTax admin jest dostosowany pod format tego konkretnego pliku CSV, więc plik z API (JSON) by nie pasował. Integracja z wtyczki (n8n + Fleet API) zostaje jako odrębne, niezwiązane rozwiązanie — nie przenosimy jej do tego projektu.
- **Uber**: Raporty → Wygeneruj raport → Płatności kierowca → okres: tydzień bieżący.
- **FreeNow**: Zarobki → okres: tydzień bieżący → pobierz → wariant pliku **WITH VAT** (ważne: jest kilka wariantów, trzeba pobierać właściwy).
- **PartnerTax Admin** (upload): System → [Platforma, np. Bolt] → [Miasto, np. Wrocław] → [Firma, np. Unity Drive / Da Investment] → pole "Plik źródłowy" → wybór pobranego pliku → "Zapisz i kontynuuj edycję".

To pierwszy realny wgląd w strukturę PartnerTax admin (mimo braku pełnego dostępu): nawigacja jest hierarchiczna **System → Platforma → Miasto → Firma**, z uploadem pojedynczego pliku źródłowego na formularzu edycji. Trzeba to zweryfikować, gdy będzie pełny dostęp, ale można już projektować pod ten kształt.

**Konsekwencja dla modelu danych:** każde konto na platformie (Uber/Bolt/FreeNow) musi mieć przypisany cel w PartnerTax (miasto + firma), żeby automat wiedział, gdzie wgrać pobrany plik. Konto do samego PartnerTax admin pozostaje pojedyncze (jeden login do panelu, z którego nawigujemy do wielu kombinacji miasto/firma).

**Okres pobierania:** trzeba dodać do GUI wybór okresu per konto — na start: "tydzień bieżący" (domyślny, zgodny z tym co pokazał klient) / "tydzień poprzedni" / zakres niestandardowy (data od–do).

## Otwarte kwestie / do ustalenia

- **Definicja wymaganych raportów per platforma** — częściowo ustalone (patrz sekcja wyżej), do potwierdzenia: czy zawsze tylko jeden raport per platforma, czy klienci mogą potrzebować więcej (np. Uber miał w wtyczce też `trip_activity` obok `payments_driver`).
- **Dostęp do PartnerTax admin** — wciąż brak pełnego wglądu do systemu, ale znamy już strukturę nawigacji z demo klienta (System → Platforma → Miasto → Firma → Plik źródłowy → Zapisz i kontynuuj edycję). Do potwierdzenia po uzyskaniu dostępu: dokładne selektory, czy "Miasto"/"Firma" to dropdowny czy stała ścieżka URL, czy po zapisie trzeba dodatkowo "opublikować"/zatwierdzić.
- **Skala multi-kont** — czy inni partnerzy też będą mieli po kilka firm/kont per platforma (jak ten klient), czy to wyjątek. Zakładamy ogólny model (lista kont per platforma), żeby nie przepisywać tego później.
- **Obsługa 2FA** na platformach Uber/Bolt/Freenow — plan: widoczne okno przeglądarki + ręczne wpisanie kodu przez partnera przy pierwszym logowaniu / odświeżaniu sesji.
- **Aktualizacje aplikacji** — jak dystrybuować poprawki (np. gdy zmieni się UI Ubera i trzeba poprawić selektory) bez proszenia partnerów o ręczną reinstalację. Do rozstrzygnięcia: auto-update w Electronie.
- **Telemetria/logi błędów** — jak partner/wy dowiecie się, że synchronizacja się nie powiodła (np. zmieniony UI, wygasła sesja, 2FA). Minimalnie: status sukces/porażka + kod błędu, bez przesyłania danych wrażliwych.

## Plan działania (kolejne kroki)

1. ✅ Szkielet aplikacji (Electron + Playwright) z GUI: konta per platforma (multi-konto), bezpieczne przechowywanie przez `safeStorage`.
2. ✅ Moduł logowania i pobierania — Uber, Bolt (eksport CSV z panelu, nie Fleet API), FreeNow — wszystkie trzy przez Playwright (przeglądarka), nie API.
3. ~~Moduł Bolt przez Fleet API~~ — nieaktualne, Bolt też idzie przez przeglądarkę (patrz sekcja wyżej).
4. Warstwa "co pobrać" — konfigurowalna lista wymaganych raportów per platforma (częściowo już w `platforms.js` jako `report`).
5. Moduł uploadu do PartnerTax admin — stub na razie, pełna implementacja po uzyskaniu dostępu do systemu.

## Ważne zastrzeżenie do modułu z punktu 2

Selektory Playwright w `src/main/automation/platforms/*.js` są napisane na bazie opisu przepływu z demo klienta i ogólnej wiedzy o UI tych platform (preferowane są odporne lokatory po tekście/roli, nie kruche CSS/XPath), ale **nie zostały zweryfikowane na żywym koncie** — nie mam dostępu do rzeczywistych paneli Uber/Bolt/FreeNow. Przed pierwszym realnym użyciem trzeba je przetestować i doprecyzować (dokładne teksty przycisków, format selektora daty, ewentualne różnice w UI między kontami/rynkami).

**Aktualizacja (2026-08-18):** ekrany logowania zostały zweryfikowane na podstawie zrzutów ekranu od użytkownika i selektory zaktualizowane:
- **FreeNow** (`/login`): zakładka "Company"/"Driver" (musi być aktywna "Company"), pola z placeholderem "Sign in email" / "Password", przycisk "Sign in".
- **Bolt Fleet**: logowanie jednoetapowe, zakładka "E-mail lub nazwa użytkownika" (domyślnie aktywna), pola "E-mail lub nazwa użytkownika" / "Hasło", przycisk "Zaloguj się".
- **Uber**: logowanie dwuetapowe — krok 1 "What's your phone number or email?" (placeholder "Enter phone number or email", przycisk "Continue"), krok 2 "Welcome back, {imię}." (placeholder "Enter your password", przycisk "Next"). Uber oferuje też logowanie przez Google/Apple — nieobsługiwane, zakładamy logowanie email+hasło.

**Aktualizacja (2026-08-18, cd.):** kroki generowania/pobierania raportu też zostały zweryfikowane na zrzutach ekranu i selektory zaktualizowane:
- **Uber**: zakładka "Reports" → przycisk "Generate Report" → panel z polami "Report type" (trzeba przełączyć z domyślnego "Driver Activity" na "Payments Driver"), "Start of report"/"End of report" (format `YYYY/MM/DD`), "Select organizations to include in report" (wybór firmy — TODO: dokładna interakcja niezweryfikowana), przycisk "Generate". Generowanie trwa chwilę (async) — automat czeka aż w tabeli pojawi się wiersz z pasującym zakresem dat, potem klika jego "Download".
- **Bolt**: Finanse → Zarobki na kierowcę → przycisk z zakresem dat (biblioteka kalendarza "kalep", format polski typu "18 sie") → przycisk "Pobierz" → z rozwijanego menu wybór pozycji "Zarobki na kierowcę" (druga opcja w menu to "Zarobki i wyniki" — nie ta). TODO: dokładna interakcja z kalendarzem dat niezweryfikowana (założenie: pole przyjmuje wpisany tekst).
- **FreeNow**: menu "Earnings" → przełącznik "Earnings with VAT" (musi być aktywny) → pole "Date range" (format `DD/MM/YYYY`) → przycisk pobierania ma stabilny `data-testid="download-csv-file"` (znaleziony w devtools, najpewniejszy selektor ze wszystkich trzech platform).

**Wciąż niezweryfikowane (TODO):** dokładna interakcja z kalendarzem dat na FreeNow oraz widget wyboru organizacji/firmy na Uberze. To realistycznie wymaga live testu z prawdziwym kontem, nie da się dalej doprecyzować ze zrzutów ekranu.

## ✅ Bolt: pierwszy pełny end-to-end test zakończony sukcesem (2026-08-18)

Po serii live-testów z prawdziwym kontem (DA INVESTMENT SP. Z O.O.) moduł Bolta działa od logowania po zapis pliku CSV na dysku. Po drodze znalezione i naprawione błędy (ważne jako wzorzec dla dokańczania Ubera/FreeNow):

1. **Pola logowania nie byly powiazane z widocznym tekstem etykiety** (aria-labelledby wskazywalo gdzie indziej) - `getByLabel()` nie dzialal. Naprawa: selektory po stabilnym `id` (`#email`, `#current-password`).
2. **Jezyk UI jest zmienny** (obserwowany i polski, i angielski dla tego samego konta) - przycisk logowania raz to "Zaloguj się", raz "Sign in". Naprawa: dopasowanie obu wariantow regexem.
3. **Blad wyscigu przy przekierowaniu SPA**: zaraz po `page.goto()` sprawdzalismy URL, ale przekierowanie z `/login` na docelowa strone (gdy sesja z poprzedniego uruchomienia byla juz wazna) dzieje sie po stronie klienta (JS) z opoznieniem - sprawdzenie "za wczesnie" dawalo falszywy wynik "niezalogowany". Naprawa: `waitForAuthStateToSettle()` w `loginHelpers.js`, ktore czeka az ustali sie jeden z dwoch stanow (formularz logowania widoczny ALBO URL opuscil `/login`). **Zastosowane tez do Ubera i FreeNow** - to ten sam wzorzec architektoniczny SPA.
4. **Pole zakresu dat to NIE jest zwykly tekstowy input do wypelnienia** - to wyzwala kalendarz `react-datepicker` (standardowa biblioteka open source), ktory wymaga klikania w konkretne komorki dni (`role="gridcell"`), nie wpisywania tekstu.
5. **Pozycje menu "Pobierz" nie maja roli ARIA `menuitem`** - `getByRole('menuitem', ...)` nigdy ich nie znajdowal. Naprawa: klikanie po unikalnym tekscie opisu pozycji ("Eksport CSV danych finansowych kierowcy"), ktory w odroznieniu od samego tytulu "Zarobki na kierowce" nie koliduje z nagłowkiem `<h1>` strony o identycznej tresci.
6. **Blad strefy czasowej w `dateRange.js`**: `toISODate()` uzywal `date.toISOString()` (UTC) zamiast lokalnych skladnikow daty. Przy CEST (UTC+2) polnoc poniedzialku lokalnie wychodzila jako niedziela w UTC - liczenie tygodnia bylo przesuniete o jeden dzien. Naprawa: `toISODate()` teraz sklada date z `getFullYear()/getMonth()/getDate()` (lokalne), nie z `toISOString()`.
7. **Platforma nie ma danych za dni, ktore jeszcze nie nastapily** - "tydzien biezacy" probowal wybrac niedziele biezacego tygodnia, ktora jeszcze nie nadeszla (dzis jest np. wtorek), a te komorki kalendarza sa zablokowane (`aria-disabled="true"`). Naprawa: `computePeriodRange()` przycina koniec zakresu do dzisiaj, gdy tryb to "tydzien biezacy" i niedziela jeszcze nie minela.

**Wciaz oznaczone jako TODO w kodzie Bolta:** nawigacja kalendarza miedzy miesiacami (dziala tylko gdy oba dni zakresu sa w aktualnie wyswietlanym miesiacu - wystarczajace dla "tydzien biezacy/poprzedni", moze zawiesc przy zakresie niestandardowym z innego miesiaca) oraz angielski tekst pozycji menu "Eksport CSV..." (nie zaobserwowany jeszcze na zywo, tylko polski).

## ✅ Modul uploadu do PartnerTax admin - pierwsza implementacja (2026-08-19)

Klient udostepnil zrzuty ekranu i DOM formularza admina (Django admin standardowy). Zaimplementowano `src/main/automation/platforms/partnertax.js` + spiecie przez `runner.js` (`runUpload`) i IPC (`upload:run`) + przycisk "Wgraj do PartnerTax" w GUI (globalny, nie per-konto - wgrywa wszystko co zostalo pobrane w biezacej sesji aplikacji, trzymane w pamieci procesu main w `lastDownloads`).

Przeplyw: `/admin/` login (`#id_username`/`#id_password`) → `/admin/finances/reckoning/` → pierwszy wiersz z "Finished" = False → w formularzu zmiany: "Add another Data source" → wypelnij `select[name="sources-N-system"]` (Bolt=17, Uber=32, FreeNow=2), `select[name="sources-N-city"]` (mapowanie nazw miast na ID w `CITY_OPTION_VALUES`) i `select[name="sources-N-company"]` (mapowanie w `COMPANY_OPTION_VALUES`, zweryfikowane 2026-08-19: Unity Drive=5, Da Investment=4) → `input[type=file][name="sources-N-file"]` → **"Save and continue editing" po KAZDYM pliku** (klient podkreslil to wprost - bez tego raport sie nie zapisuje).

**Niezweryfikowane na zywo (TODO):**
- `CITY_OPTION_VALUES`/`COMPANY_OPTION_VALUES` w `partnertax.js` to pelne listy z dropdownow widoczne na zrzutach, ale nie kazda wartosc byla testowana w praktyce - kolejni partnerzy z nowymi miastami/firmami beda wymagac dopisania wpisow.
- Selektor wiersza "Finished = False" (`filter({ hasText: 'False' })`) zaklada, ze tekst "False" nie pojawia sie nigdzie indziej w wierszu - do potwierdzenia na zywym DOM.
- Logowanie do Django admin zaklada standardowy przycisk `role=button` z tekstem "Log in"/"Zaloguj" - do zweryfikowania (moze to byc zwykly `<input type="submit">`, ktory Playwright tez lapie przez `getByRole('button')`, ale warto sprawdzic realny tekst).

## ✅ FreeNow: poprawka bledu strict-mode na linku "Zarobki" (2026-08-19)

Live test zglosil blad `locator.click: strict mode violation: locator('a[href="/earnings"]') resolved to 2 elements` - przy pierwszym przejsciu przez flow strona (dashboard) ma DWA linki z `href="/earnings"`: link w menu bocznym z tekstem "Zarobki" i osobny link "Szczegoly zarobkow" (np. karta na dashboardzie). Przy kolejnym pobraniu w tej samej sesji dzialalo, bo uzytkownik byl juz na innej podstronie, gdzie tylko jeden z tych linkow istnieje w DOM.

Naprawa w `src/main/automation/platforms/freenow.js`: zamiast selektora po samym `href`, celowanie w link po dokladnym tekscie - `page.getByRole('link', { name: 'Zarobki', exact: true })`. Dziala niezaleznie od tego, z ktorej podstrony flow sie zaczyna.

## ✅ Walidacja raportu przed uploadem: zly tydzien/zla firma/niespojne miasto (2026-09-01)

Realne ryzyko finansowe: raport moglby trafic do zlego miasta w PartnerTax lub zostac
wgrany dla niewlasciwego tygodnia, bez zadnej weryfikacji. Dodano
`src/main/automation/reportValidator.js`, wywolywany w `sync:run` (`main.js`) zaraz po
pobraniu, przed dopisaniem pliku do `lastDownloads`:
- Tydzien: parsowany z prawdziwej nazwy pliku sugerowanej przez serwer platformy
  (Bolt/Uber/FreeNow/Bolt Food, kazdy w innym formacie), porownywany dokladnie z
  `computePeriodRange`.
- Firma: parsowana z nazwy pliku tylko dla Bolt i Uber (jedyne dwie platformy, ktore ja
  ujawniaja w nazwie), porownywana z `account.company`.
- Miasto: NIE wystepuje w zadnym pobranym pliku - walidowana jest za to spojnosc
  `account.label` z `account.city` w konfiguracji konta (lapie literowke/pomylke przy
  zakladaniu konta, ale swiadomie nie chroni przed pobraniem danych dla zlego konta na
  samej platformie - patrz `docs/superpowers/specs/2026-09-01-report-validation-city-week-design.md`).

Kazda niezgodnosc = twarda blokada (plik nie trafia do `lastDownloads`, wiec nie moze
zostac wgrany), zgodnie z decyzja klienta ("nie chcemy, zeby to cos popsulo").
