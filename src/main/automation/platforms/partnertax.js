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
 * Otwiera liste rozliczen i wchodzi w pierwsze z kolumna Finished = False (to ono
 * przyjmuje nowe raporty - zweryfikowane na zrzucie ekranu listy od klienta, 2026-08-19).
 */
async function openUnfinishedReckoning(page, statusCallback) {
  const log = (msg) => statusCallback?.(msg);
  log('Szukam niezakonczonego rozliczenia (Finished = False)...');
  await page.goto(RECKONING_LIST_URL, { waitUntil: 'domcontentloaded' });

  const row = page.locator('#result_list tbody tr').filter({ hasText: 'False' }).first();
  if ((await row.count()) === 0) {
    throw new Error('Nie znaleziono zadnego rozliczenia z Finished = False na liscie.');
  }

  const link = row.getByRole('link').first();
  const reckoningLabel = (await link.textContent())?.trim();
  log(`Otwieram rozliczenie: ${reckoningLabel || '(bez etykiety)'}`);
  await pause(page);
  await link.click();
  await page.waitForLoadState('domcontentloaded');
  await pause(page);
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

  // Jezyk przycisku tez zalezy od sesji (patrz komentarz w addDataSourceRow) - PL:
  // "Zapisz i kontynuuj edycję".
  await page.getByRole('button', { name: /save and continue editing|zapisz i kontynuuj edycj/i }).click();
  await page.waitForLoadState('domcontentloaded');
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

  for (const upload of uploads) {
    await addDataSourceFile(page, upload, statusCallback);
  }

  log(`Wszystkie pliki wgrane (${uploads.length}).`);
  await page.close();
}

module.exports = { uploadToPartnerTax, SYSTEM_OPTION_VALUES, CITY_OPTION_VALUES, COMPANY_OPTION_VALUES };
