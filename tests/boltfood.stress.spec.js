const path = require('path');
const os = require('os');
const fs = require('fs');
const { test, expect, chromium } = require('playwright/test');
const { syncBoltFoodAccount } = require('../src/main/automation/platforms/boltfood');
const { installBoltFoodMock } = require('./mocks/boltFoodFleetMock');
const { SAFE_TO_HELP_MARKER } = require('../src/main/automation/loginHelpers');

function makeAccount(overrides = {}) {
  return {
    accountId: 'test-boltfood',
    label: 'Test Bolt Food',
    fields: { email: 'partner@example.com', password: 'secret123', orgId: '26424' },
    ...overrides,
  };
}

test.describe('Bolt Food resilience', () => {
  let browser;
  let downloadDir;

  test.beforeEach(async () => {
    browser = await chromium.launch();
    downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boltfood-test-'));
  });

  test.afterEach(async () => {
    await browser.close();
    fs.rmSync(downloadDir, { recursive: true, force: true });
  });

  test('happy path: logowanie, nawigacja do raportow, pobranie CSV', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    const mock = await installBoltFoodMock(context);

    const result = await syncBoltFoodAccount({
      context,
      account: makeAccount(),
      downloadDir,
      statusCallback: () => {},
    });

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(mock.getDownloadedTypes()).toEqual(['Fleet Courier Earnings and Balances']);
  });

  // Regresja (zgloszenie z zywego uruchomienia 2026-10-07): po poprawnym zalogowaniu
  // automat nie rozpoznawal zalogowanej sesji i pokazywal partnerowi komunikat o
  // mozliwym 2FA, mimo ze Bolt Food zadnego kodu nie wymagal.
  test('po zalogowaniu bez 2FA automat NIE prosi o reczna pomoc', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    await installBoltFoodMock(context);
    const statuses = [];

    await syncBoltFoodAccount({
      context,
      account: makeAccount(),
      downloadDir,
      statusCallback: (msg) => statuses.push(msg),
    });

    expect(statuses.filter((msg) => msg.includes(SAFE_TO_HELP_MARKER))).toEqual([]);
  });

  test('sesja juz zalogowana: pomija ekran logowania', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    const mock = await installBoltFoodMock(context, { startLoggedIn: true });

    const result = await syncBoltFoodAccount({
      context,
      account: makeAccount(),
      downloadDir,
      statusCallback: () => {},
    });

    expect(mock.getLoginPageViews()).toBe(0);
    expect(fs.existsSync(result.filePath)).toBe(true);
  });

  test('modal powitalny zaslaniajacy strone zostaje zamkniety przed pobraniem', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    const mock = await installBoltFoodMock(context, { startLoggedIn: true, showOnboardingModal: true });

    const result = await syncBoltFoodAccount({
      context,
      account: makeAccount(),
      downloadDir,
      statusCallback: () => {},
    });

    expect(mock.getDownloadedTypes()).toEqual(['Fleet Courier Earnings and Balances']);
    expect(fs.existsSync(result.filePath)).toBe(true);
  });
});
