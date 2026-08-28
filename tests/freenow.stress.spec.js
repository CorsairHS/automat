const path = require('path');
const os = require('os');
const fs = require('fs');
const { test, expect, chromium } = require('playwright/test');
const { syncFreenowAccount } = require('../src/main/automation/platforms/freenow');
const { installFreenowMock } = require('./mocks/freenowPortalMock');

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

function collectStatusMessages() {
  const messages = [];
  return { statusCallback: (msg) => messages.push(msg), messages };
}

test.describe('FreeNow resilience', () => {
  let browser;
  let downloadDir;

  test.beforeEach(async () => {
    browser = await chromium.launch();
    downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freenow-test-'));
  });

  test.afterEach(async () => {
    await browser.close();
    fs.rmSync(downloadDir, { recursive: true, force: true });
  });

  test('happy path: login, pobranie ZIP, rozpakowanie wariantu WITH VAT', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    await installFreenowMock(context, {});
    const account = makeAccount();

    const status = collectStatusMessages();
    const result = await syncFreenowAccount({ context, account, downloadDir, statusCallback: status.statusCallback });

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(result.filePath).toMatch(/with[_\s-]?vat/i);
    expect(fs.readFileSync(result.filePath, 'utf8')).toContain('with_vat,column');
    expect(status.messages.some((m) => m.includes('Loguje sie do FreeNow'))).toBe(true);
  });

  test('sesja juz zalogowana: pomija formularz logowania', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    await installFreenowMock(context, { startLoggedIn: true });
    const account = makeAccount();

    const status = collectStatusMessages();
    const result = await syncFreenowAccount({ context, account, downloadDir, statusCallback: status.statusCallback });

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(result.filePath).toMatch(/with[_\s-]?vat/i);
    expect(status.messages.some((m) => m.includes('Loguje sie do FreeNow'))).toBe(false);
  });

  test('duplikat linku Zarobki: dopasowanie po dokladnym tekscie omija kolizje', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    await installFreenowMock(context, { duplicateEarningsLink: true });
    const account = makeAccount();

    const result = await syncFreenowAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);

    const inspectionPage = await context.newPage();
    await inspectionPage.goto('https://portal.free-now.com/dashboard');
    expect(await inspectionPage.locator('a[href$="/earnings"]').count()).toBe(2);
    expect(await inspectionPage.getByText('Zarobki', { exact: false }).count()).toBeGreaterThan(1);
    await inspectionPage.close();
  });

  test('brak wariantu WITH VAT: syncFreenowAccount rzuca czytelnym bledem', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    await installFreenowMock(context, { includeWithVatFile: false });
    const account = makeAccount();

    await expect(
      syncFreenowAccount({ context, account, downloadDir, statusCallback: () => {} })
    ).rejects.toThrow(/nie znaleziono pliku wariantu with vat/i);
  });
});
