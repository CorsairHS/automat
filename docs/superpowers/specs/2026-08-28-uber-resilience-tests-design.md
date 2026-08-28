# Harness testów odporności dla modułu Uber — design

Data: 2026-08-28

## Cel

Druga iteracja harnessu testowego (po pilotażu na module Bolt — patrz `2026-08-28-bolt-resilience-tests-design.md`). Uber Supplier Portal jest zauważalnie bardziej złożony niż Bolt: dwuetapowe logowanie, popupy pojawiające się w wielu momentach flow, pełny dialog "Wygeneruj raport" (typ raportu, kalendarz zakresu dat, lista organizacji) i dwie osobne pętle retry z twardym odświeżeniem strony. To też moduł z największą liczbą realnie zgłoszonych i naprawionych błędów na żywym koncie (patrz historia commitów `uber.js`), więc jest dobrym kandydatem na rozszerzenie harnessu.

## Zakres (ustalony z użytkownikiem)

Pełny mock całego dialogu generowania raportu (nie tylko ścieżka "raport już istnieje") — mimo większego nakładu pracy, to najbardziej złożony i najczęściej naprawiany fragment kodu, więc najbardziej zasługuje na pokrycie testami.

Cztery scenariusze:
1. **Raport już istnieje** — deep-link → zalogowany → lista raportów ma już pasujący wiersz → pobranie (pomija cały dialog generowania).
2. **Pełne generowanie nowego raportu** — brak pasującego wiersza → dialog → typ raportu → kalendarz zakresu dat → organizacja → Generuj → wiersz pojawia się na liście → pobranie.
3. **Popup przerywający wybór dat** — mock pokazuje pełnoekranowy popup "first impression" DOKŁADNIE w momencie zakończenia wyboru zakresu dat (odtwarza realnie zgłoszony przez klienta bug: "zatrzymał się na wybraniu daty i dalej nie idzie"). Weryfikuje, że `dismissChatBubble()` faktycznie usuwa przeszkadzający element PRZED kolejnym kliknięciem.
4. **Zawieszony status "W toku" wymagający odświeżenia** — raport zostaje wygenerowany, ale przycisk pobierania nic nie robi dopóki `uber.js` nie wykona twardego odświeżenia strony (pętla `REFRESH_INTERVAL_MS`). Świadomie akceptowany koszt czasowy: ten test zajmuje realnie ~35-70s (zmierzone empirycznie), bo `uber.js` odświeża stronę co zahardkodowane 30 sekund — nie skracamy tego interwału na potrzeby testu (ta sama zasada co w harnessie Bolta dla scenariusza wygasłej sesji).

## Podejście: jeden dokument SPA renderowany serwerowo

W odróżnieniu od Bolta (wielostronicowa nawigacja, każda "strona" to osobny URL), Uber Supplier Portal jest prawdziwym SPA — cały panel (niezalogowany / zalogowany / dialog generowania / tabela raportów) żyje pod jednym URL-em bez zmiany adresu. To wymaga innej architektury mocka niż w Bolcie:

- **Jeden route handler** przechwytujący `https://supplier.uber.com/**`, serwujący **jeden dokument HTML** zawierający JS obsługujący całą interakcję UI (przełączanie kroków logowania, otwieranie dialogu, kalendarz, checkbox organizacji) **bez żadnego requestu** — to czysto klienckie przejścia stanu.
- **Stan, który musi przetrwać `page.reload()`** (zalogowanie, czy raport został wygenerowany, czy jest gotowy do pobrania) jest trzymany **serwerowo** w zamknięciu `installUberMock` — bo `uber.js` w dwóch miejscach wywołuje `page.reload()` (pętla oczekiwania na pojawienie się wiersza i pętla odświeżania zawieszonego statusu), co czyści cały stan JS po stronie klienta. Te przejścia idą przez `fetch()` do trzech mini-endpointów (`/api/mock/login`, `/api/mock/generate-report`, `/api/mock/csv-export`) obsługiwanych przez ten sam route handler.
- **Deny-by-default od początku** (wniosek z finalnego review harnessu Bolta) — `context.route('**/*', route => route.abort('blockedbyclient'))` rejestrowany PRZED specyficznym routem dla `supplier.uber.com`, więc żaden nieprzewidziany request nie ucieknie do prawdziwej sieci.

**Mechanizm "zawieszonego statusu":** endpoint `/api/mock/generate-report` zapisuje `generatedAtLoadCount` (aktualną wartość licznika przeładowań strony w momencie generowania). Endpoint `/api/mock/csv-export` uznaje raport za gotowy, gdy `pageLoadCount > generatedAtLoadCount` — czyli dopiero po co najmniej jednym PEŁNYM przeładowaniu dokumentu od momentu wygenerowania. Dla scenariusza 2 (szybka ścieżka) ustawiamy `generatedAtLoadCount = -1`, więc warunek jest spełniony natychmiast (żadnego przeładowania nie trzeba czekać). Dla scenariusza 4 ustawiamy go na aktualny licznik, więc pobranie faktycznie wisi aż `uber.js` sam wykona `page.reload()`.

**Mechanizm "popup przerywający":** klient JS pokazuje pełnoekranowy `<div style="position:fixed; ...">` DOKŁADNIE po drugim kliknięciu w komórkę kalendarza (czyli po wybraniu obu dat zakresu) — dokładnie tam, gdzie klient zgłosił realny bug. Ten element fizycznie zasłania stronę (Playwright wykrywa to jako "intercepts pointer events" przy próbie kliknięcia w cokolwiek pod spodem), więc test ma realne zęby: **zweryfikowane mutation-testem** — z celowo zepsutym selektorem przycisku zamykającego popup, scenariusz faktycznie failuje (zamiast przechodzić przypadkowo).

**Uproszczenia świadomie przyjęte na tę iterację** (analogicznie do uproszczeń w Bolcie):
- Domyślna data początkowa kalendarza jest ustawiona na ten sam miesiąc co docelowy zakres, więc `navigateCalendarMonths()` zawsze liczy deltę 0 i nigdy nie nawiguje między miesiącami — nawigacja międzymiesięczna nie jest objęta tą iteracją.
- Tylko jedna organizacja w popoverze (ścieżka `orgCount === 1`, auto-wybór bez dopasowania po `account.company`) — wielo-organizacyjny wybór po nazwie firmy nie jest objęty.
- Tylko jeden typ popupu (`first-impression-dismiss`) jest symulowany; drugi wariant z `uber.js` (ikona SVG "Delete" w bannerze aplikacji mobilnej) nie jest odtwarzany w tej iteracji.
- Błędna ścieżka generowania raportu (retry po błędzie, przycisk "Anuluj") nie jest testowana — wszystkie cztery scenariusze to happy-path warianty różnych stanów, nie testy błędów walidacji formularza.

## Komponenty

- `tests/mocks/uberSupplierMock.js` — `installUberMock(context, scenario)`, gdzie `scenario` to `{ credentials?, reportAlreadyExists?, requireReloadForDownloadReady?, popupAfterDateSelection?, csvContent? }`. **Kod już napisany i ręcznie zweryfikowany działaniem wszystkich 4 scenariuszy przeciwko prawdziwemu, niezmienionemu `syncUberAccount()`** (weryfikacja w tej sesji, poza formalnym procesem subagent-driven — patrz plan).
- `tests/uber.stress.spec.js` — cztery testy, analogicznie do `tests/bolt.stress.spec.js`.

## Poza zakresem tej iteracji

- FreeNow, PartnerTax admin — kolejne iteracje.
- Nawigacja kalendarza między miesiącami, wielo-organizacyjny wybór, drugi wariant popupu, ścieżka błędu/retry generowania raportu — patrz "Uproszczenia" wyżej.
