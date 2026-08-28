# Harness testów odporności dla modułu FreeNow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dodać 4 testy odporności w `tests/freenow.stress.spec.js`, wykorzystujące już zweryfikowany mock `tests/mocks/freenowPortalMock.js` (+ `tests/mocks/zipBuilder.js`), do black-boxowego testowania `src/main/automation/platforms/freenow.js` bez dotykania prawdziwego konta FreeNow.

**Architecture:** `installFreenowMock(context, scenario)` (już napisany i ręcznie zweryfikowany w tej sesji przeciwko prawdziwemu `syncFreenowAccount()` dla wszystkich 4 scenariuszy, włącznie z mutation-testem scenariusza duplikatu linku) przechwytuje `https://portal.free-now.com/**` wielostronicowo (jak Bolt) i serwuje prawdziwe bajty ZIP (budowane przez `zipBuilder.js`, bez nowej zależności) dla pobieranego archiwum. Ten plan tylko dopisuje testy korzystające z tych już gotowych modułów.

**Tech Stack:** Playwright (`playwright/test`), bez nowych zależności.

**Spec:** `docs/superpowers/specs/2026-08-28-freenow-resilience-tests-design.md`

## Global Constraints

- Nie modyfikować `src/main/automation/platforms/freenow.js` — testy są czysto black-box.
- Nie modyfikować `tests/mocks/freenowPortalMock.js` ani `tests/mocks/zipBuilder.js` — już napisane, ręcznie zweryfikowane i zacommitowane (commit `b6c1d84`); wszystkie 4 zadania w tym planie tylko je KONSUMUJĄ.
- Żadnych nowych zależności npm.
- Testy nie łączą się z prawdziwym `portal.free-now.com` — mock zawiera deny-by-default catch-all.
- Istniejący `playwright.config.js` w root już pokrywa nowy plik `tests/freenow.stress.spec.js` — nie trzeba nowej konfiguracji.

---

### Task 1: Setup pliku testowego + happy path

**Files:**
- Create: `tests/freenow.stress.spec.js`

**Interfaces:**
- Consumes: `installFreenowMock(context, scenario)` z `tests/mocks/freenowPortalMock.js`.
- Consumes: `syncFreenowAccount({ context, account, downloadDir, statusCallback })` z `src/main/automation/platforms/freenow.js` (bez zmian).
- Produces: `makeAccount(overrides)` (helper lokalny w spec-file): `{ accountId, label, fields: { email: 'partner@example.com', password: 'secret123' }, periodMode: 'custom', periodFrom: '2026-08-05', periodTo: '2026-08-07' }`.

- [ ] **Step 1: Napisz plik testowy z helperem i pierwszym testem**

Utwórz `tests/freenow.stress.spec.js`:

```js
const path = require('path');
const os = require('os');
const fs = require('fs');
const { test, expect, chromium } = require('playwright/test');
const { syncFreenowAccount } = require('../src/main/automation/platforms/freenow');
const { installFreenowMock } = require('./mocks/freenowPortalMock');

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

test.describe('FreeNow resilience', () => {
  let browser;
  let downloadDir;

  test.beforeEach(async () => {
    browser = await chromium.launch();
    downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freenow-test-'));
  });

  test.afterEach(async () => {
    await browser.close();
    fs.rmSync(downloadDir, { recursive: true, force: true });
  });

  test('happy path: login, pobranie ZIP, rozpakowanie wariantu WITH VAT', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    await installFreenowMock(context, {});
    const account = makeAccount();

    const result = await syncFreenowAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(result.filePath).toMatch(/with[_\s-]?vat/i);
    expect(fs.readFileSync(result.filePath, 'utf8')).toContain('with_vat,column');
  });
});
```

- [ ] **Step 2: Uruchom test i zweryfikuj, że przechodzi**

Run: `npx playwright test tests/freenow.stress.spec.js -g "happy path"`
Expected: 1 passed (kilkanaście sekund — w tym ~2s na sprawdzenie nieobecnego przycisku "Company", które `freenow.js` zawsze wykonuje przed pominięciem go).

- [ ] **Step 3: Commit**

```bash
git add tests/freenow.stress.spec.js
git commit -m "test: add FreeNow resilience test harness with happy-path scenario"
```

---

### Task 2: Scenariusz "sesja już zalogowana"

**Files:**
- Modify: `tests/freenow.stress.spec.js`

**Interfaces:**
- Consumes: `installFreenowMock(context, { startLoggedIn: true })`.

- [ ] **Step 1: Dodaj test**

Wstaw nowy `test(...)` zaraz po teście `'happy path: ...'`, przed zamknięciem `});` bloku `test.describe`:

```js

  test('sesja juz zalogowana: pomija formularz logowania', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    await installFreenowMock(context, { startLoggedIn: true });
    const account = makeAccount();

    const result = await syncFreenowAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(result.filePath).toMatch(/with[_\s-]?vat/i);
  });
```

- [ ] **Step 2: Uruchom test i zweryfikuj, że przechodzi**

Run: `npx playwright test tests/freenow.stress.spec.js -g "sesja juz zalogowana"`
Expected: 1 passed (szybciej niż happy path — brak kroku logowania, więc brak 2s sprawdzenia przycisku "Company").

- [ ] **Step 3: Uruchom oba testy razem**

Run: `npx playwright test tests/freenow.stress.spec.js -g "happy path|sesja juz zalogowana"`
Expected: 2 passed.

- [ ] **Step 4: Commit**

```bash
git add tests/freenow.stress.spec.js
git commit -m "test: add already-logged-in scenario to FreeNow resilience suite"
```

---

### Task 3: Scenariusz "duplikat linku Zarobki"

**Files:**
- Modify: `tests/freenow.stress.spec.js`

**Interfaces:**
- Consumes: `installFreenowMock(context, { duplicateEarningsLink: true })`.

- [ ] **Step 1: Dodaj test**

Wstaw nowy `test(...)` zaraz po teście `'sesja juz zalogowana: ...'`:

```js

  test('duplikat linku Zarobki: dopasowanie po dokladnym tekscie omija kolizje', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    await installFreenowMock(context, { duplicateEarningsLink: true });
    const account = makeAccount();

    const result = await syncFreenowAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
  });
```

- [ ] **Step 2: Uruchom test i zweryfikuj, że przechodzi**

Run: `npx playwright test tests/freenow.stress.spec.js -g "duplikat linku"`
Expected: 1 passed (kilkanaście sekund).

- [ ] **Step 3: Commit**

```bash
git add tests/freenow.stress.spec.js
git commit -m "test: add duplicate-earnings-link regression scenario to FreeNow resilience suite"
```

---

### Task 4: Scenariusz "brak wariantu WITH VAT"

**Files:**
- Modify: `tests/freenow.stress.spec.js`

**Interfaces:**
- Consumes: `installFreenowMock(context, { includeWithVatFile: false })`.

- [ ] **Step 1: Dodaj test**

Wstaw nowy `test(...)` zaraz po teście `'duplikat linku Zarobki: ...'`, przed zamknięciem `});` bloku `test.describe`:

```js

  test('brak wariantu WITH VAT: syncFreenowAccount rzuca czytelnym bledem', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    await installFreenowMock(context, { includeWithVatFile: false });
    const account = makeAccount();

    await expect(
      syncFreenowAccount({ context, account, downloadDir, statusCallback: () => {} })
    ).rejects.toThrow(/nie znaleziono pliku wariantu with vat/i);
  });
```

- [ ] **Step 2: Uruchom test i zweryfikuj, że przechodzi**

Run: `npx playwright test tests/freenow.stress.spec.js -g "brak wariantu"`
Expected: 1 passed (kilkanaście sekund — to szybki, deterministyczny błąd, nie zależny od żadnego hardkodowanego timeoutu).

- [ ] **Step 3: Uruchom cały plik testowy razem**

Run: `npx playwright test tests/freenow.stress.spec.js`
Expected: 4 passed.

- [ ] **Step 4: Commit**

```bash
git add tests/freenow.stress.spec.js
git commit -m "test: add missing-WITH-VAT-variant error scenario to FreeNow resilience suite"
```

---

## Po zakończeniu

Pełny zestaw: `npx playwright test tests/freenow.stress.spec.js`. Razem z istniejącymi `tests/bolt.stress.spec.js` i `tests/uber.stress.spec.js`, `npx playwright test` uruchamia teraz wszystkie trzy platformy (12 testów łącznie).
