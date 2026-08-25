const path = require('path');
const { waitForAuthStateToSettle, waitForLoginCompletion } = require('../loginHelpers');
const { humanClick, humanFill } = require('../humanInteraction');

// Bolt Food Fleet Portal (dcfo.bolt.eu) to inny system niz Bolt dla kierowcow (fleets.bolt.eu,
// patrz bolt.js) - osobne konto/logowanie, osobna domena, osobny panel. Logowanie idzie przez
// OAuth/PKCE (iam.bolt.eu) z code_challenge/state generowanymi na nowo przy kazdej wizycie -
// NIE mozna wiec zapisac na stale skopiowanego URL logowania (jak w bolt.js), bo te wartosci
// wygasaja/nie pasuja do zapisanego po stronie klienta code_verifier. Zamiast tego celujemy
// bezposrednio w docelowa strone raportow (dcfo.bolt.eu) - niezalogowana wizyta sama
// przekierowuje przez fresh IAM login, a po zalogowaniu wraca dokladnie tam, skad przyszlismy.
//
// "{orgId}" w URL to ID organizacji partnera (widoczne w URL panelu, np. "26424" w
// "/fleet/26424/reports") - w odroznieniu od bolt.js (gdzie jest zahardkodowane), tutaj
// jest to konfigurowalne pole konta (account.fields.orgId), bo docelowo obsluzy wielu
// partnerow Bolt Food z roznymi ID.
function buildReportsUrl(orgId) {
  return `https://dcfo.bolt.eu/fleet/${orgId}/reports`;
}

const TARGET_REPORT_TYPE = 'Fleet Courier Earnings and Balances';

/**
 * Ekran logowania (zweryfikowany na zrzucie ekranu + DOM, 2026-08-25): pola maja LOSOWE id
 * generowane przez React (np. "base-ui-_r_7_") - rozne przy kazdym renderze, wiec NIE mozna
 * ich uzyc jako selektora. Uzywamy zamiast tego stabilnych atrybutow "name" (name="username" /
 * name="password", widoczne w DOM niezaleznie od odswiezenia strony). Przycisk logowania to
 * zwykly button[type="submit"] z tekstem "Zaloguj sie" (jezyk UI moze byc rowniez angielski,
 * jak w innych platformach Bolta - dopasowujemy oba warianty).
 *
 * Raporty w tym panelu generuja sie automatycznie w tle (harmonogram po stronie Bolta) -
 * w odroznieniu od Bolt/FreeNow/Uber NIE wybieramy tu zakresu dat ani nie klikamy "generuj".
 * Zadanie: znajdz najnowszy (najwyzej w tabeli "Wygenerowane raporty") wiersz typu
 * "Fleet Courier Earnings and Balances" i pobierz go (format domyslnie CSV).
 */
async function syncBoltFoodAccount({ context, account, downloadDir, statusCallback }) {
  const log = (msg) => statusCallback?.(msg);
  const page = await context.newPage();

  const orgId = account.fields.orgId;
  if (!orgId) {
    throw new Error('Brak ID organizacji (pole "orgId") w konfiguracji konta Bolt Food - wymagane do zbudowania URL panelu.');
  }
  const reportsUrl = buildReportsUrl(orgId);

  // UWAGA (2026-08-25, po realnym bledzie na zywo): logowanie idzie przez OAuth z
  // przekierowaniem client-side (JS), NIE przez natychmiastowe przekierowanie HTTP - po
  // goto() strona na chwile renderuje sie pod URL-em docelowym (dcfo.bolt.eu) i DOPIERO
  // PO CHWILI jej JS przekierowuje do ekranu logowania (iam*.bolt.eu / boltsvc.net).
  // Sprawdzanie samego page.url() (jak w bolt.js) daje wiec falszywy wynik "zalogowany"
  // w tym oknie, zanim przekierowanie zdazy nastapic - zaobserwowane na zywo: automat
  // pomijal cale logowanie i od razu czekal (bezskutecznie) na tabele raportow, podczas
  // gdy przegladarka byla w trakcie przekierowania na ekran logowania. Zamiast URL,
  // sprawdzamy obecnosc linku "Raportowanie" w menu bocznym - jest widoczny na KAZDEJ
  // stronie zalogowanego panelu (nie tylko na stronie raportow), wiec dziala niezaleznie
  // od tego, gdzie OAuth callback faktycznie wyladuje (patrz komentarz przy nawigacji
  // ponizej - w praktyce nie zawsze jest to strona docelowa z deep-linku).
  const isLoggedIn = () => page.getByRole('link', { name: /raportowanie/i }).isVisible().catch(() => false);

  log('Otwieram panel Bolt Food Fleet...');
  await page.goto(reportsUrl, { waitUntil: 'domcontentloaded' });
  await waitForAuthStateToSettle(page, {
    isLoggedIn,
    isLoginFormVisible: () => page.locator('input[name="username"]').isVisible().catch(() => false),
  });

  if (!(await isLoggedIn())) {
    log('Loguje sie do Bolt Food Fleet...');
    await humanFill(page.locator('input[name="username"]'), account.fields.email);
    await humanFill(page.locator('input[name="password"]'), account.fields.password);
    await humanClick(page.getByRole('button', { name: /zaloguj si.|sign in|log in/i }));

    const loggedIn = await waitForLoginCompletion(page, { isLoggedIn, statusCallback });
    if (!loggedIn) {
      throw new Error('Logowanie do Bolt Food Fleet nie powiodlo sie w wyznaczonym czasie (mozliwe 2FA wymagajace recznej interwencji).');
    }
  }

  // Zaobserwowane na zywo (2026-08-25): OAuth callback po zalogowaniu nie zawsze wraca na
  // deep-link docelowy z reportsUrl - potrafi wyladowac na domyslnym dashboardzie
  // ("Wyniki kurierow"). Nawigujemy wiec jawnie na strone raportow, zamiast zakladac, ze
  // logowanie samo tam wroci.
  if (!/\/reports(\?|$)/.test(page.url())) {
    log('Przechodze do zakladki Raportowanie...');
    await page.goto(reportsUrl, { waitUntil: 'domcontentloaded' });
  }

  // Panel przy pierwszym uzyciu (per przegladarka/profil, patrz browserSession.js -
  // profile per konto) pokazuje jednorazowy modal onboardingowy "Witaj w panelu
  // zarobkow!", ktory zaslania cala strone ponizej - trzeba go zamknac, zanim cokolwiek
  // klikniemy na stronie. Nie zawsze sie pojawia (np. jesli konto juz go wczesniej
  // zamknelo), wiec klikamy go tylko jesli jest widoczny.
  const onboardingCloseButton = page.getByRole('button', { name: /^zamknij$|^close$/i });
  if (await onboardingCloseButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    log('Zamykam modal powitalny...');
    await humanClick(onboardingCloseButton);
  }

  log(`Szukam najnowszego raportu "${TARGET_REPORT_TYPE}"...`);
  const matchingRow = page.locator('table tbody tr').filter({ hasText: TARGET_REPORT_TYPE }).first();
  await matchingRow.waitFor({ state: 'visible', timeout: 30000 });

  log('Pobieram raport...');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    humanClick(matchingRow.getByRole('button', { name: /download|pobierz/i })),
  ]);

  const filePath = path.join(downloadDir, download.suggestedFilename());
  await download.saveAs(filePath);
  log(`Zapisano plik: ${filePath}`);

  await page.close();
  return { filePath };
}

module.exports = { syncBoltFoodAccount };
