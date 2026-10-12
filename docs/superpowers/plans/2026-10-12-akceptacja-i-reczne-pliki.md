# Akceptacja plikow i reczne pliki per konto - plan wdrozenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Klient moze akceptowac kazdy pobrany i wgrany plik, podmienic plik dowolnego konta na wlasny, przerwac zawieszone konto i wgrac plik recznie, a automat dziala wolniej.

**Architecture:** Logika plikow (kopiowanie/walidacja/przemianowanie recznego pliku) i rejestr przerywalnych uruchomien to nowe, male moduly w `src/main/automation/`, testowalne bez Electrona. `main.js` wystawia je przez IPC. Petla "Pobierz wszystkie" zostaje w rendererze (panele decyzji to zwykly DOM-owy modal); petla wgrywania zostaje w `uploadToPartnerTax`, ktora dostaje haki `shouldStop` i `confirmAfterEach` mostkowane przez IPC.

**Tech Stack:** Electron (main + preload + renderer w czystym JS/DOM), Playwright (automatyzacja i testy `playwright test`), Node `fs`.

**Spec:** `docs/superpowers/specs/2026-10-12-akceptacja-i-reczne-pliki-design.md`

## Global Constraints

- Komentarze i komunikaty UI po polsku, BEZ polskich znakow w kodzie (styl repo: "Pobierz wszystkie", "Blad", "recznie").
- Nazwy wpisow pobran: klucz `${platformId}:${accountId}`, wpis `{ platformId, accountId, city, company, filePath, downloadedAt, manual? }`.
- Przelaczniki "Akceptuj kazdy plik" domyslnie WLACZONE, pamietane w `localStorage` (odczyt/zapis w try/catch).
- Panel bledu pobierania pokazuje sie ZAWSZE, niezaleznie od przelacznika.
- Przerwa miedzy kontami w "Pobierz wszystkie": losowo 8-15 s.
- Reczny plik: KOPIA (oryginal klienta nietkniety), walidacja jak pobranego, przy niezgodnosci ostrzezenie z "Uzyj mimo to".
- Uruchamianie testow: `npx playwright test <plik>` (cala suita: `npm test`).

## Struktura plikow

- Create `src/main/automation/downloadFiles.js` - `getDownloadDir`, `renameDownloadedFile` (przeniesione z main.js/runner.js), `attachManualFile`.
- Create `src/main/automation/activeRuns.js` - rejestr przerywalnych uruchomien: `runAbortable`, `abortRun`, `AbortedByUserError`.
- Modify `src/main/automation/humanInteraction.js` - wolniejsze tempo, (poprawka `humanFill` juz w drzewie roboczym).
- Modify `src/main/automation/runner.js` - `runDownload` przez `runAbortable`; `runUpload` przekazuje haki.
- Modify `src/main/automation/platforms/partnertax.js` - `shouldStop`, `confirmAfterEach`, `UploadStoppedError`.
- Modify `src/main/main.js` - IPC: `sync:abort`, `downloads:attachManual`, `downloads:showFile`, `upload:run(options)`, `upload:confirmReply`, `upload:stop`.
- Modify `src/preload/preload.js` - nowe metody `window.api`.
- Modify `src/renderer/renderer.js`, `src/renderer/styles.css` - modal decyzji, wiersze Kontroli pobran, nowa petla "Pobierz wszystkie", sekcja wgrywania.
- Tests: `tests/humanInteraction.spec.js`, `tests/downloadFiles.spec.js`, `tests/activeRuns.spec.js`, `tests/partnertax.stress.spec.js` (dopisane testy).

---

### Task 1: humanFill odporne na kradziez fokusu + wolniejsze tempo

**Files:**
- Modify: `src/main/automation/humanInteraction.js` (poprawka `humanFill` jest juz w drzewie roboczym, niezacommitowana)
- Test: `tests/humanInteraction.spec.js` (nowy)

**Interfaces:**
- Produces: `humanFill(locator, text)` - rzuca `Error` gdy pole po ponownym wypelnieniu nie zawiera tekstu; `humanClick`, `humanDelay` bez zmian sygnatur.

- [ ] **Step 1: Write the failing test**

```js
// tests/humanInteraction.spec.js
const { test, expect, chromium } = require('playwright/test');
const { humanFill } = require('../src/main/automation/humanInteraction');

test.describe('humanFill', () => {
  let browser;
  test.beforeEach(async () => { browser = await chromium.launch(); });
  test.afterEach(async () => { await browser.close(); });

  test('strona kradnie fokus w trakcie wpisywania - pole i tak ma pelny tekst', async () => {
    const page = await browser.newPage();
    // Po 5. znaku strona przenosi fokus na inne pole (jak podpowiedz autouzupelniania /
    // przerenderowanie formularza u klienta, 2026-10-12).
    await page.setContent(`
      <input id="email"><input id="other">
      <script>
        document.getElementById('email').addEventListener('input', (e) => {
          if (e.target.value.length === 5) document.getElementById('other').focus();
        });
      </script>`);
    await humanFill(page.locator('#email'), 'novapartner.warszawa@gmail.com');
    expect(await page.locator('#email').inputValue()).toBe('novapartner.warszawa@gmail.com');
  });

  test('pole, ktore nie przyjmuje tekstu, konczy sie bledem bez ujawniania wartosci', async () => {
    const page = await browser.newPage();
    await page.setContent(`<input id="pw" maxlength="3">`);
    await expect(humanFill(page.locator('#pw'), 'tajnehaslo')).rejects.toThrow(/3 z 10 znakow/);
  });
});
```

- [ ] **Step 2: Run test against the OLD implementation to verify it fails**

Run: `git stash push src/main/automation/humanInteraction.js && npx playwright test tests/humanInteraction.spec.js; git stash pop`
Expected: oba testy FAIL (stara wersja ucina tekst na 5 znakach i nie rzuca bledu).

- [ ] **Step 3: Slow down the pace**

W `src/main/automation/humanInteraction.js` zmien opoznienia (klient: "za szybko"):

```js
async function humanDelay(min = 300, max = 800) {
  await new Promise((resolve) => setTimeout(resolve, randomBetween(min, max)));
}
```

w `humanClick`: `await humanDelay(200, 450);` zamiast `humanDelay(80, 220)`;
w `humanFill`: `delay: randomBetween(70, 140)` zamiast `randomBetween(40, 90)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx playwright test tests/humanInteraction.spec.js tests/bolt.stress.spec.js tests/boltfood.stress.spec.js tests/freenow.stress.spec.js`
Expected: PASS (jesli ktorys stress-test przekracza 45 s przez wolniejsze tempo - dodaj `test.setTimeout(90_000)` w tym tescie, nie przywracaj szybszego tempa).

- [ ] **Step 5: Commit**

```bash
git add src/main/automation/humanInteraction.js tests/humanInteraction.spec.js tests/*.stress.spec.js
git commit -m "Wpisywanie loginow odporne na kradziez fokusu, wolniejsze tempo"
```

---

### Task 2: downloadFiles.js - reczny plik dla konta

**Files:**
- Create: `src/main/automation/downloadFiles.js`
- Modify: `src/main/automation/runner.js:17-34` (uzycie `getDownloadDir`)
- Modify: `src/main/main.js:99-123` (usun `sanitizeFileNamePart`/`renameDownloadedFile`, importuj z modulu)
- Test: `tests/downloadFiles.spec.js` (nowy)

**Interfaces:**
- Produces:
  - `getDownloadDir(userDataRoot: string, platformId: string, account: { label?, accountId }) => string`
  - `renameDownloadedFile(filePath: string, { city, company, platformLabel }) => string` - nie dokleja prefiksu drugi raz.
  - `attachManualFile({ platformId, account, sourcePath, downloadDir, force = false }) => { ok: true, filePath } | { ok: false, needsConfirm: true, warning, filePath } | { ok: false, error }`

- [ ] **Step 1: Write the failing tests**

```js
// tests/downloadFiles.spec.js
const path = require('path');
const os = require('os');
const fs = require('fs');
const { test, expect } = require('playwright/test');
const { attachManualFile, renameDownloadedFile, getDownloadDir } = require('../src/main/automation/downloadFiles');

const account = {
  accountId: 'acc-1',
  label: 'Uber - Leszno',
  city: 'Leszno',
  company: 'Unity Drive',
  periodMode: 'custom',
  periodFrom: '2026-10-05',
  periodTo: '2026-10-12',
};

function makeSource(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-src-'));
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, 'a,b\n1,2\n');
  return filePath;
}

test.describe('attachManualFile', () => {
  test('poprawny plik: kopiuje do folderu konta, oryginal zostaje', () => {
    const sourcePath = makeSource('20261005-20261012-payments_driver-UNITY_DRIVE_SP_Z_O_O.csv');
    const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-dst-'));
    const result = attachManualFile({ platformId: 'uber', account, sourcePath, downloadDir });
    expect(result.ok).toBe(true);
    expect(path.dirname(result.filePath)).toBe(downloadDir);
    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(fs.existsSync(sourcePath)).toBe(true);
  });

  test('zly tydzien bez force: ostrzezenie, nic nie skopiowane', () => {
    const sourcePath = makeSource('20260928-20261005-payments_driver-UNITY_DRIVE_SP_Z_O_O.csv');
    const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-dst-'));
    const result = attachManualFile({ platformId: 'uber', account, sourcePath, downloadDir });
    expect(result).toMatchObject({ ok: false, needsConfirm: true, filePath: sourcePath });
    expect(result.warning).toMatch(/Zly tydzien/);
    expect(fs.readdirSync(downloadDir)).toEqual([]);
  });

  test('zly tydzien z force: przyjety', () => {
    const sourcePath = makeSource('20260928-20261005-payments_driver-UNITY_DRIVE_SP_Z_O_O.csv');
    const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-dst-'));
    const result = attachManualFile({ platformId: 'uber', account, sourcePath, downloadDir, force: true });
    expect(result.ok).toBe(true);
  });

  test('nieistniejacy plik: blad', () => {
    const result = attachManualFile({ platformId: 'uber', account, sourcePath: 'C:/nie/ma/takiego.csv', downloadDir: os.tmpdir() });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/nie istnieje/);
  });
});

test.describe('renameDownloadedFile', () => {
  test('dokleja prefiks miasto - firma - platforma', () => {
    const filePath = makeSource('raport.csv');
    const renamed = renameDownloadedFile(filePath, { city: 'Leszno', company: 'Unity Drive', platformLabel: 'Uber' });
    expect(path.basename(renamed)).toBe('Leszno - Unity Drive - Uber - raport.csv');
  });

  test('nie dokleja prefiksu drugi raz (plik wybrany ponownie z folderu pobran)', () => {
    const filePath = makeSource('Leszno - Unity Drive - Uber - raport.csv');
    const renamed = renameDownloadedFile(filePath, { city: 'Leszno', company: 'Unity Drive', platformLabel: 'Uber' });
    expect(renamed).toBe(filePath);
  });
});

test('getDownloadDir: folder per platforma i etykieta konta', () => {
  expect(getDownloadDir('/root', 'uber', account)).toBe(path.join('/root', 'downloads', 'uber', 'Uber_-_Leszno'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx playwright test tests/downloadFiles.spec.js`
Expected: FAIL "Cannot find module '../src/main/automation/downloadFiles'".

- [ ] **Step 3: Implement `downloadFiles.js`**

```js
// src/main/automation/downloadFiles.js
const path = require('path');
const fs = require('fs');
const { validateDownloadedReport, ReportValidationError } = require('./reportValidator');

function sanitizeFolderName(name) {
  return name.replace(/[^a-z0-9\-_]+/gi, '_');
}

function sanitizeFileNamePart(value) {
  return String(value || '').trim().replace(/[\\/:*?"<>|]+/g, '_');
}

function getDownloadDir(userDataRoot, platformId, account) {
  return path.join(userDataRoot, 'downloads', platformId, sanitizeFolderName(account.label || account.accountId));
}

// Przeniesione z main.js bez zmian zachowania (patrz komentarz historyczny: klient chcial
// miasto/firme/platforme w nazwie pliku; zmiana nazwy PO walidacji, bo walidator parsuje
// oryginalna nazwe serwera). Nowe: plik, ktory juz ma prefiks (klient wybral recznie plik
// z folderu pobran), nie dostaje go drugi raz.
function renameDownloadedFile(filePath, { city, company, platformLabel }) {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const originalBase = path.basename(filePath, ext);
  const prefix = [city, company, platformLabel].map(sanitizeFileNamePart).filter(Boolean).join(' - ');
  if (!prefix || originalBase.startsWith(`${prefix} - `)) return filePath;

  const newPath = path.join(dir, `${prefix} - ${originalBase}${ext}`);
  fs.renameSync(filePath, newPath);
  return newPath;
}

/**
 * Plik wskazany recznie przez klienta dla konkretnego konta (przycisk "Wgraj wlasny plik",
 * panel bledu pobierania, przerwanie konta). Walidacja jak dla pobranego automatem - przy
 * niezgodnosci (zly tydzien/firma) zwracamy ostrzezenie, a decyzja "Uzyj mimo to" (force)
 * nalezy do klienta. Plik jest KOPIOWANY do folderu konta - oryginal zostaje nietkniety.
 */
function attachManualFile({ platformId, account, sourcePath, downloadDir, force = false }) {
  if (!fs.existsSync(sourcePath)) {
    return { ok: false, error: `Plik nie istnieje: ${sourcePath}` };
  }
  try {
    validateDownloadedReport({ platformId, account, filePath: sourcePath });
  } catch (error) {
    if (!(error instanceof ReportValidationError)) throw error;
    if (!force) {
      return { ok: false, needsConfirm: true, warning: error.message, filePath: sourcePath };
    }
  }
  fs.mkdirSync(downloadDir, { recursive: true });
  const targetPath = path.join(downloadDir, path.basename(sourcePath));
  if (path.resolve(targetPath) !== path.resolve(sourcePath)) {
    fs.copyFileSync(sourcePath, targetPath);
  }
  return { ok: true, filePath: targetPath };
}

module.exports = { getDownloadDir, renameDownloadedFile, attachManualFile };
```

- [ ] **Step 4: Use the module in runner.js and main.js**

`src/main/automation/runner.js`: usun `sanitizeFolderName`, dodaj `const { getDownloadDir } = require('./downloadFiles');`, w `runDownload`:

```js
  const downloadDir = getDownloadDir(userDataRoot, platformId, account);
  fs.mkdirSync(downloadDir, { recursive: true });
```

`src/main/main.js`: usun funkcje `sanitizeFileNamePart` i `renameDownloadedFile` (linie 99-123 razem z komentarzem - komentarz jest juz w module), dodaj import:

```js
const { renameDownloadedFile, attachManualFile, getDownloadDir } = require('./automation/downloadFiles');
```

- [ ] **Step 5: Run tests**

Run: `npx playwright test tests/downloadFiles.spec.js tests/reportValidator.spec.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/automation/downloadFiles.js src/main/automation/runner.js src/main/main.js tests/downloadFiles.spec.js
git commit -m "Modul downloadFiles: reczny plik dla konta z walidacja"
```

---

### Task 3: activeRuns.js - przerywanie pobierania konta

**Files:**
- Create: `src/main/automation/activeRuns.js`
- Modify: `src/main/automation/runner.js` (`runDownload`)
- Test: `tests/activeRuns.spec.js` (nowy)

**Interfaces:**
- Produces:
  - `class AbortedByUserError extends Error` (message `'Przerwano recznie.'`)
  - `runAbortable(key: string, context: { close(): Promise }, task: () => Promise<T>) => Promise<T>` - odrzuca `AbortedByUserError` natychmiast po `abortRun(key)`, nawet jesli `task` wisi.
  - `abortRun(key: string) => Promise<boolean>` - `false` gdy nic nie biegnie pod tym kluczem; zamyka kontekst.

- [ ] **Step 1: Write the failing tests**

```js
// tests/activeRuns.spec.js
const { test, expect } = require('playwright/test');
const { runAbortable, abortRun, AbortedByUserError } = require('../src/main/automation/activeRuns');

function fakeContext() {
  return { closed: false, async close() { this.closed = true; } };
}

test('abortRun przerywa wiszace zadanie i zamyka kontekst', async () => {
  const context = fakeContext();
  const running = runAbortable('uber:a', context, () => new Promise(() => {}));
  expect(await abortRun('uber:a')).toBe(true);
  await expect(running).rejects.toBeInstanceOf(AbortedByUserError);
  expect(context.closed).toBe(true);
});

test('zadanie zakonczone normalnie zwraca wynik i wypisuje sie z rejestru', async () => {
  const result = await runAbortable('bolt:b', fakeContext(), async () => 'plik.csv');
  expect(result).toBe('plik.csv');
  expect(await abortRun('bolt:b')).toBe(false);
});

test('blad zadania przechodzi bez zmian', async () => {
  await expect(runAbortable('bolt:c', fakeContext(), async () => { throw new Error('logowanie'); })).rejects.toThrow('logowanie');
});

test('abortRun dla nieznanego klucza zwraca false', async () => {
  expect(await abortRun('nie:ma')).toBe(false);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx playwright test tests/activeRuns.spec.js`
Expected: FAIL "Cannot find module".

- [ ] **Step 3: Implement**

```js
// src/main/automation/activeRuns.js
/**
 * Rejestr trwajacych pobran (klucz "platformId:accountId") - przycisk awaryjny "Przerwij to
 * konto" (klient, 2026-10-12: Uber potrafi "stanac" na kilka minut). Samo zamkniecie
 * kontekstu przegladarki nie wystarcza do szybkiego zakonczenia: czesc petli oczekiwania w
 * platformach lapie wszystkie bledy (isVisible().catch(() => false)) i krecilaby sie do
 * swojego limitu czasu. Dlatego wynik zadania scigamy z obietnica przerwania, ktora
 * odrzuca sie natychmiast, a porzucone zadanie dobiega konca w tle na zamknietej stronie.
 */
class AbortedByUserError extends Error {
  constructor() {
    super('Przerwano recznie.');
    this.name = 'AbortedByUserError';
  }
}

const activeRuns = new Map();

async function runAbortable(key, context, task) {
  let rejectAborted;
  const aborted = new Promise((_, reject) => {
    rejectAborted = reject;
  });
  const run = { context, abort: () => rejectAborted(new AbortedByUserError()) };
  activeRuns.set(key, run);

  const taskPromise = Promise.resolve().then(task);
  // Porzucone po przerwaniu zadanie konczy sie bledem "Target closed" - bez tego
  // lapania trafialoby do unhandledRejection.
  taskPromise.catch(() => {});
  try {
    return await Promise.race([taskPromise, aborted]);
  } finally {
    if (activeRuns.get(key) === run) activeRuns.delete(key);
  }
}

async function abortRun(key) {
  const run = activeRuns.get(key);
  if (!run) return false;
  run.abort();
  await run.context.close().catch(() => {});
  return true;
}

module.exports = { runAbortable, abortRun, AbortedByUserError };
```

- [ ] **Step 4: Wire into runner.js**

W `src/main/automation/runner.js` dodaj `const { runAbortable } = require('./activeRuns');` i zmien koncowke `runDownload`:

```js
  const context = await launchPlatformContext(userDataRoot, platformId, account.accountId, { statusCallback });
  try {
    return await runAbortable(`${platformId}:${account.accountId}`, context, () =>
      syncFn({ context, account, downloadDir, statusCallback })
    );
  } finally {
    // Po przerwaniu kontekst jest juz zamkniety (abortRun) - ponowne close() rzuca.
    await context.close().catch(() => {});
  }
```

- [ ] **Step 5: Run tests**

Run: `npx playwright test tests/activeRuns.spec.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/automation/activeRuns.js src/main/automation/runner.js tests/activeRuns.spec.js
git commit -m "Przerywanie trwajacego pobierania konta (activeRuns)"
```

---

### Task 4: uploadToPartnerTax - zatrzymanie i akceptacja po kazdym pliku

**Files:**
- Modify: `src/main/automation/platforms/partnertax.js:281-310, 449-453`
- Modify: `src/main/automation/runner.js` (`runUpload`)
- Test: `tests/partnertax.stress.spec.js` (dopisac testy)

**Interfaces:**
- Produces:
  - `class UploadStoppedError extends Error` (message `'Zatrzymano wgrywanie na zyczenie.'`), eksport z `partnertax.js`; ma `succeededUploads` jak inne bledy uploadu.
  - `uploadToPartnerTax({ context, account, uploads, statusCallback, shouldStop?: () => boolean, confirmAfterEach?: (upload, index, total) => Promise<'continue'|'stop'> })` - `confirmAfterEach` NIE jest wolane po ostatnim pliku.
  - `runUpload(userDataRoot, account, uploads, { statusCallback, shouldStop, confirmAfterEach })`

- [ ] **Step 1: Write the failing tests** (dopisz w `test.describe('PartnerTax admin resilience', ...)`, import `UploadStoppedError` z `partnertax.js`)

```js
  test('confirmAfterEach "stop" po 1. pliku: wgrany tylko 1, blad UploadStoppedError z succeededUploads', async () => {
    const context = await browser.newContext();
    const mock = await installPartnerTaxMock(context, {});
    const uploads = [makeUpload({ platformId: 'bolt' }), makeUpload({ platformId: 'uber' })];
    const asked = [];

    let caughtError;
    try {
      await uploadToPartnerTax({
        context, account: makeAccount(), uploads, statusCallback: () => {},
        confirmAfterEach: async (upload, index, total) => { asked.push([upload.platformId, index, total]); return 'stop'; },
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(UploadStoppedError);
    expect(caughtError.succeededUploads.map((u) => u.platformId)).toEqual(['bolt']);
    expect(asked).toEqual([['bolt', 0, 2]]);
    expect(mock.state.savedSources).toHaveLength(1);
  });

  test('confirmAfterEach "continue": wszystkie wgrane, brak pytania po ostatnim pliku', async () => {
    const context = await browser.newContext();
    const mock = await installPartnerTaxMock(context, {});
    const uploads = [makeUpload({ platformId: 'bolt' }), makeUpload({ platformId: 'uber' })];
    let askedCount = 0;

    await uploadToPartnerTax({
      context, account: makeAccount(), uploads, statusCallback: () => {},
      confirmAfterEach: async () => { askedCount += 1; return 'continue'; },
    });

    expect(askedCount).toBe(1);
    expect(mock.state.savedSources).toHaveLength(2);
  });

  test('shouldStop przed startem: nic nie wgrane', async () => {
    const context = await browser.newContext();
    const mock = await installPartnerTaxMock(context, {});
    await expect(
      uploadToPartnerTax({ context, account: makeAccount(), uploads: [makeUpload()], statusCallback: () => {}, shouldStop: () => true })
    ).rejects.toBeInstanceOf(UploadStoppedError);
    expect(mock.state.savedSources).toEqual([]);
  });
```

- [ ] **Step 2: Run to verify fail**

Run: `npx playwright test tests/partnertax.stress.spec.js -g "confirmAfterEach|shouldStop"`
Expected: FAIL (`UploadStoppedError` undefined).

- [ ] **Step 3: Implement in partnertax.js**

Nad `uploadToPartnerTax`:

```js
class UploadStoppedError extends Error {
  constructor() {
    super('Zatrzymano wgrywanie na zyczenie.');
    this.name = 'UploadStoppedError';
  }
}
```

Sygnatura i petla:

```js
async function uploadToPartnerTax({ context, account, uploads, statusCallback, shouldStop, confirmAfterEach }) {
  // ... bez zmian az do petli ...
  const succeeded = [];
  try {
    for (let index = 0; index < uploads.length; index += 1) {
      // Zatrzymanie (przycisk "Zatrzymaj") sprawdzane tylko MIEDZY plikami - plik w trakcie
      // zapisu zawsze jest dokonczony, nic nie zostaje zapisane w polowie.
      if (shouldStop?.()) throw new UploadStoppedError();
      const upload = uploads[index];
      await addDataSourceFile(page, upload, statusCallback);
      succeeded.push(upload);
      // Akceptacja po kazdym pliku (klient, 2026-10-12) - po ostatnim nie ma juz czego
      // akceptowac, wiec nie pytamy.
      if (confirmAfterEach && index < uploads.length - 1) {
        const decision = await confirmAfterEach(upload, index, uploads.length);
        if (decision === 'stop') throw new UploadStoppedError();
      }
    }
  } catch (error) {
    error.succeededUploads = succeeded;
    throw error;
  } finally {
    await page.close();
  }
```

Eksport: dodaj `UploadStoppedError` do `module.exports`.

- [ ] **Step 4: Pass hooks through runner.js**

```js
async function runUpload(userDataRoot, account, uploads, { statusCallback, shouldStop, confirmAfterEach } = {}) {
  const context = await launchPlatformContext(userDataRoot, 'partnertax', account.accountId, { statusCallback });
  try {
    await uploadToPartnerTax({ context, account, uploads, statusCallback, shouldStop, confirmAfterEach });
  } finally {
    await context.close();
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npx playwright test tests/partnertax.stress.spec.js`
Expected: PASS (wszystkie, w tym stare).

- [ ] **Step 6: Commit**

```bash
git add src/main/automation/platforms/partnertax.js src/main/automation/runner.js tests/partnertax.stress.spec.js
git commit -m "Wgrywanie do PartnerTax: zatrzymanie i akceptacja po kazdym pliku"
```

---

### Task 5: IPC w main.js + preload

**Files:**
- Modify: `src/main/main.js` (`sync:run`, `upload:run`, nowe handlery)
- Modify: `src/preload/preload.js`

**Interfaces:**
- Consumes: `attachManualFile`, `getDownloadDir`, `renameDownloadedFile` (Task 2); `abortRun`, `AbortedByUserError` (Task 3); `UploadStoppedError` (Task 4).
- Produces (`window.api`):
  - `abortSync(platformId, accountId) => Promise<{ ok: boolean }>`
  - `runSync(...)` - przy przerwaniu `{ ok: false, aborted: true, error: 'Przerwano recznie.' }`
  - `attachManualFile(platformId, accountId, { filePath?, force? }) => Promise<{ ok, filePath } | { canceled } | { needsConfirm, warning, filePath } | { ok: false, error }>`
  - `showDownloadedFile(filePath) => Promise<{ ok, error? }>`
  - `runUpload({ confirmEach: boolean }) => Promise<{ ok, count } | { ok: false, stopped: true, count } | { ok: false, error }>`
  - `onUploadConfirm(cb({ index, total, platformId, accountId, fileName }))`, `replyUploadConfirm(decision: 'continue'|'stop')`, `stopUpload()`
  - wpis pobrania ma dodatkowo `manual: boolean`.

- [ ] **Step 1: Shared recordDownload helper + sync:run**

W `main.js` pod `getOrderedDownloads` dodaj:

```js
function recordDownload(platformId, account, filePath, { manual = false } = {}) {
  const targetMap = account.group === 'gwarant' ? lastGwarantDownloads : lastDownloads;
  targetMap.set(`${platformId}:${account.accountId}`, {
    platformId,
    accountId: account.accountId,
    city: account.city,
    company: account.company,
    filePath,
    downloadedAt: new Date().toISOString(),
    manual,
  });
}

function platformLabelOf(platformId) {
  return PLATFORMS.find((p) => p.id === platformId)?.label || platformId;
}
```

W `sync:run` zastap blok `targetMap.set(...)` przez `recordDownload(platformId, account, filePath);`, `platformLabel` przez `platformLabelOf(platformId)`, a w `catch` dodaj na poczatku:

```js
    if (error instanceof AbortedByUserError) {
      logger.info(`${logPrefix} przerwano recznie`);
      return { ok: false, aborted: true, error: error.message };
    }
```

Importy: `const { abortRun, AbortedByUserError } = require('./automation/activeRuns');`, `const { UploadStoppedError } = require('./automation/platforms/partnertax');`.

- [ ] **Step 2: New handlers**

```js
ipcMain.handle('sync:abort', async (_event, platformId, accountId) => {
  const aborted = await abortRun(`${platformId}:${accountId}`);
  if (aborted) logger.info(`[sync ${platformId}:${accountId}] przerwanie na zyczenie partnera`);
  return { ok: aborted };
});

// Reczny plik dla konta (przycisk "Wgraj wlasny plik" w Kontroli pobran, panel bledu,
// przerwanie konta) - patrz attachManualFile w downloadFiles.js.
ipcMain.handle('downloads:attachManual', async (_event, platformId, accountId, { filePath, force = false } = {}) => {
  const account = credentialStore.listAccounts(platformId).find((a) => a.accountId === accountId);
  if (!account) return { ok: false, error: 'Nie znaleziono konta.' };

  let sourcePath = filePath;
  if (!sourcePath) {
    const dialogResult = await dialog.showOpenDialog(mainWindow, {
      title: `Wybierz plik raportu: ${platformLabelOf(platformId)} - ${account.label || accountId}`,
      filters: [{ name: 'Raport CSV', extensions: ['csv'] }, { name: 'Wszystkie pliki', extensions: ['*'] }],
      properties: ['openFile'],
    });
    if (dialogResult.canceled || dialogResult.filePaths.length === 0) return { ok: false, canceled: true };
    sourcePath = dialogResult.filePaths[0];
  }

  try {
    const result = attachManualFile({
      platformId,
      account,
      sourcePath,
      downloadDir: getDownloadDir(app.getPath('userData'), platformId, account),
      force,
    });
    if (!result.ok) return result;
    const finalPath = renameDownloadedFile(result.filePath, { city: account.city, company: account.company, platformLabel: platformLabelOf(platformId) });
    recordDownload(platformId, account, finalPath, { manual: true });
    logger.info(`[manual ${platformId}:${account.label || accountId}] dodano plik${force ? ' (mimo ostrzezenia)' : ''}: ${finalPath}`);
    return { ok: true, filePath: finalPath };
  } catch (error) {
    logger.error(`[manual ${platformId}:${accountId}] blad: ${error.stack || error.message}`);
    return { ok: false, error: error.message };
  }
});

// Tylko pliki znane z listy pobran - renderer nie moze otworzyc dowolnej sciezki.
ipcMain.handle('downloads:showFile', (_event, filePath) => {
  const known = [...lastDownloads.values(), ...lastGwarantDownloads.values()].some((d) => d.filePath === filePath);
  if (!known || !fs.existsSync(filePath)) return { ok: false, error: 'Plik nie jest juz dostepny.' };
  shell.showItemInFolder(filePath);
  return { ok: true };
});
```

- [ ] **Step 3: upload:run with confirm/stop**

Nad `upload:run`:

```js
// Stan trwajacego wgrywania: flaga "Zatrzymaj" i ewentualne oczekujace pytanie o akceptacje.
let uploadControl = null;
```

Zmien `upload:run`:

```js
ipcMain.handle('upload:run', async (event, { confirmEach = false } = {}) => {
  // ... sprawdzenia konta i listy bez zmian ...
  const control = { stopRequested: false, resolveConfirm: null };
  uploadControl = control;
  const confirmAfterEach = confirmEach
    ? (upload, index, total) =>
        new Promise((resolve) => {
          control.resolveConfirm = resolve;
          event.sender.send('upload:confirm', {
            index,
            total,
            platformId: upload.platformId,
            accountId: upload.accountId,
            fileName: path.basename(upload.filePath),
          });
        })
    : undefined;

  logger.info(`[upload] start, plikow: ${uploads.length}${confirmEach ? ' (z akceptacja kazdego pliku)' : ''}`);
  try {
    await runUpload(app.getPath('userData'), partnertaxAccount, uploads, {
      statusCallback,
      confirmAfterEach,
      shouldStop: () => control.stopRequested,
    });
    // ... sukces bez zmian ...
  } catch (error) {
    for (const upload of error.succeededUploads || []) {
      lastDownloads.delete(`${upload.platformId}:${upload.accountId}`);
    }
    if (error instanceof UploadStoppedError) {
      const count = (error.succeededUploads || []).length;
      logger.info(`[upload] zatrzymano na zyczenie, wgrano: ${count}`);
      return { ok: false, stopped: true, count };
    }
    logger.error(`[upload] blad: ${error.stack || error.message}`);
    return { ok: false, error: error.message };
  } finally {
    if (uploadControl === control) uploadControl = null;
  }
});

function settleUploadConfirm(decision) {
  const resolve = uploadControl?.resolveConfirm;
  if (uploadControl) uploadControl.resolveConfirm = null;
  resolve?.(decision);
}

ipcMain.handle('upload:confirmReply', (_event, decision) => {
  settleUploadConfirm(decision === 'stop' ? 'stop' : 'continue');
  return { ok: true };
});

ipcMain.handle('upload:stop', () => {
  if (!uploadControl) return { ok: false };
  uploadControl.stopRequested = true;
  settleUploadConfirm('stop');
  return { ok: true };
});
```

(Uwaga: istniejaca petla wykreslajaca `succeededUploads` przenosi sie przed `if (error instanceof UploadStoppedError)` - jest wspolna dla obu sciezek.)

- [ ] **Step 4: preload.js**

Dodaj do obiektu `window.api`:

```js
  abortSync: (platformId, accountId) => ipcRenderer.invoke('sync:abort', platformId, accountId),
  attachManualFile: (platformId, accountId, options) => ipcRenderer.invoke('downloads:attachManual', platformId, accountId, options),
  showDownloadedFile: (filePath) => ipcRenderer.invoke('downloads:showFile', filePath),
  onUploadConfirm: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('upload:confirm', listener);
    return () => ipcRenderer.removeListener('upload:confirm', listener);
  },
  replyUploadConfirm: (decision) => ipcRenderer.invoke('upload:confirmReply', decision),
  stopUpload: () => ipcRenderer.invoke('upload:stop'),
```

oraz zmien `runUpload: (options) => ipcRenderer.invoke('upload:run', options),`.

- [ ] **Step 5: Smoke check**

Run: `npm test` (cala suita - main.js nie ma testow jednostkowych, ale importowane moduly tak) oraz `node -e "require('./src/main/automation/downloadFiles'); require('./src/main/automation/activeRuns')"`
Expected: PASS, brak bledow skladni. Potem `npm start` - aplikacja startuje, Kontrola pobran sie renderuje.

- [ ] **Step 6: Commit**

```bash
git add src/main/main.js src/preload/preload.js
git commit -m "IPC: przerywanie konta, reczny plik, pokaz plik, zatrzymanie/akceptacja wgrywania"
```

---

### Task 6: Renderer - modal decyzji i przeplyw recznego pliku

**Files:**
- Modify: `src/renderer/renderer.js` (nowe funkcje pod `applyStatusMessage`)
- Modify: `src/renderer/styles.css` (nowe klasy na koncu sekcji przyciskow)

**Interfaces:**
- Consumes: `window.api.attachManualFile` (Task 5).
- Produces:
  - `askDecision({ title, message, tone?: 'info'|'warning'|'danger', overlayClass?: string, actions: [{ id, label, className?, keepOpen?, onClick? }] }) => Promise<id>`
  - `attachManualFileFlow(item: { platformId, accountId, label, platformLabel }) => Promise<boolean>` - `true` gdy plik dodany.
  - `refreshChecklists() => Promise<void>` - odswieza Kontrole pobran i checkliste Gwaranta.
  - `failedKeys: Set<string>` - konta z bledem w ostatnim przebiegu (czerwone).

- [ ] **Step 1: CSS**

Dopisz w `styles.css` po `.btn-delete:hover`:

```css
/* Panel decyzji (akceptacja pliku, blad pobierania, ostrzezenie recznego pliku) */
.decision-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: var(--shadow-200);
  backdrop-filter: blur(2px);
}

.decision-box {
  width: min(560px, 100%);
  padding: 20px 22px;
  border: 1px solid var(--ui-border-color);
  border-radius: var(--ui-modal-radius);
  background: var(--surface-900);
  box-shadow: 0 12px 32px var(--shadow-200);
}

.decision-box--warning { border-color: var(--primary-500); }
.decision-box--danger { border-color: var(--danger-tint-200); }

.decision-box h3 { margin: 0 0 8px; color: var(--text-140); }

.decision-message {
  margin: 0 0 16px;
  color: var(--text-300);
  white-space: pre-wrap;
  word-break: break-word;
}

.decision-actions { display: flex; flex-wrap: wrap; gap: 8px; }

.checklist-item.failed { color: var(--text-danger); font-weight: 700; }

.checklist-file-link {
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  text-decoration: underline;
  cursor: pointer;
}

.checklist-item .btn-secondary { margin-left: auto; padding: 4px 10px; font-size: 12px; }
```

- [ ] **Step 2: askDecision, attachManualFileFlow, refreshChecklists**

W `renderer.js` po `applyStatusMessage`:

```js
// Konta, ktorych ostatnie pobranie w tej sesji sie nie udalo/zostalo przerwane - na
// czerwono w Kontroli pobran, dopoki nie pojawi sie plik (pobrany albo reczny).
const failedKeys = new Set();

/**
 * Panel decyzji nad cala aplikacja (klient, 2026-10-12: akceptacja kazdego pliku, pytanie
 * o reczny plik po bledzie). Zwraca id wybranej akcji. Akcja z keepOpen (np. "Pokaz plik")
 * wykonuje onClick i zostawia panel otwarty.
 */
function askDecision({ title, message, tone = 'info', actions, overlayClass = '' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = `decision-overlay ${overlayClass}`.trim();
    const box = document.createElement('div');
    box.className = `decision-box decision-box--${tone}`;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    const heading = document.createElement('h3');
    heading.textContent = title;
    const text = document.createElement('p');
    text.className = 'decision-message';
    text.textContent = message;

    const row = document.createElement('div');
    row.className = 'decision-actions';
    for (const action of actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = action.className || 'btn-secondary';
      btn.textContent = action.label;
      btn.onclick = async () => {
        if (action.keepOpen) {
          await action.onClick?.();
          return;
        }
        overlay.remove();
        resolve(action.id);
      };
      row.appendChild(btn);
    }

    box.append(heading, text, row);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    row.querySelector('button')?.focus();
  });
}

async function refreshChecklists() {
  await renderChecklistSection();
  await refreshGwarantChecklist();
}

/**
 * Reczny plik dla konta: wybor pliku -> walidacja w main -> przy niezgodnosci pytanie
 * "Uzyj mimo to / Wybierz inny plik". Zwraca true, gdy plik zostal dodany.
 */
async function attachManualFileFlow(item) {
  let result = await window.api.attachManualFile(item.platformId, item.accountId, {});
  for (;;) {
    if (result.canceled) return false;
    if (result.ok) {
      failedKeys.delete(`${item.platformId}:${item.accountId}`);
      await refreshChecklists();
      return true;
    }
    if (!result.needsConfirm) {
      await askDecision({ title: 'Nie udalo sie dodac pliku', message: result.error, tone: 'danger', actions: [{ id: 'ok', label: 'OK' }] });
      return false;
    }
    const choice = await askDecision({
      title: `Plik nie pasuje do konta ${item.platformLabel} - ${item.label || item.accountId}`,
      message: result.warning,
      tone: 'warning',
      actions: [
        { id: 'force', label: 'Uzyj mimo to', className: 'btn-run' },
        { id: 'other', label: 'Wybierz inny plik' },
        { id: 'cancel', label: 'Anuluj' },
      ],
    });
    if (choice === 'force') {
      result = await window.api.attachManualFile(item.platformId, item.accountId, { filePath: result.filePath, force: true });
    } else if (choice === 'other') {
      result = await window.api.attachManualFile(item.platformId, item.accountId, {});
    } else {
      return false;
    }
  }
}
```

- [ ] **Step 3: Manual check**

Run: `npm start`, w DevTools (Ctrl+Shift+I) konsola: `askDecision({ title: 'Test', message: 'Tresc', actions: [{ id: 'a', label: 'A' }] }).then(console.log)` - panel widoczny w trybie jasnym i ciemnym, klik "A" zamyka i loguje `a`.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/renderer.js src/renderer/styles.css
git commit -m "Renderer: panel decyzji i przeplyw recznego pliku"
```

---

### Task 7: Renderer - wiersze Kontroli pobran (klik = pokaz plik, przycisk "Wgraj wlasny plik")

**Files:**
- Modify: `src/renderer/renderer.js` - `renderChecklistSection` (507-530), `renderGwarantChecklist` (661-684)

**Interfaces:**
- Consumes: `attachManualFileFlow`, `failedKeys` (Task 6); `window.api.showDownloadedFile` (Task 5).
- Produces: `buildChecklistRow(item, entry) => HTMLElement` (wspolne dla obu checklist).

- [ ] **Step 1: buildChecklistRow**

Dodaj przed `renderChecklistSection`:

```js
/**
 * Wiersz Kontroli pobran (wspolny dla domyslnej i Gwaranta). Nazwa pliku jest klikalna -
 * pokazuje plik w Finderze/Eksploratorze (klient chce moc wrocic do dowolnego pliku i go
 * sprawdzic); "Wgraj wlasny plik" podmienia/dodaje plik tego konta recznie.
 */
function buildChecklistRow(item, entry) {
  const key = `${item.platformId}:${item.accountId}`;
  const row = document.createElement('div');
  row.className = 'checklist-item' + (entry ? ' checked' : '') + (!entry && failedKeys.has(key) ? ' failed' : '');

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = Boolean(entry);
  checkbox.disabled = true;
  row.appendChild(checkbox);

  const accountLabel = item.label || item.accountId;
  if (entry) {
    const fileName = entry.filePath.split(/[\\/]/).pop();
    const time = new Date(entry.downloadedAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'checklist-file-link';
    link.title = 'Pokaz plik w folderze';
    link.textContent = `${item.platformLabel} - ${accountLabel}: ${fileName} (${time})${entry.manual ? ' (recznie)' : ''}`;
    link.onclick = async () => {
      const result = await window.api.showDownloadedFile(entry.filePath);
      if (!result.ok) await askDecision({ title: 'Nie mozna pokazac pliku', message: result.error, tone: 'danger', actions: [{ id: 'ok', label: 'OK' }] });
    };
    row.appendChild(link);
  } else {
    const text = document.createElement('span');
    text.textContent = `${item.platformLabel} - ${accountLabel}: ${failedKeys.has(key) ? 'blad - wymaga pliku' : 'nie pobrano'}`;
    row.appendChild(text);
  }

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn-secondary';
  editBtn.textContent = 'Wgraj wlasny plik';
  editBtn.onclick = () => attachManualFileFlow(item);
  row.appendChild(editBtn);

  return row;
}
```

- [ ] **Step 2: Use it in both checklists**

W `renderChecklistSection` zastap cialo petli `for (const item of reportAccountsCache) { ... }` przez:

```js
    for (const item of reportAccountsCache) {
      list.appendChild(buildChecklistRow(item, downloadedMap.get(`${item.platformId}:${item.accountId}`)));
    }
```

W `renderGwarantChecklist` analogicznie dla `gwarantReportAccountsCache`. Zmien tez tekst notatki w `renderChecklistSection`:

```js
  note.textContent = 'Checkbox zaznacza sie sam po pobraniu pliku w tej sesji. Klik w nazwe pliku pokazuje go w folderze; "Wgraj wlasny plik" podmienia plik konta na wybrany recznie.';
```

- [ ] **Step 3: Manual check**

`npm start` -> pobierz jedno konto (albo dodaj reczny plik) -> klik w nazwe otwiera folder z zaznaczonym plikiem; "Wgraj wlasny plik" z plikiem o zlej nazwie pokazuje ostrzezenie; "Uzyj mimo to" dodaje wiersz z "(recznie)"; ZIP zawiera reczny plik.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/renderer.js
git commit -m "Kontrola pobran: klik pokazuje plik, przycisk recznego pliku per konto"
```

---

### Task 8: Renderer - "Pobierz wszystkie" z akceptacja, przerwaniem i przerwa miedzy kontami

**Files:**
- Modify: `src/renderer/renderer.js` - `renderChecklistSection` (run row), `runAllDownloads` (544-573), `renderGwarantChecklist` (run row), `runAllGwarantDownloads` (712-738), "Pobierz teraz" w `renderAccountCard` (1129-1165)

**Interfaces:**
- Consumes: `askDecision`, `attachManualFileFlow`, `failedKeys`, `refreshChecklists` (Task 6); `window.api.abortSync`, `window.api.showDownloadedFile` (Task 5).
- Produces:
  - `readToggle(storageKey) => boolean`, `buildAcceptToggle(storageKey) => HTMLElement` (uzyte tez w Task 9).
  - `askUntilSettled(item, panel) => Promise<id>`, `runAllDownloadsWithReview({ items, getRunButton, getStatusEl, getControlsEl, toggleKey, refresh })`.

- [ ] **Step 1: Toggle helpers + current-run state**

Po `failedKeys`:

```js
const ACCEPT_DOWNLOADS_KEY = 'acceptEachDownload';
const ACCEPT_UPLOADS_KEY = 'acceptEachUpload';

function readToggle(storageKey) {
  try {
    return localStorage.getItem(storageKey) !== 'false';
  } catch {
    return true;
  }
}

function buildAcceptToggle(storageKey) {
  const label = document.createElement('label');
  label.className = 'accept-toggle';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = readToggle(storageKey);
  input.onchange = () => {
    try {
      localStorage.setItem(storageKey, String(input.checked));
    } catch {
      // Brak dostepu do localStorage - przelacznik dziala do konca sesji okna.
    }
  };
  label.append(input, ' Akceptuj kazdy plik');
  return label;
}

const BETWEEN_ACCOUNTS_MIN_MS = 8000;
const BETWEEN_ACCOUNTS_MAX_MS = 15000;
// Konto aktualnie pobierane przez "Pobierz wszystkie" i flaga "Zatrzymaj wszystko".
let bulkRun = null;
```

CSS (dopisz w `styles.css`): `.accept-toggle { display: inline-flex; align-items: center; gap: 6px; color: var(--text-300); font-size: 13px; }`

- [ ] **Step 2: Generic loop**

Zastap `runAllDownloads` i `runAllGwarantDownloads` ponizszym kodem. Sekcje checklist sa przebudowywane po kazdym koncie (`refresh`), wiec przycisk/status/kontener kontrolek sa pobierane przez gettery, a przyciski "Przerwij to konto"/"Zatrzymaj wszystko" sa przenoszone do nowego kontenera po kazdym odswiezeniu.

```js
function waitBetweenAccounts(getStatusEl, run) {
  const totalMs = BETWEEN_ACCOUNTS_MIN_MS + Math.random() * (BETWEEN_ACCOUNTS_MAX_MS - BETWEEN_ACCOUNTS_MIN_MS);
  const endAt = Date.now() + totalMs;
  return new Promise((resolve) => {
    const tick = () => {
      const left = Math.ceil((endAt - Date.now()) / 1000);
      if (run.stopRequested || left <= 0) return resolve();
      const statusEl = getStatusEl();
      if (statusEl) statusEl.textContent = `Nastepne konto za ${left} s...`;
      setTimeout(tick, 250);
    };
    tick();
  });
}

/**
 * Pyta w petli, dopoki decyzja nie jest ostateczna: wybor "manual" z anulowanym oknem
 * wyboru pliku wraca do tego samego panelu (zamiast np. pobierac konto drugi raz).
 */
async function askUntilSettled(item, panel) {
  for (;;) {
    const choice = await askDecision(panel);
    if (choice !== 'manual') return choice;
    if (await attachManualFileFlow(item)) return 'manual';
  }
}

/**
 * "Pobierz wszystkie" (klient, 2026-10-12): po kazdym pliku opcjonalna akceptacja, po
 * bledzie/przerwaniu ZAWSZE pytanie (reczny plik / ponow / pomin), przerwa 8-15 s miedzy
 * kontami, "Przerwij to konto" i "Zatrzymaj wszystko" przez caly czas.
 */
async function runAllDownloadsWithReview({ items, getRunButton, getStatusEl, getControlsEl, toggleKey, refresh }) {
  if (items.length === 0 || bulkRun) return;
  const run = { stopRequested: false, currentKey: null };
  bulkRun = run;

  const abortBtn = document.createElement('button');
  abortBtn.type = 'button';
  abortBtn.className = 'btn-delete';
  abortBtn.textContent = 'Przerwij to konto';
  abortBtn.disabled = true;
  abortBtn.onclick = () => {
    if (!run.currentKey) return;
    const [platformId, accountId] = run.currentKey.split(':');
    abortBtn.disabled = true;
    window.api.abortSync(platformId, accountId);
  };
  const stopAllBtn = document.createElement('button');
  stopAllBtn.type = 'button';
  stopAllBtn.className = 'btn-secondary';
  stopAllBtn.textContent = 'Zatrzymaj wszystko';
  stopAllBtn.onclick = () => {
    run.stopRequested = true;
    stopAllBtn.disabled = true;
  };

  const lockUi = () => {
    getRunButton()?.setAttribute('disabled', '');
    for (const btn of runButtons.values()) btn.disabled = true;
    getControlsEl()?.append(abortBtn, stopAllBtn);
  };
  const refreshAndLock = async () => {
    await refresh();
    lockUi();
  };
  const setStatus = (text) => {
    const el = getStatusEl();
    if (el) el.textContent = text;
  };

  lockUi();
  let doneCount = 0;
  try {
    for (let i = 0; i < items.length && !run.stopRequested; i += 1) {
      const item = items[i];
      const key = `${item.platformId}:${item.accountId}`;
      const accountName = `${item.platformLabel} - ${item.label || item.accountId}`;
      if (i > 0) await waitBetweenAccounts(getStatusEl, run);
      if (run.stopRequested) break;

      for (;;) {
        setStatus(`Pobieram (${i + 1}/${items.length}): ${accountName}...`);
        const statusSpan = statusElements.get(key);
        if (statusSpan) statusSpan.textContent = 'Uruchamiam przegladarke...';
        run.currentKey = key;
        abortBtn.disabled = false;
        const result = await window.api.runSync(item.platformId, item.accountId);
        run.currentKey = null;
        abortBtn.disabled = true;
        if (statusSpan) statusSpan.textContent = result.ok ? `Gotowe: ${result.filePath}` : `Blad: ${result.error}`;

        let choice;
        if (result.ok) {
          failedKeys.delete(key);
          await refreshAndLock();
          if (!readToggle(toggleKey)) break;
          choice = await askUntilSettled(item, {
            title: `Pobrano: ${accountName}`,
            message: result.filePath.split(/[\\/]/).pop(),
            actions: [
              { id: 'show', label: 'Pokaz plik', keepOpen: true, onClick: () => window.api.showDownloadedFile(result.filePath) },
              { id: 'ok', label: 'OK, dalej', className: 'btn-run' },
              { id: 'manual', label: 'Zly plik - wgraj wlasny' },
              { id: 'stop', label: 'Zatrzymaj wszystko', className: 'btn-delete' },
            ],
          });
        } else {
          failedKeys.add(key);
          await refreshAndLock();
          choice = await askUntilSettled(item, {
            title: result.aborted ? `Przerwano: ${accountName}` : `Blad: ${accountName}`,
            message: result.error,
            tone: 'danger',
            actions: [
              { id: 'manual', label: 'Wgraj plik recznie', className: 'btn-run' },
              { id: 'retry', label: 'Sprobuj ponownie' },
              { id: 'skip', label: 'Pomin konto' },
              { id: 'stop', label: 'Zatrzymaj wszystko', className: 'btn-delete' },
            ],
          });
        }
        if (choice === 'retry') continue;
        if (choice === 'stop') run.stopRequested = true;
        break;
      }
      doneCount += 1;
    }
  } finally {
    bulkRun = null;
    abortBtn.remove();
    stopAllBtn.remove();
    await refresh();
    for (const btn of runButtons.values()) btn.disabled = false;
  }
  setStatus(
    run.stopRequested
      ? `Zatrzymano po ${doneCount}/${items.length} kontach.`
      : `Gotowe: przetworzono ${doneCount}/${items.length} kont.`
  );
}
```

- [ ] **Step 3: Run rows in both checklists**

W `renderChecklistSection` (blok `if (reportAccountsCache.length > 0)`): dodaj `const controls = document.createElement('span'); controls.className = 'run-controls'; downloadAllControlsElement = controls;`, a do `runRow` kolejno: `runBtn`, `buildAcceptToggle(ACCEPT_DOWNLOADS_KEY)`, `controls`, `statusSpan`. Jesli `bulkRun` trwa, ustaw `runBtn.disabled = true`. `runBtn.onclick`:

```js
    runBtn.onclick = () =>
      runAllDownloadsWithReview({
        items: reportAccountsCache,
        getRunButton: () => downloadAllButton,
        getStatusEl: () => downloadAllStatusElement,
        getControlsEl: () => downloadAllControlsElement,
        toggleKey: ACCEPT_DOWNLOADS_KEY,
        refresh: renderChecklistSection,
      });
```

Analogicznie w `renderGwarantChecklist` z `gwarantDownloadAllControlsElement`, `items: gwarantReportAccountsCache`, `refresh: refreshGwarantChecklist`. Dodaj zmienne globalne `let downloadAllControlsElement = null; let gwarantDownloadAllControlsElement = null;` obok istniejacych. CSS: `.run-controls { display: inline-flex; gap: 8px; }`. Usun stare `runAllDownloads` i `runAllGwarantDownloads`.

- [ ] **Step 4: "Pobierz teraz" na karcie konta**

W `renderAccountCard` (blok `if (!isNew && platform.report)`):

```js
    const abortBtn = document.createElement('button');
    abortBtn.type = 'button';
    abortBtn.className = 'btn-delete';
    abortBtn.textContent = 'Przerwij';
    abortBtn.hidden = true;
    abortBtn.onclick = () => window.api.abortSync(platform.id, account.accountId);

    runBtn.onclick = async () => {
      runBtn.disabled = true;
      abortBtn.hidden = false;
      statusSpan.textContent = 'Zapisuje ustawienia i uruchamiam przegladarke...';
      // (istniejacy komentarz o zapisie formularza przed uruchomieniem - zostaje)
      await window.api.saveAccount(platform.id, collectAccountPayload());
      const result = await window.api.runSync(platform.id, account.accountId);
      runBtn.disabled = false;
      abortBtn.hidden = true;
      statusSpan.textContent = result.ok ? `Gotowe: ${result.filePath}` : `Blad: ${result.error}`;
      const item = { platformId: platform.id, accountId: account.accountId, label: account.label, platformLabel: platform.label };
      if (result.ok) {
        failedKeys.delete(statusKey);
        await refreshChecklists();
        return;
      }
      failedKeys.add(statusKey);
      await refreshChecklists();
      const choice = await askDecision({
        title: result.aborted ? `Przerwano: ${platform.label} - ${account.label}` : `Blad: ${platform.label} - ${account.label}`,
        message: result.error,
        tone: 'danger',
        actions: [
          { id: 'manual', label: 'Wgraj plik recznie', className: 'btn-run' },
          { id: 'close', label: 'Zamknij' },
        ],
      });
      if (choice === 'manual') await attachManualFileFlow(item);
    };

    runRow.appendChild(runBtn);
    runRow.appendChild(abortBtn);
    runRow.appendChild(statusSpan);
```

- [ ] **Step 5: Manual check (`npm start`)**

1. "Pobierz wszystkie" z wlaczonym przelacznikiem: po pierwszym koncie panel "Pobrano: ..."; "Pokaz plik" otwiera folder i panel zostaje; "OK, dalej" -> odliczanie "Nastepne konto za N s..." (8-15 s) -> kolejne konto.
2. W trakcie pobierania "Przerwij to konto" -> okno przegladarki zamyka sie w ciagu ~1 s, panel "Przerwano: ..."; "Wgraj plik recznie" -> wybor pliku -> wiersz "(recznie)" -> petla idzie dalej.
3. Konto z blednym haslem -> panel bledu -> "Pomin konto" -> wiersz na czerwono "blad - wymaga pliku".
4. Wylaczony przelacznik -> brak panelu po sukcesie, panel bledu nadal sie pokazuje; przelacznik pamietany po restarcie aplikacji.
5. "Zatrzymaj wszystko" w trakcie odliczania -> petla konczy sie od razu, status "Zatrzymano po N/M kontach".
6. "Pobierz teraz" na karcie -> "Przerwij" widoczny tylko w trakcie, po przerwaniu pytanie o reczny plik.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/renderer.js src/renderer/styles.css
git commit -m "Pobierz wszystkie: akceptacja plikow, przerwanie konta, przerwa miedzy kontami"
```

---

### Task 9: Renderer - wgrywanie z akceptacja i "Zatrzymaj"

**Files:**
- Modify: `src/renderer/renderer.js` - `renderUploadSection` (747-788), listener `onUploadConfirm` przy `onUploadStatus` (68-70)

**Interfaces:**
- Consumes: `askDecision`, `buildAcceptToggle`, `readToggle`, `ACCEPT_UPLOADS_KEY` (Task 6/8); `window.api.runUpload({ confirmEach })`, `onUploadConfirm`, `replyUploadConfirm`, `stopUpload` (Task 5).

- [ ] **Step 1: Confirm listener**

Pod `window.api.onUploadStatus(...)`:

```js
// Akceptacja po kazdym wgranym pliku (przelacznik w sekcji wgrywania) - main czeka na
// odpowiedz, okno admina zostaje otwarte, wiec partner moze sprawdzic wiersz rozliczenia.
window.api.onUploadConfirm(async ({ index, total, platformId, accountId, fileName }) => {
  const item = reportAccountsCache.find((a) => a.platformId === platformId && a.accountId === accountId);
  const name = item ? `${item.platformLabel} - ${item.label || accountId}` : platformId;
  const choice = await askDecision({
    overlayClass: 'decision-overlay--upload',
    title: `Wgrano ${index + 1}/${total}: ${name}`,
    message: `${fileName}\n\nSprawdz wiersz w oknie PartnerTax admin i zdecyduj, czy wgrywac dalej.`,
    actions: [
      { id: 'continue', label: 'Dalej', className: 'btn-run' },
      { id: 'stop', label: 'Zatrzymaj', className: 'btn-delete' },
    ],
  });
  await window.api.replyUploadConfirm(choice);
});
```

- [ ] **Step 2: Upload section**

W `renderUploadSection` zmien budowe `runRow` i `onclick`:

```js
  const stopBtn = document.createElement('button');
  stopBtn.type = 'button';
  stopBtn.className = 'btn-delete';
  stopBtn.textContent = 'Zatrzymaj';
  stopBtn.hidden = true;
  stopBtn.onclick = async () => {
    stopBtn.disabled = true;
    statusSpan.textContent = 'Zatrzymuje po biezacym pliku...';
    await window.api.stopUpload();
  };

  runBtn.onclick = async () => {
    runBtn.disabled = true;
    stopBtn.hidden = false;
    stopBtn.disabled = false;
    statusSpan.textContent = 'Uruchamiam przegladarke...';
    const result = await window.api.runUpload({ confirmEach: readToggle(ACCEPT_UPLOADS_KEY) });
    runBtn.disabled = false;
    stopBtn.hidden = true;
    // Panel akceptacji, ktory moglby zostac otwarty po "Zatrzymaj" z zewnatrz, jest juz
    // nieaktualny.
    document.querySelectorAll('.decision-overlay--upload').forEach((el) => el.remove());
    if (result.ok) statusSpan.textContent = `Gotowe: wgrano ${result.count} plik(ow).`;
    else if (result.stopped) statusSpan.textContent = `Zatrzymano: wgrano ${result.count} plik(ow). Pozostale zostaja na liscie - "Wgraj do PartnerTax" dokonczy reszte.`;
    else statusSpan.textContent = `Blad: ${result.error}`;
    await renderChecklistSection();
  };

  runRow.appendChild(runBtn);
  runRow.appendChild(buildAcceptToggle(ACCEPT_UPLOADS_KEY));
  runRow.appendChild(stopBtn);
  runRow.appendChild(statusSpan);
```

Uwaga: usuwamy tylko panel wgrywania (`.decision-overlay--upload`), nie ewentualny panel "Pobierz wszystkie". Porzucona obietnica `askDecision` po usunieciu overlayu nigdy sie nie rozwiaze - to OK, `replyUploadConfirm` po zakonczonym uploadzie i tak nic nie robi.

- [ ] **Step 3: Manual check (`npm start`, na koncie testowym PartnerTax)**

1. Przelacznik wlaczony, 2+ pliki: po 1. pliku panel "Wgrano 1/N"; "Dalej" -> kolejny; po ostatnim brak panelu, "Gotowe".
2. "Zatrzymaj" w panelu -> status "Zatrzymano: wgrano 1"; Kontrola pobran pokazuje tylko niewgrane; ponowne "Wgraj" dokancza reszte bez duplikatow.
3. "Zatrzymaj" (przycisk w sekcji) w trakcie zapisu pliku -> plik dokonczony, potem stop.
4. Przelacznik wylaczony -> wgrywa wszystko bez pytan (jak dotad).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/renderer.js
git commit -m "Wgrywanie do PartnerTax: przelacznik akceptacji i przycisk Zatrzymaj"
```

---

### Task 10: Pelna weryfikacja i wydanie

- [ ] **Step 1:** `npm test` - Expected: wszystkie testy PASS.
- [ ] **Step 2:** Przejdz scenariusze manualne z Task 7, 8, 9 w `npm start` (jasny i ciemny motyw).
- [ ] **Step 3:** Podbij wersje w `package.json` do `1.0.22` i zacommituj: `git commit -am "Wersja 1.0.22: akceptacja plikow, reczne pliki, przerywanie, wolniejsze tempo"`. Wydanie (build/publikacja) - tylko na wyrazna prosbe uzytkownika.
