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

    const result = await syncFreenowAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(result.filePath).toMatch(/with[_\s-]?vat/i);
    expect(fs.readFileSync(result.filePath, 'utf8')).toContain('with_vat,column');
  });

  test('sesja juz zalogowana: pomija formularz logowania', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    await installFreenowMock(context, { startLoggedIn: true });
    const account = makeAccount();

    const result = await syncFreenowAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(result.filePath).toMatch(/with[_\s-]?vat/i);
  });

  test('duplikat linku Zarobki: dopasowanie po dokladnym tekscie omija kolizje', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    await installFreenowMock(context, { duplicateEarningsLink: true });
    const account = makeAccount();

    const result = await syncFreenowAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
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
