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
    // Jezyk UI zalezy od ustawien przegladarki/konta (widziany zarowno polski, jak i
    // angielski) - dopasowujemy oba warianty tekstu przycisku.
    await humanClick(page.getByRole('button', { name: /zaloguj si.|sign in/i }));

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
  // TODO: nawigacja miedzy miesiacami NIE jest obslugiwana - dziala tylko gdy oba dni
  // (from i to) sa w aktualnie wyswietlanym miesiacu kalendarza (prawdziwe dla "tydzien
  // biezacy"/"poprzedni" w wiekszosci przypadkow, moze zawiesc przy zakresie niestandardowym
  // z innego miesiaca lub w pierwszych dniach miesiaca).
  const dateRangeInput = page.locator('input[placeholder="d MMM - d MMM"]');
  await humanClick(dateRangeInput);
  await humanDelay(300, 700);
  await selectReactDatepickerDay(page, from);
  await humanDelay(300, 600);
  await selectReactDatepickerDay(page, to);
  await humanDelay(400, 800);

  log('Otwieram menu pobierania i wybieram "Zarobki na kierowce" (CSV)...');
  await humanClick(page.getByRole('button', { name: /^pobierz$|^download$/i }));
  await humanDelay(400, 900);

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    // Pozycje menu NIE maja roli ARIA menuitem, wiec klikamy po unikalnym tekscie opisu
    // ("Eksport CSV danych finansowych kierowcy") - w odroznieniu od samego tytulu
    // "Zarobki na kierowce", ten tekst nie koliduje z niczym innym na stronie (m.in. z
    // naglowkiem <h1> strony, ktory ma identyczna tresc). TODO: angielski tekst opisu
    // nie zostal jeszcze zaobserwowany na zywo.
    humanClick(page.getByText(/eksport csv danych finansowych kierowcy/i)),
  ]);

  const filePath = path.join(downloadDir, download.suggestedFilename());
  await download.saveAs(filePath);
  log(`Zapisano plik: ${filePath}`);

  await page.close();
  return { filePath };
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
