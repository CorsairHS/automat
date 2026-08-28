# Harness testów odporności dla modułu Bolt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zbudować black-boxowy harness testowy dla `src/main/automation/platforms/bolt.js`, który przechwytuje ruch sieciowy do `fleets.bolt.eu` i pozwala odtworzyć happy path oraz trzy scenariusze odporności (sesja już zalogowana, sesja wygasająca w trakcie flow, wolne ładowanie SPA) bez dotykania prawdziwego konta Bolt.

**Architecture:** Playwright `context.route()` przechwytuje żądania do `https://fleets.bolt.eu/**` i serwuje w locie wygenerowany HTML/JS imitujący panel logowania i stronę raportu (kalendarz `react-datepicker`, menu pobierania CSV przez `fetch('/api/csv-export')`). Testy wołają realny, niezmieniony `syncBoltAccount()` z prawdziwym Chromium i asertują na wyniku (zapisany plik / rzucony błąd).

**Tech Stack:** Playwright (`playwright/test` — już w `node_modules`, żadna nowa zależność), Node.js `fs`/`os`/`path` do katalogów tymczasowych.

**Spec:** `docs/superpowers/specs/2026-08-28-bolt-resilience-tests-design.md`

## Global Constraints

- Nie modyfikować `src/main/automation/platforms/bolt.js` — testy są czysto black-box przez przechwytywanie sieci.
- Żadnych nowych zależności npm — używamy `playwright/test`, które jest już eksportowane przez istniejącą zależność `playwright`.
- Testy nie łączą się z prawdziwym `fleets.bolt.eu` — cały ruch do tego origin jest przechwytywany przez mock.
- Scenariusz "sesja wygasa w trakcie" ma świadomie długi czas wykonania (do ~120s, bo `bolt.js` czeka na wbudowany timeout downloadu) — to zaakceptowany koszt, nie błąd do naprawienia w tym planie.

---

### Task 1: Test runner setup + mock panelu Bolt + test happy path

**Files:**
- Create: `playwright.config.js`
- Create: `tests/mocks/boltFleetMock.js`
- Create: `tests/bolt.stress.spec.js`
- Modify: `package.json` (dodanie skryptu `test`)

**Interfaces:**
- Produces: `installBoltMock(context, scenario)` z `tests/mocks/boltFleetMock.js`, gdzie `scenario` to `{ orgId?, credentials?, startLoggedIn?, networkDelayMs?, expireAfterDateSelected?, csvFileName?, csvContent? }`. Zwraca `{ reportUrl, loginUrl, getLoginPageServedCount() }`.
- Produces: `makeAccount(overrides)` (helper lokalny w spec-file) zwracający obiekt konta zgodny z kształtem używanym przez `syncBoltAccount` (`{ accountId, label, fields: { email, password, orgId }, periodMode, periodFrom, periodTo }`).
- Consumes: `syncBoltAccount({ context, account, downloadDir, statusCallback })` z `src/main/automation/platforms/bolt.js` (bez zmian).

- [ ] **Step 1: Napisz plik konfiguracyjny Playwrighta**

Utwórz `playwright.config.js` w katalogu głównym:

```js
const { defineConfig } = require('playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 45_000,
  fullyParallel: true,
});
```

- [ ] **Step 2: Dodaj skrypt `test` w `package.json`**

W `package.json`, w sekcji `"scripts"`, dodaj:

```json
    "test": "playwright test",
```

(obok istniejących skryptów `start`, `postinstall`, itd. — zachowaj przecinki między wpisami).

- [ ] **Step 3: Napisz mock panelu Bolt**

Utwórz `tests/mocks/boltFleetMock.js`:

```js
const DEFAULT_CREDENTIALS = { email: 'partner@example.com', password: 'secret123' };

function toScriptLiteral(value) {
  return JSON.stringify(value);
}

function buildLoginHtml({ expectedEmail, expectedPassword, reportUrl }) {
  return `<!doctype html>
<html>
<body>
  <input id="email" />
  <input id="current-password" type="password" />
  <button>Zaloguj się</button>
  <script>
    document.querySelector('button').addEventListener('click', () => {
      const email = document.getElementById('email').value;
      const password = document.getElementById('current-password').value;
      if (email === ${toScriptLiteral(expectedEmail)} && password === ${toScriptLiteral(expectedPassword)}) {
        window.location.href = ${toScriptLiteral(reportUrl)};
      }
    });
  </script>
</body>
</html>`;
}

function buildReportHtml({ csvFileName, loginUrl }) {
  const dayCells = Array.from({ length: 31 }, (_, i) => i + 1)
    .map((day) => `<div class="react-datepicker__day">${day}</div>`)
    .join('');

  return `<!doctype html>
<html>
<body>
  <input placeholder="d MMM - d MMM" readonly />
  <div id="calendar" style="display:none">${dayCells}</div>
  <button>Pobierz</button>
  <div id="download-menu" style="display:none">
    <div id="csv-menu-item">Eksport CSV danych finansowych kierowcy</div>
  </div>
  <script>
    let selectedCount = 0;
    document.querySelector('input').addEventListener('click', () => {
      document.getElementById('calendar').style.display = 'block';
    });
    document.getElementById('calendar').addEventListener('click', (e) => {
      if (!e.target.classList.contains('react-datepicker__day')) return;
      selectedCount += 1;
      if (selectedCount >= 2) document.getElementById('calendar').style.display = 'none';
    });
    document.querySelector('button').addEventListener('click', () => {
      document.getElementById('download-menu').style.display = 'block';
    });
    document.getElementById('csv-menu-item').addEventListener('click', async () => {
      const res = await fetch('/api/csv-export');
      if (res.status === 200) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = ${toScriptLiteral(csvFileName)};
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        window.location.href = ${toScriptLiteral(loginUrl)};
      }
    });
  </script>
</body>
</html>`;
}

/**
 * Instaluje przechwytywanie ruchu do fleets.bolt.eu na danym Playwrightowym
 * BrowserContext, serwując w locie fałszywy panel Bolt. Pozwala uruchomić
 * prawdziwy, niezmieniony syncBoltAccount() bez kontaktu z prawdziwym Boltem.
 */
async function installBoltMock(context, scenario = {}) {
  const {
    orgId = 'test-org',
    credentials = DEFAULT_CREDENTIALS,
    startLoggedIn = false,
    networkDelayMs = 0,
    expireAfterDateSelected = false,
    csvFileName = 'zarobki-test-org.csv',
    csvContent = 'data,column\n1,2\n',
  } = scenario;

  const loginPath = '/login';
  const reportPath = `/${orgId}/finances/reports/driverEarnings`;
  const reportUrl = `https://fleets.bolt.eu${reportPath}`;
  const loginUrl = `https://fleets.bolt.eu${loginPath}`;

  let loginPageServedCount = 0;

  await context.route('https://fleets.bolt.eu/**', async (route) => {
    if (networkDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, networkDelayMs));
    }

    const url = new URL(route.request().url());

    if (url.pathname === loginPath) {
      if (startLoggedIn) {
        return route.fulfill({ status: 302, headers: { location: reportUrl } });
      }
      loginPageServedCount += 1;
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: buildLoginHtml({
          expectedEmail: credentials.email,
          expectedPassword: credentials.password,
          reportUrl,
        }),
      });
    }

    if (url.pathname === reportPath) {
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: buildReportHtml({ csvFileName, loginUrl }),
      });
    }

    if (url.pathname === '/api/csv-export') {
      if (expireAfterDateSelected) {
        return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
      }
      return route.fulfill({ status: 200, contentType: 'text/csv', body: csvContent });
    }

    return route.fulfill({ status: 404, body: 'not found' });
  });

  return {
    reportUrl,
    loginUrl,
    getLoginPageServedCount: () => loginPageServedCount,
  };
}

module.exports = { installBoltMock };
```

- [ ] **Step 4: Napisz test happy path (na razie jedyny w pliku)**

Utwórz `tests/bolt.stress.spec.js`:

```js
const path = require('path');
const os = require('os');
const fs = require('fs');
const { test, expect, chromium } = require('playwright/test');
const { syncBoltAccount } = require('../src/main/automation/platforms/bolt');
const { installBoltMock } = require('./mocks/boltFleetMock');

function makeAccount(overrides = {}) {
  return {
    accountId: 'test-account',
    label: 'Test Account',
    fields: { email: 'partner@example.com', password: 'secret123', orgId: 'test-org' },
    periodMode: 'custom',
    periodFrom: '2026-08-05',
    periodTo: '2026-08-07',
    ...overrides,
  };
}

test.describe('Bolt resilience', () => {
  let browser;
  let downloadDir;

  test.beforeEach(async () => {
    browser = await chromium.launch();
    downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-test-'));
  });

  test.afterEach(async () => {
    await browser.close();
    fs.rmSync(downloadDir, { recursive: true, force: true });
  });

  test('happy path: login, wybor dat, pobranie CSV', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    await installBoltMock(context, { startLoggedIn: false });
    const account = makeAccount();

    const result = await syncBoltAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(fs.readFileSync(result.filePath, 'utf8')).toContain('data,column');
  });
});
```

- [ ] **Step 5: Uruchom test i zweryfikuj, że przechodzi**

Run: `npx playwright test tests/bolt.stress.spec.js -g "happy path"`
Expected: 1 passed. Jeśli test nie widzi przeglądarki Chromium, uruchom najpierw `npx playwright install chromium` (powinno być już zainstalowane przez `postinstall`, ale warto potwierdzić w razie błędu "Executable doesn't exist").

- [ ] **Step 6: Commit**

```bash
git add playwright.config.js package.json tests/mocks/boltFleetMock.js tests/bolt.stress.spec.js
git commit -m "test: add Bolt resilience test harness with happy-path scenario"
```

---

### Task 2: Scenariusz "sesja już zalogowana"

**Files:**
- Modify: `tests/bolt.stress.spec.js`

**Interfaces:**
- Consumes: `installBoltMock` (Task 1), zwrócone pole `getLoginPageServedCount()`.

- [ ] **Step 1: Dodaj test w `tests/bolt.stress.spec.js`**

Wstaw nowy `test(...)` zaraz po teście `'happy path: ...'`, przed zamknięciem `});` bloku `test.describe`:

```js

  test('sesja juz zalogowana: pomija formularz logowania', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    const mock = await installBoltMock(context, { startLoggedIn: true });
    const account = makeAccount();

    const result = await syncBoltAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(mock.getLoginPageServedCount()).toBe(0);
  });
```

- [ ] **Step 2: Uruchom test i zweryfikuj, że przechodzi**

Run: `npx playwright test tests/bolt.stress.spec.js -g "sesja juz zalogowana"`
Expected: 1 passed.

- [ ] **Step 3: Uruchom cały plik testowy, upewnij się, że nic nie zepsuło poprzedniego testu**

Run: `npx playwright test tests/bolt.stress.spec.js`
Expected: 2 passed.

- [ ] **Step 4: Commit**

```bash
git add tests/bolt.stress.spec.js
git commit -m "test: add already-logged-in scenario to Bolt resilience suite"
```

---

### Task 3: Scenariusz "sesja wygasa w trakcie"

**Files:**
- Modify: `tests/bolt.stress.spec.js`

**Interfaces:**
- Consumes: `installBoltMock(context, { startLoggedIn, expireAfterDateSelected })` (Task 1).

- [ ] **Step 1: Dodaj test w `tests/bolt.stress.spec.js`**

Wstaw nowy `test(...)` zaraz po teście `'sesja juz zalogowana: ...'`:

```js

  test('sesja wygasa w trakcie: syncBoltAccount rzuca bledem zamiast wisiec w nieskonczonosc', async () => {
    test.setTimeout(150_000);
    const context = await browser.newContext({ acceptDownloads: true });
    await installBoltMock(context, { startLoggedIn: true, expireAfterDateSelected: true });
    const account = makeAccount();

    await expect(
      syncBoltAccount({ context, account, downloadDir, statusCallback: () => {} })
    ).rejects.toThrow();
  });
```

- [ ] **Step 2: Uruchom test i zweryfikuj, że przechodzi (uwaga: trwa do ~2 minut)**

Run: `npx playwright test tests/bolt.stress.spec.js -g "sesja wygasa"`
Expected: 1 passed, czas wykonania rzędu 120s (`bolt.js` czeka na wbudowany timeout `waitForEvent('download', { timeout: 120000 })`, zanim rzuci błąd). To zgodne z projektem — nie skracamy timeoutu w `bolt.js`.

- [ ] **Step 3: Commit**

```bash
git add tests/bolt.stress.spec.js
git commit -m "test: add mid-flow session expiry scenario to Bolt resilience suite"
```

---

### Task 4: Scenariusz "wolne ładowanie SPA"

**Files:**
- Modify: `tests/bolt.stress.spec.js`

**Interfaces:**
- Consumes: `installBoltMock(context, { networkDelayMs })` (Task 1).

- [ ] **Step 1: Dodaj test w `tests/bolt.stress.spec.js`**

Wstaw nowy `test(...)` zaraz po teście `'sesja wygasa w trakcie: ...'`, przed zamknięciem `});` bloku `test.describe`:

```js

  test('wolne ladowanie SPA: dziala mimo opoznien sieciowych', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    await installBoltMock(context, { startLoggedIn: false, networkDelayMs: 2000 });
    const account = makeAccount();

    const result = await syncBoltAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
  });
```

- [ ] **Step 2: Uruchom test i zweryfikuj, że przechodzi**

Run: `npx playwright test tests/bolt.stress.spec.js -g "wolne ladowanie"`
Expected: 1 passed. Jeśli test wywala się na timeoucie configu (45s), sprawdź czy `networkDelayMs` nie mnoży się przez zbyt wiele żądań (mock dodaje opóźnienie do KAŻDEGO przechwyconego requestu, więc happy-path flow z ok. 3-5 żądań powinien zmieścić się w limicie).

- [ ] **Step 3: Uruchom cały plik testowy (poza wolnym scenariuszem 3) i potwierdź stabilność całości**

Run: `npx playwright test tests/bolt.stress.spec.js -g "happy path|sesja juz zalogowana|wolne ladowanie"`
Expected: 3 passed.

- [ ] **Step 4: Commit**

```bash
git add tests/bolt.stress.spec.js
git commit -m "test: add slow-network scenario to Bolt resilience suite"
```

---

## Po zakończeniu

Pełny zestaw: `npx playwright test` (uwaga: obejmuje to scenariusz sesji wygasłej, więc cały przebieg zajmie ~2-3 minuty). Wynik tego zestawu jest bazowym punktem odniesienia do rozszerzenia harnessu o Uber/FreeNow/PartnerTax w kolejnej iteracji (poza zakresem tego planu — patrz sekcja "Poza zakresem tej iteracji" w specyfikacji).
