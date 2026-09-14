const { test, expect } = require('playwright/test');
const {
  LEGACY_NOVA_BASE_URL,
  normalizeBaseUrl,
  buildAdminUrls,
  applyLegacyBaseUrlMigration,
} = require('../src/main/partnerTaxConfig');

test.describe('normalizeBaseUrl', () => {
  test('ucina sciezke /admin/ i ukosnik', () => {
    expect(normalizeBaseUrl('https://app.nova-partner.pl/admin/')).toBe('https://app.nova-partner.pl');
  });

  test('dopisuje https gdy brak schematu, przycina spacje', () => {
    expect(normalizeBaseUrl('  panel.inny-partner.pl ')).toBe('https://panel.inny-partner.pl');
  });

  test('rzuca przy pustym adresie', () => {
    expect(() => normalizeBaseUrl('')).toThrow(/Brak adresu panelu/);
    expect(() => normalizeBaseUrl(undefined)).toThrow(/Brak adresu panelu/);
  });

  test('rzuca przy http i smieciach', () => {
    expect(() => normalizeBaseUrl('http://panel.firma.pl')).toThrow(/https/);
    expect(() => normalizeBaseUrl('https://')).toThrow(/Nieprawidlowy adres/);
  });
});

test('buildAdminUrls', () => {
  expect(buildAdminUrls('https://panel.firma.pl')).toEqual({
    loginUrl: 'https://panel.firma.pl/admin/',
    reckoningListUrl: 'https://panel.firma.pl/admin/finances/reckoning/',
  });
});

test.describe('applyLegacyBaseUrlMigration', () => {
  const password = { enc: true, value: 'xxx' };

  test('uzupelnia adres Nova w istniejacym koncie i ustawia flage', () => {
    const { store, changed } = applyLegacyBaseUrlMigration({
      partnertax: [{ accountId: 'a', fields: { username: { enc: false, value: 'u' }, password } }],
    });
    expect(changed).toBe(true);
    expect(store.partnertax[0].fields.baseUrl).toEqual({ enc: false, value: LEGACY_NOVA_BASE_URL });
    expect(store.partnertax[0].fields.password).toEqual(password);
    expect(store._migrations.partnertaxBaseUrl).toBe(true);
  });

  test('nie nadpisuje ustawionego adresu', () => {
    const own = { enc: false, value: 'https://panel.firma.pl' };
    const { store } = applyLegacyBaseUrlMigration({ partnertax: [{ accountId: 'a', fields: { baseUrl: own } }] });
    expect(store.partnertax[0].fields.baseUrl).toEqual(own);
  });

  test('po ustawieniu flagi nic nie robi (nowe konto bez adresu nie dostaje Nova)', () => {
    const input = { _migrations: { partnertaxBaseUrl: true }, partnertax: [{ accountId: 'b', fields: {} }] };
    const { store, changed } = applyLegacyBaseUrlMigration(input);
    expect(changed).toBe(false);
    expect(store.partnertax[0].fields.baseUrl).toBeUndefined();
  });

  test('swieza instalacja: tylko flaga, bez tworzenia klucza partnertax', () => {
    const { store, changed } = applyLegacyBaseUrlMigration({});
    expect(changed).toBe(true);
    expect(store).toEqual({ _migrations: { partnertaxBaseUrl: true } });
  });
});
