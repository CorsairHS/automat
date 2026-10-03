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
    fields: { username: 'partner', password: 'secret123', baseUrl: 'https://app.nova-partner.pl' },
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
    expect(caughtError.message).toMatch(/brak opcji "nieznane-miasto" w polu City/i);
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

  test('usuwanie po aliasie systemu: deleteReportsFromPartnerTax konczy sie (nie wisi) i usuwa wiersz', async () => {
    test.setTimeout(60_000);
    const context = await browser.newContext();
    const mock = await installPartnerTaxMock(context, { preSeedSavedSources: [{ system: '65' }] });

    // Wczesniej (count() + nth(i).evaluate() w getSystemRowValues) obietnica wisiala w
    // nieskonczonosc po zapisie - zglaszane przez klienta jako zawieszanie sie usuwania.
    const result = await deleteReportsFromPartnerTax({ context, account: makeAccount(), statusCallback: () => {} });

    expect(result.deletedCount).toBe(1);
    expect(mock.state.savedSources).toEqual([]);
  });

  test('usuwanie wielu wierszy: wszystko jednym zapisem, inne systemy nietkniete', async () => {
    test.setTimeout(60_000);
    const context = await browser.newContext();
    const mock = await installPartnerTaxMock(context, {
      systems: [['17', 'Bolt'], ['32', 'Uber'], ['2', 'Freenow'], ['78', 'Bolt Food'], ['90', 'Circle K - faktura']],
      preSeedSavedSources: [
        { system: '17' }, { system: '2' }, { system: '32' }, { system: '17' },
        { system: '78' }, { system: '90' }, { system: '17' }, { system: '32' },
      ],
    });

    const result = await deleteReportsFromPartnerTax({ context, account: makeAccount(), statusCallback: () => {} });

    expect(result.deletedCount).toBe(7);
    expect(mock.state.savedSources).toEqual([{ system: '90' }]);
  });

  test('inny partner: inny adres panelu i inne ID opcji', async () => {
    const context = await browser.newContext();
    const mock = await installPartnerTaxMock(context, {
      baseUrl: 'https://panel.inny-partner.pl',
      systems: [['3', 'Uber'], ['4', 'Bolt Food'], ['5', 'Bolt'], ['6', 'Free Now']],
      cities: [['1', 'Gdańsk']],
      companies: [['9', 'Firma XYZ Sp. z o.o.']],
    });
    const account = makeAccount({
      fields: { username: 'partner', password: 'secret123', baseUrl: 'panel.inny-partner.pl/admin/' },
    });
    const uploads = [
      makeUpload({ platformId: 'bolt', city: 'Gdansk', company: 'firma xyz sp. z o.o.' }),
      makeUpload({ platformId: 'freenow', city: 'Gdansk', company: 'firma xyz sp. z o.o.' }),
    ];

    await uploadToPartnerTax({ context, account, uploads, statusCallback: () => {} });

    expect(mock.state.savedSources).toEqual([
      { system: '5', city: '1', company: '9', file: '1' },
      { system: '6', city: '1', company: '9', file: '1' },
    ]);
  });

  test('brak adresu panelu: czytelny blad przed otwarciem przegladarki', async () => {
    const context = await browser.newContext();
    const mock = await installPartnerTaxMock(context, {});
    const account = makeAccount({ fields: { username: 'partner', password: 'secret123' } });

    await expect(
      uploadToPartnerTax({ context, account, uploads: [makeUpload()], statusCallback: () => {} })
    ).rejects.toThrow(/Brak adresu panelu/);
    expect(mock.state.loggedIn).toBe(false);
  });

  test('niejednoznaczny system: blad zamiast losowego wyboru, formularz nietkniety', async () => {
    const context = await browser.newContext();
    const mock = await installPartnerTaxMock(context, { systems: [['17', 'BOLT'], ['65', 'bolt']] });

    await expect(
      uploadToPartnerTax({ context, account: makeAccount(), uploads: [makeUpload()], statusCallback: () => {} })
    ).rejects.toThrow(/niejednoznaczna opcja "Bolt" w polu System/);
    expect(mock.state.pendingNewRows).toEqual({});
    expect(mock.state.savedSources).toEqual([]);
  });

  test('inny partner: krok usuwania Bolt nie traktuje "Bolt Food" jako Bolt', async () => {
    const context = await browser.newContext();
    const mock = await installPartnerTaxMock(context, {
      baseUrl: 'https://panel.inny-partner.pl',
      systems: [['4', 'Bolt Food'], ['5', 'Bolt']],
      preSeedSavedSources: [{ system: '4' }],
    });
    const account = makeAccount({
      fields: { username: 'partner', password: 'secret123', baseUrl: 'https://panel.inny-partner.pl' },
    });
    const logs = [];

    // Jak w tescie "usuwanie po aliasie": po zapisie Playwright w tym mocku potrafi
    // nie rozstrzygnac obietnicy - sprawdzamy logi i stan serwera, nie wynik funkcji.
    // Petla idzie bolt -> uber -> freenow -> boltfood; krok bolt jest przed jakimkolwiek
    // zapisem, wiec jego log jest deterministyczny.
    deleteReportsFromPartnerTax({ context, account, statusCallback: (m) => logs.push(m) }).catch(() => {});

    await expect
      .poll(() => logs.some((m) => m.startsWith('Brak raportu do usuniecia dla systemu: bolt ')), { timeout: 15_000 })
      .toBe(true);
    // Wiersz Bolt Food usuwa dopiero wlasciwy krok boltfood (inne ID niz w Nova).
    await expect.poll(() => mock.state.savedSources, { timeout: 15_000 }).toEqual([]);
  });
});
