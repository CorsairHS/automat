const path = require('path');
const fs = require('fs');
const extractZip = require('extract-zip');
const { computePeriodRange } = require('../dateRange');
const { waitForAuthStateToSettle, waitForLoginCompletion } = require('../loginHelpers');
const { humanClick, humanFill, humanDelay } = require('../humanInteraction');

const LOGIN_URL = 'https://portal.free-now.com/login';

/**
 * Ekran logowania (zaktualizowano 2026-08-18 po realnym bledzie timeoutu na
 * przycisku "Company" - FreeNow zmienilo layout formularza): pola po id
 * ("#username" / "#password", bez placeholderow "Sign in email"/"Password"),
 * przycisk logowania po data-testid="login-button" (ma atrybut
 * data-partner-type="COMPANY" juz ustawiony, wiec nie ma juz osobnej
 * zakladki/przycisku "Company" do klikniecia - probujemy ja klikn ac tylko
 * jesli sie pojawi, ale nie blokujemy na niej flow).
 * Przeplyw wg demo klienta: Zarobki > okres: tydzien biezacy > pobierz >
 * WAZNE - wybrac wariant pliku "WITH VAT" (platforma oferuje kilka wariantow).
 * Krok pobierania raportu NIE zostal jeszcze zweryfikowany - nadal TODO.
 *
 * Uwaga: istniejaca wtyczka (novapartner/wtyczka) przechwytuje token Bearer i
 * odtwarza wywolania API FreeNow zamiast klikac w UI - to podejscie jest
 * stabilniejsze, ale zwraca surowe dane (JSON), a nie gotowy plik w formacie
 * "WITH VAT" ktorego oczekuje PartnerTax admin. Dlatego tutaj pobieramy
 * bezposrednio wygenerowany przez FreeNow plik przez UI, tak jak Uber/Bolt.
 */
async function syncFreenowAccount({ context, account, downloadDir, statusCallback }) {
  const log = (msg) => statusCallback?.(msg);
  const page = await context.newPage();

  const isLoggedIn = () => !/login|signin/i.test(page.url());

  log('Otwieram portal FreeNow...');
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await waitForAuthStateToSettle(page, {
    isLoggedIn,
    isLoginFormVisible: () => page.locator('#username').isVisible().catch(() => false),
  });

  if (!isLoggedIn()) {
    log('Loguje sie do FreeNow...');

    const companyTab = page.getByRole('button', { name: /^company$/i });
    if (await companyTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await humanClick(companyTab);
    }

    await humanFill(page.locator('#username'), account.fields.email);
    await humanFill(page.locator('#password'), account.fields.password);
    await humanClick(page.locator('[data-testid="login-button"]'));

    const loggedIn = await waitForLoginCompletion(page, { isLoggedIn, statusCallback });
    if (!loggedIn) {
      throw new Error('Logowanie do FreeNow nie powiodlo sie w wyznaczonym czasie (mozliwe 2FA wymagajace recznej interwencji).');
    }
  }

  const { from, to } = computePeriodRange(account);
  log(`Pobieram "Zarobki" (WITH VAT) za okres ${from} - ${to}...`);

  // Zaktualizowano 2026-08-18 na podstawie realnego DOM (interfejs spolszczony,
  // menu boczne to link "Zarobki" pod href="/earnings"). Zakres dat to DWA osobne
  // pola (nie jedno "Date range"): data-testid="start-date-input" i
  // "end-date-input", format DD/MM/YYYY, przycisk pobierania ma stabilny
  // data-testid="download-csv-file".
  // Zweryfikowane na zrzucie ekranu (2026-08-18): przelacznik ma polska etykiete
  // "Zarobki z VAT" / "Zarobki bez VAT" (UI jest spolszczone, jezyk "Polski").
  // Poprawka (2026-08-19, po realnym bledzie strict-mode): a[href="/earnings"]
  // pasuje do DWOCH linkow na stronie - linku w menu bocznym "Zarobki" i linku
  // "Szczegoly zarobkow" gdzies indziej na stronie (np. na dashboardzie). Trzeba
  // celowac dokladnie w link z tekstem "Zarobki", nie samym href.
  await page.getByRole('link', { name: 'Zarobki', exact: true }).click();
  await humanDelay(400, 900);
  await page.getByRole('button', { name: /zarobki z vat/i }).click();
  await humanDelay(300, 700);

  await page.locator('[data-testid="start-date-input"]').fill(formatFreenowDate(from));
  await humanDelay(300, 600);
  await page.locator('[data-testid="end-date-input"]').fill(formatFreenowDate(to));
  await humanDelay(300, 600);
  await page.keyboard.press('Enter');
  await humanDelay(400, 800);

  log('Czekam na eksport pliku CSV (wariant WITH VAT)...');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    page.locator('[data-testid="download-csv-file"]').click(),
  ]);

  const zipPath = path.join(downloadDir, download.suggestedFilename());
  await download.saveAs(zipPath);
  log(`Zapisano plik: ${zipPath}`);

  // FreeNow pobiera archiwum ZIP zawierajace kilka wariantow CSV (m.in. z i bez VAT) -
  // rozpakowujemy i wybieramy plik z wariantem WITH VAT (zweryfikowane na zywo, 2026-08-18:
  // nazwa pliku zawiera "with_VAT", np. "earnings_2026-08-17_2026-08-18_with_VAT.csv").
  await extractZip(zipPath, { dir: downloadDir });
  const extractedFiles = fs.readdirSync(downloadDir).filter((name) => name !== path.basename(zipPath));
  const withVatFile = extractedFiles.find((name) => /with[_\s-]?vat/i.test(name));
  if (!withVatFile) {
    throw new Error(`Nie znaleziono pliku wariantu WITH VAT w rozpakowanym archiwum FreeNow (znalezione pliki: ${extractedFiles.join(', ') || 'brak'}).`);
  }

  const filePath = path.join(downloadDir, withVatFile);
  log(`Wyodrebniono plik WITH VAT: ${filePath}`);

  await page.close();
  return { filePath };
}

/** "2026-08-10" -> "10/08/2026" (format pola "Date range" widoczny w UI FreeNow). */
function formatFreenowDate(isoDate) {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

module.exports = { syncFreenowAccount };
