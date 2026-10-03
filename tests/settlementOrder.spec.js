const { test, expect } = require('playwright/test');
const { sortBySettlementOrder } = require('../src/main/settlementOrder');

const DA = 'DA INVESTMENT SP Z O O';
const UD = 'UNITY DRIVE SP Z O O';

test('kolejnosc jak w ostatnim zamknietym rozliczeniu klienta: firma -> miasto -> platforma', () => {
  // Wejscie w kolejnosci "po platformie" (tak jak dotad szla Kontrola pobran).
  const input = [
    ['uber', 'Wrocław', DA], ['uber', 'Warszawa', UD], ['uber', 'Leszno', UD], ['uber', 'sulawki/augustow uber', UD],
    ['bolt', 'Wrocław', DA], ['bolt', 'Warszawa', DA], ['bolt', 'Kraków', UD], ['bolt', 'Lubin', UD],
    ['bolt', 'Wałbrzych/Jelenia Góra', UD], ['bolt', 'Wrocław', UD], ['bolt', 'Poznan', UD],
    ['freenow', 'Wrocław', DA], ['freenow', 'Wrocław', UD], ['boltfood', 'Wrocław', UD],
  ].map(([platformId, city, company]) => ({ platformId, city, company }));

  const result = sortBySettlementOrder(input).map((i) => `${i.platformId} ${i.city} ${i.company.split(' ')[0]}`);

  expect(result).toEqual([
    'bolt Wrocław DA', 'freenow Wrocław DA', 'uber Wrocław DA', 'bolt Warszawa DA',
    'boltfood Wrocław UNITY', 'bolt Wrocław UNITY', 'freenow Wrocław UNITY',
    'uber Warszawa UNITY', 'bolt Kraków UNITY', 'bolt Wałbrzych/Jelenia Góra UNITY', 'bolt Lubin UNITY',
    'uber sulawki/augustow uber UNITY', 'bolt Poznan UNITY', 'uber Leszno UNITY',
  ]);
});

test('nieznana firma/miasto trafia na koniec w kolejnosci wejscia', () => {
  const input = [
    { platformId: 'bolt', city: 'Gdańsk', company: 'Firma X', id: 1 },
    { platformId: 'uber', city: 'Wrocław', company: DA, id: 2 },
    { platformId: 'uber', city: 'Gdańsk', company: 'Firma X', id: 3 },
  ];
  expect(sortBySettlementOrder(input).map((i) => i.id)).toEqual([2, 1, 3]);
});
