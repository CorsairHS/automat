const { waitForAuthStateToSettle, waitForLoginCompletion } = require('../loginHelpers');

// Krotka pauza miedzy kolejnymi krokami formularza - bez niej automat klika/wypelnia
// pola szybciej niz strona nadaza (animacje formsetu, re-render po selectOption), a
// tempo jest tez po prostu nienaturalnie szybkie do obserwowania na zywo w widocznym
// oknie przegladarki.
const STEP_DELAY_MS = 700;

async function pause(page, ms = STEP_DELAY_MS) {
  await page.waitForTimeout(ms);
}

const BASE_URL = 'https://app.nova-partner.pl';
const LOGIN_URL = `${BASE_URL}/admin/`;
const RECKONING_LIST_URL = `${BASE_URL}/admin/finances/reckoning/`;

// Wartosci <option value="..."> pola "System" w formularzu Data source (zweryfikowane
// na zrzucie ekranu DOM od klienta, 2026-08-19). Lista ma tez warianty
// archiwalne/duplikaty (np. "BOLT"=65 obok "Bolt"=17, "iTaxi correction file" itp.) -
// uzywamy podstawowych wpisow wskazanych przez klienta jako wlasciwe dla biezacego
// przeplywu (Bolt/Uber/FreeNow).
const SYSTEM_OPTION_VALUES = {
  bolt: '17',
  uber: '32',
  freenow: '2',
};

// Przy usuwaniu trzeba dopasowac tez warianty/duplikaty tego samego systemu (patrz
// komentarz wyzej) - np. istniejacy raport moze byc zapisany pod "BOLT"=65 zamiast
// "Bolt"=17, jesli zostal wgrany recznie przez klienta, nie przez ten automat (ktory
// zawsze uzywa kanonicznej wartosci z SYSTEM_OPTION_VALUES przy uploadzie). Znalezione
// na zywo 2026-08-21: rozliczenie z raportem Bolt zapisanym jako System=65.
const SYSTEM_OPTION_ALIASES = {
  bolt: ['17', '65'],
  uber: ['32'],
  freenow: ['2'],
};

// Wartosci <option value="..."> pola "City" (zweryfikowane na zrzucie ekranu DOM,
// 2026-08-19). Dopasowanie po nazwie miasta z konfiguracji konta (case-insensitive,
// diakrytyki obojetne). Lista nie jest kompletna dla wszystkich mozliwych miast -
// rozszerzac w miare potrzeb, gdy pojawi sie nowe konto z nieobslugiwanym miastem.
const CITY_OPTION_VALUES = {
  'wroclaw': '7',
  'warszawa': '8',
  'legnica': '9',
  'krakow': '10',
  'walbrzych/jelenia gora': '11',
  'bialystok': '12',
  'augustow/suwalki': '13',
  'lubin': '14',
  'sulawki/augustow uber': '15',
  'sulawki bolt': '16',
  'poznan': '17',
  'leszno': '18',
};

// Wartosci <option value="..."> pola "Company" (zweryfikowane na zrzucie ekranu DOM,
// 2026-08-19). Lista zawiera tylko firmy klienta demo - kolejne firmy innych partnerow
// trzeba tu dopisywac w miare potrzeb (dopasowanie po nazwie z konfiguracji konta).
const COMPANY_OPTION_VALUES = {
  'unity drive': '5',
  'da investment': '4',
};

function normalizeTextKey(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (ch) => ({ ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' }[ch] || ch));
}

function resolveCityValue(cityName) {
  if (!cityName) {
    throw new Error('Brak miasta w konfiguracji konta - wymagane do wgrania pliku w PartnerTax admin.');
  }
  const value = CITY_OPTION_VALUES[normalizeTextKey(cityName)];
  if (!value) {
    throw new Error(`Nieznane miasto dla PartnerTax admin: "${cityName}". Dopisz je do CITY_OPTION_VALUES w partnertax.js.`);
  }
  return value;
}

function resolveCompanyValue(companyName) {
  if (!companyName) {
    throw new Error('Brak firmy w konfiguracji konta - wymagane do wgrania pliku w PartnerTax admin.');
  }
  const value = COMPANY_OPTION_VALUES[normalizeTextKey(companyName)];
  if (!value) {
    throw new Error(`Nieznana firma dla PartnerTax admin: "${companyName}". Dopisz ja do COMPANY_OPTION_VALUES w partnertax.js.`);
  }
  return value;
}

/**
 * Django admin login (formularz standardowy: #id_username / #id_password). Sesja
 * trzymana w trwalym kontekscie przegladarki (jak inne platformy), wiec kolejne
 * uruchomienia zwykle pomijaja ten krok.
 */
async function loginToPartnerTaxAdmin(page, account, statusCallback) {
  const log = (msg) => statusCallback?.(msg);
  const isLoggedIn = () => !/\/admin\/login\//.test(page.url());
  const isLoginFormVisible = () => page.locator('#id_username').isVisible().catch(() => false);

  log('Otwieram PartnerTax admin...');
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await waitForAuthStateToSettle(page, { isLoggedIn, isLoginFormVisible });

  if (!isLoggedIn()) {
    log('Loguje sie do PartnerTax admin...');
    await page.locator('#id_username').fill(account.fields.username);
    await pause(page);
    await page.locator('#id_password').fill(account.fields.password);
    await pause(page);
    await page.getByRole('button', { name: /log in|zaloguj/i }).click();

    const loggedIn = await waitForLoginCompletion(page, { isLoggedIn, statusCallback });
    if (!loggedIn) {
      throw new Error('Logowanie do PartnerTax admin nie powiodlo sie w wyznaczonym czasie.');
    }
  }
}

/**
 * Panel admina (motyw Tailwind, doladowuje tresc po stronie klienta) potrafi "zawiesic
 * sie" na spinnerze ladowania przy przejsciu miedzy stronami (zaobserwowane na zywo u
 * klienta) - dotychczasowym rozwiazaniem partnera bylo reczne przeladowanie calej
 * aplikacji i ponowna proba. Ta funkcja robi to samo automatycznie: gdy `action` (goto
 * lub klikniecie linku) nie zdazy zaladowac strony w rozsadnym czasie, probuje ponownie
 * zamiast od razu przerywac caly proces.
 */
async function withPageLoadRetry(page, action, { attempts = 5, statusCallback } = {}) {
  const log = (msg) => statusCallback?.(msg);
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await action();
      return;
    } catch (error) {
      lastError = error;
      log(`Strona nie odpowiada (proba ${i + 1}/${attempts}) - ponawiam...`);
    }
  }
  throw lastError;
}

/**
 * Otwiera liste rozliczen i wchodzi w pierwsze z kolumna Finished = False (to ono
 * przyjmuje nowe raporty - zweryfikowane na zrzucie ekranu listy od klienta, 2026-08-19).
 */
async function openUnfinishedReckoning(page, statusCallback) {
  const log = (msg) => statusCallback?.(msg);
  log('Szukam niezakonczonego rozliczenia (Finished = False)...');
  await withPageLoadRetry(
    page,
    () => page.goto(RECKONING_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }),
    { statusCallback },
  );

  const row = page.locator('#result_list tbody tr').filter({ hasText: 'False' }).first();
  if ((await row.count()) === 0) {
    throw new Error('Nie znaleziono zadnego rozliczenia z Finished = False na liscie.');
  }

  const link = row.getByRole('link').first();
  const reckoningLabel = (await link.textContent())?.trim();
  log(`Otwieram rozliczenie: ${reckoningLabel || '(bez etykiety)'}`);
  await pause(page);
  await withPageLoadRetry(
    page,
    async () => {
      await link.click({ timeout: 30000 });
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    },
    { statusCallback },
  );
  await pause(page);
  return reckoningLabel || '(bez etykiety)';
}

/**
 * Django trzyma w DOM tez ukryty wiersz-szablon formsetu ("empty form", uzywany przez
 * JS do klonowania nowych wierszy) z indeksem literalnym "__prefix__" zamiast liczby
 * (np. name="sources-__prefix__-system") - zawsze niewidoczny, ale pasuje do prostych
 * selektorow po prefiksie/sufiksie nazwy, wiec `.last()` na goly `select[name^="sources-"]...`
 * czasem trafial w ten szablon zamiast w prawdziwy nowo dodany wiersz (obserwowane na
 * zywo: timeout "element is not visible" na `sources-__prefix__-system`). Wykluczamy
 * ten wiersz jawnie.
 */
function realSourceFieldSelector(tag, fieldSuffix) {
  return `${tag}[name^="sources-"][name$="-${fieldSuffix}"]:not([name*="__prefix__"])`;
}

/**
 * Klika "Save and continue editing" i czeka na potwierdzenie zapisu. Zapis (zwlaszcza z
 * duzym plikiem lub przy wolniejszym lączu klienta) potrafi trwac dluzej niz Playwright
 * jest w stanie wiarygodnie wykryc jako "trwajaca nawigacja" - zamiast przerywac caly
 * upload twardym timeoutem (zaobserwowane na zywo 2026-08-21: proces "wisial", a potem
 * wywalal sie bledem mimo ze serwer zdazyl juz zapisac plik), po kazdej nieudanej probie
 * wykrycia przeladowania odswiezamy strone recznie i sprawdzamy `verifyFn` - jesli zapis
 * mimo wszystko doszedl do skutku po stronie serwera, kontynuujemy zamiast przerywac caly
 * proces.
 */
async function clickSaveAndVerify(page, verifyFn, { timeoutMs = 15 * 60 * 1000, pollTimeoutMs = 20000, statusCallback } = {}) {
  const log = (msg) => statusCallback?.(msg);
  const url = page.url();
  await page.getByRole('button', { name: /save and continue editing|zapisz i kontynuuj edycj/i }).click({ noWaitAfter: true });

  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: pollTimeoutMs });
    } catch {
      attempt += 1;
      // Panel admina po zapisie potrafi "wisiec" (spinner ladowania bez konca) mimo ze
      // serwer juz zapisal dane - zamiast czekac bezczynnie, aktywnie odswiezamy strone i
      // sprawdzamy stan (verifyFn) - to samo, co partner robil dotad recznie ("przeladuj
      // appke i sprobuj jeszcze raz"), tylko automatycznie i bez utraty postepu.
      log(`Strona nie odpowiada (proba ${attempt}) - odswiezam i sprawdzam, czy zapis sie powiodl...`);
      await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    }
    if (await verifyFn()) return;
    await page.waitForTimeout(1000);
  }
  throw new Error('Zapis w PartnerTax admin nie zostal potwierdzony w wyznaczonym czasie.');
}

/**
 * Klika "Add another Data source" (dodaje kolejny wiersz formsetu Django) i czeka az
 * nowy wiersz faktycznie pojawi sie w DOM, zanim cokolwiek wypelnimy w nim - formset
 * dolacza wiersz po stronie JS, wiec bez tego czekania trafialibysmy w poprzedni wiersz.
 *
 * UWAGA: jezyk UI admina zalezy od jezyka przegladarki/sesji, nie jest staly (obserwowane
 * 2026-08-19: klient widzi PL w swojej przegladarce, automat z domyslnym profilem
 * Playwright dostal EN) - jak w Bolcie/Uberze/FreeNow dopasowujemy oba warianty tekstu.
 * Polski tekst linku to doslownie "Dodaj kolejne(go)(-ną)(-ny) Źródło danych" (dziwna
 * skladnia z nawiasami - wyglada na nierozwiniety szablon i18n z wariantami rodzaju),
 * wiec dopasowujemy tylko stabilny prefiks "Dodaj kolejne".
 */
async function addDataSourceRow(page) {
  const systemSelectSelector = realSourceFieldSelector('select', 'system');
  const beforeCount = await page.locator(systemSelectSelector).count();
  await page.getByRole('link', { name: /add another data source|dodaj kolejne/i }).click();
  await page.waitForFunction(
    ({ selector, beforeCount: prevCount }) => document.querySelectorAll(selector).length > prevCount,
    { selector: systemSelectSelector, beforeCount },
  );
  await pause(page);
}

/**
 * Dodaje jeden plik zrodlowy jako nowy Data source w otwartym formularzu rozliczenia
 * i zapisuje formularz. KRYTYCZNE (wskazane wprost przez klienta): trzeba kliknac
 * "Save and continue editing" po KAZDYM pliku, inaczej wgrany raport sie nie zapisuje.
 */
async function addDataSourceFile(page, { platformId, city, company, filePath }, statusCallback) {
  const log = (msg) => statusCallback?.(msg);
  const systemValue = SYSTEM_OPTION_VALUES[platformId];
  if (!systemValue) {
    throw new Error(`Brak mapowania System dla platformy "${platformId}" w PartnerTax admin.`);
  }
  const cityValue = resolveCityValue(city);
  const companyValue = resolveCompanyValue(company);

  log(`Dodaje Data source: system=${platformId}, miasto=${city}, firma=${company}, plik=${filePath}...`);
  await addDataSourceRow(page);

  await page.locator(realSourceFieldSelector('select', 'system')).last().selectOption(systemValue);
  await pause(page);
  await page.locator(realSourceFieldSelector('select', 'city')).last().selectOption(cityValue);
  await pause(page);
  await page.locator(realSourceFieldSelector('select', 'company')).last().selectOption(companyValue);
  await pause(page);
  await page.locator(realSourceFieldSelector('input[type="file"]', 'file')).last().setInputFiles(filePath);
  await pause(page);

  // Wiersz jeszcze niezapisany ma pole System jako <select>; po zapisie Django admin
  // pokazuje go jako readonly link do "/admin/systems/system/<id>/change/" (patrz
  // getSystemRowValues) - liczymy takie linki dla danego systemu PRZED zapisem, zeby po
  // odswiezeniu strony (patrz clickSaveAndVerify) sprawdzic, czy przybyl kolejny -
  // to potwierdza zapis niezaleznie od tego, czy Playwright wykryl przeladowanie na czas.
  const savedRowSelector = `a[href="/admin/systems/system/${systemValue}/change/"]`;
  const beforeSavedCount = await page.locator(savedRowSelector).count();

  await clickSaveAndVerify(
    page,
    async () => (await page.locator(savedRowSelector).count()) > beforeSavedCount,
    { statusCallback },
  );
  await pause(page);
  log('Zapisano ("Save and continue editing" / "Zapisz i kontynuuj edycję").');
}

/**
 * Loguje sie do PartnerTax admin, otwiera pierwsze niezakonczone rozliczenie (Finished
 * = False) i wgrywa podana liste plikow zrodlowych - po jednym Data source per wpis,
 * zapisujac formularz po kazdym (wymog PartnerTax admin, patrz addDataSourceFile).
 * uploads: [{ platformId: 'bolt'|'uber'|'freenow', city: string, company: string, filePath: string }]
 */
async function uploadToPartnerTax({ context, account, uploads, statusCallback }) {
  const log = (msg) => statusCallback?.(msg);
  const page = await context.newPage();

  await loginToPartnerTaxAdmin(page, account, statusCallback);
  await openUnfinishedReckoning(page, statusCallback);

  // Jesli ktorys plik zawiedzie w polowie (np. platforma z bledem walidacji), pliki
  // dodane wczesniej w tej samej petli sa juz trwale zapisane po stronie serwera -
  // zwracamy je nawet przy bledzie (przez error.succeededUploads), zeby wywolujacy (patrz
  // main.js) mogl je wykreslic z listy "do wgrania" i retry nie dodawal ich powtornie
  // (zaobserwowane na zywo 2026-08-21: po bledzie i ponownym uruchomieniu Uber zostal
  // dodany drugi raz, bo caly upload byl liczony jako "nieudany" i retry probowal wgrac
  // wszystko od nowa).
  const succeeded = [];
  try {
    for (const upload of uploads) {
      await addDataSourceFile(page, upload, statusCallback);
      succeeded.push(upload);
    }
  } catch (error) {
    error.succeededUploads = succeeded;
    throw error;
  } finally {
    await page.close();
  }

  log(`Wszystkie pliki wgrane (${uploads.length}).`);
}

/**
 * Usuwa jeden wiersz Data source dla danej platformy (Bolt/Uber/FreeNow, wg
 * SYSTEM_OPTION_VALUES) z aktualnie otwartego rozliczenia: zaznacza jego checkbox DELETE
 * (`sources-N-DELETE`) i zapisuje formularz ("Save and continue editing" - jak przy
 * dodawaniu pliku, ten sam wymog PartnerTax admin). Usuwa TYLKO pierwszy pasujacy wiersz
 * na wywolanie - klient wskazal wprost, ze kasuje sie po jednym rekordzie na raz i sciezke
 * (otworz rozliczenie -> znajdz system -> zaznacz DELETE -> zapisz) powtarza sie osobno
 * dla kazdego systemu. Zwraca false, jesli dla danej platformy nie ma zadnego wiersza do
 * usuniecia (nic sie wtedy nie zmienia w formularzu).
 */
/**
 * Zwraca wartosc System (ID z SYSTEM_OPTION_VALUES) dla kazdego wiersza Data source w
 * kolejnosci wystapienia w formularzu. Juz zapisane wiersze pokazuja pole System jako
 * readonly link do "/admin/systems/system/<id>/change/" (nie <select> - selecty sa tylko
 * na nowo dodanym, jeszcze niezapisanym wierszu, patrz addDataSourceRow) - ID w hrefie
 * odpowiada dokladnie wartosciom w SYSTEM_OPTION_VALUES. Dla ewentualnego swiezo dodanego,
 * niezapisanego jeszcze wiersza (select, nie link) wartosc dolaczana jest tak samo, zeby
 * kolejnosc/indeksy pokrywaly sie z kolejnoscia checkboxow DELETE w formularzu.
 */
async function getSystemRowValues(page) {
  const rowValues = [];
  const rows = page.locator(
    `${realSourceFieldSelector('select', 'system')}, a[href^="/admin/systems/system/"][href$="/change/"]`,
  );
  const count = await rows.count();
  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    const tagName = await row.evaluate((el) => el.tagName.toLowerCase());
    if (tagName === 'select') {
      rowValues.push(await row.inputValue());
    } else {
      const href = await row.getAttribute('href');
      const idMatch = href?.match(/\/systems\/system\/(\d+)\/change\//);
      rowValues.push(idMatch ? idMatch[1] : null);
    }
  }
  return rowValues;
}

async function deleteDataSourceForSystem(page, platformId, statusCallback) {
  const log = (msg) => statusCallback?.(msg);
  const acceptableValues = SYSTEM_OPTION_ALIASES[platformId];
  if (!acceptableValues) {
    throw new Error(`Brak mapowania System dla platformy "${platformId}" w PartnerTax admin.`);
  }

  const reckoningLabel = await openUnfinishedReckoning(page, statusCallback);

  const rowValues = await getSystemRowValues(page);
  const rowCount = rowValues.length;
  const matchedIndex = rowValues.findIndex((value) => acceptableValues.includes(value));

  if (matchedIndex === -1) {
    const diagnostic = `${platformId}: brak w rozliczeniu "${reckoningLabel}" (szukane System=[${acceptableValues.join(', ')}], wierszy=${rowCount}, wartosci=[${rowValues.join(', ')}])`;
    log(`Brak raportu do usuniecia dla systemu: ${platformId} (${diagnostic}).`);
    return { deleted: false, diagnostic };
  }

  log(`Usuwam raport dla systemu: ${platformId}...`);
  const deleteCheckbox = page.locator(realSourceFieldSelector('input[type="checkbox"]', 'DELETE')).nth(matchedIndex);
  // Wiersze Data source sa zwiniete w sekcje (kazdy system to osobny naglowek typu
  // "BOLT : 2026-08-20 - 2026-08-20" na zrzucie ekranu od klienta) - checkbox DELETE dla
  // zwinietej sekcji jest w DOM, ale ma display:none (potwierdzone live testem: nawet
  // check({force:true}) rzuca "Element is not visible" od razu, bo Playwright nie potrafi
  // wyliczyc punktu klikniecia bez bounding boxa). Zamiast klikac mysza, ustawiamy
  // .checked bezposrednio w DOM i wysylamy 'change'/'input' - dziala niezaleznie od tego,
  // czy sekcja jest wizualnie rozwinieta, a formularz i tak wysyla stan checkboxa przy
  // zapisie niezaleznie od jego widocznosci.
  await deleteCheckbox.evaluate((el) => {
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await pause(page);

  const isChecked = await deleteCheckbox.isChecked();
  if (!isChecked) {
    const diagnostic = `${platformId}: checkbox DELETE (wiersz ${matchedIndex}) nie zaznaczyl sie po check({force:true}) - mozliwe ze jest disabled.`;
    log(`Nie udalo sie zaznaczyc DELETE dla systemu: ${platformId} (${diagnostic}).`);
    return { deleted: false, diagnostic };
  }

  await clickSaveAndVerify(
    page,
    async () => (await getSystemRowValues(page)).length < rowCount,
    { statusCallback },
  );
  await pause(page);
  log(`Usunieto raport dla systemu: ${platformId}.`);
  return { deleted: true, diagnostic: null };
}

/**
 * Loguje sie do PartnerTax admin i usuwa po jednym Data source dla Uber/Bolt/FreeNow
 * z pierwszego niezakonczonego rozliczenia (Finished = False) - nic innego (inne systemy
 * na liscie, np. archiwalne wpisy, pozostaja nietkniete). Kazde usuniecie to osobny
 * przejazd sciezki otworz rozliczenie -> zaznacz DELETE -> zapisz, bo formularz przeladowuje
 * sie po kazdym zapisie.
 */
async function deleteReportsFromPartnerTax({ context, account, statusCallback }) {
  const log = (msg) => statusCallback?.(msg);
  const page = await context.newPage();

  await loginToPartnerTaxAdmin(page, account, statusCallback);

  let deletedCount = 0;
  const diagnostics = [];
  for (const platformId of Object.keys(SYSTEM_OPTION_VALUES)) {
    const result = await deleteDataSourceForSystem(page, platformId, statusCallback);
    if (result.deleted) {
      deletedCount += 1;
    } else {
      diagnostics.push(result.diagnostic);
    }
  }

  log(`Usunieto raportow: ${deletedCount}.`);
  await page.close();
  return { deletedCount, diagnostics };
}

module.exports = {
  uploadToPartnerTax,
  deleteReportsFromPartnerTax,
  SYSTEM_OPTION_VALUES,
  CITY_OPTION_VALUES,
  COMPANY_OPTION_VALUES,
};
