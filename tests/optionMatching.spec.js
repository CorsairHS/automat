const { test, expect } = require('playwright/test');
const { matchOptionValue, findAllOptionValues } = require('../src/main/automation/optionMatching');

const SYSTEMS = [
  { value: '', text: '---------' },
  { value: '17', text: 'Bolt' },
  { value: '65', text: 'BOLT' },
  { value: '78', text: 'Bolt Food' },
  { value: '32', text: 'Uber' },
  { value: '2', text: 'Free Now' },
];

test.describe('matchOptionValue', () => {
  test('dokladny tekst wygrywa z duplikatem po normalizacji', () => {
    expect(matchOptionValue(SYSTEMS, ['Bolt'], { fieldName: 'System' })).toBe('17');
  });

  test('dopasowuje po normalizacji (wielkosc liter, spacje, polskie znaki)', () => {
    expect(matchOptionValue(SYSTEMS, ['FreeNow'], { fieldName: 'System' })).toBe('2');
    const cities = [{ value: '7', text: 'Wrocław' }, { value: '11', text: 'Wałbrzych/Jelenia Góra' }];
    expect(matchOptionValue(cities, ['wroclaw'], { fieldName: 'City' })).toBe('7');
    expect(matchOptionValue(cities, ['walbrzych/jelenia gora'], { fieldName: 'City' })).toBe('11');
  });

  test('"Bolt" nie trafia w "Bolt Food"', () => {
    const onlyFood = [{ value: '78', text: 'Bolt Food' }];
    expect(() => matchOptionValue(onlyFood, ['Bolt'], { fieldName: 'System' }))
      .toThrow(/brak opcji "Bolt" w polu System/);
  });

  test('brak dopasowania wypisuje dostepne opcje (bez pustej)', () => {
    let message = '';
    try {
      matchOptionValue(SYSTEMS, ['iTaxi'], { fieldName: 'System' });
    } catch (error) {
      message = error.message;
    }
    expect(message).toContain('"Uber" (32)');
    expect(message).not.toContain('---------');
  });

  test('kilka roznych ID po normalizacji bez dokladnego trafienia = blad niejednoznacznosci', () => {
    const dup = [{ value: '17', text: 'BOLT' }, { value: '65', text: 'bolt' }];
    expect(() => matchOptionValue(dup, ['Bolt'], { fieldName: 'System' })).toThrow(/niejednoznaczna/);
  });

  const COMPANIES = [
    { value: '', text: 'Select value' },
    { value: '5', text: 'UNITY DRIVE SP Z O O' },
    { value: '4', text: 'DA INVESTMENT SP Z O O' },
  ];

  test('allowContains: nazwa firmy bez formy prawnej trafia w pelna nazwe z panelu', () => {
    expect(matchOptionValue(COMPANIES, ['Unity Drive'], { fieldName: 'Company', allowContains: true })).toBe('5');
    expect(matchOptionValue(COMPANIES, ['DA INVESTMENT SP. Z O.O.'], { fieldName: 'Company', allowContains: true })).toBe('4');
  });

  test('allowContains: kilka trafien = blad niejednoznacznosci', () => {
    expect(() => matchOptionValue(COMPANIES, ['SP Z O O'], { fieldName: 'Company', allowContains: true }))
      .toThrow(/niejednoznaczna opcja "SP Z O O" w polu Company/);
  });

  test('bez allowContains "zawiera" nie dziala (miasta)', () => {
    const cities = [{ value: '15', text: 'sulawki/augustow uber' }, { value: '16', text: 'Sulawki Bolt' }];
    expect(() => matchOptionValue(cities, ['Sulawki'], { fieldName: 'City' })).toThrow(/brak opcji "Sulawki" w polu City/);
  });
});

test.describe('findAllOptionValues', () => {
  test('zwraca wszystkie aliasy systemu, bez "Bolt Food"', () => {
    expect(findAllOptionValues(SYSTEMS, ['Bolt'])).toEqual(['17', '65']);
  });

  test('pusta tablica gdy brak dopasowania', () => {
    expect(findAllOptionValues(SYSTEMS, ['iTaxi'])).toEqual([]);
  });
});
