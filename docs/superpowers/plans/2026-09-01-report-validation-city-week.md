# Walidacja pobranych raportów przed uploadem (miasto + tydzień) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Blokować upload pobranego raportu do PartnerTax, jeśli tydzień w nazwie pliku (prawdziwa nazwa z serwera platformy) nie zgadza się dokładnie z oczekiwanym zakresem (`computePeriodRange`), firma w nazwie pliku (Bolt/Uber) nie zgadza się z `account.company`, lub `account.label` nie zawiera nazwy `account.city`.

**Architecture:** Nowy moduł `src/main/automation/reportValidator.js` z parserami nazw plików per platforma (Bolt, Uber, FreeNow, Bolt Food) i funkcją orchestrującą `validateDownloadedReport`, wywoływaną w `src/main/main.js` w handlerze `sync:run` zaraz po `runDownload`, przed dopisaniem wpisu do `lastDownloads`. Niezgodność rzuca `ReportValidationError`, która przechodzi przez istniejący `try/catch` w `sync:run` (bez zmian w kształcie obsługi błędów) — plik nigdy nie trafia do `lastDownloads`, więc nie może zostać wgrany.

**Tech Stack:** Node.js (CommonJS), Playwright Test runner (`playwright/test` — używany też do zwykłych testów jednostkowych w tym repo, patrz `tests/logger.spec.js`), bez dodatkowych zależności.

**Spec:** `docs/superpowers/specs/2026-09-01-report-validation-city-week-design.md`

## Global Constraints

- Dopasowanie tygodnia: **dokładne** (start i koniec równe co do dnia z `computePeriodRange`), bez marginesu tolerancji.
- Przy jakiejkolwiek niezgodności: **twarda blokada** (rzucony wyjątek), nigdy ostrzeżenie z możliwością kontynuacji.
- Walidacja miasta = spójność `account.label` z `account.city` (nie parsowanie pliku) — miasto nie występuje w treści/nazwie żadnego pobranego pliku (patrz spec).
- Walidacja firmy dostępna tylko dla Bolt i Uber (nazwa firmy jest w prawdziwej nazwie pliku tych dwóch platform) — dla FreeNow i Bolt Food pomijana.
- Nierozpoznana nazwa pliku (nie pasuje do żadnego znanego wzorca danej platformy) = traktowana jako niezgodność (blokada), nie jako pominięcie walidacji — spójne z istniejącym wzorcem w `partnertax.js` (`resolveCityValue`/`resolveCompanyValue` też rzucają na nieznaną wartość zamiast przepuszczać).

---

## Kontekst dla wykonawcy (rzeczy, które trzeba znać, a nie są oczywiste z samego kodu)

- `computePeriodRange({ periodMode, periodFrom, periodTo }, now)` (`src/main/automation/dateRange.js:25`) zwraca `{ from, to }` jako stringi `'YYYY-MM-DD'` (lokalna strefa czasowa, NIE UTC — patrz `toISODate` w tym samym pliku, eksportowana i do reużycia). Dla `periodMode: 'current_week'` `to` bywa przycięte do dzisiaj, jeśli niedziela tego tygodnia jeszcze nie nadeszła — to zachowanie jest już wliczone w `computePeriodRange`, walidator nie musi go znać, tylko porównać wynik 1:1.
- Prawdziwe przykłady nazw plików (z sesji z klientem, 2026-09-01) — parsery muszą je poprawnie obsłużyć:
  - Bolt: `Zarobki na kierowcę-31 sie 2026-1 wrz 2026-DA INVESTMENT SP_ Z O_O_.csv`
  - Uber: `20260824-20260825-payments_driver-DA_INVESTMENT_SPKA_Z_OGRANICZON_ODPOWIEDZIALNOCI.csv`
  - FreeNow: `earnings_2026-08-31_2026-09-01_with_VAT.csv`
  - Bolt Food: `fleet_courier_earnings_and_balances_2026_W34.csv`
- `download.suggestedFilename()` (patrz `bolt.js:91`, `uber.js:222`, `freenow.js:92`, `boltfood.js:109`) to prawdziwa nazwa pliku sugerowana przez przeglądarkę na podstawie odpowiedzi serwera platformy — niezależny dowód, nie coś generowanego przez nasz kod.
- `account` (obiekt z `credentialStore.listAccounts`, patrz `credentialStore.js:78-87`) ma pola: `label`, `city`, `company`, `periodMode`, `periodFrom`, `periodTo` — wszystkie to zwykłe stringi (mogą być puste dla starszych/niekompletnych kont).
- `normalizeTextKey` w `src/main/automation/platforms/partnertax.js:68-73` to istniejący wzorzec transliteracji polskich znaków (ą→a, ć→c, ę→e, ł→l, ń→n, ó→o, ś→s, ź→z, ż→z) — reportValidator.js implementuje własną, podobną funkcję (`normalizeForCompare`), bo dodatkowo usuwa wszystkie znaki niealfanumeryczne (potrzebne do porównań "zawiera się w", nie tylko dokładnej równości) — nie importować z `partnertax.js`, żeby nie tworzyć zależności między tymi dwoma modułami w złą stronę.
- Miesiące po polsku w skrócie u Bolta: `sty, lut, mar, kwi, maj, cze, lip, sie, wrz, paź, lis, gru`.

---

## Task 1: Parser tygodnia ISO (Bolt Food)

**Files:**
- Create: `src/main/automation/reportValidator.js`
- Test: `tests/reportValidator.spec.js`

**Interfaces:**
- Produces: `getIsoWeekMonday(year: number, week: number): Date` — poniedziałek (lokalny czas, godzina 00:00:00) danego tygodnia ISO-8601 danego roku. Używane przez Task 3 (parser Bolt Food) i importowane z `dateRange.js` `toISODate`/`getMondayOfWeek` gdzie to pomaga uniknąć duplikacji.

- [ ] **Step 1: Napisz failing test dla `getIsoWeekMonday`**

```js
const { test, expect } = require('playwright/test');
const { getIsoWeekMonday } = require('../src/main/automation/reportValidator');
const { toISODate } = require('../src/main/automation/dateRange');

test.describe('getIsoWeekMonday', () => {
  test('zwraca poniedzialek (dzien tygodnia = 1)', () => {
    const monday = getIsoWeekMonday(2026, 34);
    expect(monday.getDay()).toBe(1);
  });

  test('kolejne tygodnie sa oddalone o dokladnie 7 dni', () => {
    const week1 = getIsoWeekMonday(2026, 1);
    const week34 = getIsoWeekMonday(2026, 34);
    const diffDays = Math.round((week34 - week1) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(33 * 7);
  });

  test('poniedzialek tygodnia 1 przypada 29 grudnia poprzedniego roku lub pozniej, ale nie pozniej niz 4 stycznia', () => {
    const week1Monday = getIsoWeekMonday(2026, 1);
    expect(toISODate(week1Monday) >= '2025-12-29').toBe(true);
    expect(toISODate(week1Monday) <= '2026-01-04').toBe(true);
  });
});
```

- [ ] **Step 2: Uruchom test, potwierdź niepowodzenie**

Run: `npx playwright test tests/reportValidator.spec.js`
Expected: FAIL (moduł `reportValidator.js` nie istnieje / nie eksportuje `getIsoWeekMonday`)

- [ ] **Step 3: Zaimplementuj `getIsoWeekMonday` w nowym pliku `src/main/automation/reportValidator.js`**

```js
const { toISODate } = require('../dateRange');

/**
 * Poniedzialek tygodnia ISO-8601 danego numeru/roku (tydzien 1 = tydzien zawierajacy
 * pierwszy czwartek roku, rownowaznie: tydzien zawierajacy 4 stycznia).
 */
function getIsoWeekMonday(year, week) {
  const jan4 = new Date(year, 0, 4);
  const jan4DayIso = jan4.getDay() === 0 ? 7 : jan4.getDay(); // Mon=1..Sun=7
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - (jan4DayIso - 1));
  const monday = new Date(week1Monday);
  monday.setDate(week1Monday.getDate() + (week - 1) * 7);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

module.exports = { getIsoWeekMonday };
```

- [ ] **Step 4: Uruchom test, potwierdź powodzenie**

Run: `npx playwright test tests/reportValidator.spec.js`
Expected: PASS (3 testy)

- [ ] **Step 5: Commit**

```bash
git add src/main/automation/reportValidator.js tests/reportValidator.spec.js
git commit -m "Dodaj helper obliczania poniedzialku tygodnia ISO dla walidacji raportow"
```

---

## Task 2: Normalizacja tekstu i dopasowanie firma/miasto

**Files:**
- Modify: `src/main/automation/reportValidator.js`
- Test: `tests/reportValidator.spec.js`

**Interfaces:**
- Consumes: brak (funkcje samodzielne, tylko string in/out).
- Produces:
  - `normalizeForCompare(text: string): string` — lowercase, transliteracja polskich znaków, usuniecie wszystkiego poza `[a-z0-9]`.
  - `companiesMatch(fileCompany: string | null, accountCompany: string): boolean` — `true` gdy `fileCompany` jest `null` (platforma nie ujawnia firmy) lub gdy znormalizowane wersje zawierają sie nawzajem.
  - `labelMatchesCity(label: string, city: string): boolean` — `true` gdy znormalizowany `label` zawiera znormalizowane `city`.
  Uzywane przez Task 4 (orchestrator).

- [ ] **Step 1: Napisz failing testy**

```js
const { normalizeForCompare, companiesMatch, labelMatchesCity } = require('../src/main/automation/reportValidator');

test.describe('normalizeForCompare', () => {
  test('lowercase, transliteruje polskie znaki, usuwa nie-alfanumeryczne', () => {
    expect(normalizeForCompare('DA Investment - Wrocław')).toBe('dainvestmentwroclaw');
  });
});

test.describe('companiesMatch', () => {
  test('dopasowuje mimo formatowania w nazwie pliku Bolta', () => {
    expect(companiesMatch('DA INVESTMENT SP_ Z O_O_', 'DA Investment')).toBe(true);
  });

  test('dopasowuje mimo formatowania w nazwie pliku Ubera', () => {
    expect(companiesMatch('DA_INVESTMENT_SPKA_Z_OGRANICZON_ODPOWIEDZIALNOCI', 'DA Investment')).toBe(true);
  });

  test('wykrywa niezgodnosc firmy', () => {
    expect(companiesMatch('UNITY_DRIVE_SP_Z_O_O', 'DA Investment')).toBe(false);
  });

  test('brak firmy w pliku (FreeNow/Bolt Food) = przepuszcza', () => {
    expect(companiesMatch(null, 'DA Investment')).toBe(true);
  });
});

test.describe('labelMatchesCity', () => {
  test('dopasowuje typowy format etykiety konta', () => {
    expect(labelMatchesCity('DA Investment - Wrocław', 'Wrocław')).toBe(true);
  });

  test('wykrywa niezgodnosc miasta w etykiecie', () => {
    expect(labelMatchesCity('DA Investment - Wrocław', 'Warszawa')).toBe(false);
  });
});
```

- [ ] **Step 2: Uruchom testy, potwierdź niepowodzenie**

Run: `npx playwright test tests/reportValidator.spec.js`
Expected: FAIL (funkcje nie istnieją)

- [ ] **Step 3: Zaimplementuj w `src/main/automation/reportValidator.js`**

```js
const POLISH_DIACRITICS = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };

function normalizeForCompare(text) {
  return text
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (ch) => POLISH_DIACRITICS[ch])
    .replace(/[^a-z0-9]/g, '');
}

function companiesMatch(fileCompany, accountCompany) {
  if (!fileCompany) return true;
  const a = normalizeForCompare(fileCompany);
  const b = normalizeForCompare(accountCompany || '');
  if (!b) return true;
  return a.includes(b) || b.includes(a);
}

function labelMatchesCity(label, city) {
  if (!label || !city) return true;
  return normalizeForCompare(label).includes(normalizeForCompare(city));
}

module.exports = { getIsoWeekMonday, normalizeForCompare, companiesMatch, labelMatchesCity };
```

- [ ] **Step 4: Uruchom testy, potwierdź powodzenie**

Run: `npx playwright test tests/reportValidator.spec.js`
Expected: PASS (wszystkie testy z Task 1 i 2)

- [ ] **Step 5: Commit**

```bash
git add src/main/automation/reportValidator.js tests/reportValidator.spec.js
git commit -m "Dodaj normalizacje tekstu i dopasowanie firma/miasto do walidacji raportow"
```

---

## Task 3: Parsery nazw plików per platforma

**Files:**
- Modify: `src/main/automation/reportValidator.js`
- Test: `tests/reportValidator.spec.js`

**Interfaces:**
- Consumes: `getIsoWeekMonday` (Task 1), `toISODate` z `dateRange.js`.
- Produces: dla każdej platformy funkcja `parse<Platforma>Filename(filename: string): { company: string | null, periodStart: string, periodEnd: string }` (daty jako `'YYYY-MM-DD'`), rzuca zwykły `Error` gdy nazwa nie pasuje do wzorca. Nazwy: `parseBoltFilename`, `parseUberFilename`, `parseFreenowFilename`, `parseBoltFoodFilename`. Używane przez Task 4 przez dispatcher `PLATFORM_PARSERS`.

- [ ] **Step 1: Napisz failing testy (dokładnie te przykłady, które podał klient)**

```js
const {
  parseBoltFilename,
  parseUberFilename,
  parseFreenowFilename,
  parseBoltFoodFilename,
} = require('../src/main/automation/reportValidator');

test.describe('parseBoltFilename', () => {
  test('parsuje polskie nazwy miesiecy i firme', () => {
    const result = parseBoltFilename('Zarobki na kierowcę-31 sie 2026-1 wrz 2026-DA INVESTMENT SP_ Z O_O_.csv');
    expect(result).toEqual({ company: 'DA INVESTMENT SP_ Z O_O_', periodStart: '2026-08-31', periodEnd: '2026-09-01' });
  });

  test('rzuca na nierozpoznana nazwe', () => {
    expect(() => parseBoltFilename('cos_zupelnie_innego.csv')).toThrow();
  });
});

test.describe('parseUberFilename', () => {
  test('parsuje daty YYYYMMDD i firme', () => {
    const result = parseUberFilename('20260824-20260825-payments_driver-DA_INVESTMENT_SPKA_Z_OGRANICZON_ODPOWIEDZIALNOCI.csv');
    expect(result).toEqual({
      company: 'DA_INVESTMENT_SPKA_Z_OGRANICZON_ODPOWIEDZIALNOCI',
      periodStart: '2026-08-24',
      periodEnd: '2026-08-25',
    });
  });

  test('rzuca na nierozpoznana nazwe', () => {
    expect(() => parseUberFilename('raport.csv')).toThrow();
  });
});

test.describe('parseFreenowFilename', () => {
  test('parsuje zakres dat, brak firmy', () => {
    const result = parseFreenowFilename('earnings_2026-08-31_2026-09-01_with_VAT.csv');
    expect(result).toEqual({ company: null, periodStart: '2026-08-31', periodEnd: '2026-09-01' });
  });

  test('rzuca na nierozpoznana nazwe', () => {
    expect(() => parseFreenowFilename('raport.csv')).toThrow();
  });
});

test.describe('parseBoltFoodFilename', () => {
  test('parsuje numer tygodnia ISO na poniedzialek-niedziele, brak firmy', () => {
    const result = parseBoltFoodFilename('fleet_courier_earnings_and_balances_2026_W34.csv');
    expect(result.company).toBeNull();
    expect(result.periodStart).toBe('2026-08-17');
    expect(result.periodEnd).toBe('2026-08-23');
  });

  test('rzuca na nierozpoznana nazwe', () => {
    expect(() => parseBoltFoodFilename('raport.csv')).toThrow();
  });
});
```

- [ ] **Step 2: Uruchom testy, potwierdź niepowodzenie**

Run: `npx playwright test tests/reportValidator.spec.js`
Expected: FAIL (funkcje nie istnieją)

- [ ] **Step 3: Zaimplementuj parsery w `src/main/automation/reportValidator.js`**

```js
const PL_MONTHS = { sty: 0, lut: 1, mar: 2, kwi: 3, maj: 4, cze: 5, lip: 6, sie: 7, wrz: 8, paz: 9, lis: 10, gru: 11 };

function parsePolishMonthDate(day, monthAbbrev, year) {
  const key = normalizeForCompare(monthAbbrev).slice(0, 3);
  const monthIndex = PL_MONTHS[key];
  if (monthIndex === undefined) {
    throw new Error(`Nierozpoznany skrot miesiaca: "${monthAbbrev}"`);
  }
  return toISODate(new Date(Number(year), monthIndex, Number(day)));
}

function parseBoltFilename(filename) {
  const match = filename.match(/^Zarobki na kierowc.-(\d{1,2}) (\S+) (\d{4})-(\d{1,2}) (\S+) (\d{4})-(.+)\.csv$/i);
  if (!match) {
    throw new Error(`Nierozpoznany format nazwy pliku Bolt: "${filename}"`);
  }
  const [, d1, m1, y1, d2, m2, y2, company] = match;
  return {
    company,
    periodStart: parsePolishMonthDate(d1, m1, y1),
    periodEnd: parsePolishMonthDate(d2, m2, y2),
  };
}

function parseUberFilename(filename) {
  const match = filename.match(/^(\d{4})(\d{2})(\d{2})-(\d{4})(\d{2})(\d{2})-payments_driver-(.+)\.csv$/i);
  if (!match) {
    throw new Error(`Nierozpoznany format nazwy pliku Uber: "${filename}"`);
  }
  const [, y1, m1, d1, y2, m2, d2, company] = match;
  return {
    company,
    periodStart: `${y1}-${m1}-${d1}`,
    periodEnd: `${y2}-${m2}-${d2}`,
  };
}

function parseFreenowFilename(filename) {
  const match = filename.match(/earnings_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})/i);
  if (!match) {
    throw new Error(`Nierozpoznany format nazwy pliku FreeNow: "${filename}"`);
  }
  const [, periodStart, periodEnd] = match;
  return { company: null, periodStart, periodEnd };
}

function parseBoltFoodFilename(filename) {
  const match = filename.match(/_(\d{4})_W(\d{1,2})\.csv$/i);
  if (!match) {
    throw new Error(`Nierozpoznany format nazwy pliku Bolt Food: "${filename}"`);
  }
  const [, year, week] = match;
  const monday = getIsoWeekMonday(Number(year), Number(week));
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return { company: null, periodStart: toISODate(monday), periodEnd: toISODate(sunday) };
}

module.exports = {
  getIsoWeekMonday,
  normalizeForCompare,
  companiesMatch,
  labelMatchesCity,
  parseBoltFilename,
  parseUberFilename,
  parseFreenowFilename,
  parseBoltFoodFilename,
};
```

Uwaga: `parsePolishMonthDate` musi być zdefiniowane PO `normalizeForCompare` w pliku (albo `normalizeForCompare` przeniesione wyżej) — kolejność deklaracji funkcji w module nie ma znaczenia dla `function` (hoisting), więc kolejność w pliku jest dowolna, ale zachowaj czytelność: helpery (Task 1-2) na górze, parsery (Task 3) pod nimi, orchestrator (Task 4) na końcu.

- [ ] **Step 4: Uruchom testy, potwierdź powodzenie**

Run: `npx playwright test tests/reportValidator.spec.js`
Expected: PASS (wszystkie testy z Task 1-3)

- [ ] **Step 5: Commit**

```bash
git add src/main/automation/reportValidator.js tests/reportValidator.spec.js
git commit -m "Dodaj parsery nazw plikow raportow (Bolt/Uber/FreeNow/Bolt Food)"
```

---

## Task 4: Orchestrator `validateDownloadedReport`

**Files:**
- Modify: `src/main/automation/reportValidator.js`
- Test: `tests/reportValidator.spec.js`

**Interfaces:**
- Consumes: `computePeriodRange` z `../dateRange` (sygnatura: `computePeriodRange({ periodMode, periodFrom, periodTo }, now?)` → `{ from, to }`), parsery i helpery z Task 1-3.
- Produces: `class ReportValidationError extends Error`, funkcja `validateDownloadedReport({ platformId: string, account: object, filePath: string })` — nie zwraca nic przy sukcesie, rzuca `ReportValidationError` z czytelnym komunikatem PL przy dowolnej niezgodności. Wywoływana przez Task 5 w `main.js`.

- [ ] **Step 1: Napisz failing testy**

```js
const path = require('path');
const { validateDownloadedReport, ReportValidationError } = require('../src/main/automation/reportValidator');

function baseAccount(overrides = {}) {
  return {
    label: 'DA Investment - Wrocław',
    city: 'Wrocław',
    company: 'DA Investment',
    periodMode: 'custom',
    periodFrom: '2026-08-31',
    periodTo: '2026-09-01',
    ...overrides,
  };
}

test.describe('validateDownloadedReport', () => {
  test('przepuszcza zgodny plik Bolt', () => {
    const filePath = path.join('C:', 'downloads', 'bolt', 'DA_Investment_-_Wroc_aw', 'Zarobki na kierowcę-31 sie 2026-1 wrz 2026-DA INVESTMENT SP_ Z O_O_.csv');
    expect(() => validateDownloadedReport({ platformId: 'bolt', account: baseAccount(), filePath })).not.toThrow();
  });

  test('blokuje zly tydzien', () => {
    const filePath = path.join('C:', 'downloads', 'bolt', 'x', 'Zarobki na kierowcę-24 sie 2026-30 sie 2026-DA INVESTMENT SP_ Z O_O_.csv');
    expect(() => validateDownloadedReport({ platformId: 'bolt', account: baseAccount(), filePath }))
      .toThrow(ReportValidationError);
  });

  test('blokuje zla firme (Uber)', () => {
    const filePath = path.join('C:', 'downloads', 'uber', 'x', '20260831-20260901-payments_driver-UNITY_DRIVE_SP_Z_O_O.csv');
    expect(() => validateDownloadedReport({
      platformId: 'uber',
      account: baseAccount({ periodMode: 'custom', periodFrom: '2026-08-31', periodTo: '2026-09-01' }),
      filePath,
    })).toThrow(ReportValidationError);
  });

  test('blokuje niespojnosc etykiety konta z miastem', () => {
    const filePath = path.join('C:', 'downloads', 'bolt', 'x', 'Zarobki na kierowcę-31 sie 2026-1 wrz 2026-DA INVESTMENT SP_ Z O_O_.csv');
    expect(() => validateDownloadedReport({
      platformId: 'bolt',
      account: baseAccount({ label: 'DA Investment - Warszawa' }),
      filePath,
    })).toThrow(ReportValidationError);
  });

  test('FreeNow: przepuszcza mimo braku firmy w pliku', () => {
    const filePath = path.join('C:', 'downloads', 'freenow', 'x', 'earnings_2026-08-31_2026-09-01', 'earnings_2026-08-31_2026-09-01_with_VAT.csv');
    expect(() => validateDownloadedReport({ platformId: 'freenow', account: baseAccount(), filePath })).not.toThrow();
  });

  test('nierozpoznana nazwa pliku blokuje upload', () => {
    const filePath = path.join('C:', 'downloads', 'bolt', 'x', 'niespodziewany_format.csv');
    expect(() => validateDownloadedReport({ platformId: 'bolt', account: baseAccount(), filePath })).toThrow(ReportValidationError);
  });
});
```

- [ ] **Step 2: Uruchom testy, potwierdź niepowodzenie**

Run: `npx playwright test tests/reportValidator.spec.js`
Expected: FAIL (`validateDownloadedReport`/`ReportValidationError` nie istnieją)

- [ ] **Step 3: Zaimplementuj w `src/main/automation/reportValidator.js`**

```js
const path = require('path');
const { computePeriodRange } = require('../dateRange');

const PLATFORM_PARSERS = {
  bolt: parseBoltFilename,
  uber: parseUberFilename,
  freenow: parseFreenowFilename,
  boltfood: parseBoltFoodFilename,
};

class ReportValidationError extends Error {}

function validateDownloadedReport({ platformId, account, filePath }) {
  const parser = PLATFORM_PARSERS[platformId];
  if (!parser) {
    throw new ReportValidationError(`Brak walidatora nazwy pliku dla platformy: ${platformId}`);
  }

  const filename = path.basename(filePath);
  let parsed;
  try {
    parsed = parser(filename);
  } catch (error) {
    throw new ReportValidationError(
      `Nie rozpoznano formatu nazwy pobranego pliku (${platformId}): "${filename}". ${error.message}`
    );
  }

  const expected = computePeriodRange({
    periodMode: account.periodMode,
    periodFrom: account.periodFrom,
    periodTo: account.periodTo,
  });

  if (parsed.periodStart !== expected.from || parsed.periodEnd !== expected.to) {
    throw new ReportValidationError(
      `Zly tydzien w pobranym pliku (${platformId}, konto "${account.label}"): plik dotyczy ${parsed.periodStart} - ${parsed.periodEnd}, oczekiwano ${expected.from} - ${expected.to}.`
    );
  }

  if (!companiesMatch(parsed.company, account.company)) {
    throw new ReportValidationError(
      `Zla firma w pobranym pliku (${platformId}, konto "${account.label}"): plik wskazuje na "${parsed.company}", skonfigurowana firma to "${account.company}".`
    );
  }

  if (!labelMatchesCity(account.label, account.city)) {
    throw new ReportValidationError(
      `Niespojna konfiguracja konta: etykieta "${account.label}" nie zawiera skonfigurowanego miasta "${account.city}". Sprawdz ustawienia konta.`
    );
  }
}

module.exports = {
  getIsoWeekMonday,
  normalizeForCompare,
  companiesMatch,
  labelMatchesCity,
  parseBoltFilename,
  parseUberFilename,
  parseFreenowFilename,
  parseBoltFoodFilename,
  ReportValidationError,
  validateDownloadedReport,
};
```

- [ ] **Step 4: Uruchom testy, potwierdź powodzenie**

Run: `npx playwright test tests/reportValidator.spec.js`
Expected: PASS (wszystkie testy w pliku)

- [ ] **Step 5: Commit**

```bash
git add src/main/automation/reportValidator.js tests/reportValidator.spec.js
git commit -m "Dodaj orchestrator walidacji raportu przed uploadem (tydzien/firma/miasto)"
```

---

## Task 5: Wpiecie w `sync:run` (main.js) + wpis w ARCHITEKTURA.md

**Files:**
- Modify: `src/main/main.js:124-153`
- Modify: `ARCHITEKTURA.md`

**Interfaces:**
- Consumes: `validateDownloadedReport` z `./automation/reportValidator` (Task 4).
- Produces: brak nowego eksportu — to koncowe wpiecie logiki w istniejacy handler IPC.

**Uwaga (dlaczego bez automatycznego testu):** `main.js` laduje `electron` (`app`, `ipcMain`, `safeStorage`) na poziomie modulu i rejestruje handlery IPC jako efekt uboczny `require(...)` — w tym repo nie ma (i nie ma sensu budowac na tym etapie) harnessu importujacego `main.js` w testach (podobnie jak `runner.js`/`credentialStore.js` nie sa dzis pokryte testami jednostkowymi, tylko modul `platforms/*.js`, ktory dzialaja na nich, sa). Logika biznesowa jest w calosci pokryta testami w `reportValidator.spec.js` (Task 1-4) - to wpiecie weryfikujemy manualnie.

- [ ] **Step 1: Dodaj import w `src/main/main.js`**

Modyfikacja linii z importami (`src/main/main.js:6`, obok istniejacego importu `runner`):

```js
const { runDownload, runUpload, runDeleteReports } = require('./automation/runner');
const { validateDownloadedReport, ReportValidationError } = require('./automation/reportValidator');
```

- [ ] **Step 2: Wywolaj walidacje w handlerze `sync:run` przed `lastDownloads.set(...)`**

W `src/main/main.js`, w bloku `try` handlera `sync:run` (obecnie linie 137-148):

```js
  logger.info(`${logPrefix} start`);
  try {
    const result = await runDownload(app.getPath('userData'), platformId, account, { statusCallback });
    validateDownloadedReport({ platformId, account, filePath: result.filePath });
    lastDownloads.set(`${platformId}:${accountId}`, {
      platformId,
      accountId,
      city: account.city,
      company: account.company,
      filePath: result.filePath,
      downloadedAt: new Date().toISOString(),
    });
    logger.info(`${logPrefix} sukces: ${result.filePath}`);
    return { ok: true, filePath: result.filePath };
  } catch (error) {
    logger.error(`${logPrefix} blad: ${error.stack || error.message}`);
    return { ok: false, error: error.message };
  }
```

Nic wiecej w tym bloku nie trzeba zmieniac: `ReportValidationError extends Error`, wiec istniejacy `catch (error)` juz go obsluzy identycznie jak kazdy inny blad pobierania (log + `{ ok: false, error: error.message }` do renderera) - plik nie trafia do `lastDownloads`, wiec nie moze zostac pozniej wgrany.

- [ ] **Step 3: Manualna weryfikacja (brak automatycznego testu dla tego kroku, patrz uwaga wyzej)**

1. Uruchom apke (`npm start` lub odpowiedni skrypt z `package.json`).
2. Skonfiguruj dowolne konto (np. Bolt) z `account.periodMode = 'custom'` i `periodFrom`/`periodTo` ustawionymi na zakres celowo INNY niz to, co faktycznie zwroci platforma (np. `periodFrom`/`periodTo` sprzed tygodnia, podczas gdy platforma i tak wygeneruje plik na dzisiejszy tydzien z uwagi na wlasna logike raportowania) - LUB prosciej: chwilowo zmien `account.city` w zapisanej konfiguracji na inne miasto niz w `account.label` i uruchom pobieranie dla dowolnej platformy.
3. Sprawdz w logu aplikacji (`%APPDATA%/partnertax-automat/logs/automat.log` lub `getLogFilePath()`), ze pojawil sie wpis `[ERROR]` z komunikatem z `ReportValidationError` (np. "Niespojna konfiguracja konta...").
4. Sprawdz w UI, ze plik NIE pojawia sie na liscie "co sie pobralo" (checklista przed uploadem) - czyli `downloads:status` nie zwraca tego wpisu.
5. Przywroc poprawna konfiguracje konta i powtorz pobieranie - upewnij sie, ze tym razem konczy sie sukcesem i plik trafia na liste do wgrania.

- [ ] **Step 4: Dopisz wpis do `ARCHITEKTURA.md`**

Dodaj na koncu pliku `ARCHITEKTURA.md` nowa sekcje (w stylu istniejacych datowanych wpisow, np. linia 108 "## ✅ Modul uploadu do PartnerTax admin..."):

```markdown
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
```

- [ ] **Step 5: Commit**

```bash
git add src/main/main.js ARCHITEKTURA.md
git commit -m "Wpiecie walidacji raportu (tydzien/firma/miasto) w sync:run przed uploadem"
```

---

## Podsumowanie pokrycia specyfikacji

- Parser nazwy pliku per platforma → Task 3.
- Sprawdzenie spojnosci `account.label`/`account.city` → Task 2 (`labelMatchesCity`) + Task 4 (wywolanie).
- Porownanie z `account.company` i `computePeriodRange` → Task 4.
- Twarda blokada przy niezgodnosci → Task 4 (`ReportValidationError`) + Task 5 (wpiecie, plik nie trafia do `lastDownloads`).
- Log bledu → Task 5 (istniejacy `logger.error` w `sync:run` obsluguje kazdy `Error`, wliczajac `ReportValidationError`).
- Testy jednostkowe parserow + testy funkcji spojnosci + test integracyjny blokady → Task 1-4 (`tests/reportValidator.spec.js`).
