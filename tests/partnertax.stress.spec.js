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

    expect(mock.state.savedSources).toEqual([{ system: '17', city: '7', company: '5', file: '1' }]);
  });

  test('upload wielu plikow: czesciowe niepowodzenie zwraca juz zapisane pliki', async () => {
    const context = await browser.newContext();
    const mock = await installPartnerTaxMock(context, {});
    const account = makeAccount();
    const uploads = [
      makeUpload({ platformId: 'bolt' }),
      makeUpload({ platformId: 'uber' }),
      makeUpload({ platformId: 'freenow', city: 'nieznane-miasto' }),
    ];

    let caughtError;
    try {
      await uploadToPartnerTax({ context, account, uploads, statusCallback: () => {} });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError.message).toMatch(/nieznane miasto/i);
    expect(caughtError.succeededUploads.map((u) => u.platformId)).toEqual(['bolt', 'uber']);
    expect(mock.state.savedSources).toEqual([
      { system: '17', city: '7', company: '5', file: '1' },
      { system: '32', city: '7', company: '5', file: '1' },
    ]);
  });

  test('bardzo wolny zapis: uploadToPartnerTax mimo to konczy sie sukcesem', async () => {
    test.setTimeout(90_000);
    const context = await browser.newContext();
    const mock = await installPartnerTaxMock(context, { hangOnFirstSave: true });
    const account = makeAccount();

    const started = Date.now();
    await uploadToPartnerTax({ context, account, uploads: [makeUpload()], statusCallback: () => {} });

    expect(Date.now() - started).toBeGreaterThan(25_000);
    expect(mock.state.saveAttemptCount).toBe(1);
    expect(mock.state.savedSources).toEqual([{ system: '17', city: '7', company: '5', file: '1' }]);
  });

  test('usuwanie po aliasie systemu: deleteReportsFromPartnerTax wisi mimo poprawnego usuniecia po stronie serwera', async () => {
    const context = await browser.newContext();
    const mock = await installPartnerTaxMock(context, { preSeedSavedSources: [{ system: '65' }] });
    const account = makeAccount();

    let settled = false;
    deleteReportsFromPartnerTax({ context, account, statusCallback: () => {} })
      .then(() => { settled = true; })
      .catch(() => { settled = true; });

    await new Promise((resolve) => setTimeout(resolve, 10_000));

    // Playwright Test nie ma domyslnego limitu czasu akcji (patrz spec) - .evaluate()
    // w getSystemRowValues wisi wiec w nieskonczonosc, nie rzuca czystego bledu w
    // rozsadnym czasie. Zamiast lapac blad, dowodzimy ze obietnica NADAL nie jest
    // rozstrzygnieta po 10s (komfortowy margines ponad ~1-2s normalnej sciezki sukcesu).
    expect(settled).toBe(false);

    // Mimo ze klient (Playwright) nadal czeka, serwer (mock) juz przetworzyl usuniecie -
    // to dokladnie ten sam mechanizm co realnie zgloszony bug klienta ("wisial, a potem
    // wywalal sie bledem mimo ze serwer zdazyl juz zapisac plik"), tylko przy usuwaniu
    // zamiast dodawaniu.
    expect(mock.state.savedSources).toEqual([]);
  });
});
