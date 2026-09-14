const { normalizeForCompare } = require('./reportValidator');

/**
 * Dopasowanie opcji <select> panelu PartnerTax admin po widocznym tekscie zamiast po
 * numerycznych ID (ID to klucze bazy danych konkretnej instalacji - u kazdego partnera
 * inne). Tylko rownosc po normalizacji, nigdy "zawiera" - inaczej "Bolt" trafialby
 * w "Bolt Food".
 */

function usableOptions(options) {
  return options.filter((option) => option.value !== '' && normalizeForCompare(option.text) !== '');
}

function distinctValues(options) {
  return [...new Set(options.map((option) => option.value))];
}

function describeOptions(options) {
  return options.map((option) => `"${option.text.trim()}" (${option.value})`).join(', ');
}

function ambiguousError(fieldName, label, matched) {
  return new Error(
    `PartnerTax admin: niejednoznaczna opcja "${label}" w polu ${fieldName} - pasuje kilka wpisow: ${describeOptions(matched)}. Ujednolic nazwy w panelu albo zglos to do poprawki w automacie.`
  );
}

function findMatchingOptions(options, candidates) {
  const keys = new Set(candidates.map(normalizeForCompare));
  return usableOptions(options).filter((option) => keys.has(normalizeForCompare(option.text)));
}

/**
 * Opcje, ktorych znormalizowany tekst ZAWIERA ktorego kandydata. Tylko dla Company:
 * panel Nova ma "UNITY DRIVE SP Z O O", a konto "Unity Drive" (zrzut 2026-09-14).
 */
function findContainingOptions(options, candidates) {
  const keys = candidates.map(normalizeForCompare).filter((key) => key !== '');
  return options.filter((option) => keys.some((key) => normalizeForCompare(option.text).includes(key)));
}

/**
 * Zwraca ID jednej opcji. Kolejnosc: dokladny tekst kolejnych kandydatow (rozstrzyga
 * duplikaty typu "Bolt"=17 / "BOLT"=65 w panelu Nova), potem rownosc po normalizacji,
 * a przy allowContains na koncu jednoznaczne "zawiera".
 */
function matchOptionValue(options, candidates, { fieldName, allowContains = false }) {
  const usable = usableOptions(options);

  for (const candidate of candidates) {
    const exact = usable.filter((option) => option.text.trim() === candidate.trim());
    const exactValues = distinctValues(exact);
    if (exactValues.length === 1) return exactValues[0];
    if (exactValues.length > 1) throw ambiguousError(fieldName, candidate, exact);
  }

  let matched = findMatchingOptions(usable, candidates);
  if (matched.length === 0 && allowContains) {
    matched = findContainingOptions(usable, candidates);
  }
  const values = distinctValues(matched);
  if (values.length === 1) return values[0];
  if (values.length === 0) {
    throw new Error(
      `PartnerTax admin: brak opcji "${candidates.join('" / "')}" w polu ${fieldName}. Dostepne: ${describeOptions(usable)}.`
    );
  }
  throw ambiguousError(fieldName, candidates[0], matched);
}

function findAllOptionValues(options, candidates) {
  return distinctValues(findMatchingOptions(options, candidates));
}

module.exports = { matchOptionValue, findAllOptionValues };
