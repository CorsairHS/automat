const path = require('path');
const os = require('os');
const fs = require('fs');
const { test, expect, chromium } = require('playwright/test');
const { syncBoltAccount } = require('../src/main/automation/platforms/bolt');
const { installBoltMock } = require('./mocks/boltFleetMock');

function makeAccount(overrides = {}) {
  return {
    accountId: 'test-account',
    label: 'Test Account',
    fields: { email: 'partner@example.com', password: 'secret123', orgId: 'test-org' },
    periodMode: 'custom',
    periodFrom: '2026-08-05',
    periodTo: '2026-08-07',
    ...overrides,
  };
}

test.describe('Bolt resilience', () => {
  let browser;
  let downloadDir;

  test.beforeEach(async () => {
    browser = await chromium.launch();
    downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-test-'));
  });

  test.afterEach(async () => {
    await browser.close();
    fs.rmSync(downloadDir, { recursive: true, force: true });
  });

  test('happy path: login, wybor dat, pobranie CSV', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    await installBoltMock(context, { startLoggedIn: false });
    const account = makeAccount();

    const result = await syncBoltAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(fs.readFileSync(result.filePath, 'utf8')).toContain('data,column');
  });

  test('sesja juz zalogowana: pomija formularz logowania', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    const mock = await installBoltMock(context, { startLoggedIn: true });
    const account = makeAccount();

    const result = await syncBoltAccount({ context, account, downloadDir, statusCallback: () => {} });

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(mock.getLoginPageServedCount()).toBe(0);
  });
});
