const path = require('path');
const { computePeriodRange } = require('../dateRange');
const { waitForAuthStateToSettle, waitForLoginCompletion } = require('../loginHelpers');
const { humanClick, humanFill, humanDelay } = require('../humanInteraction');

// "{orgId}" w URL to ID organizacji/firmy partnera (widoczne w URL panelu po przelaczeniu
// firmy w przelaczniku "UNITY DRIVE sp. z o.o. / DA INVESTMENT..." w prawym gornym rogu) -
// jak w boltfood.js, jedno konto/login Bolt (email+haslo) moze miec dostep do wielu firm
// (rozne miasta), kazda z innym ID. Konfigurowalne per konto (account.fields.orgId) - jedno
// miasto = jedno konto w UI, ze wspolnymi danymi logowania i osobnym orgId/City/Company.
function buildLoginUrl(orgId) {
  return `https://fleets.bolt.eu/login?to=%2F${orgId}%2Ffinances%2Freports%2FdriverEarnings&tab=email_username`;
}

/**
 * Ekran logowania (zweryfikowany na zrzucie ekranu + DOM, 2026-08-18): jednoetapowy,
 * zakladka "E-mail lub nazwa uzytkownika" domyslnie aktywna. Pola NIE sa powiazane
 * semantycznie z widocznym tekstem etykiety (aria-labelledby wskazuje gdzie indziej),
 * wiec getByLabel() nie dziala - uzywamy stabilnych id: #email / #current-password.
 * Dzieki deep-linkowi z buildLoginUrl(), po zalogowaniu Bolt przekierowuje bezposrednio
 * na strone raportu "Zarobki na kierowce" - nie trzeba juz nawigowac przez
 * Finanse > Zarobki na kierowce recznie.
 */
async function syncBoltAccount({ context, account, downloadDir, statusCallback }) {
  const log = (msg) => statusCallback?.(msg);
  const page = await context.newPage();

  const orgId = account.fields.orgId;
  if (!orgId) {
    throw new Error('Brak ID organizacji (pole "orgId") w konfiguracji konta Bolt - wymagane do zbudowania URL panelu.');
  }

  const isLoggedIn = () => !/login|signin/i.test(page.url());

  log('Otwieram panel partnera Bolt...');
  await page.goto(buildLoginUrl(orgId), { waitUntil: 'domcontentloaded' });
  await waitForAuthStateToSettle(page, {
    isLoggedIn,
    isLoginFormVisible: () => page.locator('#email').isVisible().catch(() => false),
  });

  if (!isLoggedIn()) {
    log('Loguje sie do Bolta...');
    await humanFill(page.locator('#email'), account.fields.email);
    await humanFill(page.locator('#current-password'), account.fields.password);
    // Konta partnerow maja UI ustawione na jezyk polski - dopasowujemy tylko polski tekst.
    await humanClick(page.getByRole('button', { name: /zaloguj si./i }));

    const loggedIn = await waitForLoginCompletion(page, { isLoggedIn, statusCallback });
    if (!loggedIn) {
      throw new Error('Logowanie do Bolta nie powiodlo sie w wyznaczonym czasie (mozliwe 2FA wymagajace recznej interwencji).');
    }
  }

  const { from, to } = computePeriodRange(account);
  log(`Pobieram "Zarobki na kierowce" (CSV) za okres ${from} - ${to}...`);

  // Zweryfikowane na zrzucie ekranu + devtools (2026-08-18): klikniecie pola z datami
  // otwiera kalendarz react-datepicker (biblioteka standardowa, klasy .react-datepicker__*).
  // Komorki dni maja role="gridcell" i tekst = numer dnia. Wybieramy start, potem koniec
  // zakresu - react-datepicker w trybie zakresu zamyka popup po drugim kliknieciu.
  // Kalendarz przy otwarciu (bez wczesniej wybranej daty) domyslnie wyswietla biezacy
  // miesiac - nawigujemy stad do miesiaca "from", wybieramy dzien, po czym nawigujemy
  // dalej do miesiaca "to" (moze byc innym miesiacem niz "from") i wybieramy drugi dzien.
  const dateRangeInput = page.locator('input[placeholder="d MMM - d MMM"]');
  await humanClick(dateRangeInput);
  await humanDelay(300, 700);

  const now = new Date();
  let displayedMonthIndex = now.getFullYear() * 12 + now.getMonth();
  displayedMonthIndex = await navigateCalendarToMonth(page, monthIndexOfIsoDate(from), displayedMonthIndex);
  await selectReactDatepickerDay(page, from);
  await humanDelay(300, 600);
  displayedMonthIndex = await navigateCalendarToMonth(page, monthIndexOfIsoDate(to), displayedMonthIndex);
  await selectReactDatepickerDay(page, to);
  await humanDelay(400, 800);

  log('Otwieram menu pobierania i wybieram "Zarobki na kierowce" (CSV)...');
  await humanClick(page.getByRole('button', { name: /^pobierz$/i }));
  await humanDelay(400, 900);

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    // Pozycje menu NIE maja roli ARIA menuitem, wiec klikamy po unikalnym tekscie opisu
    // ("Eksport CSV danych finansowych kierowcy") - w odroznieniu od samego tytulu
    // "Zarobki na kierowce", ten tekst nie koliduje z niczym innym na stronie (m.in. z
    // naglowkiem <h1> strony, ktory ma identyczna tresc).
    humanClick(page.getByText(/eksport csv danych finansowych kierowcy/i)),
  ]);

  const filePath = path.join(downloadDir, download.suggestedFilename());
  await download.saveAs(filePath);
  log(`Zapisano plik: ${filePath}`);

  await page.close();
  return { filePath };
}

/** Zwraca indeks miesiaca (rok*12+miesiac) daty ISO "YYYY-MM-DD", do porownywania miesiecy. */
function monthIndexOfIsoDate(isoDate) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

/**
 * Klika strzalke "poprzedni"/"nastepny" miesiac kalendarza az wyswietlany miesiac (sledzony
 * lokalnie, bez odczytu zlokalizowanej nazwy miesiaca z DOM) zrowna sie z docelowym. Zwraca
 * nowy, aktualny indeks wyswietlanego miesiaca.
 *
 * Przyciski nawigacji NIE maja juz klasy react-datepicker__navigation--previous/--next
 * (Bolt przebudowal je na wlasne komponenty Tailwind) - zweryfikowane w devtools 2026-09-01:
 * to zwykle <button> z aria-label="Previous month" / "Next month" (po angielsku, mimo ze
 * reszta UI jest po polsku). Komorki dni nadal maja klasy react-datepicker__day*.
 */
async function navigateCalendarToMonth(page, targetMonthIndex, currentMonthIndex) {
  const diff = targetMonthIndex - currentMonthIndex;
  const ariaLabel = diff >= 0 ? 'Next month' : 'Previous month';
  for (let i = 0; i < Math.abs(diff); i += 1) {
    await humanClick(page.getByRole('button', { name: ariaLabel, exact: true }));
    await humanDelay(150, 350);
  }
  return targetMonthIndex;
}

/** Klika komorke dnia w otwartym kalendarzu react-datepicker (zaklada, ze miesiac juz jest widoczny). */
async function selectReactDatepickerDay(page, isoDate) {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDate();
  await humanClick(
    page
      .locator('.react-datepicker__day:not(.react-datepicker__day--outside-month)')
      .filter({ hasText: new RegExp(`^${day}$`) })
      .first()
  );
}

module.exports = { syncBoltAccount };
