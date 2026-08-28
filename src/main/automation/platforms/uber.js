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
    // Tekst przycisku bywa w dowolnym jezyku UI (obserwowane PL/EN/RU), wiec dopasowanie
    // po nazwie jest zawodne. Wczesniejsze podejscia (dopasowanie po tekscie, potem po
    // button[type="submit"] wewnatrz najblizszego <form>) okazaly sie zawodne - albo pole
    // nie jest w ogole wewnatrz <form> (xpath=ancestor::form zwracal pustke), albo
    // <button> nie ma jawnego atrybutu type mimo bycia submitem (zaobserwowane na zywo
    // 2026-08-25). Zamiast zgadywac strukture, uzywamy stabilnego id="forward-button"
    // (potwierdzone na zywym DOM dla kroku 1 - "Dalej"), z fallbackiem na
    // button[type="submit"]/bez atrybutu w formularzu, gdyby ten id kiedys zniknal.
    const clickContinueButton = async (fieldLocator) => {
      const byId = page.locator('#forward-button');
      if (await byId.isVisible().catch(() => false)) {
        await humanClick(byId);
        return;
      }
      const formSubmit = fieldLocator.locator('xpath=ancestor::form').locator('button[type="submit"], button:not([type])');
      await humanClick(formSubmit);
    };

    log('Loguje sie do Ubera (krok 1/2: email)...');
    const emailInput = page.locator('#PHONE_NUMBER_or_EMAIL_ADDRESS');
    await humanFill(emailInput, account.fields.email);
    await clickContinueButton(emailInput);

    log('Loguje sie do Ubera (krok 2/2: haslo)...');
    const passwordInput = page.locator('#PASSWORD');
    await humanFill(passwordInput, account.fields.password);
    await clickContinueButton(passwordInput);

    const loggedIn = await waitForLoginCompletion(page, { isLoggedIn, statusCallback });
    if (!loggedIn) {
      throw new Error('Logowanie do Ubera nie powiodlo sie w wyznaczonym czasie (mozliwe 2FA wymagajace recznej interwencji).');
    }
  }

  // Zamykamy oba znane popupy (bąbelek czatu, baner instalacji aplikacji mobilnej) od razu
  // po zalogowaniu, zanim jeszcze cokolwiek klikniemy - nie czekamy, az akurat przeszkodza w
  // pierwszej interakcji (klient zglosil, ze wolal, zeby znikaly natychmiast).
  await dismissChatBubble(page);

  const { from, to } = computePeriodRange(account);

  // Nazwa pliku/wiersza wygenerowanego raportu ma stabilny, jezykowo-niezalezny prefiks
  // "RRRRMMDD-RRRRMMDD-payments_driver..." (zweryfikowane na pobranych plikach, np.
  // "20260817-20260821-payments_driver-UNITY_DRIVE..."). Przed generowaniem nowego
  // raportu sprawdzamy, czy taki juz istnieje na liscie - klient zglosil, ze kazde
  // uruchomienie automatu tworzylo nowy raport nawet dla juz pobranego okresu, zasmiecajac
  // liste "Reports" duplikatami. Jesli pasujacy wiersz juz istnieje, pobieramy go zamiast
  // generowac kolejny.
  const reportNamePrefix = `${from.replace(/-/g, '')}-${to.replace(/-/g, '')}-payments_driver`;

  // Zweryfikowane na zywym DOM (2026-08-18): zakladka "Reports" (data-testid stabilne
  // niezaleznie od jezyka), przycisk "Generate Report" (data-tracking-name stabilne)
  // otwiera panel z polami Report type / Start Date / End Date / Select organizations.
  log(`Sprawdzam, czy raport "Payments Driver" za okres ${from} - ${to} juz istnieje...`);
  await humanClick(page.locator('[data-testid="header-nav-/reports"]'));
  await humanDelay(400, 900);
  // Tabela raportow doladowuje sie asynchronicznie po przelaczeniu zakladki - bez
  // odczekania na pierwszy wiersz danych sprawdzenie ponizej odpalalo sie za wczesnie i
  // zawsze wychodzilo "brak", nawet gdy pasujacy raport byl juz na liscie (zaobserwowane
  // na zywo 2026-08-21: automat i tak generowal duplikat mimo istniejacego raportu).
  await page.getByRole('row').nth(1).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

  // Dopasowanie PO NAZWIE (nie po pozycji w tabeli) - uzywane zarowno do sprawdzenia
  // "czy juz istnieje", jak i (po wygenerowaniu) do znalezienia swiezo utworzonego
  // wiersza. Zalozenie "najnowszy raport zawsze na gorze listy (nth(1))" okazalo sie
  // zawodne (zaobserwowane na zywo 2026-08-25: automat pobral stary raport za inny
  // okres, bo nowy wiersz nie trafil od razu na pozycje nth(1)) - dopasowanie po nazwie
  // dziala niezaleznie od tego, gdzie w tabeli wiersz sie akurat znajduje.
  const matchingReportRow = () => page.getByRole('row').filter({ hasText: new RegExp(reportNamePrefix, 'i') }).first();
  const reportAlreadyExists = (await matchingReportRow().count()) > 0;

  if (reportAlreadyExists) {
    log('Raport za ten okres juz istnieje - pobieram istniejacy zamiast generowac nowy.');
  } else {
    // UWAGA (2026-08-25, po serii realnych bledow na zywo, konto Warszawa): ten panel
    // ("Wygeneruj raport") okazal sie na tyle niestabilny/zalezny od timingu, ze kolejne
    // proby lataniowego naprawiania pojedynczych krokow (zly wybor daty, cichy brak
    // zaznaczenia organizacji, zawodny checkbox, timeout na kliknieciu zwijajacym panel dat)
    // za kazdym razem ujawnialy INNY punkt awarii w tym samym miejscu - to sygnal, ze caly
    // ten fragment jest po prostu niestabilny czasowo, a nie ze kazdy krok z osobna ma swoj
    // wlasny, odrebny blad do naprawienia. Zamiast dalej lataniowo lapac kolejne punkty
    // awarii, cala sekwencja (otworz dialog -> typ -> daty -> organizacja -> Wygeneruj) jest
    // opakowana w retry: kazda nieudana proba zamyka dialog (Anuluj/Escape) i zaczyna od
    // nowa, zamiast zakladac, ze pojedynczy krok da sie raz na zawsze "utwardzic".
    await generateUberReportWithRetry(page, from, to, account, statusCallback);

    // Wstawienie nowego wiersza do tabeli jest asynchroniczne (zadanie generowania idzie
    // do backendu, dopiero jego odpowiedz dodaje wiersz) - czekamy, az wiersz PASUJACY PO
    // NAZWIE faktycznie sie pojawi w DOM, zamiast zakladac konkretna pozycje. Wczesniejsze
    // podejscie oparte na "nth(1)" (najnowszy zawsze na gorze) bylo zawodne (zaobserwowane
    // na zywo 2026-08-25: automat pobral stary raport za inny okres, bo nowy wiersz nie
    // trafil od razu na pozycje nth(1) i pobranie ruszylo z gotowego juz starego wiersza).
    log('Czekam az nowo wygenerowany raport pojawi sie na liscie...');
    // Tabela potrafi nie doladowac nowego wiersza mimo ze zadanie generowania poszlo do
    // backendu poprawnie (ta sama "zawieszajaca sie" strona, co przy pobieraniu - patrz
    // odswiezanie w petli oczekiwania na download nizej). Zamiast od razu poddawac cala
    // synchronizacje bledem, probujemy kilka razy z twardym odswiezeniem strony miedzy
    // probami - NIE generujemy raportu ponownie (to zostawilibysmy duplikat), tylko
    // sprawdzamy po odswiezeniu, czy wiersz jednak juz tam jest.
    const ROW_WAIT_MS = 30000;
    const MAX_ROW_WAIT_ATTEMPTS = 3;
    let rowFound = false;
    for (let attempt = 1; attempt <= MAX_ROW_WAIT_ATTEMPTS; attempt += 1) {
      const rowAppearDeadline = Date.now() + ROW_WAIT_MS;
      while (Date.now() < rowAppearDeadline && (await matchingReportRow().count()) === 0) {
        await page.waitForTimeout(500);
      }
      if ((await matchingReportRow().count()) > 0) {
        rowFound = true;
        break;
      }
      if (attempt < MAX_ROW_WAIT_ATTEMPTS) {
        log(`Raport nadal niewidoczny na liscie - odswiezam strone i probuje ponownie (${attempt}/${MAX_ROW_WAIT_ATTEMPTS})...`);
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
        await dismissChatBubble(page);
        await humanClick(page.locator('[data-testid="header-nav-/reports"]'));
        await page.getByRole('row').nth(1).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      }
    }
    if (!rowFound) {
      throw new Error('Nowo wygenerowany raport nie pojawil sie na liscie mimo kilku prob z odswiezeniem strony.');
    }
  }

  // Zweryfikowane na zywo: przycisk pobierania jest obecny w DOM (ten sam data-testid)
  // JUZ w trakcie generowania (status "W toku"), wiec samo czekanie na jego widocznosc
  // nie wystarcza - klikniecie w tym stanie po prostu nic nie robi. Zamiast zgadywac po
  // czym rozpoznac gotowosc, probujemy pobrania cyklicznie az faktycznie wystartuje.
  // matchingReportRow() jest wywolywana na nowo przy kazdej probie (nie zapamietujemy
  // raz zlokalizowanego wiersza), zeby dopasowanie po nazwie bylo odporne na ewentualne
  // przesortowanie listy miedzy wygenerowaniem a faktycznym pobraniem.
  if (!reportAlreadyExists) {
    log('Czekam na wygenerowanie raportu (moze to potrwac do kilku minut)...');
  }
  const downloadButton = matchingReportRow().getByRole('button', { name: /download|pobierz/i });
  const overallDeadline = Date.now() + 5 * 60 * 1000;
  // Uber Supplier Portal potrafi "zawiesic" stan wiersza (status zostaje na "W toku" mimo
  // ze raport jest juz gotowy po stronie backendu, klikniecie w przycisk pobierania w tym
  // stanie nic nie robi) - obserwowane na zywo. Samo ponawianie klikniecia w te sama,
  // nieodswiezona strone tego nie naprawia; pomaga twarde odswiezenie strony (page.reload),
  // po ktorym trzeba wrocic na zakladke Reports (SPA bez wlasnego URL - patrz komentarz przy
  // isLoggedIn wyzej). Odswiezamy wiec co REFRESH_INTERVAL_MS, nie przy kazdej nieudanej
  // probie, zeby nie przeszkadzac stronie w normalnym odswiezaniu statusu.
  const REFRESH_INTERVAL_MS = 30000;
  let lastRefreshAt = Date.now();
  let download = null;
  while (Date.now() < overallDeadline && !download) {
    try {
      [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 8000 }),
        humanClick(downloadButton),
      ]);
    } catch {
      if (Date.now() - lastRefreshAt >= REFRESH_INTERVAL_MS) {
        log('Status raportu sie nie zmienia - odswiezam strone Uber...');
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
        await dismissChatBubble(page);
        await humanClick(page.locator('[data-testid="header-nav-/reports"]'));
        await page.getByRole('row').nth(1).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
        lastRefreshAt = Date.now();
      } else {
        await page.waitForTimeout(4000);
      }
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

/**
 * Klika komorke dnia w otwartym kalendarzu zakresu dat (Custom range) - patrz komentarz
 * przy wywolaniu w syncUberAccount o tym, dlaczego wpisywanie tekstu w pole zostalo
 * porzucone na rzecz bezposredniego klikania w kalendarz (jak w bolt.js). Zaklada, ze
 * wlasciwy miesiac jest juz wyswietlony (nawigacja - patrz navigateCalendarMonths -
 * odpowiada za to PRZED wywolaniem tej funkcji). Komorki wykluczone przez aria-disabled
 * to dni spoza dozwolonego zakresu (np. przyszle, jeszcze nie zakonczone dni
 * rozliczeniowe).
 */
async function selectUberCalendarDay(page, isoDate) {
  await dismissChatBubble(page);
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDate();
  const cell = page
    .locator('[role="gridcell"]:not([aria-disabled="true"])')
    .filter({ hasText: new RegExp(`^${day}$`) })
    .first();
  await humanClick(cell);
}

/**
 * Uber Supplier Portal pokazuje czasem popupy zaslaniajace/przechwytujace kliknięcia -
 * zaobserwowane na zywo DWA NIEZALEZNE komponenty, ktore potrafia byc widoczne jednoczesnie
 * (zrzut ekranu z klienta 2026-08-26): bąbelek czatu w rogu ekranu ("Masz pytanie? Chętnie z
 * Tobą porozmawiamy.", przycisk zamkniecia z data-testid="first-impression-dismiss") oraz
 * pelnoszerokosciowy niebieski baner u gory strony ("Zainstaluj naszą aplikację mobilną!",
 * przycisk zamkniecia to generyczna ikona Base Web "Delete" uzywana jako X - bez wlasnego
 * atrybutu identyfikujacego, wiec zawezamy szukanie do ikon w gornych ~60px viewportu, zeby
 * nie trafic przypadkiem w inny przycisk "Delete"/kosz na smiec gdzies indziej na stronie).
 * Potrafia wyskoczyc w dowolnym momencie procesu logowania/generowania raportu - w tym TUZ po
 * wybraniu obu dat zakresu, zaslaniajac caly formularz i przechwytujac kolejne kliknięcie
 * (zgloszone przez klienta jako "zatrzymal sie na wybraniu daty i dalej nie idzie") - dlatego
 * wywolujemy to przed KAZDA proba klikniecia w tej sciezce, nie tylko przy kalendarzu. Cichy
 * no-op dla kazdego popupu z osobna, gdy akurat nie jest widoczny.
 */
async function dismissChatBubble(page) {
  const chatDismissBtn = page.locator('[data-testid="first-impression-dismiss"]');
  if (await chatDismissBtn.isVisible().catch(() => false)) {
    await chatDismissBtn.click({ timeout: 2000 }).catch(() => {});
    await humanDelay(200, 400);
  }

  const closeIcons = page.locator('svg').filter({ has: page.locator('title', { hasText: /^Delete$/ }) });
  const closeIconCount = await closeIcons.count().catch(() => 0);
  for (let i = 0; i < closeIconCount; i += 1) {
    const icon = closeIcons.nth(i);
    const box = await icon.boundingBox().catch(() => null);
    if (box && box.y < 60) {
      await icon.click({ timeout: 2000 }).catch(() => {});
      await humanDelay(200, 400);
      break;
    }
  }
}

/** "2026/07/24" -> 2026*12+7 (do porownywania miesiecy niezaleznie od roku). */
function yearMonthFromSlashDate(slashDate) {
  const [year, month] = slashDate.split('/').map(Number);
  return year * 12 + month;
}

/** "2026-08-10" -> 2026*12+8 (do porownywania miesiecy niezaleznie od roku). */
function yearMonthFromIsoDate(isoDate) {
  const [year, month] = isoDate.split('-').map(Number);
  return year * 12 + month;
}

/**
 * Nawiguje otwarty kalendarz o `deltaMonths` miesiecy (dodatnie - do przodu, ujemne -
 * wstecz), klikajac przycisk nawigacji tyle razy, ile trzeba. Kalendarz otwiera sie
 * domyslnie na miesiacu aktualnie ustawionej (domyslnej) daty, ktora NIE musi pokrywac
 * sie z docelowym okresem (zaobserwowane na zywo 2026-08-25, konto Krakow: domyslny
 * zakres byl z lipca, docelowy z sierpnia - klikniecie dnia "24"/"25" bez nawigacji
 * trafialo w zly miesiac, a ponowienie proby powtarzalo ten sam blad w kolko, bo tez nie
 * nawigowalo). Dopasowanie przyciskow po aria-label (oba warianty jezykowe, jak wszedzie
 * indziej w tym pliku).
 */
async function navigateCalendarMonths(page, deltaMonths) {
  if (deltaMonths === 0) return;
  const button = page.getByRole('button', {
    name: deltaMonths > 0 ? /next month|nast.pny miesi.c/i : /previous month|poprzedni miesi.c/i,
  });
  for (let i = 0; i < Math.abs(deltaMonths); i += 1) {
    await dismissChatBubble(page);
    await humanClick(button);
    await humanDelay(200, 400);
  }
}

/**
 * Jedna proba wypelnienia i wyslania formularza "Wygeneruj raport" (typ -> daty ->
 * organizacja -> Wygeneruj). Zaklada, ze dialog jest juz otwarty (otwiera go wywolujacy).
 * Rzuca blad przy pierwszej niespojnosci (zla data, brak organizacji, itp.) zamiast probowac
 * kontynuowac w niepewnym stanie - patrz generateUberReportWithRetry, ktora lapie te bledy
 * i probuje od nowa.
 */
async function attemptGenerateUberReport(page, from, to, account) {
  // Domyslny "Report type" to "Driver Activity"/"Czas i odleglosc kierowcy" - trzeba
  // przelaczyc na "Payments Driver". Jezyk UI jest nieprzewidywalny (widziany polski i
  // angielski dla tego samego konta w roznych sesjach) - dopasowujemy oba warianty.
  // Combobox ma stabilne id="report-type"; lista opcji to prawdziwy role="option" (li),
  // ktory zawiera zagniezdzony div z tym samym tekstem - getByRole unikalnie trafia w
  // zewnetrzny element, w przeciwienstwie do filtrowania po [aria-selected] (kolizja z
  // zagniezdzonym divem).
  await dismissChatBubble(page);
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
  await dismissChatBubble(page);
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
    await dismissChatBubble(page);
    await humanClick(customRangeTab, { force: true });
    await page.waitForTimeout(300);
  }
  const dateInputs = page.locator('input[aria-label="Select a date range."]');
  await dateInputs.nth(0).waitFor({ state: 'visible' });
  const defaultStartValue = await dateInputs.nth(0).inputValue();
  await dismissChatBubble(page);
  await humanClick(dateInputs.nth(0));
  await humanDelay(300, 600);

  // Wpisywanie tekstu w te pola zawodzilo wielokrotnie (zobacz historie w komentarzach
  // commitow) - klikamy bezposrednio w komorki kalendarza (jak w bolt.js), co jest
  // bezposrednia zmiana stanu widgetu, bez zadnego parsowania/maskowania tekstu. Przed
  // kazdym kliknieciem dnia nawigujemy kalendarz do wlasciwego miesiaca (patrz
  // navigateCalendarMonths) - "from" i "to" moga wypasc w roznych miesiacach.
  let currentYearMonth = yearMonthFromSlashDate(defaultStartValue);
  const fromYearMonth = yearMonthFromIsoDate(from);
  await navigateCalendarMonths(page, fromYearMonth - currentYearMonth);
  currentYearMonth = fromYearMonth;
  await selectUberCalendarDay(page, from);
  await humanDelay(300, 600);

  const toYearMonth = yearMonthFromIsoDate(to);
  await navigateCalendarMonths(page, toYearMonth - currentYearMonth);
  await selectUberCalendarDay(page, to);
  await humanDelay(300, 600);

  for (const [input, isoDate, label] of [
    [dateInputs.nth(0), from, 'Data rozpoczecia'],
    [dateInputs.nth(1), to, 'Data zakonczenia'],
  ]) {
    const expected = toSlashDate(isoDate);
    const actual = await input.inputValue();
    if (actual !== expected) {
      throw new Error(`Po kliknieciu w kalendarz pole daty "${label}" pokazuje "${actual}" zamiast oczekiwanego "${expected}" - wybor daty w Uberze najwyrazniej sie nie powiodl.`);
    }
  }
  // Wypelnienie pol otwiera kalendarz z potwierdzeniem wybranego zakresu (zweryfikowane
  // na zywo: "Selected start date"/"Selected end date" w aria-label komorek - daty SA
  // poprawnie ustawione, kalendarz to tylko widok do zamkniecia). Podobnie jak w
  // react-datepicker uzywanym w bolt.js (selectReactDatepickerDay), popup kalendarza
  // zamyka sie SAM po kliknieciu drugiego dnia zakresu - nie trzeba (i nie wolno) go
  // zamykac Escape'em. UWAGA (2026-08-25, na zywo): Escape w tym miejscu byl
  // interpretowany przez widget jako "anuluj wybor zakresu", a nie "zamknij widok" -
  // powodowal cofniecie sie na ekran wyboru dat (zgloszone przez klienta jako "program
  // wchodzi drugi raz w daty"/"wychodzi z ekranu generacji raportu"). Klikamy wiec od
  // razu w pole-wyzwalacz, zeby zwinac zewnetrzny panel "Report time range".
  // UWAGA (na zywo): to samo "first impression" okienko (patrz dismissChatBubble) potrafi
  // tu wyskoczyc na pelnym ekranie z przyciemnionym tlem TUZ po wybraniu obu dat i
  // zaslonic/przechwycic ten klik, zamrazajac formularz z wypelnionymi juz datami (zgloszone
  // przez klienta jako "zatrzymal sie na wybraniu daty i dalej nie idzie").
  await dismissChatBubble(page);
  await humanClick(timeFrameTrigger);

  // Pole organizacji jest readonly (klikniecie otwiera liste, nie da sie wpisac tekstu).
  // Zweryfikowany na zywo polski placeholder "Wybierz organizacje, ktore chcesz
  // uwzglednic w raporcie" - dopasowujemy go obok angielskiego oryginalu. Lista opcji
  // to (w odroznieniu od "Report type") checkboxy z etykieta: <label data-baseweb="checkbox">
  // zawierajacy span (wizualny checkbox) + prawdziwy <input type="checkbox"> (wizualnie
  // ukryty przez CSS - stylowany przez sasiedni span) + tekst. Operujemy na <label>, bo
  // to on jest faktycznie widoczny i klikalny - czekanie na widocznosc ukrytego <input>
  // (np. przez getByRole('checkbox').waitFor(visible)) wisi w nieskonczonosc, bo input
  // NIGDY nie staje sie "visible" w rozumieniu Playwrighta.
  // Uber wymaga zaznaczenia co najmniej jednej organizacji (walidacja "Wybierz co
  // najmniej jedna organizacje"), wiec ten krok wykonujemy zawsze, niezaleznie od tego,
  // czy w konfiguracji konta wpisano pole "Firma". Poleganie na dopasowaniu tekstu
  // account.company do etykiety checkboxa okazalo sie zawodne u klienta (pole "Firma" to
  // wolny tekst wpisywany recznie, nie musi byc podciagiem pelnej nazwy prawnej widocznej
  // w Uberze) - kiedy lista ma dokladnie jedna organizacje (typowy przypadek), zaznaczamy
  // ja bezposrednio bez zadnego dopasowania tekstu. Dopiero przy wielu organizacjach
  // uzywamy account.company do wyboru wlasciwej.
  const orgInput = page.getByPlaceholder(/select organizations to include in report|wybierz organizacje/i);
  await dismissChatBubble(page);
  await humanClick(orgInput);
  await humanDelay(300, 700);
  // `label[data-baseweb="checkbox"]` bez zawezenia szuka na CALEJ stronie, nie tylko w tym
  // konkretnym popoverze - Base Web (ten sam system komponentow) jest uzywany w wielu
  // miejscach aplikacji. Popover z lista organizacji renderuje sie przez React portal, ale
  // wrapper wyzwalajacy go ma stabilny `aria-controls` wskazujacy na ID tego portalu -
  // zawezamy wiec szukanie checkboxow do tego jednego, konkretnego kontenera zamiast do
  // calej strony.
  const orgTriggerWrapper = page.locator('span[aria-haspopup="true"]').filter({ has: orgInput });
  const orgPopoverId = await orgTriggerWrapper.getAttribute('aria-controls');
  if (!orgPopoverId) {
    throw new Error('Nie udalo sie ustalic ID popovera z lista organizacji Uber (brak atrybutu aria-controls na wyzwalaczu) - struktura strony mogla sie zmienic.');
  }
  const orgLabels = page.locator(`#${orgPopoverId}`).locator('label[data-baseweb="checkbox"]');
  await orgLabels.first().waitFor({ state: 'visible' });
  const orgCount = await orgLabels.count();
  let orgLabel;
  if (orgCount === 1) {
    orgLabel = orgLabels.first();
  } else if (account.company) {
    orgLabel = orgLabels.filter({ hasText: new RegExp(account.company, 'i') });
    if ((await orgLabel.count()) === 0) {
      throw new Error(`Nie znaleziono organizacji pasujacej do pola "Firma" ("${account.company}") wsrod ${orgCount} dostepnych w Uberze. Sprawdz, czy pole "Firma" w konfiguracji konta odpowiada dokladnej nazwie organizacji widocznej na liscie w Uberze.`);
    }
  } else {
    throw new Error(`Konto ma ${orgCount} organizacje w Uberze - uzupelnij pole "Firma" w konfiguracji konta, zeby wskazac, ktora z nich uwzglednic w raporcie.`);
  }
  // Klikniecie <label> PRZELACZA (toggle) powiazany checkbox - jesli byl juz zaznaczony,
  // slepe klikniecie go ODZNACZA zamiast zaznaczyc. Sprawdzamy wiec faktyczny stan
  // prawdziwego (wizualnie ukrytego, stylowanego przez sasiedni <span>) <input
  // type="checkbox"> i dzialamy tylko wtedy, gdy nie jest jeszcze zaznaczony. Zamiast
  // pozycyjnego humanClick (zawodnego dla tego typu widgetu Base Web - patrz ten sam problem
  // rozwiazany dla checkboxa DELETE w partnertax.js), wywolujemy bezposrednio natywna
  // metode .click() na elemencie w DOM (przez evaluate).
  const orgCheckboxInput = orgLabel.locator('input[type="checkbox"]');
  if (!(await orgCheckboxInput.isChecked())) {
    await orgCheckboxInput.evaluate((el) => el.click());
    await humanDelay(300, 600);
    if (!(await orgCheckboxInput.isChecked())) {
      throw new Error('Nie udalo sie zaznaczyc organizacji w formularzu generowania raportu Uber (checkbox pozostaje odznaczony po probie automatycznego zaznaczenia).');
    }
  }
  await humanDelay(300, 600);
  await page.keyboard.press('Escape');
  await humanDelay(300, 600);

  await humanDelay(300, 700);
  const generateButton = page.getByRole('button', { name: /^generate$|^wygeneruj$/i });
  if (await generateButton.isDisabled().catch(() => false)) {
    throw new Error('Przycisk "Wygeneruj" jest nieaktywny (disabled) - formularz raportu ma niewypelnione/nieprawidlowe pole (np. organizacje).');
  }
  await dismissChatBubble(page);
  await humanClick(generateButton);
  // Dialog "Wygeneruj raport" NIE zamyka sie sam po kliknieciu - zaslania tabele i blokuje
  // kliknieca w przycisk pobierania ponizej. Zamykamy go (zadanie generowania raportu jest
  // juz wyslane niezaleznie od stanu dialogu - nowy wiersz w tabeli pojawia sie ze statusem
  // "W toku" natychmiast).
  await page.keyboard.press('Escape');
}

/**
 * Otwiera i wypelnia formularz "Wygeneruj raport", ponawiajac cala sekwencje od zera przy
 * kazdym bledzie (zamiast probowac naprawiac pojedyncze kroki) - patrz uzasadnienie w
 * syncUberAccount, gdzie ta funkcja jest wywolywana. Przy nieudanej probie zamyka dialog
 * (przycisk "Anuluj", z fallbackiem na Escape) zanim otworzy go ponownie od nowa.
 */
async function generateUberReportWithRetry(page, from, to, account, statusCallback, attempts = 3) {
  const log = (msg) => statusCallback?.(msg);
  const dialogHeading = page.getByRole('heading', { name: /^wygeneruj raport$|^generate report$/i });
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    log(`Generuje raport "Payments Driver" za okres ${from} - ${to} (proba ${attempt}/${attempts})...`);
    await dismissChatBubble(page);
    await humanClick(page.locator('[data-tracking-name="report-generation-initiated"]'));
    await humanDelay(400, 900);
    try {
      await attemptGenerateUberReport(page, from, to, account);
      return;
    } catch (error) {
      lastError = error;
      log(`Generowanie raportu nie powiodlo sie (proba ${attempt}/${attempts}): ${error.message}`);
      const cancelButton = page.getByRole('button', { name: /^anuluj$|^cancel$/i });
      if (await cancelButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await cancelButton.click({ timeout: 5000 }).catch(() => {});
      }
      // Liczba nakladek (kalendarz/panel dat/lista organizacji) otwartych w chwili bledu
      // zalezy od tego, NA KTORYM kroku formularz sie wywrocil - stale "dwa Escape"
      // (zaobserwowane na zywo 2026-08-25) czasem nie wystarczaly, zeby faktycznie zamknac
      // caly dialog "Wygeneruj raport". Skutek: kolejna proba probowala otworzyc nowy
      // dialog przyciskiem "Wygeneruj raport", podczas gdy stary, wciaz otwarty dialog
      // zaslanial go i blokowal to klikniecie w nieskonczonosc. Wciskamy wiec Escape w
      // petli, az naglowek dialogu faktycznie zniknie z DOM, zamiast zgadywac ile razy
      // wystarczy.
      for (let i = 0; i < 6 && (await dialogHeading.isVisible().catch(() => false)); i += 1) {
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(300);
      }
      if (await dialogHeading.isVisible().catch(() => false)) {
        throw new Error(`Nie udalo sie zamknac dialogu "Wygeneruj raport" po nieudanej probie ${attempt}/${attempts} (dialog nadal widoczny) - blokuje to kolejne proby. Ostatni blad: ${error.message}`);
      }
      await page.waitForTimeout(700);
    }
  }
  throw new Error(`Generowanie raportu w Uberze nie powiodlo sie po ${attempts} probach. Ostatni blad: ${lastError.message}`);
}

module.exports = { syncUberAccount };
