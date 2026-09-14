# Wsparcie wielu partnerow (PartnerTax admin) - plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Cel:** Automat wgrywa i usuwa raporty w dowolnej instalacji panelu PartnerTax admin (nie tylko Nova Partner), bez hardkodow adresu i numerycznych ID opcji.

**Architektura:** Adres panelu staje sie polem `baseUrl` konta PartnerTax (z jednorazowa migracja istniejacych instalacji Nova). Numeryczne ID opcji System/City/Company sa odczytywane w locie z ukrytego wiersza-szablonu formsetu Django (`select[name="sources-__prefix__-..."]`, zawsze obecny w DOM) i dopasowywane po znormalizowanym tekscie przez czysty modul `optionMatching.js`. Weryfikacja zapisu i usuwanie dalej porownuja ID (hrefy zapisanych wierszy), ale ID pochodza z mapy odczytanej ze strony, nie ze stalych w kodzie.

**Stack:** Electron 31, Playwright 1.47 (automat + `playwright test` jako runner testow), Node 20 (CI).

**Spec:** [docs/superpowers/specs/2026-09-14-multi-partner-support-findings.md](../specs/2026-09-14-multi-partner-support-findings.md) + ustalenia z przegladu kodu zapisane nizej w "Decyzje projektowe".

## Globalne ograniczenia

- Komentarze i komunikaty w kodzie po polsku, bez polskich znakow (styl repo). Commity po polsku, w trybie rozkazujacym (jak w historii repo), zakonczone linia `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Jeden build aplikacji dla wszystkich partnerow - cala konfiguracja partnera zyje w `credentials.enc.json` w userData, nie w kodzie.
- Istniejace instalacje Nova po auto-update musza dzialac bez zadnej recznej konfiguracji (migracja `baseUrl`).
- Dopasowanie opcji System/City: rownosc po normalizacji (`normalizeForCompare` z `reportValidator.js`), NIGDY `includes`/prefiks ("bolt" nie moze trafic w "Bolt Food"). Wyjatek wylacznie dla Company - patrz Decyzja 6.
- Testy: `npx playwright test <plik>` dla pojedynczego pliku; pelny zestaw `npm test` (stress testy trwaja kilka minut).
- Zakladamy, ze sciezki panelu (`/admin/`, `/admin/finances/reckoning/`, `/admin/systems/system/<id>/change/`) sa identyczne we wszystkich instalacjach i ze panel stoi w korzeniu domeny (bez podsciezki).

## Decyzje projektowe (uzupelnienie spec)

1. **Zrodlo opcji = szablon `__prefix__`.** Odczyt opcji z wiersza-szablonu pozwala rozwiazac wszystkie trzy wartosci PRZED dodaniem wiersza (fail-fast, formularz nietkniety przy bledzie konfiguracji) i dziala tak samo przy uploadzie i usuwaniu. Nie polegamy na tekscie linkow zapisanych wierszy (nie jest potwierdzony na zywym panelu).
2. **Duplikaty w liscie System** (Nova: "Bolt"=17 i "BOLT"=65): upload najpierw szuka dokladnego tekstu z listy kandydatow (`'Bolt'` -> 17), potem rownosci po normalizacji; wiele roznych ID po normalizacji = blad "niejednoznaczna opcja" (nigdy losowy wybor). Usuwanie akceptuje wszystkie ID pasujace po normalizacji (zastepuje `SYSTEM_OPTION_ALIASES`).
3. **Komunikat bledu wypisuje dostepne opcje** z panelu, zamiast odsylac do edycji `partnertax.js`.
4. **Migracja `baseUrl` jednorazowa** (flaga `_migrations.partnertaxBaseUrl` w magazynie) - nowy partner, ktory doda konto bez adresu, dostanie czytelny blad, a nie ciche ustawienie adresu Nova.
5. **Regula "etykieta konta musi zawierac miasto"** (`reportValidator.js`) przestaje blokowac - staje sie ostrzezeniem w statusie synchronizacji (to konwencja nazewnicza Nova, nie regula biznesowa).
6. **Company dopuszcza dopasowanie "zawiera" (tylko jako ostatni krok i tylko jednoznaczne).** Zrzut z zywego panelu Nova (Task 1): opcje firm to "UNITY DRIVE SP Z O O" / "DA INVESTMENT SP Z O O", a konta maja wpisane "Unity Drive" / "DA Investment" (tak dzialaly dawne klucze mapy). Sama rownosc po normalizacji zepsulaby upload u Nova. Dla System i City "zawiera" pozostaje zakazane ("Bolt" vs "Bolt Food", "Sulawki Bolt" vs "sulawki/augustow uber").

## Poza zakresem

- Filtr `hasText: 'False'` na liscie rozliczen (zaleznosc od jezyka UI) - sprawdzic przy pierwszej drugiej instalacji, nie ruszac teraz.
- Panel pod podsciezka domeny (`https://firma.pl/panel/admin/`) - `normalizeBaseUrl` bierze `origin`.

## Mapa plikow

| Plik | Zmiana | Odpowiedzialnosc |
|---|---|---|
| `src/main/automation/optionMatching.js` | nowy | Czyste dopasowanie `{value,text}[]` do kandydatow tekstowych |
| `src/main/partnerTaxConfig.js` | nowy | Normalizacja `baseUrl`, budowa URL-i admina, migracja magazynu (bez zaleznosci od Electrona - testowalne) |
| `src/main/automation/platforms/partnertax.js` | modyfikacja | Usuniecie hardkodow, uzycie powyzszych |
| `src/main/credentialStore.js` | modyfikacja | `runMigrations()` |
| `src/main/main.js` | modyfikacja | Wywolanie migracji przy starcie; ostrzezenia walidacji |
| `src/main/platforms.js` | modyfikacja | Pole `baseUrl`, usuniecie martwego `loginUrl` |
| `src/renderer/renderer.js` | modyfikacja | Etykieta i typ pola `baseUrl` |
| `src/main/automation/reportValidator.js` | modyfikacja | Etykieta/miasto -> ostrzezenie |
| `tests/mocks/partnerTaxAdminMock.js` | modyfikacja | Konfigurowalny adres i listy opcji |
| `tests/optionMatching.spec.js`, `tests/partnerTaxConfig.spec.js`, `tests/novaOptionsRegression.spec.js`, `tests/fixtures/novaAdminOptions.js` | nowe | Testy |
| `tests/partnertax.stress.spec.js`, `tests/reportValidator.spec.js` | modyfikacja | Dostosowanie + nowe przypadki |

## Przed startem

- [ ] Drzewo robocze ma niezacommitowane zmiany m.in. w `credentialStore.js`, `main.js`, `renderer.js`, ktorych dotyka ten plan. Uzytkownik decyduje: zacommitowac je najpierw (zalecane) albo pracowac w osobnym worktree (`superpowers:using-git-worktrees`). Nie mieszac tych zmian z commitami z planu.
- [ ] `npx playwright test tests/partnertax.stress.spec.js tests/reportValidator.spec.js` - zapisz wynik bazowy (ma przechodzic przed zmianami).

---

### Task 1: Zrzut zywych opcji z panelu Nova (fixture)

Zrzut zrobiony przez uzytkownika 2026-09-14 skryptem w DevTools na formularzu rozliczenia:

```js
JSON.stringify(Object.fromEntries(['system', 'city', 'company'].map((f) => {
  const el = document.querySelector(`select[name="sources-__prefix__-${f}"]`);
  return [f, el ? [...el.options].map((o) => ({ value: o.value, text: o.textContent.trim() })) : null];
})), null, 2)
```

Wnioski (juz uwzglednione w dalszych taskach): szablon `__prefix__` istnieje (Decyzja 1 potwierdzona); System: "Bolt"=17, "BOLT"=65, "Uber"=32, "Freenow"=2, "Bolt Food"=78 plus wiele wariantow ("Bolt - ilość przejazdów", "BOLT - korekta", "Uber korekta"...), ktore po normalizacji NIE koliduja; City: wszystkie 12 dawnych kluczy rowne po normalizacji; Company: teksty z sufiksem "SP Z O O" (Decyzja 6).

**Files:**
- Create: `tests/fixtures/novaAdminOptions.js`

- [ ] **Step 1: Zapisz fixture** jako `tests/fixtures/novaAdminOptions.js` (dokladnie te dane):

```js
// Zrzut opcji <select name="sources-__prefix__-*"> z zywego panelu Nova Partner
// (2026-09-14). Uzywany w tescie regresji: dopasowanie po tekscie musi dawac te
// same ID, ktore byly wczesniej zahardkodowane w partnertax.js.
const o = (value, text) => ({ value, text });

module.exports = {
  system: [
    o('', 'Select value'),
    o('34', 'Amic - faktura'),
    o('67', 'Awaryjne do przeniesienia'),
    o('65', 'BOLT'),
    o('83', 'BOLT - korekta'),
    o('56', 'BP - karta flotowa'),
    o('62', 'Bliq'),
    o('17', 'Bolt'),
    o('54', 'Bolt - ilość przejazdów'),
    o('40', 'Bolt - ilość przejazdów (stary)'),
    o('78', 'Bolt Food'),
    o('35', 'Circle K - faktura'),
    o('36', 'Cost Pocket - faktura'),
    o('61', 'DKV - faktury'),
    o('29', 'Do przeniesenia'),
    o('51', 'Ebi24 - faktura'),
    o('75', 'Ebi24 - faktura archiwum'),
    o('2', 'Freenow'),
    o('44', 'Freenow - ilość przejazdów'),
    o('82', 'Gwarant'),
    o('46', 'Import faktur'),
    o('50', 'Import salda'),
    o('9', 'Inne'),
    o('73', 'Inne archiwum'),
    o('81', 'Komornik'),
    o('77', 'Korekta'),
    o('74', 'Korekta salda'),
    o('37', 'Mol - faktura (stare)'),
    o('52', 'Mol – faktura'),
    o('38', 'Moya - faktura'),
    o('72', 'Nova porównanie'),
    o('80', 'NovaPartner - Prowizja 2'),
    o('70', 'NovaPartner - Prowizja pojazd'),
    o('63', 'Orlen - faktury'),
    o('71', 'Prowizja flota'),
    o('84', 'Prowizja flota - korekta'),
    o('16', 'Prowizja partnera - miesięczna'),
    o('13', 'Prowizja partnera - tygodniowa'),
    o('11', 'Prowizja pojazd'),
    o('33', 'Raport'),
    o('14', 'Rata'),
    o('12', 'Salda i inne'),
    o('10', 'Spłata długu'),
    o('4', 'SumUp'),
    o('32', 'Uber'),
    o('55', 'Uber - ilość przejazdów'),
    o('42', 'Uber - ilość przejazdów (stary)'),
    o('79', 'Uber korekta'),
    o('53', 'Umowa - HRappka'),
    o('69', 'Umowa/Kontrakt'),
    o('15', 'Wypłata - miesięczna'),
    o('7', 'Wypłata - tygodniowa'),
    o('76', 'Zerowanie'),
    o('58', 'iTaxi'),
    o('60', 'iTaxi - korekta miesięczna'),
    o('59', 'iTaxi plik do korekty'),
  ],
  city: [
    o('', 'Select value'),
    o('7', 'Wrocław'),
    o('8', 'Warszawa'),
    o('9', 'Legnica'),
    o('10', 'Kraków'),
    o('12', 'Białystok'),
    o('11', 'Wałbrzych/Jelenia Góra'),
    o('14', 'Lubin'),
    o('15', 'sulawki/augustow uber'),
    o('16', 'Sulawki Bolt'),
    o('13', 'Augustow/suwalki'),
    o('17', 'Poznan'),
    o('18', 'Leszno'),
  ],
  company: [
    o('', 'Select value'),
    o('5', 'UNITY DRIVE SP Z O O'),
    o('4', 'DA INVESTMENT SP Z O O'),
  ],
};
```

- [ ] **Step 2: Commit**

```bash
git add tests/fixtures/novaAdminOptions.js
git commit -m "Dodaj zrzut opcji formularza Data source z panelu Nova (fixture testowy)"
```

---

### Task 2: Modul dopasowania opcji po tekscie

**Files:**
- Create: `src/main/automation/optionMatching.js`
- Test: `tests/optionMatching.spec.js`

**Interfaces:**
- Consumes: `normalizeForCompare(text: string): string` z `src/main/automation/reportValidator.js` (lowercase, bez polskich znakow, tylko `[a-z0-9]`).
- Produces:
  - `matchOptionValue(options: {value: string, text: string}[], candidates: string[], { fieldName: string, allowContains?: boolean }): string` - rzuca `Error` przy braku lub niejednoznacznosci. `allowContains: true` (tylko Company) dodaje ostatni krok: znormalizowany tekst opcji zawiera znormalizowanego kandydata, wynik musi byc jednoznaczny.
  - `findAllOptionValues(options, candidates): string[]` - wszystkie rozne ID pasujace po normalizacji (moze byc pusta).

- [ ] **Step 1: Napisz failujace testy** - `tests/optionMatching.spec.js`:

```js
const { test, expect } = require('playwright/test');
const { matchOptionValue, findAllOptionValues } = require('../src/main/automation/optionMatching');

const SYSTEMS = [
  { value: '', text: '---------' },
  { value: '17', text: 'Bolt' },
  { value: '65', text: 'BOLT' },
  { value: '78', text: 'Bolt Food' },
  { value: '32', text: 'Uber' },
  { value: '2', text: 'Free Now' },
];

test.describe('matchOptionValue', () => {
  test('dokladny tekst wygrywa z duplikatem po normalizacji', () => {
    expect(matchOptionValue(SYSTEMS, ['Bolt'], { fieldName: 'System' })).toBe('17');
  });

  test('dopasowuje po normalizacji (wielkosc liter, spacje, polskie znaki)', () => {
    expect(matchOptionValue(SYSTEMS, ['FreeNow'], { fieldName: 'System' })).toBe('2');
    const cities = [{ value: '7', text: 'Wrocław' }, { value: '11', text: 'Wałbrzych/Jelenia Góra' }];
    expect(matchOptionValue(cities, ['wroclaw'], { fieldName: 'City' })).toBe('7');
    expect(matchOptionValue(cities, ['walbrzych/jelenia gora'], { fieldName: 'City' })).toBe('11');
  });

  test('"Bolt" nie trafia w "Bolt Food"', () => {
    const onlyFood = [{ value: '78', text: 'Bolt Food' }];
    expect(() => matchOptionValue(onlyFood, ['Bolt'], { fieldName: 'System' }))
      .toThrow(/brak opcji "Bolt" w polu System/);
  });

  test('brak dopasowania wypisuje dostepne opcje (bez pustej)', () => {
    let message = '';
    try {
      matchOptionValue(SYSTEMS, ['iTaxi'], { fieldName: 'System' });
    } catch (error) {
      message = error.message;
    }
    expect(message).toContain('"Uber" (32)');
    expect(message).not.toContain('---------');
  });

  test('kilka roznych ID po normalizacji bez dokladnego trafienia = blad niejednoznacznosci', () => {
    const dup = [{ value: '17', text: 'BOLT' }, { value: '65', text: 'bolt' }];
    expect(() => matchOptionValue(dup, ['Bolt'], { fieldName: 'System' })).toThrow(/niejednoznaczna/);
  });

  const COMPANIES = [
    { value: '', text: 'Select value' },
    { value: '5', text: 'UNITY DRIVE SP Z O O' },
    { value: '4', text: 'DA INVESTMENT SP Z O O' },
  ];

  test('allowContains: nazwa firmy bez formy prawnej trafia w pelna nazwe z panelu', () => {
    expect(matchOptionValue(COMPANIES, ['Unity Drive'], { fieldName: 'Company', allowContains: true })).toBe('5');
    expect(matchOptionValue(COMPANIES, ['DA INVESTMENT SP. Z O.O.'], { fieldName: 'Company', allowContains: true })).toBe('4');
  });

  test('allowContains: kilka trafien = blad niejednoznacznosci', () => {
    expect(() => matchOptionValue(COMPANIES, ['SP Z O O'], { fieldName: 'Company', allowContains: true }))
      .toThrow(/niejednoznaczna opcja "SP Z O O" w polu Company/);
  });

  test('bez allowContains "zawiera" nie dziala (miasta)', () => {
    const cities = [{ value: '15', text: 'sulawki/augustow uber' }, { value: '16', text: 'Sulawki Bolt' }];
    expect(() => matchOptionValue(cities, ['Sulawki'], { fieldName: 'City' })).toThrow(/brak opcji "Sulawki" w polu City/);
  });
});

test.describe('findAllOptionValues', () => {
  test('zwraca wszystkie aliasy systemu, bez "Bolt Food"', () => {
    expect(findAllOptionValues(SYSTEMS, ['Bolt'])).toEqual(['17', '65']);
  });

  test('pusta tablica gdy brak dopasowania', () => {
    expect(findAllOptionValues(SYSTEMS, ['iTaxi'])).toEqual([]);
  });
});
```

- [ ] **Step 2: Uruchom - ma failowac**

Run: `npx playwright test tests/optionMatching.spec.js`
Expected: FAIL - `Cannot find module '../src/main/automation/optionMatching'`.

- [ ] **Step 3: Implementacja** - `src/main/automation/optionMatching.js`:

```js
const { normalizeForCompare } = require('./reportValidator');

/**
 * Dopasowanie opcji <select> panelu PartnerTax admin po widocznym tekscie zamiast po
 * numerycznych ID (ID to klucze bazy danych konkretnej instalacji - u kazdego partnera
 * inne). Tylko rownosc po normalizacji, nigdy "zawiera" - inaczej "Bolt" trafialby
 * w "Bolt Food".
 */

function usableOptions(options) {
  return options.filter((option) => option.value !== '' && normalizeForCompare(option.text) !== '');
}

function distinctValues(options) {
  return [...new Set(options.map((option) => option.value))];
}

function describeOptions(options) {
  return options.map((option) => `"${option.text.trim()}" (${option.value})`).join(', ');
}

function ambiguousError(fieldName, label, matched) {
  return new Error(
    `PartnerTax admin: niejednoznaczna opcja "${label}" w polu ${fieldName} - pasuje kilka wpisow: ${describeOptions(matched)}. Ujednolic nazwy w panelu albo zglos to do poprawki w automacie.`
  );
}

function findMatchingOptions(options, candidates) {
  const keys = new Set(candidates.map(normalizeForCompare));
  return usableOptions(options).filter((option) => keys.has(normalizeForCompare(option.text)));
}

/**
 * Opcje, ktorych znormalizowany tekst ZAWIERA ktoregos kandydata. Tylko dla Company:
 * panel Nova ma "UNITY DRIVE SP Z O O", a konto "Unity Drive" (zrzut 2026-09-14).
 */
function findContainingOptions(options, candidates) {
  const keys = candidates.map(normalizeForCompare).filter((key) => key !== '');
  return options.filter((option) => keys.some((key) => normalizeForCompare(option.text).includes(key)));
}

/**
 * Zwraca ID jednej opcji. Kolejnosc: dokladny tekst kolejnych kandydatow (rozstrzyga
 * duplikaty typu "Bolt"=17 / "BOLT"=65 w panelu Nova), potem rownosc po normalizacji,
 * a przy allowContains na koncu jednoznaczne "zawiera".
 */
function matchOptionValue(options, candidates, { fieldName, allowContains = false }) {
  const usable = usableOptions(options);

  for (const candidate of candidates) {
    const exact = usable.filter((option) => option.text.trim() === candidate.trim());
    const exactValues = distinctValues(exact);
    if (exactValues.length === 1) return exactValues[0];
    if (exactValues.length > 1) throw ambiguousError(fieldName, candidate, exact);
  }

  let matched = findMatchingOptions(usable, candidates);
  if (matched.length === 0 && allowContains) {
    matched = findContainingOptions(usable, candidates);
  }
  const values = distinctValues(matched);
  if (values.length === 1) return values[0];
  if (values.length === 0) {
    throw new Error(
      `PartnerTax admin: brak opcji "${candidates.join('" / "')}" w polu ${fieldName}. Dostepne: ${describeOptions(usable)}.`
    );
  }
  throw ambiguousError(fieldName, candidates[0], matched);
}

function findAllOptionValues(options, candidates) {
  return distinctValues(findMatchingOptions(options, candidates));
}

module.exports = { matchOptionValue, findAllOptionValues };
```

- [ ] **Step 4: Uruchom - ma przechodzic**

Run: `npx playwright test tests/optionMatching.spec.js`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add src/main/automation/optionMatching.js tests/optionMatching.spec.js
git commit -m "Dodaj dopasowanie opcji formularza PartnerTax po tekscie zamiast po ID"
```

---

### Task 3: Konfiguracja adresu panelu (czysty modul)

**Files:**
- Create: `src/main/partnerTaxConfig.js`
- Test: `tests/partnerTaxConfig.spec.js`

**Interfaces:**
- Produces:
  - `LEGACY_NOVA_BASE_URL: string` = `'https://app.nova-partner.pl'`
  - `normalizeBaseUrl(input: string | undefined): string` - zwraca `origin` (np. `https://app.firma.pl`), rzuca przy braku/zlym adresie/nie-https.
  - `buildAdminUrls(baseUrl: string): { loginUrl: string, reckoningListUrl: string }`
  - `applyLegacyBaseUrlMigration(store: object): { store: object, changed: boolean }` - czysta funkcja na surowym magazynie (`{ [platformId]: account[], _migrations?: {} }`, pola kont w formacie `{ enc: boolean, value: string }`).

- [ ] **Step 1: Napisz failujace testy** - `tests/partnerTaxConfig.spec.js`:

```js
const { test, expect } = require('playwright/test');
const {
  LEGACY_NOVA_BASE_URL,
  normalizeBaseUrl,
  buildAdminUrls,
  applyLegacyBaseUrlMigration,
} = require('../src/main/partnerTaxConfig');

test.describe('normalizeBaseUrl', () => {
  test('ucina sciezke /admin/ i ukosnik', () => {
    expect(normalizeBaseUrl('https://app.nova-partner.pl/admin/')).toBe('https://app.nova-partner.pl');
  });

  test('dopisuje https gdy brak schematu, przycina spacje', () => {
    expect(normalizeBaseUrl('  panel.inny-partner.pl ')).toBe('https://panel.inny-partner.pl');
  });

  test('rzuca przy pustym adresie', () => {
    expect(() => normalizeBaseUrl('')).toThrow(/Brak adresu panelu/);
    expect(() => normalizeBaseUrl(undefined)).toThrow(/Brak adresu panelu/);
  });

  test('rzuca przy http i smieciach', () => {
    expect(() => normalizeBaseUrl('http://panel.firma.pl')).toThrow(/https/);
    expect(() => normalizeBaseUrl('https://')).toThrow(/Nieprawidlowy adres/);
  });
});

test('buildAdminUrls', () => {
  expect(buildAdminUrls('https://panel.firma.pl')).toEqual({
    loginUrl: 'https://panel.firma.pl/admin/',
    reckoningListUrl: 'https://panel.firma.pl/admin/finances/reckoning/',
  });
});

test.describe('applyLegacyBaseUrlMigration', () => {
  const password = { enc: true, value: 'xxx' };

  test('uzupelnia adres Nova w istniejacym koncie i ustawia flage', () => {
    const { store, changed } = applyLegacyBaseUrlMigration({
      partnertax: [{ accountId: 'a', fields: { username: { enc: false, value: 'u' }, password } }],
    });
    expect(changed).toBe(true);
    expect(store.partnertax[0].fields.baseUrl).toEqual({ enc: false, value: LEGACY_NOVA_BASE_URL });
    expect(store.partnertax[0].fields.password).toEqual(password);
    expect(store._migrations.partnertaxBaseUrl).toBe(true);
  });

  test('nie nadpisuje ustawionego adresu', () => {
    const own = { enc: false, value: 'https://panel.firma.pl' };
    const { store } = applyLegacyBaseUrlMigration({ partnertax: [{ accountId: 'a', fields: { baseUrl: own } }] });
    expect(store.partnertax[0].fields.baseUrl).toEqual(own);
  });

  test('po ustawieniu flagi nic nie robi (nowe konto bez adresu nie dostaje Nova)', () => {
    const input = { _migrations: { partnertaxBaseUrl: true }, partnertax: [{ accountId: 'b', fields: {} }] };
    const { store, changed } = applyLegacyBaseUrlMigration(input);
    expect(changed).toBe(false);
    expect(store.partnertax[0].fields.baseUrl).toBeUndefined();
  });

  test('swieza instalacja: tylko flaga, bez tworzenia klucza partnertax', () => {
    const { store, changed } = applyLegacyBaseUrlMigration({});
    expect(changed).toBe(true);
    expect(store).toEqual({ _migrations: { partnertaxBaseUrl: true } });
  });
});
```

- [ ] **Step 2: Uruchom - ma failowac**

Run: `npx playwright test tests/partnerTaxConfig.spec.js`
Expected: FAIL - `Cannot find module '../src/main/partnerTaxConfig'`.

- [ ] **Step 3: Implementacja** - `src/main/partnerTaxConfig.js`:

```js
// Adres instalacji panelu, z ktorej korzystala aplikacja zanim adres stal sie
// polem konta - uzywany WYLACZNIE w jednorazowej migracji istniejacych kont.
const LEGACY_NOVA_BASE_URL = 'https://app.nova-partner.pl';

const BASE_URL_MIGRATION_KEY = 'partnertaxBaseUrl';

/**
 * Kazdy partner ma wlasna instalacje panelu PartnerTax admin pod innym adresem.
 * Przyjmujemy to, co partner wkleil (z /admin/ na koncu, bez schematu itp.) i
 * sprowadzamy do samego origin - sciezki admina doklada buildAdminUrls.
 */
function normalizeBaseUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    throw new Error('Brak adresu panelu PartnerTax admin w konfiguracji konta (pole "Adres panelu PartnerTax").');
  }
  const withScheme = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`Nieprawidlowy adres panelu PartnerTax admin: "${raw}".`);
  }
  if (!url.hostname) {
    throw new Error(`Nieprawidlowy adres panelu PartnerTax admin: "${raw}".`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`Adres panelu PartnerTax admin musi zaczynac sie od https:// (podano "${raw}").`);
  }
  return url.origin;
}

function buildAdminUrls(baseUrl) {
  return {
    loginUrl: `${baseUrl}/admin/`,
    reckoningListUrl: `${baseUrl}/admin/finances/reckoning/`,
  };
}

/**
 * Jednorazowo uzupelnia adres Nova w kontach PartnerTax zapisanych przed pojawieniem
 * sie pola baseUrl (wszystkie takie instalacje to Nova). Flaga w _migrations pilnuje,
 * zeby nowy partner, ktory pozniej doda konto bez adresu, dostal czytelny blad zamiast
 * po cichu ustawionego adresu Nova.
 */
function applyLegacyBaseUrlMigration(store) {
  const migrations = store._migrations || {};
  if (migrations[BASE_URL_MIGRATION_KEY]) {
    return { store, changed: false };
  }

  const next = { ...store, _migrations: { ...migrations, [BASE_URL_MIGRATION_KEY]: true } };
  if (store.partnertax) {
    next.partnertax = store.partnertax.map((account) => {
      const fields = account.fields || {};
      if (fields.baseUrl && fields.baseUrl.value) return account;
      return { ...account, fields: { ...fields, baseUrl: { enc: false, value: LEGACY_NOVA_BASE_URL } } };
    });
  }
  return { store: next, changed: true };
}

module.exports = {
  LEGACY_NOVA_BASE_URL,
  normalizeBaseUrl,
  buildAdminUrls,
  applyLegacyBaseUrlMigration,
};
```

- [ ] **Step 4: Uruchom - ma przechodzic**

Run: `npx playwright test tests/partnerTaxConfig.spec.js`
Expected: 9 passed. (Uwaga: `new URL('https://')` rzuca w Node 20 - trafia w galaz "Nieprawidlowy adres". Jesli nie rzuca, lapie go sprawdzenie `!url.hostname`.)

- [ ] **Step 5: Commit**

```bash
git add src/main/partnerTaxConfig.js tests/partnerTaxConfig.spec.js
git commit -m "Dodaj konfiguracje adresu panelu PartnerTax z migracja kont Nova"
```

---

### Task 4: Refaktor partnertax.js - adres z konta i opcje z panelu

**Files:**
- Modify: `src/main/automation/platforms/partnertax.js` (linie 1-95 stale/resolvery, 102-124 login, 153-181 lista rozliczen, 259-295 upload wiersza, 303-331 upload, 352-452 usuwanie, 454-460 eksporty)
- Modify: `tests/mocks/partnerTaxAdminMock.js`
- Modify: `tests/partnertax.stress.spec.js`
- Create: `tests/novaOptionsRegression.spec.js`

**Interfaces:**
- Consumes: `matchOptionValue`, `findAllOptionValues` (Task 2); `normalizeBaseUrl`, `buildAdminUrls` (Task 3); `tests/fixtures/novaAdminOptions.js` (Task 1) w ksztalcie `{ system: {value,text}[], city: [...], company: [...] }`.
- Produces: eksporty `uploadToPartnerTax({ context, account, uploads, statusCallback })` i `deleteReportsFromPartnerTax({ context, account, statusCallback })` - sygnatury BEZ zmian (runner.js/main.js nietkniete), ale `account.fields.baseUrl` jest teraz wymagane. Nowy eksport `SYSTEM_LABEL_CANDIDATES: Record<'bolt'|'uber'|'freenow'|'boltfood', string[]>`. Znikaja eksporty `SYSTEM_OPTION_VALUES`, `CITY_OPTION_VALUES`, `COMPANY_OPTION_VALUES` (brak innych uzytkownikow - sprawdzone grepem).
- Mock: `installPartnerTaxMock(context, { baseUrl?, systems?, cities?, companies?, credentials?, preSeedSavedSources?, hangOnFirstSave? })`, gdzie `systems/cities/companies` to `[value, text][]`.

- [ ] **Step 1: Mock - konfigurowalny adres i opcje.** W `tests/mocks/partnerTaxAdminMock.js`:

Zamien `const BASE_URL = 'https://app.nova-partner.pl';` na `const DEFAULT_BASE_URL = 'https://app.nova-partner.pl';`.

Zamien stale `KNOWN_*` na (teksty jak w zywym panelu Nova - zrzut z Task 1, w tym duplikaty i warianty):

```js
const DEFAULT_SYSTEMS = [
  ['65', 'BOLT'],
  ['83', 'BOLT - korekta'],
  ['17', 'Bolt'],
  ['54', 'Bolt - ilość przejazdów'],
  ['78', 'Bolt Food'],
  ['2', 'Freenow'],
  ['44', 'Freenow - ilość przejazdów'],
  ['32', 'Uber'],
  ['79', 'Uber korekta'],
];
const DEFAULT_CITIES = [
  ['7', 'Wrocław'],
  ['8', 'Warszawa'],
];
const DEFAULT_COMPANIES = [
  ['5', 'UNITY DRIVE SP Z O O'],
  ['4', 'DA INVESTMENT SP Z O O'],
];
```

Zmien sygnature `buildChangeFormHtml(state, { changeFormUrl })` na `buildChangeFormHtml(state, { changeFormUrl, systems, cities, companies })` i w jej ciele zastap wszystkie `optionsHtml(KNOWN_SYSTEMS)` / `KNOWN_CITIES` / `KNOWN_COMPANIES` odpowiednio przez `optionsHtml(systems)` / `optionsHtml(cities)` / `optionsHtml(companies)` (6 miejsc: szablon `__prefix__` i klonowany wiersz).

W `installPartnerTaxMock` rozszerz destrukturyzacje:

```js
  const {
    baseUrl = DEFAULT_BASE_URL,
    systems = DEFAULT_SYSTEMS,
    cities = DEFAULT_CITIES,
    companies = DEFAULT_COMPANIES,
    credentials = DEFAULT_CREDENTIALS,
    preSeedSavedSources = [],
    hangOnFirstSave = false,
  } = scenario;
```

i w ciele tej funkcji zastap kazde `BASE_URL` przez `baseUrl` (route, przekierowanie na login, `redirectTo`, `changeFormUrl` x2), a wywolanie formularza przez:

```js
        body: buildChangeFormHtml(state, { changeFormUrl: baseUrl + changeFormPath, systems, cities, companies }),
```

Zaktualizuj komentarz nad funkcja ("Instaluje przechwytywanie ruchu do app.nova-partner.pl") na "do adresu panelu ze scenariusza (domyslnie app.nova-partner.pl)".

- [ ] **Step 2: Uruchom stary zestaw na nowym mocku - ma przechodzic**

Run: `npx playwright test tests/partnertax.stress.spec.js`
Expected: 4 passed (mock zachowuje sie jak wczesniej; duplikat 65 w szablonie jeszcze niczego nie zmienia, bo kod uzywa stalych ID).

- [ ] **Step 3: Napisz failujace testy** w `tests/partnertax.stress.spec.js`.

W `makeAccount` dodaj adres do pol:

```js
    fields: { username: 'partner', password: 'secret123', baseUrl: 'https://app.nova-partner.pl' },
```

W tescie "upload wielu plikow" zmien oczekiwany komunikat:

```js
    expect(caughtError.message).toMatch(/brak opcji "nieznane-miasto" w polu City/i);
```

Dodaj na koncu `test.describe` nowe przypadki:

```js
  test('inny partner: inny adres panelu i inne ID opcji', async () => {
    const context = await browser.newContext();
    const mock = await installPartnerTaxMock(context, {
      baseUrl: 'https://panel.inny-partner.pl',
      systems: [['3', 'Uber'], ['4', 'Bolt Food'], ['5', 'Bolt'], ['6', 'Free Now']],
      cities: [['1', 'Gdańsk']],
      companies: [['9', 'Firma XYZ Sp. z o.o.']],
    });
    const account = makeAccount({
      fields: { username: 'partner', password: 'secret123', baseUrl: 'panel.inny-partner.pl/admin/' },
    });
    const uploads = [
      makeUpload({ platformId: 'bolt', city: 'Gdansk', company: 'firma xyz sp. z o.o.' }),
      makeUpload({ platformId: 'freenow', city: 'Gdansk', company: 'firma xyz sp. z o.o.' }),
    ];

    await uploadToPartnerTax({ context, account, uploads, statusCallback: () => {} });

    expect(mock.state.savedSources).toEqual([
      { system: '5', city: '1', company: '9', file: '1' },
      { system: '6', city: '1', company: '9', file: '1' },
    ]);
  });

  test('brak adresu panelu: czytelny blad przed otwarciem przegladarki', async () => {
    const context = await browser.newContext();
    const mock = await installPartnerTaxMock(context, {});
    const account = makeAccount({ fields: { username: 'partner', password: 'secret123' } });

    await expect(
      uploadToPartnerTax({ context, account, uploads: [makeUpload()], statusCallback: () => {} })
    ).rejects.toThrow(/Brak adresu panelu/);
    expect(mock.state.loggedIn).toBe(false);
  });

  test('niejednoznaczny system: blad zamiast losowego wyboru, formularz nietkniety', async () => {
    const context = await browser.newContext();
    const mock = await installPartnerTaxMock(context, { systems: [['17', 'BOLT'], ['65', 'bolt']] });

    await expect(
      uploadToPartnerTax({ context, account: makeAccount(), uploads: [makeUpload()], statusCallback: () => {} })
    ).rejects.toThrow(/niejednoznaczna opcja "Bolt" w polu System/);
    expect(mock.state.pendingNewRows).toEqual({});
    expect(mock.state.savedSources).toEqual([]);
  });

  test('inny partner: krok usuwania Bolt nie traktuje "Bolt Food" jako Bolt', async () => {
    const context = await browser.newContext();
    const mock = await installPartnerTaxMock(context, {
      baseUrl: 'https://panel.inny-partner.pl',
      systems: [['4', 'Bolt Food'], ['5', 'Bolt']],
      preSeedSavedSources: [{ system: '4' }],
    });
    const account = makeAccount({
      fields: { username: 'partner', password: 'secret123', baseUrl: 'https://panel.inny-partner.pl' },
    });
    const logs = [];

    // Jak w tescie "usuwanie po aliasie": po zapisie Playwright w tym mocku potrafi
    // nie rozstrzygnac obietnicy - sprawdzamy logi i stan serwera, nie wynik funkcji.
    // Petla idzie bolt -> uber -> freenow -> boltfood; krok bolt jest przed jakimkolwiek
    // zapisem, wiec jego log jest deterministyczny.
    deleteReportsFromPartnerTax({ context, account, statusCallback: (m) => logs.push(m) }).catch(() => {});

    await expect
      .poll(() => logs.some((m) => m.startsWith('Brak raportu do usuniecia dla systemu: bolt ')), { timeout: 15_000 })
      .toBe(true);
    // Wiersz Bolt Food usuwa dopiero wlasciwy krok boltfood (inne ID niz w Nova).
    await expect.poll(() => mock.state.savedSources, { timeout: 15_000 }).toEqual([]);
  });
```

- [ ] **Step 4: Uruchom - nowe testy maja failowac**

Run: `npx playwright test tests/partnertax.stress.spec.js`
Expected: FAIL m.in. "inny partner" (route na `panel.inny-partner.pl` nigdy nie jest odwiedzony - kod idzie na nova-partner.pl), "brak adresu panelu" (kod nie rzuca), "upload wielu plikow" (stary komunikat "Nieznane miasto").

- [ ] **Step 5: Implementacja - naglowek i stale.** W `src/main/automation/platforms/partnertax.js` zastap linie 1 oraz 13-95 (od `const BASE_URL` do konca `resolveCompanyValue`) przez:

```js
const { waitForAuthStateToSettle, waitForLoginCompletion } = require('../loginHelpers');
const { matchOptionValue, findAllOptionValues } = require('../optionMatching');
const { normalizeBaseUrl, buildAdminUrls } = require('../../partnerTaxConfig');
```

(zachowaj `STEP_DELAY_MS` i `pause` miedzy nimi), a w miejscu dawnych stalych:

```js
// Teksty opcji pola "System" w formularzu Data source, po ktorych szukamy wlasciwego
// wpisu w panelu danego partnera (ID opcji to klucze bazy danych konkretnej instalacji -
// u kazdego partnera inne, dlatego nie trzymamy ich w kodzie). Pierwszy kandydat jest
// preferowany przy duplikatach - w panelu Nova sa np. "Bolt"=17 i archiwalne "BOLT"=65,
// a wlasciwym dla uploadu jest "Bolt". Przy usuwaniu akceptujemy wszystkie wpisy pasujace
// po normalizacji (raporty wgrane recznie bywaja pod archiwalnym wariantem - znalezione
// na zywo 2026-08-21).
const SYSTEM_LABEL_CANDIDATES = {
  bolt: ['Bolt'],
  uber: ['Uber'],
  freenow: ['Freenow'],
  boltfood: ['Bolt Food'],
};

/**
 * Opcje <select> odczytane z ukrytego wiersza-szablonu formsetu Django (patrz
 * realSourceFieldSelector) - jest zawsze w DOM i ma pelna liste opcji, wiec mozna
 * rozwiazac ID przed dodaniem wiersza i tak samo przy usuwaniu.
 */
async function readTemplateOptions(page, fieldSuffix) {
  const select = page.locator(`select[name="sources-__prefix__-${fieldSuffix}"]`);
  if ((await select.count()) === 0) {
    throw new Error(`Nie znaleziono pola "${fieldSuffix}" (sources-__prefix__-${fieldSuffix}) w formularzu rozliczenia PartnerTax admin.`);
  }
  return select.first().evaluate((el) =>
    Array.from(el.options).map((option) => ({ value: option.value, text: option.textContent }))
  );
}

async function resolveSourceValues(page, { platformId, city, company }) {
  const systemCandidates = SYSTEM_LABEL_CANDIDATES[platformId];
  if (!systemCandidates) {
    throw new Error(`Brak mapowania System dla platformy "${platformId}" w PartnerTax admin.`);
  }
  if (!city) {
    throw new Error('Brak miasta w konfiguracji konta - wymagane do wgrania pliku w PartnerTax admin.');
  }
  if (!company) {
    throw new Error('Brak firmy w konfiguracji konta - wymagane do wgrania pliku w PartnerTax admin.');
  }
  return {
    systemValue: matchOptionValue(await readTemplateOptions(page, 'system'), systemCandidates, { fieldName: 'System' }),
    cityValue: matchOptionValue(await readTemplateOptions(page, 'city'), [city], { fieldName: 'City' }),
    // Firmy w panelu maja forme prawna w nazwie ("UNITY DRIVE SP Z O O"), konta zwykle
    // nie ("Unity Drive") - jednoznaczne "zawiera" tylko dla tego pola.
    companyValue: matchOptionValue(await readTemplateOptions(page, 'company'), [company], { fieldName: 'Company', allowContains: true }),
  };
}

function resolveAdminUrls(account) {
  return buildAdminUrls(normalizeBaseUrl(account.fields.baseUrl));
}
```

Funkcja `normalizeTextKey` znika (zastapiona przez `normalizeForCompare` w optionMatching).

- [ ] **Step 6: Implementacja - login i lista rozliczen.**

`loginToPartnerTaxAdmin(page, account, statusCallback)` -> `loginToPartnerTaxAdmin(page, account, adminUrls, statusCallback)`, a w ciele `page.goto(LOGIN_URL, ...)` -> `page.goto(adminUrls.loginUrl, ...)`.

`openUnfinishedReckoning(page, statusCallback)` -> `openUnfinishedReckoning(page, adminUrls, statusCallback)`, a w ciele `page.goto(RECKONING_LIST_URL, ...)` -> `page.goto(adminUrls.reckoningListUrl, ...)`.

- [ ] **Step 7: Implementacja - upload wiersza.** W `addDataSourceFile` zastap poczatek (od `const systemValue = SYSTEM_OPTION_VALUES[platformId];` do `const companyValue = resolveCompanyValue(company);`) przez:

```js
  // Rozwiazujemy wszystkie trzy ID przed dodaniem wiersza - przy bledzie konfiguracji
  // (nieznane miasto, niejednoznaczny system) formularz zostaje nietkniety.
  const { systemValue, cityValue, companyValue } = await resolveSourceValues(page, { platformId, city, company });
```

Reszta funkcji (selectOption, `savedRowSelector` z `systemValue`, `clickSaveAndVerify`) bez zmian.

- [ ] **Step 8: Implementacja - upload calosci.** W `uploadToPartnerTax` przed `context.newPage()`:

```js
  const adminUrls = resolveAdminUrls(account);
```

i przekaz go dalej: `loginToPartnerTaxAdmin(page, account, adminUrls, statusCallback)`, `openUnfinishedReckoning(page, adminUrls, statusCallback)`.

- [ ] **Step 9: Implementacja - usuwanie.** Zastap poczatek `deleteDataSourceForSystem`:

```js
async function deleteDataSourceForSystem(page, platformId, adminUrls, statusCallback) {
  const log = (msg) => statusCallback?.(msg);
  const systemCandidates = SYSTEM_LABEL_CANDIDATES[platformId];
  if (!systemCandidates) {
    throw new Error(`Brak mapowania System dla platformy "${platformId}" w PartnerTax admin.`);
  }

  const reckoningLabel = await openUnfinishedReckoning(page, adminUrls, statusCallback);
  const acceptableValues = findAllOptionValues(await readTemplateOptions(page, 'system'), systemCandidates);
```

(dalej od `const rowValues = await getSystemRowValues(page);` bez zmian).

W `deleteReportsFromPartnerTax`: przed `context.newPage()` dodaj `const adminUrls = resolveAdminUrls(account);`, login wywolaj z `adminUrls`, petle zmien na `for (const platformId of Object.keys(SYSTEM_LABEL_CANDIDATES))` i wywolanie na `deleteDataSourceForSystem(page, platformId, adminUrls, statusCallback)`.

Popraw komentarze wspominajace `SYSTEM_OPTION_VALUES`/`SYSTEM_OPTION_ALIASES` (nad `deleteDataSourceForSystem` i `getSystemRowValues`): ID pochodza teraz z opcji odczytanych z panelu (`readTemplateOptions`).

Eksporty:

```js
module.exports = {
  uploadToPartnerTax,
  deleteReportsFromPartnerTax,
  SYSTEM_LABEL_CANDIDATES,
};
```

- [ ] **Step 10: Uruchom - ma przechodzic**

Run: `npx playwright test tests/partnertax.stress.spec.js`
Expected: 8 passed. Jesli test "usuwanie po aliasie systemu ... wisi" zmieni zachowanie (np. obietnica sie rozstrzyga) - NIE poprawiaj oczekiwan na slepo; sprawdz, czy `readTemplateOptions` widzi opcje 65 i czy `acceptableValues` = `['17','65']` (`superpowers:systematic-debugging`).

- [ ] **Step 11: Test regresji na zywych opcjach Nova** - `tests/novaOptionsRegression.spec.js`:

```js
const { test, expect } = require('playwright/test');
const nova = require('./fixtures/novaAdminOptions');
const { matchOptionValue, findAllOptionValues } = require('../src/main/automation/optionMatching');
const { SYSTEM_LABEL_CANDIDATES } = require('../src/main/automation/platforms/partnertax');

// ID zahardkodowane w partnertax.js przed refaktorem (2026-08-19) - dopasowanie po
// tekscie na zrzucie z zywego panelu Nova musi dawac dokladnie te same wartosci.
const OLD_SYSTEMS = { bolt: '17', uber: '32', freenow: '2', boltfood: '78' };
const OLD_CITIES = {
  'wroclaw': '7', 'warszawa': '8', 'legnica': '9', 'krakow': '10',
  'walbrzych/jelenia gora': '11', 'bialystok': '12', 'augustow/suwalki': '13', 'lubin': '14',
  'sulawki/augustow uber': '15', 'sulawki bolt': '16', 'poznan': '17', 'leszno': '18',
};
const OLD_COMPANIES = { 'unity drive': '5', 'da investment': '4' };

test.describe('Nova: dopasowanie po tekscie = dawne ID', () => {
  for (const [platformId, value] of Object.entries(OLD_SYSTEMS)) {
    test(`System ${platformId}`, () => {
      expect(matchOptionValue(nova.system, SYSTEM_LABEL_CANDIDATES[platformId], { fieldName: 'System' })).toBe(value);
    });
  }

  test('usuwanie Bolt obejmuje archiwalne "BOLT"=65, nie obejmuje Bolt Food', () => {
    const values = findAllOptionValues(nova.system, SYSTEM_LABEL_CANDIDATES.bolt);
    expect(values).toEqual(expect.arrayContaining(['17', '65']));
    expect(values).not.toContain('78');
  });

  for (const [city, value] of Object.entries(OLD_CITIES)) {
    test(`City ${city}`, () => {
      expect(matchOptionValue(nova.city, [city], { fieldName: 'City' })).toBe(value);
    });
  }

  for (const [company, value] of Object.entries(OLD_COMPANIES)) {
    test(`Company ${company}`, () => {
      expect(matchOptionValue(nova.company, [company], { fieldName: 'Company', allowContains: true })).toBe(value);
    });
  }
});
```

- [ ] **Step 12: Uruchom regresje**

Run: `npx playwright test tests/novaOptionsRegression.spec.js`
Expected: 19 passed (zweryfikowane recznie na zrzucie z Task 1). Fail oznacza blad implementacji dopasowania, nie danych - nie zmieniaj testu ani fixture, debuguj (`superpowers:systematic-debugging`).

- [ ] **Step 13: Commit**

```bash
git add src/main/automation/platforms/partnertax.js tests/mocks/partnerTaxAdminMock.js tests/partnertax.stress.spec.js tests/novaOptionsRegression.spec.js
git commit -m "Usun hardkody panelu Nova z PartnerTax admin: adres z konta, opcje po tekscie"
```

---

### Task 5: Pole adresu panelu w GUI i migracja przy starcie

**Files:**
- Modify: `src/main/platforms.js:60-67`
- Modify: `src/renderer/renderer.js:1-17` (`FIELD_LABELS`, `FIELD_TYPES`)
- Modify: `src/main/credentialStore.js` (nowa funkcja + eksport)
- Modify: `src/main/main.js:107-110` (`app.whenReady`)

**Interfaces:**
- Consumes: `applyLegacyBaseUrlMigration` (Task 3); `account.fields.baseUrl` czytane przez `partnertax.js` (Task 4).
- Produces: `credentialStore.runMigrations(): boolean` (true = zapisano zmiany).

- [ ] **Step 1: Definicja platformy.** W `src/main/platforms.js` wpis `partnertax`:

```js
  {
    id: 'partnertax',
    label: 'PartnerTax Admin',
    fields: ['baseUrl', 'username', 'password'],
    sensitiveFields: ['password'],
    multiAccount: false,
  },
```

(`loginUrl` usuniety - nie byl nigdzie czytany; adres jest teraz w koncie.)

- [ ] **Step 2: Etykieta w GUI.** W `src/renderer/renderer.js` dopisz do `FIELD_LABELS`:

```js
  baseUrl: 'Adres panelu PartnerTax (np. https://app.twoja-firma.pl)',
```

i do `FIELD_TYPES`:

```js
  baseUrl: 'text',
```

Nic wiecej w rendererze - `renderAccountCard` iteruje po `platform.fields`, a `baseUrl` nie jest wrazliwe, wiec `maskAccountForRenderer` odda wartosc jawnie.

- [ ] **Step 3: Migracja w magazynie.** W `src/main/credentialStore.js` dodaj import pod istniejacymi:

```js
const { applyLegacyBaseUrlMigration } = require('./partnerTaxConfig');
```

i funkcje przed `module.exports`:

```js
/**
 * Jednorazowe migracje formatu magazynu, uruchamiane przy starcie aplikacji. Czyta plik
 * scisle (bez fallbacku readRaw na {}), zeby uszkodzony plik nigdy nie zostal nadpisany
 * automatycznie - wtedy migracja jest pomijana i ponawiana przy nastepnym starcie.
 */
function runMigrations() {
  const filePath = getFilePath();
  let raw = {};
  if (fs.existsSync(filePath)) {
    try {
      raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return false;
    }
  }
  const { store, changed } = applyLegacyBaseUrlMigration(raw);
  if (changed) writeRaw(store);
  return changed;
}
```

Eksport: dopisz `runMigrations,` do `module.exports`.

- [ ] **Step 4: Wywolanie przy starcie.** W `src/main/main.js` w `app.whenReady().then(() => {` zaraz po `logger.info('Aplikacja wystartowala.');`:

```js
  try {
    if (credentialStore.runMigrations()) {
      logger.info('Migracja magazynu kont zakonczona.');
    }
  } catch (error) {
    logger.error(`Migracja magazynu kont nie powiodla sie: ${error.stack || error.message}`);
  }
```

- [ ] **Step 5: Weryfikacja reczna (brak testu jednostkowego - credentialStore wymaga Electrona; logika pokryta w Task 3).**

1. Zrob kopie `%APPDATA%\partnertax-automat\credentials.enc.json` (sciezka userData - potwierdz w logu aplikacji).
2. Upewnij sie, ze kopia NIE ma `_migrations` i konto `partnertax` nie ma `baseUrl`.
3. `npm start`. Expected: w logu "Migracja magazynu kont zakonczona."; w pliku konto `partnertax` ma `"baseUrl": { "enc": false, "value": "https://app.nova-partner.pl" }` i jest `"_migrations": { "partnertaxBaseUrl": true }`; haslo nadal dziala (zakladka PartnerTax pokazuje "Zapisano - zostaw puste aby nie zmieniac").
4. W zakladce PartnerTax widac pole "Adres panelu PartnerTax" z adresem Nova. Zmien na `panel.test.pl`, zapisz, uruchom usuwanie raportow -> blad polaczenia z `panel.test.pl` (dowod, ze adres z konta jest uzywany). Przywroc adres Nova.
5. Zamknij i uruchom ponownie - w logu brak komunikatu migracji (flaga dziala).

- [ ] **Step 6: Commit**

```bash
git add src/main/platforms.js src/renderer/renderer.js src/main/credentialStore.js src/main/main.js
git commit -m "Dodaj pole adresu panelu PartnerTax w koncie i migracje istniejacych kont"
```

---

### Task 6: Etykieta konta bez miasta - ostrzezenie zamiast blokady

**Files:**
- Modify: `src/main/automation/reportValidator.js:162-167` (koniec `validateDownloadedReport`)
- Modify: `src/main/main.js:213` (`sync:run`)
- Test: `tests/reportValidator.spec.js:187-194`

**Interfaces:**
- Produces: `validateDownloadedReport(...)` zwraca `{ warnings: string[] }` (dotad `undefined`); nadal rzuca `ReportValidationError` przy zlym tygodniu/firmie/formacie.

- [ ] **Step 1: Zmien test na nowe zachowanie** - zastap test "blokuje niespojnosc etykiety konta z miastem":

```js
  test('niespojnosc etykiety konta z miastem nie blokuje, tylko ostrzega', () => {
    const filePath = path.join('C:', 'downloads', 'bolt', 'x', 'Zarobki na kierowcę-31 sie 2026-1 wrz 2026-DA INVESTMENT SP_ Z O_O_.csv');
    const result = validateDownloadedReport({
      platformId: 'bolt',
      account: baseAccount({ label: 'Konto glowne' }),
      filePath,
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/nie zawiera skonfigurowanego miasta "Wrocław"/);
  });

  test('zgodny plik: brak ostrzezen', () => {
    const filePath = path.join('C:', 'downloads', 'bolt', 'x', 'Zarobki na kierowcę-31 sie 2026-1 wrz 2026-DA INVESTMENT SP_ Z O_O_.csv');
    expect(validateDownloadedReport({ platformId: 'bolt', account: baseAccount(), filePath }).warnings).toEqual([]);
  });
```

- [ ] **Step 2: Uruchom - ma failowac**

Run: `npx playwright test tests/reportValidator.spec.js`
Expected: FAIL - `ReportValidationError: Niespojna konfiguracja konta...` oraz `Cannot read properties of undefined (reading 'warnings')`.

- [ ] **Step 3: Implementacja.** W `reportValidator.js` zastap ostatni blok `if (!labelMatchesCity(...)) { throw ... }` przez:

```js
  // Etykieta zawierajaca miasto to konwencja nazewnicza czesci partnerow (np. Nova:
  // "DA Investment - Wroclaw"), nie regula biznesowa - inny partner moze nazywac konta
  // dowolnie. Dlatego tylko ostrzegamy, zamiast blokowac upload.
  const warnings = [];
  if (!labelMatchesCity(account.label, account.city)) {
    warnings.push(
      `Etykieta konta "${account.label}" nie zawiera skonfigurowanego miasta "${account.city}" - sprawdz, czy miasto w koncie jest poprawne.`
    );
  }
  return { warnings };
```

W `main.js` w `sync:run` zastap linie `validateDownloadedReport({ platformId, account, filePath: result.filePath });` przez:

```js
    const { warnings } = validateDownloadedReport({ platformId, account, filePath: result.filePath });
    for (const warning of warnings) {
      logger.warn(`${logPrefix} ${warning}`);
      event.sender.send('sync:status', { platformId, accountId, message: `Uwaga: ${warning}` });
    }
```

- [ ] **Step 4: Uruchom - ma przechodzic**

Run: `npx playwright test tests/reportValidator.spec.js`
Expected: wszystkie passed.

- [ ] **Step 5: Commit**

```bash
git add src/main/automation/reportValidator.js src/main/main.js tests/reportValidator.spec.js
git commit -m "Zamien blokade etykiety konta bez miasta na ostrzezenie"
```

---

### Task 7: Dokumentacja, pelny zestaw testow i test na zywo

**Files:**
- Modify: `docs/superpowers/specs/2026-09-14-multi-partner-support-findings.md` (sekcja "Status")
- Modify: `ARCHITEKTURA.md` (jesli opisuje PartnerTax/adres Nova)

- [ ] **Step 1: Pelny zestaw**

Run: `npm test`
Expected: wszystkie passed (stress testy kilka minut). Porownaj z wynikiem bazowym z "Przed startem".

- [ ] **Step 2: Resztki hardkodow**

Run: `git grep -n -i "nova-partner\|OPTION_VALUES\|OPTION_ALIASES" -- src`
Expected: tylko `LEGACY_NOVA_BASE_URL` w `src/main/partnerTaxConfig.js`.

- [ ] **Step 3: Dokumentacja.** `git grep -n -i "nova\|app.nova-partner\|CITY_OPTION" -- ARCHITEKTURA.md` - popraw trafienia na opis: adres panelu w koncie PartnerTax, ID opcji odczytywane z panelu po tekscie. W findings zastap sekcje "Status":

```markdown
## Status

Zaimplementowane wg planu `docs/superpowers/plans/2026-09-14-multi-partner-support.md`:
adres panelu jest polem konta PartnerTax (migracja istniejacych kont Nova przy starcie),
ID System/City/Company sa odczytywane z szablonu formsetu i dopasowywane po tekscie
(dokladny tekst > normalizacja, niejednoznacznosc = blad). Regula "etykieta zawiera
miasto" jest ostrzezeniem. Niezweryfikowane na drugiej instalacji: filtr "False" na
liscie rozliczen.
```

- [ ] **Step 4: Test na zywo z uzytkownikiem (Nova).** Uzytkownik uruchamia `npm start` na swoich danych:
  1. Zakladka PartnerTax pokazuje adres `https://app.nova-partner.pl`.
  2. Pobierz jeden raport Bolt i wgraj do PartnerTax -> w panelu nowy Data source z System "Bolt" (nie "BOLT"), wlasciwym miastem i firma.
  3. Usun raporty -> wiersz Bolt znika, Bolt Food (jesli jest) zostaje.
  Kazda rozbieznosc: `superpowers:systematic-debugging`, nie latac na slepo.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-09-14-multi-partner-support-findings.md ARCHITEKTURA.md
git commit -m "Zaktualizuj dokumentacje po wsparciu wielu instalacji PartnerTax admin"
```
