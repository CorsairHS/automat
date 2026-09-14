const { test, expect } = require('playwright/test');
const nova = require('./fixtures/novaAdminOptions');
const { matchOptionValue, findAllOptionValues } = require('../src/main/automation/optionMatching');
const { SYSTEM_LABEL_CANDIDATES } = require('../src/main/automation/platforms/partnertax');

// ID zahardkodowane w partnertax.js przed refaktorem (2026-08-19) - dopasowanie po
// tekscie na zrzucie z zywego panelu Nova musi dawac dokladnie te same wartosci.
const OLD_SYSTEMS = { bolt: '17', uber: '32', freenow: '2', boltfood: '78' };
const OLD_CITIES = {
  'wroclaw': '7', 'warszawa': '8', 'legnica': '9', 'krakow': '10',
  'walbrzych/jelenia gora': '11', 'bialystok': '12', 'augustow/suwalki': '13', 'lubin': '14',
  'sulawki/augustow uber': '15', 'sulawki bolt': '16', 'poznan': '17', 'leszno': '18',
};
const OLD_COMPANIES = { 'unity drive': '5', 'da investment': '4' };

test.describe('Nova: dopasowanie po tekscie = dawne ID', () => {
  for (const [platformId, value] of Object.entries(OLD_SYSTEMS)) {
    test(`System ${platformId}`, () => {
      expect(matchOptionValue(nova.system, SYSTEM_LABEL_CANDIDATES[platformId], { fieldName: 'System' })).toBe(value);
    });
  }

  test('usuwanie Bolt obejmuje archiwalne "BOLT"=65, nie obejmuje Bolt Food', () => {
    const values = findAllOptionValues(nova.system, SYSTEM_LABEL_CANDIDATES.bolt);
    expect(values).toEqual(expect.arrayContaining(['17', '65']));
    expect(values).not.toContain('78');
  });

  for (const [city, value] of Object.entries(OLD_CITIES)) {
    test(`City ${city}`, () => {
      expect(matchOptionValue(nova.city, [city], { fieldName: 'City' })).toBe(value);
    });
  }

  for (const [company, value] of Object.entries(OLD_COMPANIES)) {
    test(`Company ${company}`, () => {
      expect(matchOptionValue(nova.company, [company], { fieldName: 'Company', allowContains: true })).toBe(value);
    });
  }
});
