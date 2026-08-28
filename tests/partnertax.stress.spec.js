const path = require('path');
const os = require('os');
const fs = require('fs');
const { test, expect, chromium } = require('playwright/test');
const { uploadToPartnerTax, deleteReportsFromPartnerTax } = require('../src/main/automation/platforms/partnertax');
const { installPartnerTaxMock } = require('./mocks/partnerTaxAdminMock');

function makeAccount(overrides = {}) {
  return {
    accountId: 'test-account',
    label: 'Test Account',
    fields: { username: 'partner', password: 'secret123' },
    ...overrides,
  };
}

function makeUpload(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptx-file-'));
  const filePath = path.join(dir, 'report.csv');
  fs.writeFileSync(filePath, 'a,b\n1,2\n');
  return {
    platformId: 'bolt',
    city: 'wroclaw',
    company: 'unity drive',
    filePath,
    ...overrides,
  };
}

test.describe('PartnerTax admin resilience', () => {
  let browser;

  test.beforeEach(async () => {
    browser = await chromium.launch();
  });

  test.afterEach(async () => {
    await browser.close();
  });

  test('happy path: login + upload jednego pliku', async () => {
    const context = await browser.newContext();
    const mock = await installPartnerTaxMock(context, {});
    const account = makeAccount();

    await uploadToPartnerTax({ context, account, uploads: [makeUpload()], statusCallback: () => {} });

    expect(mock.state.savedSources).toEqual([{ system: '17' }]);
  });

  test('upload wielu plikow: czesciowe niepowodzenie zwraca juz zapisane pliki', async () => {
    const context = await browser.newContext();
    const mock = await installPartnerTaxMock(context, {});
    const account = makeAccount();
    const uploads = [
      makeUpload({ platformId: 'bolt' }),
      makeUpload({ platformId: 'uber', city: 'nieznane-miasto' }),
      makeUpload({ platformId: 'freenow' }),
    ];

    let caughtError;
    try {
      await uploadToPartnerTax({ context, account, uploads, statusCallback: () => {} });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError.message).toMatch(/nieznane miasto/i);
    expect(caughtError.succeededUploads.map((u) => u.platformId)).toEqual(['bolt']);
    expect(mock.state.savedSources).toEqual([{ system: '17' }]);
  });
});
