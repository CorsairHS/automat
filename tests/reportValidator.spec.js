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
