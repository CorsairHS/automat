# Harness testów odporności dla modułu PartnerTax admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dodać 4 testy odporności w `tests/partnertax.stress.spec.js`, wykorzystujące już zweryfikowany mock `tests/mocks/partnerTaxAdminMock.js`, do black-boxowego testowania `src/main/automation/platforms/partnertax.js` bez dotykania prawdziwego konta PartnerTax admin.

**Architecture:** `installPartnerTaxMock(context, scenario)` (już napisany i ręcznie zweryfikowany w tej sesji przeciwko prawdziwym `uploadToPartnerTax()`/`deleteReportsFromPartnerTax()` dla wszystkich 4 scenariuszy) przechwytuje `https://app.nova-partner.pl/**` wielostronicowo, z prawdziwym `<form method="post">` dla formularza "Data source" (każda zmiana pola wysyła stan na bieżąco przez `fetch`, POST przy "Zapisz" tylko zatwierdza już znane dane). Ten plan tylko dopisuje testy korzystające z tego mocka.

**Tech Stack:** Playwright (`playwright/test`), bez nowych zależności.

**Spec:** `docs/superpowers/specs/2026-08-28-partnertax-resilience-tests-design.md`

## Global Constraints

- Nie modyfikować `src/main/automation/platforms/partnertax.js` — testy są czysto black-box. **W tym: NIE naprawiamy odkrytego w tej sesji bugu** (`.evaluate()` w `getSystemRowValues` rzuca `Timeout 30000ms exceeded` po każdym prawdziwym usunięciu) — scenariusz 4 testuje to zaobserwowane zachowanie wprost.
- Nie modyfikować `tests/mocks/partnerTaxAdminMock.js` — już napisany, ręcznie zweryfikowany i zacommitowany (commit `b2ce7a8`); wszystkie 4 zadania w tym planie tylko go KONSUMUJĄ.
- Żadnych nowych zależności npm.
- Testy nie łączą się z prawdziwym `app.nova-partner.pl` — mock zawiera deny-by-default catch-all.
- Scenariusz 3 ma świadomie długi czas wykonania (~30-40s, zmierzone empirycznie: 25s sztucznego opóźnienia + narzut nawigacji/logowania) — to zaakceptowany koszt, nie błąd.
- Scenariusz 4 ma świadomie długi czas wykonania (~30-35s, zmierzone empirycznie: deterministyczny `Timeout 30000ms exceeded` z `.evaluate()` w produkcyjnym kodzie) — **oczekiwany wynik to BŁĄD (odrzucona obietnica), nie sukces**.
- Istniejący `playwright.config.js` w root już pokrywa nowy plik `tests/partnertax.stress.spec.js` — nie trzeba nowej konfiguracji.

---

### Task 1: Setup pliku testowego + happy path

**Files:**
- Create: `tests/partnertax.stress.spec.js`

**Interfaces:**
- Consumes: `installPartnerTaxMock(context, scenario)` z `tests/mocks/partnerTaxAdminMock.js`, zwraca `{ state }`.
- Consumes: `uploadToPartnerTax({ context, account, uploads, statusCallback })` i `deleteReportsFromPartnerTax({ context, account, statusCallback })` z `src/main/automation/platforms/partnertax.js` (bez zmian).
- Produces: `makeAccount(overrides)` — `{ accountId, label, fields: { username: 'partner', password: 'secret123' } }`.
- Produces: `makeUpload(overrides)` — helper tworzący plik tymczasowy i zwracający `{ platformId: 'bolt', city: 'wroclaw', company: 'unity drive', filePath }` (miasto/firma MUSZĄ pasować do opcji zdefiniowanych w `KNOWN_CITIES`/`KNOWN_COMPANIES` mocka: `wroclaw`→`7`, `unity drive`→`5` — dowolna inna wartość spowoduje błąd `resolveCityValue`/`resolveCompanyValue` w `partnertax.js` PRZED jakąkolwiek interakcją ze stroną).

- [ ] **Step 1: Napisz plik testowy z helperami i pierwszym testem**

Utwórz `tests/partnertax.stress.spec.js`:

```js
const path = require('path');
const os = require('os');
const fs = require('fs');
const { test, expect, chromium } = require('playwright/test');
const { uploadToPartnerTax, deleteReportsFromPartnerTax } = require('../src/main/automation/platforms/partnertax');
const { installPartnerTaxMock } = require('./mocks/partnerTaxAdminMock');

function makeAccount(overrides = {}) {
  return {
    accountId: 'test-account',
    label: 'Test Account',
    fields: { username: 'partner', password: 'secret123' },
    ...overrides,
  };
}

function makeUpload(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptx-file-'));
  const filePath = path.join(dir, 'report.csv');
  fs.writeFileSync(filePath, 'a,b\n1,2\n');
  return {
    platformId: 'bolt',
    city: 'wroclaw',
    company: 'unity drive',
    filePath,
    ...overrides,
  };
}

test.describe('PartnerTax admin resilience', () => {
  let browser;

  test.beforeEach(async () => {
    browser = await chromium.launch();
  });

  test.afterEach(async () => {
    await browser.close();
  });

  test('happy path: login + upload jednego pliku', async () => {
    const context = await browser.newContext();
    const mock = await installPartnerTaxMock(context, {});
    const account = makeAccount();

    await uploadToPartnerTax({ context, account, uploads: [makeUpload()], statusCallback: () => {} });

    expect(mock.state.savedSources).toEqual([{ system: '17' }]);
  });
});
```

- [ ] **Step 2: Uruchom test i zweryfikuj, że przechodzi**

Run: `npx playwright test tests/partnertax.stress.spec.js -g "happy path"`
Expected: 1 passed (kilka sekund).

- [ ] **Step 3: Commit**

```bash
git add tests/partnertax.stress.spec.js
git commit -m "test: add PartnerTax admin resilience test harness with happy-path scenario"
```

---

### Task 2: Scenariusz "upload wielu plików z częściowym niepowodzeniem"

**Files:**
- Modify: `tests/partnertax.stress.spec.js`

**Interfaces:**
- Consumes: `makeUpload({ platformId, city, company })` z Task 1 — środkowy upload dostaje celowo nieznane miasto.

- [ ] **Step 1: Dodaj test**

Wstaw nowy `test(...)` zaraz po teście `'happy path: ...'`, przed zamknięciem `});` bloku `test.describe`:

```js

  test('upload wielu plikow: czesciowe niepowodzenie zwraca juz zapisane pliki', async () => {
    const context = await browser.newContext();
    const mock = await installPartnerTaxMock(context, {});
    const account = makeAccount();
    const uploads = [
      makeUpload({ platformId: 'bolt' }),
      makeUpload({ platformId: 'uber', city: 'nieznane-miasto' }),
      makeUpload({ platformId: 'freenow' }),
    ];

    let caughtError;
    try {
      await uploadToPartnerTax({ context, account, uploads, statusCallback: () => {} });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError.message).toMatch(/nieznane miasto/i);
    expect(caughtError.succeededUploads.map((u) => u.platformId)).toEqual(['bolt']);
    expect(mock.state.savedSources).toEqual([{ system: '17' }]);
  });
```

- [ ] **Step 2: Uruchom test i zweryfikuj, że przechodzi**

Run: `npx playwright test tests/partnertax.stress.spec.js -g "czesciowe niepowodzenie"`
Expected: 1 passed (kilka sekund — `resolveCityValue` rzuca błąd natychmiast, bez żadnej interakcji ze stroną dla drugiego uploadu).

- [ ] **Step 3: Uruchom oba testy razem**

Run: `npx playwright test tests/partnertax.stress.spec.js -g "happy path|czesciowe niepowodzenie"`
Expected: 2 passed.

- [ ] **Step 4: Commit**

```bash
git add tests/partnertax.stress.spec.js
git commit -m "test: add partial-upload-failure scenario to PartnerTax admin resilience suite"
```

---

### Task 3: Scenariusz "bardzo wolny zapis"

**Files:**
- Modify: `tests/partnertax.stress.spec.js`

**Interfaces:**
- Consumes: `installPartnerTaxMock(context, { hangOnFirstSave: true })`.

- [ ] **Step 1: Dodaj test**

Wstaw nowy `test(...)` zaraz po teście `'upload wielu plikow: ...'`:

```js

  test('bardzo wolny zapis: uploadToPartnerTax mimo to konczy sie sukcesem', async () => {
    test.setTimeout(90_000);
    const context = await browser.newContext();
    const mock = await installPartnerTaxMock(context, { hangOnFirstSave: true });
    const account = makeAccount();

    await uploadToPartnerTax({ context, account, uploads: [makeUpload()], statusCallback: () => {} });

    expect(mock.state.savedSources).toEqual([{ system: '17' }]);
  });
```

- [ ] **Step 2: Uruchom test i zweryfikuj, że przechodzi (uwaga: trwa ~30-40s)**

Run: `npx playwright test tests/partnertax.stress.spec.js -g "bardzo wolny zapis"`
Expected: 1 passed, czas wykonania rzędu 30-40 sekund (zmierzone empirycznie przy prototypowaniu tego mocka w tej samej sesji — 25s sztucznego opóźnienia pierwszej odpowiedzi na "Zapisz" plus narzut logowania/nawigacji). To zgodne z projektem — zewnętrzna pętla `verifyFn()` w `clickSaveAndVerify` poprawnie wykrywa sukces mimo bardzo wolnej odpowiedzi, mimo że `page.waitForLoadState()` (patrz spec) nie wykrywa tego jawnie.

- [ ] **Step 3: Commit**

```bash
git add tests/partnertax.stress.spec.js
git commit -m "test: add slow-save-still-succeeds scenario to PartnerTax admin resilience suite"
```

---

### Task 4: Scenariusz "usuwanie raportu zapisanego pod aliasem systemu"

**Files:**
- Modify: `tests/partnertax.stress.spec.js`

**Interfaces:**
- Consumes: `installPartnerTaxMock(context, { preSeedSavedSources: [{ system: '65' }] })`.

- [ ] **Step 1: Dodaj test**

Wstaw nowy `test(...)` zaraz po teście `'bardzo wolny zapis: ...'`, przed zamknięciem `});` bloku `test.describe`. **WAŻNE — ten test dokumentuje zaobserwowane, prawdopodobnie błędne zachowanie produkcyjnego kodu (patrz spec): `deleteReportsFromPartnerTax` rzuca błędem zamiast zwrócić wynik, mimo że raport pod aliasem faktycznie zostaje znaleziony i usunięty po stronie mocka. Test asercjonuje ten RZECZYWISTY wynik (odrzuconą obietnicę), nie idealny.**

```js

  test('usuwanie po aliasie systemu: deleteReportsFromPartnerTax rzuca timeoutem mimo poprawnego dopasowania', async () => {
    test.setTimeout(60_000);
    const context = await browser.newContext();
    const mock = await installPartnerTaxMock(context, { preSeedSavedSources: [{ system: '65' }] });
    const account = makeAccount();

    await expect(
      deleteReportsFromPartnerTax({ context, account, statusCallback: () => {} })
    ).rejects.toThrow(/timeout 30000ms exceeded/i);

    // Mimo rzuconego bledu, mock pokazuje ze usuniecie PO STRONIE SERWERA faktycznie
    // zaszlo - to dokladnie ten sam mechanizm co realnie zgloszony bug klienta
    // ("wisial, a potem wywalal sie bledem mimo ze serwer zdazyl juz zapisac plik"),
    // tylko przy usuwaniu zamiast dodawaniu.
    expect(mock.state.savedSources).toEqual([]);
  });
```

- [ ] **Step 2: Uruchom test i zweryfikuj, że przechodzi (uwaga: trwa ~30-35s, oczekiwany wynik to odrzucona obietnica)**

Run: `npx playwright test tests/partnertax.stress.spec.js -g "usuwanie po aliasie"`
Expected: 1 passed, czas wykonania rzędu 30-35 sekund. Test przechodzi, gdy `deleteReportsFromPartnerTax` RZUCA błędem pasującym do regexu — jeśli kiedyś przestanie rzucać (np. po naprawieniu bugu w `partnertax.js`), ten test zacznie failować i trzeba go będzie zaktualizować do oczekiwania sukcesu zamiast błędu.

- [ ] **Step 3: Uruchom cały plik testowy razem**

Run: `npx playwright test tests/partnertax.stress.spec.js`
Expected: 4 passed (całość zajmie ~1-1.5 minuty, ze względu na scenariusze 3 i 4).

- [ ] **Step 4: Commit**

```bash
git add tests/partnertax.stress.spec.js
git commit -m "test: add alias-delete scenario (documents observed evaluate-timeout bug) to PartnerTax admin resilience suite"
```

---

## Po zakończeniu

Pełny zestaw: `npx playwright test tests/partnertax.stress.spec.js`. Razem z istniejącymi harnessami Bolta/Ubera/FreeNow, `npx playwright test` uruchamia teraz wszystkie cztery platformy (16 testów łącznie).

**Ważne dla przyszłości:** scenariusz 4 jest sprzężony z realnym bugiem w `partnertax.js`. Jeśli ktoś kiedyś naprawi `getSystemRowValues`/`clickSaveAndVerify` (np. usuwając `.evaluate()` albo opakowując je w retry), ten test zacznie failować — to oczekiwane i wtedy trzeba go przepisać na oczekiwanie sukcesu (`deletedCount: 1`) zamiast błędu.
