const { waitForAuthStateToSettle, waitForLoginCompletion } = require('../loginHelpers');
const { matchOptionValue, findAllOptionValues } = require('../optionMatching');
const { normalizeBaseUrl, buildAdminUrls } = require('../../partnerTaxConfig');

// Krotka pauza miedzy kolejnymi krokami formularza - bez niej automat klika/wypelnia
// pola szybciej niz strona nadaza (animacje formsetu, re-render po selectOption), a
// tempo jest tez po prostu nienaturalnie szybkie do obserwowania na zywo w widocznym
// oknie przegladarki.
const STEP_DELAY_MS = 700;

async function pause(page, ms = STEP_DELAY_MS) {
  await page.waitForTimeout(ms);
}

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

/**
 * Django admin login (formularz standardowy: #id_username / #id_password). Sesja
 * trzymana w trwalym kontekscie przegladarki (jak inne platformy), wiec kolejne
 * uruchomienia zwykle pomijaja ten krok.
 */
async function loginToPartnerTaxAdmin(page, account, adminUrls, statusCallback) {
  const log = (msg) => statusCallback?.(msg);
  const isLoggedIn = () => !/\/admin\/login\//.test(page.url());
  const isLoginFormVisible = () => page.locator('#id_username').isVisible().catch(() => false);

  log('Otwieram PartnerTax admin...');
  await page.goto(adminUrls.loginUrl, { waitUntil: 'domcontentloaded' });
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
async function openUnfinishedReckoning(page, adminUrls, statusCallback) {
  const log = (msg) => statusCallback?.(msg);
  log('Szukam niezakonczonego rozliczenia (Finished = False)...');
  await withPageLoadRetry(
    page,
    () => page.goto(adminUrls.reckoningListUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }),
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
    // Django odrzucil formularz (np. blad walidacji innego wiersza) - zapis nigdy nie
    // zostanie potwierdzony, wiec zamiast czekac do konca timeoutu (wyglada jak
    // zawieszenie) konczymy od razu z tekstem bledu ze strony.
    const errorText = await page
      .locator('.errornote')
      .evaluateAll((els) => els.map((el) => el.textContent).join(' '))
      .catch(() => null);
    if (errorText) {
      throw new Error(`PartnerTax admin odrzucil zapis: ${errorText.trim()}`);
    }
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
  // Rozwiazujemy wszystkie trzy ID przed dodaniem wiersza - przy bledzie konfiguracji
  // (nieznane miasto, niejednoznaczny system) formularz zostaje nietkniety.
  const { systemValue, cityValue, companyValue } = await resolveSourceValues(page, { platformId, city, company });

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
  const adminUrls = resolveAdminUrls(account);
  const page = await context.newPage();

  await loginToPartnerTaxAdmin(page, account, adminUrls, statusCallback);
  await openUnfinishedReckoning(page, adminUrls, statusCallback);

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
 * Zwraca wartosc System (ID opcji odczytanej z panelu, patrz readTemplateOptions) dla
 * kazdego wiersza Data source w kolejnosci wystapienia w formularzu. Juz zapisane wiersze
 * pokazuja pole System jako readonly link do "/admin/systems/system/<id>/change/" (nie
 * <select> - selecty sa tylko na nowo dodanym, jeszcze niezapisanym wierszu, patrz
 * addDataSourceRow) - ID w hrefie odpowiada dokladnie wartosciom opcji z panelu. Dla
 * ewentualnego swiezo dodanego, niezapisanego jeszcze wiersza (select, nie link) wartosc
 * dolaczana jest tak samo, zeby kolejnosc/indeksy pokrywaly sie z kolejnoscia checkboxow
 * DELETE w formularzu.
 *
 * Odczyt jest JEDNYM atomowym evaluateAll. Wczesniej bylo count() + osobne
 * nth(i).evaluate() na kazdy wiersz - gdy strona przeladowala sie po zapisie miedzy tymi
 * wywolaniami (wierszy jest juz mniej), nth(i) czekal w nieskonczonosc na element, ktory
 * juz nie istnieje. To bylo zglaszane przez klienta "przy usuwaniu system sie zawiesza i
 * nie dziala dalej". Zwraca null, gdy strona jest akurat w trakcie nawigacji (wolajacy
 * po prostu ponawia).
 */
async function getSystemRowValues(page) {
  try {
    return await page
      .locator(`${realSourceFieldSelector('select', 'system')}, a[href^="/admin/systems/system/"][href$="/change/"]`)
      .evaluateAll((elements) =>
        elements.map((el) => {
          if (el.tagName.toLowerCase() === 'select') return el.value;
          const idMatch = el.getAttribute('href')?.match(/\/systems\/system\/(\d+)\/change\//);
          return idMatch ? idMatch[1] : null;
        }),
      );
  } catch {
    return null;
  }
}

async function readSystemRowValues(page, { attempts = 10 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    const values = await getSystemRowValues(page);
    if (values) return values;
    await page.waitForTimeout(1000);
  }
  throw new Error('Nie udalo sie odczytac wierszy Data source z formularza rozliczenia.');
}

/**
 * Loguje sie do PartnerTax admin i usuwa WSZYSTKIE wiersze Data source dla
 * Uber/Bolt/FreeNow/Bolt Food z pierwszego niezakonczonego rozliczenia (Finished =
 * False) - nic innego (inne systemy na liscie, np. Ebi24/Circle K/NovaPartner, zostaja
 * nietkniete).
 *
 * Wszystkie pasujace checkboxy DELETE sa zaznaczane naraz i formularz jest zapisywany
 * RAZ ("Save and continue editing" - standardowy formset Django usuwa wtedy wszystkie
 * zaznaczone wiersze). Wczesniej kazdy wiersz to byl osobny zapis + przeladowanie calego
 * (duzego, ~30 wierszy) formularza rozliczenia - przy kilkudziesieciu kontach klienta
 * trwalo to bardzo dlugo i bylo podatne na zawieszenie (patrz getSystemRowValues). Petla
 * przebiegow to tylko zabezpieczenie: jesli po zapisie cos pasujacego jeszcze zostalo,
 * kolejny przebieg to dokasuje.
 */
async function deleteReportsFromPartnerTax({ context, account, statusCallback }) {
  const log = (msg) => statusCallback?.(msg);
  const adminUrls = resolveAdminUrls(account);
  const page = await context.newPage();

  await loginToPartnerTaxAdmin(page, account, adminUrls, statusCallback);

  let deletedCount = 0;
  const diagnostics = [];
  const MAX_PASSES = 3;
  for (let pass = 1; pass <= MAX_PASSES; pass += 1) {
    const reckoningLabel = await openUnfinishedReckoning(page, adminUrls, statusCallback);
    const systemOptions = await readTemplateOptions(page, 'system');
    const rowValues = await readSystemRowValues(page);

    const matchedIndices = [];
    for (const [platformId, systemCandidates] of Object.entries(SYSTEM_LABEL_CANDIDATES)) {
      const acceptableValues = findAllOptionValues(systemOptions, systemCandidates);
      const indices = rowValues
        .map((value, index) => (acceptableValues.includes(value) ? index : -1))
        .filter((index) => index !== -1);
      if (indices.length === 0) {
        if (pass === 1) {
          const diagnostic = `${platformId}: brak w rozliczeniu "${reckoningLabel}" (szukane System=[${acceptableValues.join(', ')}], wierszy=${rowValues.length}, wartosci=[${rowValues.join(', ')}])`;
          log(`Brak raportu do usuniecia dla systemu: ${platformId} (${diagnostic}).`);
          diagnostics.push(diagnostic);
        }
        continue;
      }
      log(`Do usuniecia: ${platformId} - ${indices.length} wiersz(y).`);
      matchedIndices.push(...indices);
    }

    if (matchedIndices.length === 0) break;

    // Wiersze Data source sa zwiniete w sekcje (kazdy system to osobny naglowek typu
    // "BOLT : 2026-08-20 - 2026-08-20") - checkbox DELETE zwinietej sekcji ma display:none,
    // wiec Playwright nie potrafi go kliknac (potwierdzone live testem). Ustawiamy .checked
    // bezposrednio w DOM i wysylamy 'change'/'input' - formularz wysyla stan checkboxa przy
    // zapisie niezaleznie od jego widocznosci.
    log(`Zaznaczam DELETE na ${matchedIndices.length} wierszach...`);
    const checkedCount = await page
      .locator(realSourceFieldSelector('input[type="checkbox"]', 'DELETE'))
      .evaluateAll((checkboxes, indices) => {
        let count = 0;
        for (const index of indices) {
          const el = checkboxes[index];
          if (!el) continue;
          el.checked = true;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('input', { bubbles: true }));
          if (el.checked) count += 1;
        }
        return count;
      }, matchedIndices);
    await pause(page);

    if (checkedCount !== matchedIndices.length) {
      throw new Error(`Zaznaczono DELETE tylko na ${checkedCount} z ${matchedIndices.length} wierszy - nic nie zostalo zapisane (mozliwe, ze checkboxy sa disabled).`);
    }

    log(`Zapisuje rozliczenie (usuwanie ${matchedIndices.length} raportow naraz)...`);
    const expectedMaxRows = rowValues.length - matchedIndices.length;
    await clickSaveAndVerify(
      page,
      async () => {
        const values = await getSystemRowValues(page);
        return values !== null && values.length <= expectedMaxRows;
      },
      { statusCallback },
    );
    await pause(page);
    deletedCount += matchedIndices.length;
    log(`Usunieto ${matchedIndices.length} raportow.`);
  }

  log(`Usunieto raportow: ${deletedCount}.`);
  await page.close();
  return { deletedCount, diagnostics };
}

module.exports = {
  uploadToPartnerTax,
  deleteReportsFromPartnerTax,
  SYSTEM_LABEL_CANDIDATES,
};
