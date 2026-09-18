const { test, expect } = require('playwright/test');
const {
  resolveUberReportType,
  pickReportTypeOptionIndex,
} = require('../src/main/automation/uberReportTypes');
const { UBER_REPORT_TYPES, DEFAULT_UBER_REPORT_TYPE_ID } = require('../src/main/platforms');

// Dokladnie te teksty zwrocil zywy DOM listy "Typ zgloszenia" (zrzut od klienta,
// 2026-09-18) - z twarda spacja (&nbsp; ->  ) w "Czas i odleglosc..." i z
// polkwadratem (–) w "Platnosci – kierowca". Oba znaki wywracaja naiwne porownanie
// tekstu, wiec musza zostac w fixture doslownie takie, jakie sa na stronie.
const LIVE_PL_OPTIONS = [
  'Czas i odległość kierowcy',
  'Czas i odległość pojazdu',
  'Jakość obsługi oferowanej przez kierowcę',
  'Osiągi pojazdu',
  'Płatności – kierowca',
  'Płatności – organizacja',
  'Przejazdy',
  'Status kierowcy',
  'Transakcja płatnicza',
  'Wyświetl aktywność kierowcy',
];

test.describe('resolveUberReportType', () => {
  test('brak ustawienia na koncie daje domyslny typ (Platnosci - kierowca)', () => {
    expect(resolveUberReportType(undefined).id).toBe(DEFAULT_UBER_REPORT_TYPE_ID);
    expect(resolveUberReportType(null).id).toBe('payments_driver');
    expect(resolveUberReportType('').id).toBe('payments_driver');
  });

  test('zwraca wybrany typ', () => {
    const type = resolveUberReportType('payments_organization');
    expect(type.label).toBe('Płatności – organizacja');
    expect(type.fileSlug).toBe('payments_organization');
  });

  test('nieznane id konczy sie czytelnym bledem, nie cichym fallbackiem', () => {
    expect(() => resolveUberReportType('nie_ma_takiego')).toThrow(/nie_ma_takiego/);
  });

  test('kazdy typ ma unikalne id i etykiete', () => {
    const ids = UBER_REPORT_TYPES.map((t) => t.id);
    const labels = UBER_REPORT_TYPES.map((t) => t.label);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

test.describe('pickReportTypeOptionIndex', () => {
  test('trafia w polska etykiete mimo twardej spacji i polkwadratu', () => {
    expect(pickReportTypeOptionIndex(LIVE_PL_OPTIONS, resolveUberReportType('payments_driver'))).toBe(4);
    expect(pickReportTypeOptionIndex(LIVE_PL_OPTIONS, resolveUberReportType('driver_time_and_distance'))).toBe(0);
  });

  test('trafia w etykiete angielska (Uber losowo przelacza jezyk UI)', () => {
    const enOptions = ['Driver Activity', 'Payments Driver', 'Trips'];
    expect(pickReportTypeOptionIndex(enOptions, resolveUberReportType('payments_driver'))).toBe(1);
    expect(pickReportTypeOptionIndex(enOptions, resolveUberReportType('driver_activity'))).toBe(0);
  });

  test('ignoruje wielkosc liter i brak polskich znakow', () => {
    expect(pickReportTypeOptionIndex(['platnosci - kierowca'], resolveUberReportType('payments_driver'))).toBe(0);
  });

  test('"Platnosci - kierowca" nie trafia w "Platnosci - organizacja"', () => {
    const only = ['Płatności – organizacja'];
    expect(pickReportTypeOptionIndex(only, resolveUberReportType('payments_driver'))).toBe(-1);
  });

  test('brak opcji na liscie zwraca -1 (wywolujacy raportuje dostepne opcje)', () => {
    expect(pickReportTypeOptionIndex(LIVE_PL_OPTIONS, resolveUberReportType('vehicle_performance'))).toBe(3);
    expect(
      pickReportTypeOptionIndex(LIVE_PL_OPTIONS, resolveUberReportType('driver_auto_positioning_effectiveness'))
    ).toBe(-1);
  });

  test('kazda pozycja z zywej listy PL jest rozpoznana przez dokladnie jeden typ', () => {
    for (const optionText of LIVE_PL_OPTIONS) {
      const matching = UBER_REPORT_TYPES.filter(
        (type) => pickReportTypeOptionIndex([optionText], type) === 0
      );
      expect(matching.map((t) => t.id), `opcja "${optionText}"`).toHaveLength(1);
    }
  });
});
