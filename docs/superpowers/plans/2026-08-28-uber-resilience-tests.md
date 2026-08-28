# Harness testów odporności dla modułu Uber Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dodać 4 testy odporności w `tests/uber.stress.spec.js`, wykorzystujące już zweryfikowany mock `tests/mocks/uberSupplierMock.js`, do black-boxowego testowania `src/main/automation/platforms/uber.js` bez dotykania prawdziwego konta Uber.

**Architecture:** `installUberMock(context, scenario)` (już napisany i ręcznie zweryfikowany w tej sesji przeciwko prawdziwemu `syncUberAccount()` dla wszystkich 4 scenariuszy, włącznie z mutation-testem scenariusza popupu) przechwytuje `https://supplier.uber.com/**` i serwuje jeden dokument SPA ze stanem trzymanym serwerowo dla przejść, które muszą przetrwać `page.reload()`. Ten plan tylko dopisuje testy korzystające z tego mocka — sam mock nie jest już częścią zadań implementacyjnych.

**Tech Stack:** Playwright (`playwright/test`, ta sama instalacja co harness Bolta), bez nowych zależności.

**Spec:** `docs/superpowers/specs/2026-08-28-uber-resilience-tests-design.md`

## Global Constraints

- Nie modyfikować `src/main/automation/platforms/uber.js` — testy są czysto black-box.
- Nie modyfikować `tests/mocks/uberSupplierMock.js` — już napisany, ręcznie zweryfikowany i zacommitowany (commit `c22f418`); wszystkie 4 zadania w tym planie tylko go KONSUMUJĄ.
- Żadnych nowych zależności npm.
- Testy nie łączą się z prawdziwym `supplier.uber.com` — mock zawiera deny-by-default catch-all (`context.route('**/*', route => route.abort('blockedbyclient'))`).
- Scenariusz 4 ("zawieszony status") ma świadomie długi czas wykonania (zmierzone empirycznie: ~35-70s, zależnie od maszyny) — `uber.js` odświeża stronę co zahardkodowane 30 sekund; to zaakceptowany koszt, nie błąd.
- Istniejący `playwright.config.js` w root (z harnessu Bolta, `testDir: './tests'`) już pokrywa nowy plik `tests/uber.stress.spec.js` — nie trzeba nowej konfiguracji.

---

### Task 1: Setup pliku testowego + scenariusz "raport już istnieje"

**Files:**
- Create: `tests/uber.stress.spec.js`

**Interfaces:**
- Consumes: `installUberMock(context, scenario)` z `tests/mocks/uberSupplierMock.js`, zwraca `{ state }` (na tę chwilę `state` nie jest używany bezpośrednio w testach — czytelny stan wewnętrzny mocka, przydatny do debugowania).
- Consumes: `syncUberAccount({ context, account, downloadDir, statusCallback })` z `src/main/automation/platforms/uber.js` (bez zmian).
- Produces: `makeAccount(overrides)` (helper lokalny w spec-file), zwraca `{ accountId, label, fields: { email, password }, periodMode: 'custom', periodFrom: '2026-08-05', periodTo: '2026-08-07' }` — te konkretne daty MUSZĄ być użyte, bo domyślny `reportNamePrefix`/`fromSlash`/`toSlash` w `installUberMock` są dopasowane do nich (`20260805-20260807-payments_driver`, `2026/08/05`, `2026/08/07`).

- [ ] **Step 1: Napisz plik testowy z helperem i pierwszym testem**

Utwórz `tests/uber.stress.spec.js`:

```js
const path = require('path');
const os = require('os');
const fs = require('fs');
const { test, expect, chromium } = require('playwright/test');
const { syncUberAccount } = require('../src/main/automation/platforms/uber');
const { installUberMock } = require('./mocks/uberSupplierMock');

function makeAccount(overrides = {}) {
  return {
    accountId: 'test-account',
    label: 'Test Account',
    fields: { email: 'partner@example.com', password: 'secret123' },
    periodMode: 'custom',
    periodFrom: '2026-08-05',
    periodTo: '2026-08-07',
    ...overrides,
  };
}

test.describe('Uber resilience', () => {
  let browser;
  let downloadDir;

  test.beforeEach(async () => {
    browser = await chromium.launch();
    downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uber-test-'));
  });

  test.afterEach(async () => {
    await browser.close();
    fs.rmSync(downloadDir, { recursive: true, force: true });
  });

  test('raport juz istnieje: pomija dialog generowania', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    await installUberMock(context, { reportAlreadyExists: true });
    const account = makeAccount();

    const result = await syncUberAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(fs.readFileSync(result.filePath, 'utf8')).toContain('data,column');
  });
});
```

- [ ] **Step 2: Uruchom test i zweryfikuj, że przechodzi**

Run: `npx playwright test tests/uber.stress.spec.js -g "raport juz istnieje"`
Expected: 1 passed (kilka sekund).

- [ ] **Step 3: Commit**

```bash
git add tests/uber.stress.spec.js
git commit -m "test: add Uber resilience test harness with report-already-exists scenario"
```

---

### Task 2: Scenariusz "pełne generowanie nowego raportu"

**Files:**
- Modify: `tests/uber.stress.spec.js`

**Interfaces:**
- Consumes: `installUberMock(context, { reportAlreadyExists: false, requireReloadForDownloadReady: false })`.

- [ ] **Step 1: Dodaj test**

Wstaw nowy `test(...)` zaraz po teście `'raport juz istnieje: ...'`, przed zamknięciem `});` bloku `test.describe`:

```js

  test('pelne generowanie: dialog, kalendarz, organizacja, pobranie', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    await installUberMock(context, { reportAlreadyExists: false, requireReloadForDownloadReady: false });
    const account = makeAccount();

    const result = await syncUberAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
  });
```

- [ ] **Step 2: Uruchom test i zweryfikuj, że przechodzi**

Run: `npx playwright test tests/uber.stress.spec.js -g "pelne generowanie"`
Expected: 1 passed (kilka sekund — cała ścieżka generowania jest szybka, bo `requireReloadForDownloadReady: false` sprawia że raport jest gotowy do pobrania natychmiast po wygenerowaniu, bez czekania na odświeżenie).

- [ ] **Step 3: Uruchom oba testy razem**

Run: `npx playwright test tests/uber.stress.spec.js -g "raport juz istnieje|pelne generowanie"`
Expected: 2 passed.

- [ ] **Step 4: Commit**

```bash
git add tests/uber.stress.spec.js
git commit -m "test: add full report-generation scenario to Uber resilience suite"
```

---

### Task 3: Scenariusz "popup przerywający wybór dat"

**Files:**
- Modify: `tests/uber.stress.spec.js`

**Interfaces:**
- Consumes: `installUberMock(context, { reportAlreadyExists: false, requireReloadForDownloadReady: false, popupAfterDateSelection: true })`.

- [ ] **Step 1: Dodaj test**

Wstaw nowy `test(...)` zaraz po teście `'pelne generowanie: ...'`:

```js

  test('popup po wyborze dat: dismissChatBubble odslania kolejny klik', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    await installUberMock(context, {
      reportAlreadyExists: false,
      requireReloadForDownloadReady: false,
      popupAfterDateSelection: true,
    });
    const account = makeAccount();

    const result = await syncUberAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
  });
```

- [ ] **Step 2: Uruchom test i zweryfikuj, że przechodzi**

Run: `npx playwright test tests/uber.stress.spec.js -g "popup po wyborze dat"`
Expected: 1 passed (kilka sekund).

- [ ] **Step 3 (weryfikacja jakości testu — mutation check): potwierdź, że test faktycznie coś sprawdza**

Tymczasowo zepsuj selektor w mocku, żeby upewnić się że test bez niego faktycznie failuje (to NIE jest trwała zmiana — cofnij ją zaraz po sprawdzeniu):

```bash
sed -i 's/data-testid="first-impression-dismiss"/data-testid="BROKEN-dismiss"/' tests/mocks/uberSupplierMock.js
```

Run: `npx playwright test tests/uber.stress.spec.js -g "popup po wyborze dat"`
Expected: test FAILUJE (dowód, że test ma realne zęby — bez poprawnego dismissChatBubble popup faktycznie blokuje klik). Jeśli test i tak przejdzie, to znaczy że test nie testuje tego co powinien — zgłoś to jako DONE_WITH_CONCERNS zamiast kontynuować.

Cofnij zmianę:

```bash
sed -i 's/data-testid="BROKEN-dismiss"/data-testid="first-impression-dismiss"/' tests/mocks/uberSupplierMock.js
git diff tests/mocks/uberSupplierMock.js
```

Expected: `git diff` pokazuje PUSTY diff (plik wrócił do stanu zacommitowanego) — potwierdź to przed przejściem dalej. Uruchom ponownie test, żeby upewnić się że znowu przechodzi:

Run: `npx playwright test tests/uber.stress.spec.js -g "popup po wyborze dat"`
Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add tests/uber.stress.spec.js
git commit -m "test: add popup-interrupts-date-selection scenario to Uber resilience suite"
```

(Nie commituj żadnej zmiany w `tests/mocks/uberSupplierMock.js` — Step 3 był tylko tymczasową weryfikacją i musi być w pełni cofnięty przed commitem.)

---

### Task 4: Scenariusz "zawieszony status wymagający odświeżenia"

**Files:**
- Modify: `tests/uber.stress.spec.js`

**Interfaces:**
- Consumes: `installUberMock(context, { reportAlreadyExists: false, requireReloadForDownloadReady: true })`.

- [ ] **Step 1: Dodaj test**

Wstaw nowy `test(...)` zaraz po teście `'popup po wyborze dat: ...'`, przed zamknięciem `});` bloku `test.describe`:

```js

  test('zawieszony status W toku: syncUberAccount odswieza strone i konczy sukcesem', async () => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ acceptDownloads: true });
    await installUberMock(context, { reportAlreadyExists: false, requireReloadForDownloadReady: true });
    const account = makeAccount();

    const result = await syncUberAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
  });
```

- [ ] **Step 2: Uruchom test i zweryfikuj, że przechodzi (uwaga: trwa ~35-70s)**

Run: `npx playwright test tests/uber.stress.spec.js -g "zawieszony status"`
Expected: 1 passed, czas wykonania rzędu 35-70 sekund (zmierzone empirycznie przy prototypowaniu tego mocka w tej samej sesji — `uber.js` odświeża stronę co zahardkodowane `REFRESH_INTERVAL_MS = 30000`, zanim status raportu "odblokuje się" do pobrania). To zgodne z projektem — nie skracamy interwału w `uber.js`.

- [ ] **Step 3: Uruchom całą (szybką) resztę testów razem, żeby potwierdzić stabilność**

Run: `npx playwright test tests/uber.stress.spec.js -g "raport juz istnieje|pelne generowanie|popup po wyborze dat"`
Expected: 3 passed.

- [ ] **Step 4: Commit**

```bash
git add tests/uber.stress.spec.js
git commit -m "test: add stuck-status-requires-refresh scenario to Uber resilience suite"
```

---

## Po zakończeniu

Pełny zestaw: `npx playwright test tests/uber.stress.spec.js` (obejmuje scenariusz 4, więc cały przebieg zajmie ~1-1.5 minuty). Razem z istniejącym `tests/bolt.stress.spec.js`, `npx playwright test` uruchamia teraz obie platformy.
