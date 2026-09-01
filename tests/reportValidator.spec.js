const { test, expect } = require('playwright/test');
const { getIsoWeekMonday } = require('../src/main/automation/reportValidator');
const { toISODate } = require('../src/main/automation/dateRange');

test.describe('getIsoWeekMonday', () => {
  test('zwraca poniedzialek (dzien tygodnia = 1)', () => {
    const monday = getIsoWeekMonday(2026, 34);
    expect(monday.getDay()).toBe(1);
  });

  test('kolejne tygodnie sa oddalone o dokladnie 7 dni', () => {
    const week1 = getIsoWeekMonday(2026, 1);
    const week34 = getIsoWeekMonday(2026, 34);
    const diffDays = Math.round((week34 - week1) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(33 * 7);
  });

  test('poniedzialek tygodnia 1 przypada 29 grudnia poprzedniego roku lub pozniej, ale nie pozniej niz 4 stycznia', () => {
    const week1Monday = getIsoWeekMonday(2026, 1);
    expect(toISODate(week1Monday) >= '2025-12-29').toBe(true);
    expect(toISODate(week1Monday) <= '2026-01-04').toBe(true);
  });
});

test.describe('normalizeForCompare', () => {
  const { normalizeForCompare } = require('../src/main/automation/reportValidator');

  test('lowercase, transliteruje polskie znaki, usuwa nie-alfanumeryczne', () => {
    expect(normalizeForCompare('DA Investment - Wrocław')).toBe('dainvestmentwroclaw');
  });
});

test.describe('companiesMatch', () => {
  const { companiesMatch } = require('../src/main/automation/reportValidator');

  test('dopasowuje mimo formatowania w nazwie pliku Bolta', () => {
    expect(companiesMatch('DA INVESTMENT SP_ Z O_O_', 'DA Investment')).toBe(true);
  });

  test('dopasowuje mimo formatowania w nazwie pliku Ubera', () => {
    expect(companiesMatch('DA_INVESTMENT_SPKA_Z_OGRANICZON_ODPOWIEDZIALNOCI', 'DA Investment')).toBe(true);
  });

  test('wykrywa niezgodnosc firmy', () => {
    expect(companiesMatch('UNITY_DRIVE_SP_Z_O_O', 'DA Investment')).toBe(false);
  });

  test('brak firmy w pliku (FreeNow/Bolt Food) = przepuszcza', () => {
    expect(companiesMatch(null, 'DA Investment')).toBe(true);
  });
});

test.describe('labelMatchesCity', () => {
  const { labelMatchesCity } = require('../src/main/automation/reportValidator');

  test('dopasowuje typowy format etykiety konta', () => {
    expect(labelMatchesCity('DA Investment - Wrocław', 'Wrocław')).toBe(true);
  });

  test('wykrywa niezgodnosc miasta w etykiecie', () => {
    expect(labelMatchesCity('DA Investment - Wrocław', 'Warszawa')).toBe(false);
  });
});
