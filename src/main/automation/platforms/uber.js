const path = require('path');
const { computePeriodRange } = require('../dateRange');
const { waitForAuthStateToSettle, waitForLoginCompletion } = require('../loginHelpers');
const { humanClick, humanFill, humanDelay } = require('../humanInteraction');

const LOGIN_URL = 'https://supplier.uber.com/';

/**
 * Ekran logowania jest dwuetapowy. Zweryfikowane na zywym DOM (2026-08-18): pola NIE sa
 * spojne jezykowo (krok 1 mial polski placeholder "Wpisz numer telefonu lub adres e-mail",
 * krok 2 angielski aria-label "Enter your password" - jezyk UI jest wiec nieprzewidywalny
 * jak w Bolcie) - uzywamy stabilnych id: #PHONE_NUMBER_or_EMAIL_ADDRESS / #PASSWORD.
 * Krok "Wygeneruj raport" zweryfikowany ponizej.
 */
async function syncUberAccount({ context, account, downloadDir, statusCallback }) {
  const log = (msg) => statusCallback?.(msg);
  const page = await context.newPage();

  // Uber renderuje ekran logowania jako SPA BEZ zmiany URL (zostaje supplier.uber.com/),
  // wiec sprawdzanie po adresie strony (jak w Bolcie/FreeNow) daje falszywy wynik
  // "zalogowany" i pomija formularz. Sprawdzamy zamiast tego obecnosc elementu widocznego
  // tylko po zalogowaniu (nav "Reports").
  const isLoggedIn = () => page.locator('[data-testid="header-nav-/reports"]').isVisible().catch(() => false);
  const isLoginFormVisible = () => page.locator('#PHONE_NUMBER_or_EMAIL_ADDRESS').isVisible().catch(() => false);

  log('Otwieram Uber Supplier Portal...');
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await waitForAuthStateToSettle(page, { isLoggedIn, isLoginFormVisible });

  if (!(await isLoggedIn())) {
    log('Loguje sie do Ubera (krok 1/2: email)...');
    await humanFill(page.locator('#PHONE_NUMBER_or_EMAIL_ADDRESS'), account.fields.email);
    await humanClick(page.getByRole('button', { name: /^continue$|^dalej$/i }));

    log('Loguje sie do Ubera (krok 2/2: haslo)...');
    await humanFill(page.locator('#PASSWORD'), account.fields.password);
    await humanClick(page.getByRole('button', { name: /^next$|^dalej$/i }));

    const loggedIn = await waitForLoginCompletion(page, { isLoggedIn, statusCallback });
    if (!loggedIn) {
      throw new Error('Logowanie do Ubera nie powiodlo sie w wyznaczonym czasie (mozliwe 2FA wymagajace recznej interwencji).');
    }
  }

  const { from, to } = computePeriodRange(account);
  log(`Generuje raport "Payments Driver" za okres ${from} - ${to}...`);

  // Zweryfikowane na zywym DOM (2026-08-18): zakladka "Reports" (data-testid stabilne
  // niezaleznie od jezyka), przycisk "Generate Report" (data-tracking-name stabilne)
  // otwiera panel z polami Report type / Start Date / End Date / Select organizations.
  await humanClick(page.locator('[data-testid="header-nav-/reports"]'));
  await humanDelay(400, 900);
  await humanClick(page.locator('[data-tracking-name="report-generation-initiated"]'));
  await humanDelay(400, 900);

  // Domyslny "Report type" to "Driver Activity"/"Czas i odleglosc kierowcy" - trzeba
  // przelaczyc na "Payments Driver". Jezyk UI jest nieprzewidywalny (widziany polski i
  // angielski dla tego samego konta w roznych sesjach) - dopasowujemy oba warianty.
  // Combobox ma stabilne id="report-type"; lista opcji to prawdziwy role="option" (li),
  // ktory zawiera zagniezdzony div z tym samym tekstem - getByRole unikalnie trafia w
  // zewnetrzny element, w przeciwienstwie do filtrowania po [aria-selected] (kolizja z
  // zagniezdzonym divem).
  await humanClick(page.locator('#report-type'));
  await humanDelay(300, 700);
  await humanClick(
    page.getByRole('option', { name: /^Payments Driver$|^P[łl]atno[śs]ci\s*[-–]\s*kierowc/i })
  );
  await humanDelay(400, 900);

  // Zweryfikowane na zywo (2026-08-18): pole "Report time range" jest domyslnie zwiniete
  // (readonly, placeholder "Select time frame for report" / PL "Wybierz przedzial
  // czasowy raportu") - trzeba je kliknac, zeby rozwinelo panel z dwiema zakladkami:
  // "Settlement window" (gotowe okresy z listy, domyslnie aktywna) i "Custom range"
  // (edytowalne pola Start/End date). UWAGA: strona w tle ma WLASNY, INNY zestaw
  // zakladek ("Zgloszenia"/"Harmonogramy" - historia raportow), wiec zwykle
  // getByRole('tab').nth(1) trafia w niewlasciwy zestaw. Zakladki tla maja w
  // id/aria-controls segment "reports/" (np. "tabs-bui1-tab-reports/report-schedules"),
  // zakladki w panelu nie - filtrujemy po tym, zeby zawezic do panelu.
  const timeFrameTrigger = page.getByPlaceholder(/select time frame for report|wybierz przedzia. czasowy raportu/i);
  await humanClick(timeFrameTrigger);
  // Dopasowanie po pozycji (nth(1)) okazalo sie zawodne - prawdopodobnie animacja panelu
  // chwilowo duplikuje/podmienia elementy zakladek w DOM. Dopasowujemy po dokladnym
  // tekscie (oba zaobserwowane warianty jezykowe) i klikamy z force:true, na wypadek
  // niewidocznej nakladki przechwytujacej kliknieca (obserwowane wczesniej przy innych
  // elementach tego panelu).
  const customRangeTab = page
    .locator('[role="tab"]:not([id*="reports/"])')
    .filter({ hasText: /^Custom range$|^Zakres niestandardowy$/i });
  await customRangeTab.waitFor({ state: 'visible' });
  for (let attempt = 0; attempt < 8; attempt++) {
    if ((await customRangeTab.getAttribute('aria-selected')) === 'true') break;
    await humanClick(customRangeTab, { force: true });
    await page.waitForTimeout(300);
  }
  const dateInputs = page.locator('input[aria-label="Select a date range."]');
  await dateInputs.nth(0).waitFor({ state: 'visible' });
  await dateInputs.nth(0).fill(toSlashDate(from));
  await humanDelay(300, 600);
  await dateInputs.nth(1).fill(toSlashDate(to));
  await humanDelay(300, 600);
  // Wypelnienie pol otwiera kalendarz z potwierdzeniem wybranego zakresu (zweryfikowane
  // na zywo: "Selected start date"/"Selected end date" w aria-label komorek - daty SA
  // poprawnie ustawione, kalendarz to tylko widok do zamkniecia). Klikanie w cokolwiek
  // pod kalendarzem powodowalo petle (klik "przenikal" przez nakladke i otwieral kolejny
  // popover) - Escape zamyka kalendarz poprawnie. Zostaje jeszcze zewnetrzny panel
  // "Report time range" (z zakladkami) rozwiniety - klikamy ponownie pole-wyzwalacz,
  // zeby go zwinac (teraz juz nie zaslania go kalendarz, wiec klikniecie dociera).
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await humanClick(timeFrameTrigger);

  // Pole organizacji jest readonly (klikniecie otwiera liste, nie da sie wpisac tekstu).
  // Zweryfikowany na zywo polski placeholder "Wybierz organizacje, ktore chcesz
  // uwzglednic w raporcie" - dopasowujemy go obok angielskiego oryginalu. Lista opcji
  // to (w odroznieniu od "Report type") checkboxy z etykieta (label > span + input +
  // tekst) - prawdziwy <input type="checkbox"> jest wizualnie ukryty (stylowany przez
  // sasiedni span), Playwright odmawia klikniecia w niewidoczny element, wiec klikamy
  // zamiast tego otaczajacy <label> (rodzic inputu), co dziala jak natywne toggle.
  if (account.company) {
    await humanClick(page.getByPlaceholder(/select organizations to include in report|wybierz organizacje/i));
    await humanDelay(300, 700);
    const orgCheckbox = page.getByRole('checkbox', { name: new RegExp(account.company, 'i') });
    await humanClick(orgCheckbox.locator('xpath=..'));
    await humanDelay(300, 600);
    await page.keyboard.press('Escape');
    await humanDelay(300, 600);
  }

  await humanDelay(300, 700);
  await humanClick(page.getByRole('button', { name: /^generate$|^wygeneruj$/i }));
  // Dialog "Wygeneruj raport" NIE zamyka sie sam po kliknieciu - zaslania tabele i
  // blokuje kliknieca w przycisk pobierania ponizej. Zamykamy go (zadanie generowania
  // raportu jest juz wyslane niezaleznie od stanu dialogu - nowy wiersz w tabeli
  // pojawia sie ze statusem "W toku" natychmiast).
  await page.keyboard.press('Escape');

  // Generowanie raportu trwa chwile (async). Zamiast dopasowywac wiersz po tekscie daty
  // (jezyk tabeli jest nieprzewidywalny, jak wszystko inne w tym UI), bierzemy pierwszy
  // wiersz danych (nth(0) to naglowek tabeli) - najnowszy wygenerowany raport pojawia sie
  // zawsze na gorze listy (zweryfikowane na zrzutach ekranu historii raportow).
  // Zweryfikowane na zywo: przycisk pobierania jest obecny w DOM (ten sam data-testid)
  // JUZ w trakcie generowania (status "W toku"), wiec samo czekanie na jego widocznosc
  // nie wystarcza - klikniecie w tym stanie po prostu nic nie robi. Zamiast zgadywac po
  // czym rozpoznac gotowosc, probujemy pobrania cyklicznie az faktycznie wystartuje.
  log('Czekam na wygenerowanie raportu (moze to potrwac do kilku minut)...');
  const reportRow = page.getByRole('row').nth(1);
  const downloadButton = reportRow.getByRole('button', { name: /download|pobierz/i });
  const overallDeadline = Date.now() + 5 * 60 * 1000;
  let download = null;
  while (Date.now() < overallDeadline && !download) {
    try {
      [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 8000 }),
        humanClick(downloadButton),
      ]);
    } catch {
      await page.waitForTimeout(4000);
    }
  }
  if (!download) {
    throw new Error('Raport nie zostal wygenerowany w wyznaczonym czasie (5 minut).');
  }
  log('Raport gotowy, pobieram plik...');

  const filePath = path.join(downloadDir, download.suggestedFilename());
  await download.saveAs(filePath);
  log(`Zapisano plik: ${filePath}`);

  await page.close();
  return { filePath };
}

/** "2026-08-10" -> "2026/08/10" (format pol "Start of report"/"End of report" w Uberze). */
function toSlashDate(isoDate) {
  return isoDate.replace(/-/g, '/');
}

module.exports = { syncUberAccount };
