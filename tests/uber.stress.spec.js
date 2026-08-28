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
    await installUberMock(context, { reportAlreadyExists: true });
    const account = makeAccount();

    const result = await syncUberAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(fs.readFileSync(result.filePath, 'utf8')).toContain('data,column');
  });

  test('pelne generowanie: dialog, kalendarz, organizacja, pobranie', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    await installUberMock(context, { reportAlreadyExists: false, requireReloadForDownloadReady: false });
    const account = makeAccount();

    const result = await syncUberAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
  });

  test('popup po wyborze dat: dismissChatBubble odslania kolejny klik', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    await installUberMock(context, {
      reportAlreadyExists: false,
      requireReloadForDownloadReady: false,
      popupAfterDateSelection: true,
    });
    const account = makeAccount();

    const result = await syncUberAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
  });

  test('zawieszony status W toku: syncUberAccount odswieza strone i konczy sukcesem', async () => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ acceptDownloads: true });
    await installUberMock(context, { reportAlreadyExists: false, requireReloadForDownloadReady: true });
    const account = makeAccount();

    const result = await syncUberAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
  });
});
