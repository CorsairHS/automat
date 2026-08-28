# Harness testów odporności dla modułu PartnerTax admin — design

Data: 2026-08-28

## Cel

Czwarta iteracja harnessu testowego (po Bolcie, Uberze i FreeNow). PartnerTax admin to inny rodzaj celu niż pozostałe trzy — standardowy panel Django admin (`src/main/automation/platforms/partnertax.js`), nie zewnętrzna platforma z fingerprintingiem/SPA. Moduł ma dwie funkcje: `uploadToPartnerTax` (wgrywanie plików jako "Data source" do niezakończonego rozliczenia) i `deleteReportsFromPartnerTax` (usuwanie wgranych raportów po systemie).

## Zakres (ustalony z użytkownikiem)

Cztery scenariusze:
1. **Happy path: login + upload jednego pliku** — login → znajdź rozliczenie Finished=False → dodaj Data source (system/miasto/firma/plik) → zapisz → zweryfikuj zapis.
2. **Upload wielu plików z częściowym niepowodzeniem w trakcie** — drugi z trzech plików ma nierozpoznaną nazwę miasta → weryfikuje, że już zapisane pliki są zwracane przez `error.succeededUploads` (realnie zgłoszony bug: retry po błędzie dodawał już wgrany raport powtórnie).
3. **Zawieszona strona po zapisie wymagająca odświeżenia** — pierwsza próba zapisu trwa dłużej niż pojedynczy odczyt statusu, ale ostatecznie się kończy.
4. **Usuwanie raportu zapisanego pod aliasem systemu** — raport Bolt zapisany jako System=65 ("BOLT", stary alias) zamiast kanonicznego 17 ("Bolt").

## Ważne odkrycie z tej sesji: scenariusz 3 nie testuje tego, co pierwotnie zakładano — i scenariusz 4 ujawnił prawdopodobny realny bug

Podczas ręcznego prototypowania (przed napisaniem planu) zweryfikowano bezpośrednio przeciwko prawdziwemu `partnertax.js`, że **`page.waitForLoadState('domcontentloaded', {timeout})` wywołane zaraz po kliknięciu z `{noWaitAfter: true}` nie wykrywa niezawodnie trwającej nawigacji w zainstalowanej wersji Playwrighta (1.62.1)** — w wielokrotnych, kontrolowanych powtórzeniach (opóźnienie sieciowe 25s/45s, `route.abort()`, brak odpowiedzi w ogóle) `waitForLoadState` **zawsze rozwiązywało się natychmiast**, nigdy nie rzucając timeoutu, niezależnie od przyczyny opóźnienia. Oznacza to, że ścieżka "odśwież stronę po nieudanej próbie wykrycia przeładowania" w `clickSaveAndVerify` (`src/main/automation/platforms/partnertax.js:213-227`) **w praktyce nigdy się nie uruchamia** — realna odporność na wolny zapis pochodzi wyłącznie z zewnętrznej pętli `verifyFn()` (opartej na Playwrightowych lokatorach z auto-czekaniem), nie z jawnego mechanizmu "wykryj zawieszenie → odśwież".

**Konsekwencja dla scenariusza 3:** test symuluje realne, długie (25s), ale KOŃCZĄCE SIĘ opóźnienie odpowiedzi na pierwszy zapis — i weryfikuje, że `uploadToPartnerTax` mimo to kończy się sukcesem (dzięki pętli `verifyFn()`, nie dzięki jawnemu mechanizmowi reload). Nazwa i opis scenariusza zostały skorygowane, żeby to uczciwie odzwierciedlać — nie testujemy już dosłownie "wykrywa zawieszenie i odświeża", tylko "toleruje bardzo wolny zapis".

**Konsekwencja dla scenariusza 4 — prawdopodobny realny bug:** `deleteDataSourceForSystem`'s `verifyFn` (funkcja `getSystemRowValues`, `partnertax.js:352-370`) używa `.evaluate()` (żeby rozróżnić `<select>` od `<a>` w wierszach formularza) — a wywołanie `.evaluate()` na lokatorze **zaraz po kliknięciu Save** (ten sam `{noWaitAfter: true}` wzorzec) **deterministycznie rzuca `Timeout 30000ms exceeded`** po dokładnie 30 sekundach, bo próbuje rozwiązać uchwyt do elementu DOM w momencie, gdy strona faktycznie jest w trakcie nawigacji (w odróżnieniu od `waitForLoadState`, `.evaluate()` NA ELEMENCIE poprawnie wykrywa trwającą nawigację, ale najwyraźniej ignoruje przekazany `timeout` i zawsze czeka pełne 30s zanim odda kontrolę). Ten błąd **propaguje się jako nieobsłużony wyjątek** przez `clickSaveAndVerify` → `deleteDataSourceForSystem` → `deleteReportsFromPartnerTax`, więc cała funkcja **rzuca błędem zamiast zwrócić `{deletedCount, diagnostics}`**, mimo że usunięcie po stronie serwera realnie się powiodło. Zweryfikowane deterministycznie w kilku niezależnych powtórzeniach (różne opóźnienia mocka 0/150ms/1.5s — bez wpływu na wynik), więc to nie jest wyścig czasowy specyficzny dla mocka.

**Decyzja (za zgodą użytkownika):** scenariusz 4 testuje **rzeczywiste, zaobserwowane zachowanie** — `deleteReportsFromPartnerTax` rzuca błędem `Timeout 30000ms exceeded` po ~30 sekundach, zamiast zwrócić wynik. To dokumentuje realną, prawdopodobnie produkcyjną lukę (analogicznie do "sesja wygasła" w Bolcie / "zawieszony status" w Uberze) — **nie naprawiamy jej w tej iteracji**, tylko ją pokazujemy. `addDataSourceFile`'s verifyFn (upload) używa tylko `.count()`, nie `.evaluate()`, i **nie ma tego problemu** — dlatego scenariusze 1-3 (upload) kończą się sukcesem.

## Architektura mocka

Jak w Bolcie/FreeNow: wielostronicowa nawigacja (`/admin/` → `/admin/login/` → `/admin/finances/reckoning/` → `/admin/finances/reckoning/1/change/`), klienckie przekierowanie zamiast HTTP 302 (ten sam ustalony wzorzec). Deny-by-default catch-all przed specyficznym routem.

**Kluczowa różnica względem poprzednich trzech mocków:** formularz "Data source" (formset Django) to **prawdziwy `<form method="post">`** — kliknięcie "Save and continue editing" wywołuje PRAWDZIWĄ nawigację (POST), bo `partnertax.js` czeka na `page.waitForLoadState`/`page.locator(...).evaluate()` po kliknięciu. Żeby uniknąć parsowania multipart/form-data (plik + kilka pól select), każdy `<select>`/checkbox/plik w formularzu wysyła swoją wartość do serwera OD RAZU przy zmianie (`fetch` na `/api/mock/pending-*`) — serwer wie więc już PRZED kliknięciem "Zapisz", co jest w formularzu, i przy faktycznym POST-cie (którego treści nie parsujemy w ogóle) po prostu "zatwierdza" już znane dane.

**Komponenty:**
- `tests/mocks/partnerTaxAdminMock.js` — `installPartnerTaxMock(context, scenario)`, gdzie `scenario` to `{ credentials?, preSeedSavedSources?, hangOnFirstSave? }`.
- `tests/partnertax.stress.spec.js` — cztery testy.

## Uproszczenia świadomie przyjęte na tę iterację

- Pole organizacji/formset ma tylko jedną firmę/miasto z góry zdefiniowane w mocku (wystarczające dla testowanych scenariuszy) — pełna lista `CITY_OPTION_VALUES`/`COMPANY_OPTION_VALUES` z `partnertax.js` nie jest odtwarzana.
- Ścieżka błędu walidacji formularza po stronie Django (np. brak wymaganego pola) nie jest testowana — wszystkie scenariusze upload to happy-path warianty różnych stanów, nie testy błędów walidacji Django.
- Drugi wariant popupu/2FA przy logowaniu nie dotyczy tego modułu (Django admin nie ma takich mechanizmów w obecnym kodzie).

## Poza zakresem tej iteracji

- Naprawa odkrytego bugu w `getSystemRowValues`/`clickSaveAndVerify` (propagacja `Timeout 30000ms exceeded` z `.evaluate()`) — osobne zadanie, wymaga zgody na modyfikację kodu produkcyjnego.
- Pełna lista miast/firm z `CITY_OPTION_VALUES`/`COMPANY_OPTION_VALUES`.
