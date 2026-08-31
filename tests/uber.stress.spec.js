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
