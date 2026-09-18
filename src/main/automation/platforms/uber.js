const path = require('path');
const { computePeriodRange } = require('../dateRange');
const { waitForAuthStateToSettle, SAFE_TO_HELP_MARKER } = require('../loginHelpers');
const { humanClick, humanDelay } = require('../humanInteraction');
const { resolveUberReportType, pickReportTypeOptionIndex } = require('../uberReportTypes');

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
    // Krotki limit czasu (zamiast domyslnych 30 s): "Dalej" jest WYLACZONE, dopoki pole na
    // ekranie jest puste - czekanie nic nie da, a blad klikniecia wywracal cala
    // synchronizacje (klient, 2026-09-14). Wywolujacy lapie blad i naprawia stan pola.
    const clickContinueButton = async (fieldLocator, frame = page) => {
      const byId = frame.locator('#forward-button');
      if (await byId.isVisible().catch(() => false)) {
        await humanClick(byId, { timeout: 5000 });
        return;
      }
      const formSubmit = fieldLocator.locator('xpath=ancestor::form').locator('button[type="submit"], button:not([type])');
      await humanClick(formSubmit, { timeout: 5000 });
    };

    log('Loguje sie do Ubera (krok 1/2: email)...');
    const emailInput = page.locator('#PHONE_NUMBER_or_EMAIL_ADDRESS');
    await emailInput.waitFor({ state: 'visible', timeout: 30000 });
    await typeIntoLoginField(page, emailInput, account.fields.email, 'Email/telefon', log).catch((error) =>
      log(`Wpisanie emaila nie powiodlo sie (${error.message.split('\n')[0]}) - ponowie w kolejnym kroku.`)
    );
    await dismissChatBubble(page);
    // Blad (np. wylaczone "Dalej") obsluzy petla ponawiania ponizej (waitForStep1Outcome).
    await clickContinueButton(emailInput).catch(() => {});

    // Klikniecie "Dalej" bywa "polykane" (np. strona jeszcze nie w pelni podpieta pod
    // handler, chwilowa nakladka) - ponawianie tego klikniecia jest bezpieczne, GDY krok
    // 1 nadal jest na ekranie: to czysto kliencka zmiana widoku, bez zadnego zadania do
    // backendu. Zaobserwowane na zywo (klient, 2026-09-04): Uber potrafi zamiast
    // przejscia do hasla pokazac modal weryfikacji czlowieka Arkose Labs ("Ochrona
    // konta"), a PO jego rozwiazaniu wrocic z powrotem do TEGO SAMEGO ekranu email -
    // wymagajac ponownego klikniecia "Dalej". Cala logika ponawiania (przed I po
    // ewentualnym wyzwaniu) jest wiec w jednej funkcji (waitForStep1Outcome), zamiast w
    // osobnej "szybkiej" petli i osobnym biernym oczekiwaniu - to drugie nigdy nie
    // klikalo ponownie, wiec po rozwiazaniu wyzwania i powrocie do ekranu email automat
    // po prostu wisial w nieskonczonosc, czekajac na pole hasla, ktore bez kolejnego
    // klikniecia nigdy sie nie pojawi.
    //
    // UWAGA (klient, 2026-09-04, druga runda): nawet PO tej poprawce klient zglosil, ze
    // ekran hasla ("Witamy ponownie, <imie>") byl juz faktycznie na ekranie (kursor w
    // polu "Wpisz haslo"), a automat i tak zglaszal powrot do ekranu email i ponawial
    // "Dalej" zamiast wpisac haslo. Wniosek: sprawdzanie pola hasla WYLACZNIE w glownej
    // ramce strony (page.locator) nie wystarcza - ten ekran (jak i modal Arkose, ktorego
    // adres iframe w zaobserwowanym DOM wskazywal na "auth.uber.com") potrafi byc
    // renderowany w osadzonym iframe wspolnego logowania Ubera, ktorego page.locator()
    // nie widzi. Szukamy wiec pola hasla we WSZYSTKICH ramkach (patrz
    // findVisibleInAnyFrame) i sprawdzamy to PRZED ewentualnym ponownym kliknieciem
    // "Dalej" na starym ekranie email spod spodu.
    const STEP1_TIMEOUT_MS = 5 * 60 * 1000;
    const step1Result = await waitForStep1Outcome(
      page,
      { emailInput, email: account.fields.email, isLoggedIn, clickContinueButton },
      STEP1_TIMEOUT_MS,
      log
    );
    if (!step1Result) {
      throw new Error('Logowanie do Ubera utknelo na kroku 1 (pole hasla nie pojawilo sie) mimo ponawiania klikniecia "Dalej" i oczekiwania na reczne rozwiazanie ewentualnej weryfikacji.');
    }

    if (step1Result.outcome === 'password') {
      log('Loguje sie do Ubera (krok 2/2: haslo)...');
      const loggedIn = await completePasswordStep(
        page,
        { isLoggedIn, clickContinueButton, password: account.fields.password },
        STEP1_TIMEOUT_MS,
        log
      );
      if (!loggedIn) {
        throw new Error('Logowanie do Ubera nie powiodlo sie w wyznaczonym czasie (mozliwe 2FA wymagajace recznej interwencji).');
      }
    } else {
      // step1Result.outcome === 'loggedIn': partner dokonczyl logowanie recznie w oknie
      // przegladarki (np. nieprzewidziany ekran, na ktorym pole hasla nie pasowalo do
      // znanego selektora) - pomijamy automatyczne wypelnianie hasla, jest juz po
      // wszystkim.
      log('Zalogowano recznie w oknie przegladarki - pomijam automatyczne wypelnianie hasla.');
    }
  }

  // Zamykamy oba znane popupy (bąbelek czatu, baner instalacji aplikacji mobilnej) od razu
  // po zalogowaniu, zanim jeszcze cokolwiek klikniemy - nie czekamy, az akurat przeszkodza w
  // pierwszej interakcji (klient zglosil, ze wolal, zeby znikaly natychmiast).
  await dismissChatBubble(page);

  // Uber rozlicza okresy poniedzialek-poniedzialek (7 dni), nie poniedzialek-niedziela
  // - patrz komentarz przy `mondayToMonday` w dateRange.js.
  const { from, to } = computePeriodRange(account, new Date(), { mondayToMonday: true });

  // Typ raportu pochodzi z konfiguracji konta; konta bez ustawienia dostaja "Platnosci -
  // kierowca", czyli dokladnie to, co bylo tu wczesniej zaszyte na sztywno.
  const reportType = resolveUberReportType(account.reportType);

  // Nazwa pliku/wiersza wygenerowanego raportu ma stabilny, jezykowo-niezalezny prefiks
  // "RRRRMMDD-RRRRMMDD-<typ raportu>..." (zweryfikowane na pobranych plikach, np.
  // "20260817-20260821-payments_driver-UNITY_DRIVE..."). Przed generowaniem nowego
  // raportu sprawdzamy, czy taki juz istnieje na liscie - klient zglosil, ze kazde
  // uruchomienie automatu tworzylo nowy raport nawet dla juz pobranego okresu, zasmiecajac
  // liste "Reports" duplikatami. Jesli pasujacy wiersz juz istnieje, pobieramy go zamiast
  // generowac kolejny.
  const reportNamePrefix = `${from.replace(/-/g, '')}-${to.replace(/-/g, '')}-${reportType.fileSlug}`;

  // Zweryfikowane na zywym DOM (2026-08-18): zakladka "Reports" (data-testid stabilne
  // niezaleznie od jezyka), przycisk "Generate Report" (data-tracking-name stabilne)
  // otwiera panel z polami Report type / Start Date / End Date / Select organizations.
  log(`Sprawdzam, czy raport "${reportType.label}" za okres ${from} - ${to} juz istnieje...`);
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

/**
 * Wykrywa modal weryfikacji czlowieka Arkose Labs ("Ochrona konta" / "Rozpocznij
 * zadanie"), ktory Uber potrafi pokazac miedzy krokiem 1 (email) a krokiem 2 (haslo)
 * logowania - potwierdzone na zywym DOM (klient, 2026-09-04): pelnoekranowy dialog
 * (role="dialog", aria-modal="true", id="arkose-challenge") z osadzonym iframe
 * (data-e2e="enforcement-frame", title="Verification challenge"). Modal zaslania
 * cala strone (iframe height:100vh/width:100vw) - pola formularza pod spodem moga
 * nadal raportowac isVisible()===true dla Playwrighta (sama widocznosc CSS nie
 * uwzglednia przykrycia przez inny element), wiec nie wystarczy czekac na
 * widocznosc pola hasla - trzeba jawnie sprawdzic obecnosc tego modalu.
 */
const isArkoseChallengeVisible = (page) =>
  page.locator('#arkose-challenge, [data-e2e="enforcement-frame"]').first().isVisible().catch(() => false);

/**
 * Czy element lezy NA WIERZCHU (nic go nie zaslania) - sprawdzane przez
 * document.elementFromPoint w srodku elementu. Za "na wierzchu" uznajemy tez trafienie w
 * element wewnatrz tej samej obudowy pola (np. ikona "pokaz haslo").
 */
async function isElementOnTop(locator) {
  return locator
    .evaluate(
      (el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const top = el.ownerDocument.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        if (!top) return false;
        const container = el.closest('[data-baseweb="input"]') || el.parentElement || el;
        return top === el || container.contains(top);
      },
      undefined,
      { timeout: 2000 }
    )
    .catch(() => false);
}

/**
 * Czy weryfikacja Arkose FAKTYCZNIE blokuje ekran. Zgloszenie klienta (2026-09-14, druga
 * runda): po rozwiazaniu zagadki na ekranie byl juz formularz hasla (id="PASSWORD"), a
 * automat nadal nic nie wpisywal. Sama widocznosc kontenera Arkose w rozumieniu Playwrighta
 * nie wystarcza - po rozwiazaniu zagadki kontener/iframe potrafi zostac w DOM (np.
 * przezroczysty albo pod formularzem), a Playwright nie uwzglednia przykrycia ani
 * przezroczystosci, wiec automat czekal w nieskonczonosc na "znikniecie" weryfikacji.
 * Dlatego: jesli pole hasla jest widoczne i lezy na wierzchu - weryfikacja nie blokuje,
 * niezaleznie od tego, co zostalo w DOM.
 */
async function isArkoseChallengeBlocking(page, passwordMatch, otherFormFields = []) {
  if (!(await isArkoseChallengeVisible(page))) return false;
  if (passwordMatch && (await isElementOnTop(passwordMatch.locator))) return false;
  // To samo dla ekranu email (krok 1), gdyby Uber po weryfikacji wrocil wlasnie tam.
  for (const field of otherFormFields) {
    if ((await field.isVisible().catch(() => false)) && (await isElementOnTop(field))) return false;
  }
  return true;
}

/**
 * Wpisuje tekst w pole logowania (email albo haslo) i sprawdza, czy pole faktycznie go
 * zawiera. Najpierw "po ludzku" (klikniecie + wpisywanie znak po znaku bezposrednio w to
 * pole), a gdy to zawiedzie (przechwycone klikniecie, fokus w innym miejscu, pole
 * wyczyszczone przez strone) - wypelnienie pola bezposrednio przez Playwright.
 * Wczesniejsze humanFill wpisywalo przez page.keyboard, czyli do elementu, ktory akurat
 * MIAL fokus - jesli klikniecie w pole nie przeszlo, znaki trafialy donikad. Wartosci nie
 * logujemy (haslo!) - tylko liczbe znakow.
 */
async function typeIntoLoginField(page, input, text, label, log) {
  await dismissChatBubble(page);
  try {
    await humanClick(input, { timeout: 3000 });
  } catch {
    await input.focus({ timeout: 2000 }).catch(() => {});
  }
  try {
    await input.fill('', { timeout: 3000 });
    await input.pressSequentially(text, { delay: 60, timeout: 15000 });
  } catch {
    // Obsluzone ponizej przez sprawdzenie wartosci.
  }
  let typedLength = (await input.inputValue({ timeout: 2000 }).catch(() => '')).length;
  if (typedLength !== text.length) {
    log(`Wpisywanie pola "${label}" znak po znaku nie powiodlo sie (w polu ${typedLength} z ${text.length} znakow) - wypelniam pole bezposrednio.`);
    await input.fill(text, { timeout: 5000, force: true });
    typedLength = (await input.inputValue({ timeout: 2000 }).catch(() => '')).length;
    if (typedLength !== text.length) {
      throw new Error(`pole "${label}" zawiera ${typedLength} z ${text.length} znakow`);
    }
  }
  await humanDelay(200, 500);
}

/**
 * Szuka widocznego elementu pasujacego do selektora we WSZYSTKICH ramkach strony (nie
 * tylko glownej `page`). Zaobserwowany na zywym DOM modal Arkose (patrz
 * isArkoseChallengeVisible) osadza iframe z adresu innej subdomeny ("auth.uber.com" w
 * fragmencie URL) - to sygnal, ze przynajmniej czesc dalszych krokow logowania (haslo,
 * przycisk "Dalej" dla tego ekranu) Uber potrafi renderowac we WSPOLNYM, osadzonym
 * iframe logowania, ktorego zwykle page.locator() (dziala tylko na glownej ramce) nie
 * widzi - zaobserwowane na zywo (klient, 2026-09-04): ekran hasla byl faktycznie na
 * ekranie (kursor aktywny w polu), a page.locator('input[type="password"]') mimo to go
 * nie znajdowal. Zwraca pierwsze trafienie jako { frame, locator } (frame potrzebny
 * pozniej, zeby szukac przycisku "Dalej" w TEJ SAMEJ ramce), albo null.
 */
async function findVisibleInAnyFrame(page, selector) {
  for (const frame of page.frames()) {
    const candidates = frame.locator(selector);
    // NIE bierzemy .first() przed sprawdzeniem widocznosci - selektor
    // input[type="password"] moze trafic w wiecej niz jeden element na stronie (np.
    // ukryty formularz "Nie pamietam hasla"/rejestracji wspoldzielacy DOM z glownym
    // wizardem logowania), a .first() bierze PIERWSZY element w kolejnosci DOM,
    // niekoniecznie ten faktycznie widoczny - zaobserwowane na zywo (klient,
    // 2026-09-04): pole hasla mialo potwierdzone id="PASSWORD" i type="password", a
    // mimo to nie bylo wykrywane, bo .first() prawdopodobnie trafial w inny,
    // niewidoczny element pasujacy do type="password" wczesniej w DOM. Sprawdzamy
    // wiec KAZDE dopasowanie po kolei, az znajdziemy faktycznie widoczne.
    const count = await candidates.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
      const candidate = candidates.nth(i);
      if (await candidate.isVisible().catch(() => false)) {
        return { frame, locator: candidate };
      }
    }
  }
  return null;
}

/**
 * Prowadzi caly krok 1 logowania (email) az do jednego z trzech wynikow: (a) pojawi sie
 * pole hasla (krok 2) - zwraca { outcome: 'password', locator, frame }, (b) logowanie
 * zakonczy sie samo (partner dokonczyl je recznie w oknie przegladarki) - zwraca
 * { outcome: 'loggedIn' }, (c) uplynie timeout - zwraca null. Zaklada, ze pierwsze
 * klikniecie "Dalej" juz sie odbylo (patrz wywolanie w syncUberAccount) - ta funkcja
 * odpowiada za WSZYSTKIE ponowienia, zarowno szybkie (polkniete klikniecie), jak i te po
 * ewentualnym rozwiazaniu weryfikacji.
 *
 * Jesli w danej chwili widoczny jest modal Arkose (patrz isArkoseChallengeVisible),
 * informuje o tym raz i czeka az zniknie, bez klikania - zaobserwowane na zywo (klient,
 * 2026-09-04), ze ponowne klikniecie "Dalej" w trakcie ladowania/rozwiazywania tego
 * wyzwania zdaje sie je resetowac.
 *
 * Pole hasla szukane jest we WSZYSTKICH ramkach (patrz findVisibleInAnyFrame) i
 * sprawdzane PRZED ewentualnym ponownym kliknieciem "Dalej" na ekranie email - dopiero
 * gdy naprawde nie ma go nigdzie, a ekran email (krok 1) jest z powrotem na ekranie,
 * klikamy "Dalej" ponownie (nie czesciej niz raz na CLICK_COOLDOWN_MS). To pokrywa DWA
 * rozne przypadki tym samym mechanizmem: (1) zwykle polkniete klikniecie tuz po
 * wypelnieniu emaila, (2) powrot do ekranu email PO rozwiazaniu weryfikacji Arkose.
 */
async function waitForStep1Outcome(page, { emailInput, email, isLoggedIn, clickContinueButton }, timeoutMs, log) {
  const CLICK_COOLDOWN_MS = 8000;
  const deadline = Date.now() + timeoutMs;
  let captchaMessageShown = false;
  let helpMessageShown = false;
  let lastClickAt = Date.now();

  while (Date.now() < deadline) {
    const passwordMatch = await findVisibleInAnyFrame(page, '#PASSWORD, input[type="password"]');
    if (await isArkoseChallengeBlocking(page, passwordMatch, [emailInput])) {
      if (!captchaMessageShown) {
        log(`${SAFE_TO_HELP_MARKER} Uber pokazuje weryfikacje "Ochrona konta" (puzzle Arkose) - rozwiaz ja recznie w oknie przegladarki ("Rozpocznij zadanie" -> dopasuj obrazki). Automat czeka i sam wykryje zakonczenie.`);
        captchaMessageShown = true;
        helpMessageShown = true;
      }
      await page.waitForTimeout(500);
      continue;
    }
    if (passwordMatch) return { outcome: 'password', ...passwordMatch };
    if (await isLoggedIn()) return { outcome: 'loggedIn' };

    const emailStepVisible = await emailInput.isVisible().catch(() => false);
    // Ani email, ani haslo, ani weryfikacja - Uber pokazuje inny ekran, najczesciej kod SMS
    // wysylany od razu po emailu (zaobserwowane 2026-09-14 na koncie testowym). Automat nie
    // zna kodu, wiec prosimy partnera o wpisanie go i czekamy - po kodzie Uber albo loguje od
    // razu, albo pokazuje ekran hasla, ktory ta petla wykryje sama.
    if (!emailStepVisible && !helpMessageShown && Date.now() - lastClickAt >= 5000) {
      log(`${SAFE_TO_HELP_MARKER} Uber prosi o dodatkowe potwierdzenie (np. kod SMS) - wpisz je recznie w oknie przegladarki. Automat czeka i sam przejdzie dalej (haslo wpisze sam, jesli Uber o nie poprosi).`);
      helpMessageShown = true;
    }
    if (emailStepVisible && Date.now() - lastClickAt >= CLICK_COOLDOWN_MS) {
      log(captchaMessageShown
        ? 'Ekran logowania wrocil do podania emaila/telefonu po weryfikacji - ponawiam klikniecie "Dalej"...'
        : 'Krok logowania (email) nie przeszedl dalej - ponawiam klikniecie "Dalej"...');
      // Zgloszenie klienta (2026-09-14): po weryfikacji Uber wrocil do ekranu email z
      // PUSTYM polem - "Dalej" bylo wtedy wylaczone (disabled), a automat przez 30 s
      // probowal je kliknac i przerywal cala synchronizacje. Przed kliknieciem sprawdzamy
      // wiec zawartosc pola i w razie potrzeby wpisujemy email od nowa; blad pojedynczej
      // proby nie przerywa logowania - kolejny obieg petli sprobuje ponownie.
      try {
        const currentEmail = await emailInput.inputValue({ timeout: 2000 }).catch(() => '');
        const normalize = (value) => value.replace(/\s+/g, '').toLowerCase();
        if (normalize(currentEmail) !== normalize(email)) {
          log('Pole email/telefon jest puste lub niepelne - wpisuje je ponownie...');
          await typeIntoLoginField(page, emailInput, email, 'Email/telefon', log);
        }
        await dismissChatBubble(page);
        await clickContinueButton(emailInput);
      } catch (error) {
        log(`Ponowienie kroku email nie powiodlo sie (${error.message.split('\n')[0]}) - sprobuje ponownie.`);
      }
      lastClickAt = Date.now();
      if (!helpMessageShown) {
        // Informujemy o mozliwosci recznej pomocy dopiero po pierwszym nieudanym
        // ponowieniu (nie od razu przy pierwszym klikizemu emaila) - typowy przypadek
        // "polknietego" klikniecia rozwiazuje sie sam w kolejnej probie i nie powinien
        // niepokoic partnera falszywym alarmem o koniecznosci recznej interwencji.
        log(`${SAFE_TO_HELP_MARKER} Jesli w oknie przegladarki widac dodatkowe zabezpieczenie (np. "Ochrona konta"), rozwiaz je recznie. Automat czeka i sam wykryje przejscie dalej. (W pozostalych krokach nie klikaj w oknie przegladarki.)`);
        helpMessageShown = true;
      }
    }
    await page.waitForTimeout(300);
  }
  return null;
}

/**
 * Prowadzi krok 2 logowania (haslo) az do zalogowania. Zgloszenie klienta (2026-09-14):
 * po weryfikacji "Ochrona konta" (Arkose) Uber wrocil do ekranu "Witamy ponownie. Zaloguj
 * sie, aby kontynuowac." z PUSTYM polem hasla, a automat nic nie wpisal - wczesniej haslo
 * bylo wpisywane dokladnie raz, a potem automat juz tylko biernie czekal na zalogowanie
 * (waitForLoginCompletion). Weryfikacja potrafi wyskoczyc takze PO wyslaniu hasla, a jej
 * rozwiazanie kasuje wpisane haslo.
 *
 * Dlatego - jak w kroku 1 (waitForStep1Outcome) - krecimy sie w petli: gdy widoczny jest
 * modal Arkose, czekamy bez klikania; gdy widoczne jest PUSTE pole hasla (w dowolnej
 * ramce), wpisujemy haslo i klikamy "Dalej" (nie czesciej niz co CLICK_COOLDOWN_MS, zeby
 * nie przeszkadzac stronie w trakcie przejscia); gdy pole jest wypelnione, ale strona
 * stoi - ponawiamy samo "Dalej". Pozostale ekrany (np. kod 2FA SMS/email) zostawiamy
 * partnerowi i tylko czekamy. Bledy pojedynczej proby (np. przechwycone klikniecie) nie
 * przerywaja logowania - kolejny obieg petli sprobuje ponownie.
 */
async function completePasswordStep(page, { isLoggedIn, clickContinueButton, password }, timeoutMs, log) {
  const CLICK_COOLDOWN_MS = 8000;
  const deadline = Date.now() + timeoutMs;
  let lastSubmitAt = 0;
  let submitCount = 0;
  let captchaMessageShown = false;
  let twoFactorMessageShown = false;

  let lastDiagnosticAt = Date.now();

  while (Date.now() < deadline) {
    if (await isLoggedIn()) return true;

    const passwordMatch = await findVisibleInAnyFrame(page, '#PASSWORD, input[type="password"]');
    const arkoseBlocking = await isArkoseChallengeBlocking(page, passwordMatch);

    // Slad w logu co ~20 s, gdy logowanie stoi - bez tego z logu klienta nie da sie
    // odtworzyc, na co automat w danej chwili czekal.
    if (Date.now() - lastDiagnosticAt >= 20000) {
      log(`Logowanie (haslo) nadal trwa - weryfikacja "Ochrona konta" na ekranie: ${arkoseBlocking ? 'tak' : 'nie'}, pole hasla: ${passwordMatch ? 'widoczne' : 'brak'}, liczba prob wyslania hasla: ${submitCount}.`);
      lastDiagnosticAt = Date.now();
    }

    if (arkoseBlocking) {
      if (!captchaMessageShown) {
        log(`${SAFE_TO_HELP_MARKER} Uber pokazuje weryfikacje "Ochrona konta" (puzzle Arkose) - rozwiaz ja recznie w oknie przegladarki ("Rozpocznij zadanie" -> dopasuj obrazki). Automat czeka i sam wpisze haslo, gdy Uber o nie poprosi.`);
        captchaMessageShown = true;
      }
      // Po zniknieciu modalu dajemy stronie chwile na powrot do ekranu hasla, zanim
      // cokolwiek wpiszemy.
      lastSubmitAt = Math.max(lastSubmitAt, Date.now() - CLICK_COOLDOWN_MS + 1500);
      await page.waitForTimeout(500);
      continue;
    }

    if (passwordMatch && Date.now() - lastSubmitAt >= CLICK_COOLDOWN_MS) {
      const { locator: passwordInput, frame: passwordFrame } = passwordMatch;
      try {
        const currentValue = await passwordInput.inputValue({ timeout: 2000 }).catch(() => '');
        if (!currentValue) {
          if (submitCount > 0) log('Uber ponownie prosi o haslo (np. po weryfikacji "Ochrona konta") - wpisuje je jeszcze raz...');
          await typeIntoLoginField(page, passwordInput, password, 'Haslo', log);
        } else if (submitCount > 0) {
          log('Ekran hasla nie przeszedl dalej - ponawiam klikniecie "Dalej"...');
        }
        await dismissChatBubble(page);
        await clickContinueButton(passwordInput, passwordFrame);
      } catch (error) {
        log(`Proba wyslania hasla nie powiodla sie (${error.message.split('\n')[0]}) - sprobuje ponownie.`);
      }
      lastSubmitAt = Date.now();
      submitCount += 1;
    } else if (!passwordMatch && submitCount > 0 && !twoFactorMessageShown && Date.now() - lastSubmitAt > 5000) {
      log(`${SAFE_TO_HELP_MARKER} Mozliwe 2FA - jesli Uber prosi o kod, wpisz go recznie w otwartym oknie przegladarki. Automat czeka i sam wykryje zakonczenie logowania. (W pozostalych krokach nie klikaj w oknie przegladarki.)`);
      twoFactorMessageShown = true;
    }

    await page.waitForTimeout(500);
  }
  return false;
}

/** "2026-08-10" -> "2026/08/10" (format pol "Start of report"/"End of report" w Uberze). */
function toSlashDate(isoDate) {
  return isoDate.replace(/-/g, '/');
}

/**
 * Parsuje zwiniete pole "Report time range" (np. "Aug 24, 2026 4:01AM - Aug 31, 2026
 * 4:01AM") na pare dat ISO. Uber czasem wypelnia to pole domyslnym zakresem (poprzednie
 * okno rozliczeniowe) juz PRZED otwarciem panelu - jesli ten domyslny zakres pokrywa sie
 * z wyliczonym "from"/"to", nie trzeba w ogole dotykac kalendarza (patrz uzycie ponizej).
 * Zwraca null, jesli tekstu nie da sie sparsowac (np. placeholder albo nieznany format).
 */
function parseUberTimeRangeValue(value) {
  if (!value) return null;
  const parts = value.split(/\s*-\s*/);
  if (parts.length !== 2) return null;
  const toIso = (part) => {
    const normalized = part.trim().replace(/(AM|PM)$/i, ' $1');
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const from = toIso(parts[0]);
  const to = toIso(parts[1]);
  if (!from || !to) return null;
  return { from, to };
}

/**
 * Szuka w zakladce "Settlement window" (Okno rozliczenia) gotowego okna rozliczeniowego
 * odpowiadajacego dokladnie wyliczonemu from/to (np. "Aug 31, 2026 4:01AM - Sep 7, 2026
 * 4:01AM"). Klient poprosil, zeby automat najpierw sprawdzal ta gotowa liste, zanim
 * przejdzie do zakladki "Custom range" - ta druga okazala sie najbardziej zawodna czescia
 * calego flow (patrz komentarze przy selectUberCalendarDay/navigateCalendarMonths).
 *
 * KLUCZOWE (zweryfikowane na zrzucie z zywego DOM, klient 2026-09-07 - poprzednia wersja
 * tej funkcji tego NIE robila i dlatego automat "caly czas przechodzil na zakres
 * niestandardowy"): lista okien rozliczeniowych NIE jest widoczna od razu po otwarciu
 * zakladki. Wewnatrz zakladki "Okno rozliczenia" jest WLASNY, ZAGNIEZDZONY picker -
 * <button data-testid="payment-time-range-picker-button" aria-haspopup="true"
 * aria-expanded="..." aria-controls="..."> pokazujacy aktualnie wybrane okno - i dopiero
 * jego klikniecie rozwija liste <li role="option"> z gotowymi okresami. Bez tego
 * klikniecia szukanie role="option" zawsze zwracalo zero trafien, wiec kod leciał do
 * galezi "Custom range" nawet wtedy, gdy potrzebne okno bylo na liscie.
 *
 * Szukanie role="option" zawezamy do kontenera wskazanego przez aria-controls tego
 * pickera - bez tego dopasowanie trafiloby takze w NIEZWiazane elementy role="option" z
 * listy "Report type" wyzej w tym samym dialogu. Gdy aria-controls nie prowadzi do zadnej
 * opcji (inna struktura DOM), wracamy do szukania na calej stronie. Zwraca lokalizator
 * pasujacej opcji, albo null, jesli zadna sie nie zgadza.
 */
async function findMatchingSettlementWindowOption(page, settlementPicker, from, to) {
  // Zakladka "Okno rozliczenia" jest aktywna domyslnie, ale gdyby (np. po nieudanej
  // wczesniejszej probie) aktywna byla "Zakres niestandardowy", wracamy na nia jawnie -
  // klient wprost poprosil, zeby automat na niej ZOSTAWAL, dopoki nie okaze sie, ze
  // potrzebnego okna na liscie nie ma.
  const settlementTab = page
    .locator('[role="tab"]:not([id*="reports/"])')
    .filter({ hasText: /^Settlement window$|^Okno rozliczenia$/i });
  // Sprawdzamy WIDOCZNOSC, nie tylko aria-selected: przy zamknietym panelu zakladka
  // nadal jest w DOM (z aria-selected="false" pozostalym po poprzedniej, nieudanej
  // probie), a proba klikniecia jej wtedy konczy sie bledem "Element is not visible".
  if (
    (await settlementTab.isVisible().catch(() => false)) &&
    (await settlementTab.getAttribute('aria-selected').catch(() => null)) === 'false'
  ) {
    await dismissChatBubble(page);
    await humanClick(settlementTab, { force: true });
    await humanDelay(200, 500);
  }

  if (!(await settlementPicker.isVisible().catch(() => false))) return null;
  if ((await settlementPicker.getAttribute('aria-expanded').catch(() => null)) !== 'true') {
    await dismissChatBubble(page);
    await humanClick(settlementPicker);
    await humanDelay(300, 600);
  }

  const listboxId = await settlementPicker.getAttribute('aria-controls').catch(() => null);
  let options = listboxId
    ? page.locator(`#${listboxId}`).locator('[role="option"]')
    : page.locator('[role="option"]');
  let count = await options.count().catch(() => 0);
  if (count === 0 && listboxId) {
    options = page.locator('[role="option"]');
    count = await options.count().catch(() => 0);
  }
  for (let i = 0; i < count; i += 1) {
    const option = options.nth(i);
    const text = await option.textContent().catch(() => null);
    const parsed = parseUberTimeRangeValue(text?.trim());
    if (parsed?.from === from && parsed?.to === to) {
      return option;
    }
  }
  return null;
}

/**
 * Zwija zagniezdzony picker okien rozliczeniowych (jesli jest rozwiniety) - wywolywane,
 * gdy na jego liscie nie bylo potrzebnego okresu i przechodzimy do zakladki "Custom
 * range". Zwijamy klikajac ten sam przycisk (toggle), a NIE Escapem - Escape w tym
 * dialogu potrafi zamknac cale okno "Wygeneruj raport" (patrz komentarze w
 * generateUberReportWithRetry).
 */
async function collapseSettlementPicker(page, settlementPicker) {
  if (
    (await settlementPicker.isVisible().catch(() => false)) &&
    (await settlementPicker.getAttribute('aria-expanded', { timeout: 2000 }).catch(() => null)) === 'true'
  ) {
    await dismissChatBubble(page);
    await humanClick(settlementPicker, { timeout: 5000 });
    await humanDelay(200, 500);
  }
}

/**
 * Czy zewnetrzny panel "Przedzial czasowy raportu" (ten z zakladkami) jest otwarty.
 *
 * Rozpoznajemy to po elementach istniejacych WYLACZNIE wewnatrz tego panelu: pickerze
 * okien rozliczeniowych (zakladka "Okno rozliczenia") albo polach zakresu dat (zakladka
 * "Zakres niestandardowy"). NIE po obecnosci jakiejkolwiek zakladki role="tab" -
 * aplikacja ma wlasne zakladki nawigacyjne POZA panelem, wiec takie sprawdzenie uznawalo
 * juz zamkniety panel za otwarty i "zwijajace" klikniecie w pole-wyzwalacz OTWIERALO go z
 * powrotem. Otwarty panel jest nakladka zaslaniajaca pola ponizej - i wlasnie to objawilo
 * sie u klienta jako "nie wybiera organizacji" (2026-09-07).
 */
const TIME_FRAME_PANEL_MARKERS = [
  // zakladka "Okno rozliczenia" - jej zagniezdzony picker okien rozliczeniowych
  '[data-testid="payment-time-range-picker-button"]',
  // zakladka "Zakres niestandardowy" - pola zakresu dat
  'input[aria-label="Select a date range."]',
];

/**
 * Panel jest otwarty, gdy widoczny jest DOWOLNY z jego markerow. Kazdy sprawdzamy
 * OSOBNO - laczenie ich w jeden lokator przez .or(...).first() bralo pierwszy element w
 * kolejnosci DOM (picker okien rozliczeniowych), ktory jest ukryty, gdy aktywna jest
 * zakladka "Zakres niestandardowy" - i caly otwarty panel raportowal jako zamkniety.
 */
const isTimeFramePanelOpen = async (page) => {
  for (const selector of TIME_FRAME_PANEL_MARKERS) {
    if (await page.locator(selector).first().isVisible().catch(() => false)) return true;
  }
  return false;
};

/** Czeka (do `timeout` ms), az wszystkie markery panelu znikna. true = panel zamkniety. */
async function waitForTimeFramePanelClosed(page, timeout) {
  const deadline = Date.now() + timeout;
  do {
    if (!(await isTimeFramePanelOpen(page))) {
      // Krotka pauza na koniec animacji - element moze byc jeszcze w warstwie nad polami.
      await page.waitForTimeout(300);
      if (!(await isTimeFramePanelOpen(page))) return true;
    }
    await page.waitForTimeout(200);
  } while (Date.now() < deadline);
  return false;
}

/**
 * Zwija zewnetrzny panel "Przedzial czasowy raportu", jesli nadal jest otwarty - panel
 * zaslania pola ponizej (organizacje, przycisk "Wygeneruj"), wiec pozostawienie go
 * otwartego przechwytuje kolejne kliknieca. Zwijamy kliknieciem w pole-wyzwalacz, nie
 * Escapem (uzasadnienie j.w.). Po kliknieciu sprawdzamy stan ponownie - dzieki temu
 * funkcja jest idempotentna (na zamknietym panelu nie robi nic, wiec mozna ja wywolac
 * "na wszelki wypadek") i sama naprawia sie, gdyby klikniecie zadzialalo odwrotnie.
 */
async function collapseTimeFramePanel(page, timeFrameTrigger, log) {
  // Zgloszenie klienta (2026-09-14): po wybraniu gotowego okna rozliczenia pole organizacji
  // "nie klikalo sie" w pierwszej probie, a w drugiej (gdzie panelu dat w ogole nie
  // otwieramy, bo pole ma juz poprawny okres) dzialalo od razu. Panel zamyka sie z animacja,
  // a w jej trakcie jego elementy sa nadal "widoczne" dla Playwrighta - klikniecie
  // wyzwalacza (przelacznika!) w tym momencie potrafilo panel OTWORZYC z powrotem, a on
  // przechwytywal potem klikniecie w organizacje. Dlatego: (1) najpierw dajemy panelowi
  // czas zamknac sie samemu, (2) zamykamy go kliknieciem w naglowek dialogu - dla popovera
  // to "klikniecie na zewnatrz", ktore tylko zamyka, nigdy nie otwiera - (3) dopiero na
  // koncu, awaryjnie, klikamy przelacznik i zawsze czekamy na zakonczenie animacji.
  if (await waitForTimeFramePanelClosed(page, 1500)) return true;

  const heading = page.getByRole('heading', { name: /^wygeneruj raport$|^generate report$/i }).first();
  if (await heading.isVisible().catch(() => false)) {
    await dismissChatBubble(page);
    await heading.click({ timeout: 3000 }).catch(() => {});
    if (await waitForTimeFramePanelClosed(page, 2000)) return true;
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (await waitForTimeFramePanelClosed(page, 1000)) return true;
    await dismissChatBubble(page);
    await humanClick(timeFrameTrigger, { timeout: 5000 }).catch(() => {});
    if (await waitForTimeFramePanelClosed(page, 2000)) return true;
  }
  const stillOpen = await isTimeFramePanelOpen(page);
  if (stillOpen) {
    // Nie przerywamy - dalsze kroki (organizacje, "Wygeneruj") radza sobie z zaslonietymi
    // polami same (patrz clickEvenIfOverlaid). Zapisujemy to jednak w logu, bo bez tego
    // jedynym sladem takiej sytuacji byl 30-sekundowy, milczacy timeout klikniecia.
    log?.('Panel "Przedzial czasowy raportu" nie zwinal sie mimo kilku prob - klikam pola pod nim mimo zaslonienia.');
  }
  return !stillOpen;
}

/**
 * Rozwija panel "Przedzial czasowy raportu", jesli nie jest jeszcze otwarty. Pole-wyzwalacz
 * jest PRZELACZNIKIEM, wiec slepe klikanie go "zeby otworzyc" potrafi go rownie dobrze
 * ZAMKNAC, gdy zostal otwarty juz wczesniej (np. przez nieudana poprzednia probe
 * generowania - patrz retry w generateUberReportWithRetry). Skutkowalo to proba
 * klikniecia zakladki "Okno rozliczenia", ktora jest wtedy w DOM, ale niewidoczna
 * ("locator.click: Element is not visible"). Dlatego - jak przy zwijaniu - sterujemy
 * STANEM (sprawdz -> ewentualnie kliknij -> sprawdz ponownie), a nie liczba klikniec.
 */
async function ensureTimeFramePanelOpen(page, timeFrameTrigger) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await isTimeFramePanelOpen(page)) return true;
    await dismissChatBubble(page);
    await humanClick(timeFrameTrigger);
    await humanDelay(300, 600);
  }
  return isTimeFramePanelOpen(page);
}

/**
 * Klika element, ktory moze byc ZASLONIETY przez nakladke, ktorej nie udalo sie zamknac.
 *
 * Powod (log z zywego uruchomienia, 2026-09-07 07:00:11): po wybraniu gotowego okna
 * rozliczenia panel "Przedzial czasowy raportu" zostal otwarty, a Playwright przez ~50 s
 * ponawial klikniecie w pole organizacji, ktore odbijalo sie od panelu ("<div
 * role=\"tabpanel\" data-baseweb=\"tab-panel\"> ... subtree intercepts pointer events"),
 * az partner sam zamknal przegladarke - z zewnatrz wygladalo to jak "automat wybral okres
 * i nie wchodzi w organizacje".
 *
 * Zwijanie panelu (collapseTimeFramePanel) zostaje jako pierwsza linia obrony, ale nie
 * moze byc JEDYNA - to nakladka strony trzeciej i jej zachowanie jest poza nasza
 * kontrola. Gdy zwykle (pozycyjne) klikniecie nie przechodzi w rozsadnym czasie,
 * wywolujemy natywne .click() bezposrednio na elemencie w DOM: zdarzenie idzie prosto do
 * elementu, z pominieciem trafiania kursorem, wiec zadna nakladka go nie przechwyci. To
 * ta sama technika, ktora w tym pliku sprawdzila sie juz dla checkboxa organizacji (i w
 * partnertax.js dla checkboxa DELETE). Krotki timeout zamiast domyslnych 30 s, bo
 * czekanie i tak nic tu nie zmieni - nakladka nie zniknie sama.
 */
async function clickEvenIfOverlaid(locator, label, log) {
  try {
    await humanClick(locator, { timeout: 5000 });
    return;
  } catch (error) {
    log?.(`Klikniecie w "${label}" zostalo przechwycone przez nakladke - klikam element bezposrednio w DOM.`);
    await locator.evaluate(
      (el) => {
        el.focus?.();
        el.click();
      },
      undefined,
      { timeout: 5000 }
    );
  }
}

/**
 * Otwiera liste organizacji w dialogu "Wygeneruj raport". Zgloszenie klienta (2026-09-14,
 * po wybraniu GOTOWEGO okna rozliczenia): pole jest widoczne, ale automat nie potrafi go
 * kliknac - log pokazal nieudane zwykle klikniecie, a potem 30 s wiszace "klikniecie w DOM"
 * (locator.evaluate bez limitu czasu). Nie wiemy na pewno, co przechwytuje klikniecie, wiec
 * zamiast jednej techniki probujemy kolejno kilku, kazdej z KROTKIM limitem czasu, i po
 * kazdej sprawdzamy STAN (czy checkboxy organizacji sa widoczne), a nie to, czy samo
 * klikniecie "przeszlo". Do logu zapisujemy element, ktory lezy nad polem - zeby przy
 * kolejnym problemie wiedziec, co je zaslania.
 */
async function openOrganizationList(page, orgInput, log) {
  const labels = page.locator('label[data-baseweb="checkbox"]');
  const isOpen = async (timeout = 1500) => {
    try {
      await labels.first().waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  };

  await orgInput.waitFor({ state: 'attached', timeout: 10000 });
  if (await isOpen(200)) return;

  const describeElementOnTop = () =>
    orgInput
      .evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        if (!top) return 'brak elementu w tym punkcie';
        if (top === el || el.contains(top) || top.contains(el)) return null;
        const attrs = ['data-testid', 'data-baseweb', 'role', 'aria-label']
          .map((name) => (top.getAttribute(name) ? `${name}="${top.getAttribute(name)}"` : ''))
          .filter(Boolean)
          .join(' ');
        return `<${top.tagName.toLowerCase()} ${attrs}> "${(top.textContent || '').trim().slice(0, 60)}"`;
      }, undefined, { timeout: 3000 })
      .catch((error) => `nie udalo sie sprawdzic (${error.message.split('\n')[0]})`);

  const wrapper = orgInput.locator('xpath=ancestor::*[@data-baseweb="input" or @data-baseweb="select"][1]');
  const strategies = [
    ['zwykle klikniecie', () => humanClick(orgInput, { timeout: 3000 })],
    ['klikniecie w obudowe pola (force)', () => wrapper.first().click({ force: true, timeout: 3000 })],
    [
      'zdarzenia myszy w DOM',
      () =>
        orgInput.evaluate(
          (el) => {
            el.scrollIntoView({ block: 'center' });
            el.focus?.();
            for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
              const EventType = type.startsWith('pointer') ? PointerEvent : MouseEvent;
              el.dispatchEvent(new EventType(type, { bubbles: true, cancelable: true, view: window }));
            }
          },
          undefined,
          { timeout: 3000 }
        ),
    ],
    [
      'klawiatura',
      async () => {
        await orgInput.focus({ timeout: 3000 });
        for (const key of ['Enter', 'ArrowDown', 'Space']) {
          await page.keyboard.press(key);
          if (await isOpen(700)) return;
        }
      },
    ],
  ];

  for (const [name, run] of strategies) {
    await dismissChatBubble(page);
    const onTop = await describeElementOnTop();
    if (onTop) log?.(`Pole "Wybierz organizacje" jest zasloniete przez: ${onTop}`);
    await run().catch((error) => log?.(`Otwieranie listy organizacji (${name}) nie powiodlo sie: ${error.message.split('\n')[0]}`));
    if (await isOpen()) return;
    log?.(`Lista organizacji nie otworzyla sie po: ${name} - probuje inaczej.`);
  }
  throw new Error('Nie udalo sie otworzyc listy organizacji (pole "Wybierz organizacje") zadnym sposobem.');
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

/** Godzina ustawiana w obu polach czasu zakresu niestandardowego (poczatek doby rozliczeniowej Ubera). */
const UBER_CUSTOM_RANGE_TIME = '4:00 AM';

/** "4:00 AM" / "04:00 AM" / "4:00AM" / "04:00" -> "4:00 AM" - do porownan niezaleznych od formatu. */
function normalizeUberTime(text) {
  const match = String(text || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const suffix = match[3]?.toUpperCase();
  if (!suffix) {
    // Format 24-godzinny - przeliczamy na 12-godzinny, zeby porownywac jednolicie.
    const pm = hours >= 12;
    hours = hours % 12 || 12;
    return `${hours}:${match[2]} ${pm ? 'PM' : 'AM'}`;
  }
  return `${hours}:${match[2]} ${suffix}`;
}

/**
 * Ustawia godzine w polu czasu zakresu niestandardowego (Base Web TimePicker: input
 * role="combobox" z aria-label "Selected 4:00 AM. Select a time, 12-hour format.", obok
 * div z atrybutem value="4:00 AM"). Klient (2026-09-14): przy "Zakres niestandardowy" obie
 * godziny - rozpoczecia i zakonczenia - musza byc 4:00 AM. Najpierw sprawdzamy biezaca
 * wartosc (czesto juz jest poprawna - wtedy nic nie klikamy), potem wybieramy opcje z listy,
 * a gdyby jej nie bylo widac - wpisujemy godzine i zatwierdzamy Enterem. Na koncu weryfikacja.
 */
async function selectUberTime(page, combobox, time, label, log) {
  const expected = normalizeUberTime(time);
  const readCurrent = async () => {
    const ariaLabel = await combobox.getAttribute('aria-label').catch(() => '');
    const fromAria = ariaLabel?.match(/(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i)?.[1];
    if (fromAria) return normalizeUberTime(fromAria);
    const shown = await combobox
      .locator('xpath=ancestor::*[.//*[@value]][1]//*[@value]')
      .first()
      .getAttribute('value')
      .catch(() => null);
    return normalizeUberTime(shown);
  };

  if ((await readCurrent()) === expected) return;

  await dismissChatBubble(page);
  await humanClick(combobox);
  await humanDelay(300, 600);
  const [hours, rest] = expected.split(':');
  const option = page
    .getByRole('option')
    .filter({ hasText: new RegExp(`^\\s*0?${hours}:${rest.replace(' ', '\\s*')}\\s*$|^\\s*0?${hours}:${rest.slice(0, 2)}\\s*$`, 'i') })
    .first();
  if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
    await humanClick(option);
  } else {
    log?.(`Nie widze opcji "${time}" na liscie pola "${label}" - wpisuje godzine recznie.`);
    await combobox.fill(time).catch(async () => {
      await combobox.pressSequentially(time, { delay: 50 });
    });
    await humanDelay(300, 600);
    await combobox.press('Enter');
  }
  await humanDelay(300, 600);

  const actual = await readCurrent();
  if (actual !== expected) {
    throw new Error(`Pole godziny "${label}" pokazuje "${actual}" zamiast oczekiwanego "${time}" - wybor godziny w Uberze najwyrazniej sie nie powiodl.`);
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
 * Pozycje rozwinietej listy "Typ zgloszenia", ZAWEZONE do tej jednej listy. Zawezenie
 * jest konieczne, bo `allTextContents()` czyta takze elementy ukryte, a na stronie sa
 * inne listy z role="option" (m.in. okna rozliczeniowe w panelu przedzialu czasowego) -
 * bez zawezenia teksty z nich wmieszalyby sie w liste typow raportu i przesunely indeksy.
 * Kolejnosc: lista wskazana przez aria-controls comboboksa (tak jest na zywym DOM), potem
 * jedyna widoczna w tym momencie lista, a na koncu widoczne opcje gdziekolwiek.
 */
async function reportTypeOptionsLocator(page) {
  const controls = await page.locator('#report-type').getAttribute('aria-controls').catch(() => null);
  if (controls) {
    const options = page.locator(`[id="${controls}"] [role="option"]`);
    if ((await options.count()) > 0) return options;
  }
  const visibleListbox = page.locator('[role="listbox"]:visible').first();
  if ((await visibleListbox.count()) > 0) {
    const options = visibleListbox.locator('[role="option"]');
    if ((await options.count()) > 0) return options;
  }
  return page.locator('[role="option"]:visible');
}

/**
 * Jedna proba wypelnienia i wyslania formularza "Wygeneruj raport" (typ -> daty ->
 * organizacja -> Wygeneruj). Zaklada, ze dialog jest juz otwarty (otwiera go wywolujacy).
 * Rzuca blad przy pierwszej niespojnosci (zla data, brak organizacji, itp.) zamiast probowac
 * kontynuowac w niepewnym stanie - patrz generateUberReportWithRetry, ktora lapie te bledy
 * i probuje od nowa.
 */
async function attemptGenerateUberReport(page, from, to, account, log) {
  // Domyslny "Report type" to "Driver Activity"/"Czas i odleglosc kierowcy" - trzeba
  // przelaczyc na typ wybrany w konfiguracji konta (domyslnie "Platnosci - kierowca").
  // Jezyk UI jest nieprzewidywalny (widziany polski i angielski dla tego samego konta w
  // roznych sesjach), a opcje listy nie maja zadnego stabilnego atrybutu, wiec czytamy
  // teksty wszystkich pozycji i dopasowujemy je po normalizacji - patrz
  // uberReportTypes.js. Combobox ma stabilne id="report-type"; kazda opcja to
  // li[role="option"] z zagniezdzonym divem o tym samym tekscie, wiec zliczamy TYLKO
  // zewnetrzne elementy (role="option"), inaczej kazda pozycja liczylaby sie dwa razy.
  const reportType = resolveUberReportType(account.reportType);
  await dismissChatBubble(page);
  await humanClick(page.locator('#report-type'));
  await humanDelay(300, 700);
  const reportTypeOptions = await reportTypeOptionsLocator(page);
  const optionTexts = (await reportTypeOptions.allTextContents()).map((text) => text.trim());
  const optionIndex = pickReportTypeOptionIndex(optionTexts, reportType);
  if (optionIndex < 0) {
    throw new Error(
      `Na liscie "Typ zgloszenia" w Uberze nie ma opcji "${reportType.label}" ("${reportType.labelEn}"). Uber pokazuje: ${optionTexts.map((text) => `"${text}"`).join(', ')}. Wybierz jeden z tych typow w konfiguracji konta.`
    );
  }
  await humanClick(reportTypeOptions.nth(optionIndex));
  await humanDelay(400, 900);

  // Zweryfikowane na zywym DOM (zrzut od klienta, 2026-09-07): zewnetrzne pole "Przedzial
  // czasowy raportu" to readonly <input> z placeholderem ("Wybierz przedzial czasowy
  // raportu" / "Select time frame for report") i biezaca wartoscia w .value, opakowany w
  // standardowe divy BaseWeb ("input"/"base-input"). UWAGA: przycisk
  // data-testid="payment-time-range-picker-button" to NIE jest to pole (wczesniejsza
  // poprawka mylila te dwa elementy) - to osobny, ZAGNIEZDZONY picker WEWNATRZ zakladki
  // "Okno rozliczenia", patrz findMatchingSettlementWindowOption. Klikniecie tego pola
  // rozwija panel z dwiema zakladkami: "Settlement window" (gotowe okna rozliczeniowe,
  // domyslnie aktywna) i "Custom range" (edytowalne pola Start/End date). UWAGA: strona w
  // tle ma WLASNY, INNY zestaw zakladek ("Zgloszenia"/"Harmonogramy" - historia
  // raportow), wiec zwykle getByRole('tab').nth(1) trafia w niewlasciwy zestaw. Zakladki
  // tla maja w id/aria-controls segment "reports/" (np.
  // "tabs-bui1-tab-reports/report-schedules"), zakladki w panelu nie - filtrujemy po tym,
  // zeby zawezic do panelu.
  // .first() - uzasadnienie jak przy polu organizacji nizej (tryb strict Playwrighta).
  const timeFrameTrigger = page
    .getByPlaceholder(/select time frame for report|wybierz przedzia. czasowy raportu/i)
    .first();
  await timeFrameTrigger.waitFor({ state: 'visible' });
  const readTimeFrameValue = async () => (await timeFrameTrigger.inputValue().catch(() => ''))?.trim();
  // Uber czasem wypelnia to pole domyslnym zakresem (poprzednie okno rozliczeniowe) JUZ
  // PRZED otwarciem panelu (zaobserwowane na zywo). Jesli ten domyslny zakres juz
  // pokrywa sie z wyliczonym "from"/"to", pomijamy caly ponizszy taniec z zakladka
  // "Custom range" i klikaniem w kalendarz - to najbardziej zawodna czesc calego flow
  // (patrz komentarze przy selectUberCalendarDay/navigateCalendarMonths), a przy zgodnym
  // zakresie jest calkowicie zbedna.
  const prefilledRange = parseUberTimeRangeValue(await readTimeFrameValue());
  const rangeAlreadyCorrect = prefilledRange?.from === from && prefilledRange?.to === to;

  if (!rangeAlreadyCorrect) {
    if (!(await ensureTimeFramePanelOpen(page, timeFrameTrigger))) {
      throw new Error('Nie udalo sie rozwinac panelu "Przedzial czasowy raportu" (po kliknieciu w pole nie pojawily sie ani okno rozliczenia, ani pola zakresu dat).');
    }

    // Zakladka "Okno rozliczenia" (Settlement window) jest aktywna domyslnie zaraz po
    // otwarciu panelu - klient poprosil, zeby automat na niej ZOSTAWAL i najpierw
    // sprawdzil, czy szukanego okresu nie ma juz na gotowej liscie okien rozliczeniowych
    // (rozwijanej zagniezdzonym pickerem - patrz findMatchingSettlementWindowOption).
    // Dopiero gdy zadna pozycja z tej listy nie pasuje, przechodzimy na "Zakres
    // niestandardowy" i wybieramy daty recznie w kalendarzu.
    const settlementPicker = page.locator('[data-testid="payment-time-range-picker-button"]');
    const settlementOption = await findMatchingSettlementWindowOption(page, settlementPicker, from, to);
    if (settlementOption) {
      await dismissChatBubble(page);
      await humanClick(settlementOption);
      await humanDelay(300, 600);
      // Po wyborze okna zakres pokazuja DWA elementy: zewnetrzne pole "Przedzial czasowy
      // raportu" i sam picker w zakladce. Uber nie zawsze aktualizuje oba natychmiast,
      // wiec akceptujemy potwierdzenie z ktoregokolwiek z nich, zamiast wywracac cala
      // probe przez chwilowy brak synchronizacji jednego z pol.
      const matchesExpected = (value) => {
        const parsed = parseUberTimeRangeValue(value);
        return parsed?.from === from && parsed?.to === to;
      };
      const outerValue = await readTimeFrameValue();
      const pickerValue = (await settlementPicker.textContent().catch(() => ''))?.trim();
      if (!matchesExpected(outerValue) && !matchesExpected(pickerValue)) {
        throw new Error(`Po wybraniu gotowego okna rozliczenia pole "Przedzial czasowy raportu" pokazuje "${outerValue}" (picker w zakladce: "${pickerValue}") zamiast oczekiwanego okresu ${from} - ${to}.`);
      }
      // Panel z zakladkami zostaje otwarty i zaslania pola ponizej (organizacje, przycisk
      // "Wygeneruj") - musimy go zwinac, inaczej przechwyci kolejne kliknieca. Najpierw
      // zagniezdzona liste okien (gdyby po wyborze nie zwinela sie sama), potem panel.
      await collapseSettlementPicker(page, settlementPicker);
      await collapseTimeFramePanel(page, timeFrameTrigger, log);
    } else {
      // Na liscie okien rozliczeniowych nie bylo szukanego okresu - zwijamy zagniezdzony
      // picker (jego rozwinieta lista zaslania zakladki) i przechodzimy na "Zakres
      // niestandardowy".
      await collapseSettlementPicker(page, settlementPicker);
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

      // Godziny obu krancow zakresu: 4:00 AM (Base Web TimePicker, role="combobox").
      const timeInputs = page.locator('input[role="combobox"][aria-label*="Select a time" i]');
      await timeInputs.nth(1).waitFor({ state: 'visible', timeout: 10000 });
      await selectUberTime(page, timeInputs.nth(0), UBER_CUSTOM_RANGE_TIME, 'Godzina rozpoczecia', log);
      await selectUberTime(page, timeInputs.nth(1), UBER_CUSTOM_RANGE_TIME, 'Godzina zakonczenia', log);
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
      await collapseTimeFramePanel(page, timeFrameTrigger, log);
    }
  }

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
  // .first(): gdyby ten sam placeholder wystapil na stronie wiecej niz raz (np. pozostaly
  // w DOM popover z poprzedniej, nieudanej proby), tryb strict Playwrighta rzuca blad
  // JESZCZE PRZED kliknieciem - z zewnatrz wyglada to dokladnie jak "automat nie klika w
  // pole organizacji".
  const orgInput = page
    // \s zamiast spacji: Uber wstawia w polskich tekstach twarde spacje (&nbsp;).
    .getByPlaceholder(/select\s+organizations|wybierz\s+organizacj/i)
    .first();
  // Zabezpieczenie: gdyby panel "Przedzial czasowy raportu" mimo wszystko byl nadal
  // otwarty, jest nakladka zaslaniajaca to wlasnie pole i przechwytuje ponizsze
  // klikniecie (zgloszenie klienta 2026-09-07: "nie wybiera organizacji"). Wywolanie jest
  // idempotentne - przy zamknietym panelu nie robi nic.
  await collapseTimeFramePanel(page, timeFrameTrigger, log);
  await openOrganizationList(page, orgInput, log);
  await humanDelay(300, 700);
  // `label[data-baseweb="checkbox"]` bez zawezenia szuka na CALEJ stronie, nie tylko w tym
  // konkretnym popoverze - Base Web (ten sam system komponentow) jest uzywany w wielu
  // miejscach aplikacji. Popover z lista organizacji renderuje sie przez React portal, a
  // wyzwalacz ma `aria-controls` wskazujacy na ID tego portalu - jesli uda sie go
  // odczytac, zawezamy szukanie checkboxow do tego jednego kontenera.
  //
  // UWAGA (2026-09-07, zgloszenie klienta "nie klika pola organizacji"): wczesniej
  // wymagalismy TWARDO wrappera <span aria-haspopup="true"> i bez niego przerywalismy cale
  // generowanie bledem. Na zywym DOM pole organizacji ma jednak strukture BaseWeb bez tych
  // atrybutow na spanie (<div data-baseweb="input"><div data-baseweb="base-input"><input
  // readonly placeholder="Wybierz organizacje...">), wiec ten warunek wywracal caly krok.
  // Teraz szukamy NAJBLIZSZEGO przodka z aria-controls niezaleznie od tagu, a gdy takiego
  // nie ma - po prostu nie zawezamy (tak dzialal ten krok, zanim zawezenie dodano).
  // Zawezenie jest optymalizacja, a nie warunkiem koniecznym.
  const orgTriggerWrapper = orgInput.locator('xpath=ancestor::*[@aria-controls][1]');
  const orgPopoverId =
    (await orgTriggerWrapper.count().catch(() => 0)) > 0
      ? await orgTriggerWrapper.first().getAttribute('aria-controls').catch(() => null)
      : null;
  const orgLabels = (orgPopoverId ? page.locator(`#${orgPopoverId}`) : page).locator(
    'label[data-baseweb="checkbox"]'
  );
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
  await clickEvenIfOverlaid(generateButton, 'Wygeneruj', log);
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
      await attemptGenerateUberReport(page, from, to, account, log);
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
