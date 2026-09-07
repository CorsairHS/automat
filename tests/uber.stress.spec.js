const path = require('path');
const os = require('os');
const fs = require('fs');
const { test, expect, chromium } = require('playwright/test');
const { syncUberAccount } = require('../src/main/automation/platforms/uber');
const { installUberMock } = require('./mocks/uberSupplierMock');

function makeAccount(overrides = {}) {
  return {
    accountId: 'test-account',
    label: 'Test Account',
    fields: { email: 'partner@example.com', password: 'secret123' },
    periodMode: 'custom',
    periodFrom: '2026-08-05',
    periodTo: '2026-08-07',
    ...overrides,
  };
}

test.describe('Uber resilience', () => {
  let browser;
  let downloadDir;

  test.beforeEach(async () => {
    browser = await chromium.launch();
    downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uber-test-'));
  });

  test.afterEach(async () => {
    await browser.close();
    fs.rmSync(downloadDir, { recursive: true, force: true });
  });

  test('raport juz istnieje: pomija dialog generowania', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    const mock = await installUberMock(context, { reportAlreadyExists: true });
    const account = makeAccount();

    const result = await syncUberAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(fs.readFileSync(result.filePath, 'utf8')).toContain('data,column');
    expect(mock.state.reportGenerating).toBe(false);
  });

  test('pelne generowanie: dialog, kalendarz, organizacja, pobranie', async () => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ acceptDownloads: true });
    const mock = await installUberMock(context, { reportAlreadyExists: false, requireReloadForDownloadReady: false });
    const account = makeAccount();

    const result = await syncUberAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(mock.state.reportGenerating).toBe(true);
  });

  test('popup po wyborze dat: dismissChatBubble odslania kolejny klik', async () => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ acceptDownloads: true });
    const mock = await installUberMock(context, {
      reportAlreadyExists: false,
      requireReloadForDownloadReady: false,
      popupAfterDateSelection: true,
    });
    const account = makeAccount();

    const result = await syncUberAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(mock.state.popupDismissedCount).toBeGreaterThanOrEqual(1);
  });

  test('zawieszony status W toku: syncUberAccount odswieza strone i konczy sukcesem', async () => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ acceptDownloads: true });
    const mock = await installUberMock(context, { reportAlreadyExists: false, requireReloadForDownloadReady: true });
    const account = makeAccount();

    const result = await syncUberAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(mock.state.pageLoadCount).toBeGreaterThan(1);
  });

  test('przycisk "Dalej" nie reaguje za pierwszym razem: syncUberAccount ponawia klikniecie zamiast utknac na kroku 1', async () => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ acceptDownloads: true });
    const mock = await installUberMock(context, { reportAlreadyExists: true, failForwardClicks: 1 });
    const account = makeAccount();

    const result = await syncUberAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(mock.state.forwardClickCount).toBe(2);
  });

  test('Uber pokazuje weryfikacje Arkose ("Ochrona konta") po kroku 1: syncUberAccount czeka i wykrywa reczne rozwiazanie', async () => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ acceptDownloads: true });
    const mock = await installUberMock(context, { reportAlreadyExists: true, showArkoseChallenge: true });
    const account = makeAccount();

    context.on('page', (page) => {
      page
        .waitForSelector('#arkose-solve-button', { state: 'visible', timeout: 15000 })
        .then((el) => el.click())
        .catch(() => {});
    });

    const result = await syncUberAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(mock.state.arkoseSolvedCount).toBe(1);
  });

  test('po rozwiazaniu weryfikacji Arkose Uber wraca do ekranu email: syncUberAccount klika "Dalej" ponownie zamiast utknac', async () => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ acceptDownloads: true });
    const mock = await installUberMock(context, {
      reportAlreadyExists: true,
      showArkoseChallenge: true,
      arkoseReturnsToStep1: true,
    });
    const account = makeAccount();

    context.on('page', (page) => {
      page
        .waitForSelector('#arkose-solve-button', { state: 'visible', timeout: 15000 })
        .then((el) => el.click())
        .catch(() => {});
    });

    const result = await syncUberAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(mock.state.arkoseSolvedCount).toBe(1);
    expect(mock.state.forwardClickCount).toBe(2);
  });

  test('pole hasla renderowane w osadzonym iframe: syncUberAccount znajduje je i wpisuje haslo zamiast ponawiac "Dalej"', async () => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ acceptDownloads: true });
    const mock = await installUberMock(context, { reportAlreadyExists: true, passwordInIframe: true });
    const account = makeAccount();

    const result = await syncUberAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
  });

  test('ukryty "decoy" input[type=password] wczesniej w DOM: syncUberAccount i tak znajduje faktycznie widoczne pole hasla', async () => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ acceptDownloads: true });
    const mock = await installUberMock(context, { reportAlreadyExists: true, decoyHiddenPasswordInput: true });
    const account = makeAccount();

    const result = await syncUberAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
  });

  test('generowanie raportu zawodzi za pierwszym razem (checkbox organizacji sie nie zaznacza): syncUberAccount ponawia cala sekwencje formularza', async () => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ acceptDownloads: true });
    const mock = await installUberMock(context, {
      reportAlreadyExists: false,
      requireReloadForDownloadReady: false,
      failGenerateAttempts: 1,
    });
    const account = makeAccount();

    const result = await syncUberAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(mock.state.dialogOpenCount).toBe(2);
  });

  test('pole "Report time range" juz pokazuje zadany zakres: syncUberAccount nie dotyka kalendarza', async () => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ acceptDownloads: true });
    const mock = await installUberMock(context, {
      reportAlreadyExists: false,
      requireReloadForDownloadReady: false,
      prefilledTimeFrameValue: 'Aug 5, 2026 4:01AM - Aug 7, 2026 4:01AM',
    });
    const account = makeAccount();

    const result = await syncUberAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(mock.state.customRangeTabClicks).toBe(0);
  });

  test('gotowe okno rozliczenia pasuje do wyliczonego okresu: syncUberAccount wybiera je zamiast dotykac kalendarza', async () => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ acceptDownloads: true });
    const mock = await installUberMock(context, {
      reportAlreadyExists: false,
      requireReloadForDownloadReady: false,
      settlementWindowOptions: [
        'Jul 27, 2026 4:01AM - Aug 3, 2026 4:01AM',
        'Aug 5, 2026 4:01AM - Aug 7, 2026 4:01AM',
      ],
    });
    const account = makeAccount();

    const result = await syncUberAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(mock.state.settlementPickerClicks).toBeGreaterThanOrEqual(1);
    expect(mock.state.settlementWindowSelected).toBe('Aug 5, 2026 4:01AM - Aug 7, 2026 4:01AM');
    expect(mock.state.customRangeTabClicks).toBe(0);
  });

  test('panel przedzialu czasowego zamyka sie sam po wyborze okna rozliczenia: syncUberAccount nie otwiera go z powrotem i wybiera organizacje', async () => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ acceptDownloads: true });
    const mock = await installUberMock(context, {
      reportAlreadyExists: false,
      requireReloadForDownloadReady: false,
      settlementWindowOptions: ['Aug 5, 2026 4:01AM - Aug 7, 2026 4:01AM'],
      settlementSelectionClosesPanel: true,
    });
    const account = makeAccount();

    const result = await syncUberAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(mock.state.settlementWindowSelected).toBe('Aug 5, 2026 4:01AM - Aug 7, 2026 4:01AM');
    expect(mock.state.checkedOrgNames).toEqual(['Unity Drive sp. z o.o.']);
    // Sedno regresji: panel zamknal sie sam, wiec pole-wyzwalacz powinno zostac klikniete
    // DOKLADNIE raz (samo otwarcie panelu). Kazde dodatkowe klikniecie to ponowne
    // OTWARCIE panelu, ktory jako nakladka zaslania pole organizacji.
    expect(mock.state.timeFrameTriggerClicks).toBe(1);
  });

  test('zadnego pasujacego okna rozliczenia na liscie: syncUberAccount i tak najpierw ja rozwija i sprawdza, dopiero potem idzie w zakres niestandardowy', async () => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ acceptDownloads: true });
    const mock = await installUberMock(context, {
      reportAlreadyExists: false,
      requireReloadForDownloadReady: false,
      settlementWindowOptions: [
        'Jul 27, 2026 4:01AM - Aug 3, 2026 4:01AM',
        'Aug 3, 2026 4:01AM - Aug 10, 2026 4:01AM',
      ],
    });
    const account = makeAccount();

    const result = await syncUberAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(mock.state.settlementPickerClicks).toBeGreaterThanOrEqual(1);
    expect(mock.state.settlementWindowSelected).toBe(null);
    expect(mock.state.customRangeTabClicks).toBeGreaterThanOrEqual(1);
  });

  // Regresja z zywego uruchomienia (log klienta 2026-09-07 07:00:11): po wybraniu gotowego
  // okna rozliczenia panel "Przedzial czasowy raportu" zostal otwarty i przez ~50 s odbijal
  // klikniecie w pole organizacji ("<div role=\"tabpanel\" data-baseweb=\"tab-panel\"> ...
  // subtree intercepts pointer events"), az partner sam zamknal przegladarke. Automat NIE
  // moze zalezec od tego, czy panel da sie zwinac - kliknieca w pola ponizej musza dochodzic
  // takze wtedy, gdy nakladka zostala na ekranie.
  test('panel przedzialu czasowego nie daje sie zwinac i zaslania formularz: syncUberAccount i tak wybiera organizacje i generuje raport', async () => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ acceptDownloads: true });
    const mock = await installUberMock(context, {
      reportAlreadyExists: false,
      requireReloadForDownloadReady: false,
      settlementWindowOptions: ['Aug 5, 2026 4:01AM - Aug 7, 2026 4:01AM'],
      timeFramePanelIgnoresTriggerClose: true,
    });
    const account = makeAccount();

    const result = await syncUberAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(mock.state.settlementWindowSelected).toBe('Aug 5, 2026 4:01AM - Aug 7, 2026 4:01AM');
    expect(mock.state.checkedOrgNames).toEqual(['Unity Drive sp. z o.o.']);
  });

  test('pole organizacji bez aria-haspopup/aria-controls na wrapperze (struktura BaseWeb z zywego DOM): syncUberAccount i tak je klika i zaznacza organizacje', async () => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ acceptDownloads: true });
    const mock = await installUberMock(context, {
      reportAlreadyExists: false,
      requireReloadForDownloadReady: false,
      orgTriggerWithoutAriaControls: true,
    });
    const account = makeAccount();

    const result = await syncUberAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(mock.state.checkedOrgNames).toEqual(['Unity Drive sp. z o.o.']);
  });

  test('wiele organizacji: syncUberAccount zaznacza te dopasowana do pola "Firma"', async () => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ acceptDownloads: true });
    const mock = await installUberMock(context, {
      reportAlreadyExists: false,
      requireReloadForDownloadReady: false,
      organizations: [{ name: 'Unity Drive sp. z o.o.' }, { name: 'DA Investment sp. z o.o.' }],
    });
    const account = makeAccount({ company: 'DA Investment' });

    const result = await syncUberAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(mock.state.checkedOrgNames).toEqual(['DA Investment sp. z o.o.']);
  });
});
