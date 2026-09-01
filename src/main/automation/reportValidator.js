const { toISODate } = require('./dateRange');

/**
 * Poniedzialek tygodnia ISO-8601 danego numeru/roku (tydzien 1 = tydzien zawierajacy
 * pierwszy czwartek roku, rownowaznie: tydzien zawierajacy 4 stycznia).
 */
function getIsoWeekMonday(year, week) {
  const jan4 = new Date(year, 0, 4);
  const jan4DayIso = jan4.getDay() === 0 ? 7 : jan4.getDay(); // Mon=1..Sun=7
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - (jan4DayIso - 1));
  const monday = new Date(week1Monday);
  monday.setDate(week1Monday.getDate() + (week - 1) * 7);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

const POLISH_DIACRITICS = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };

function normalizeForCompare(text) {
  return text
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (ch) => POLISH_DIACRITICS[ch])
    .replace(/[^a-z0-9]/g, '');
}

function companiesMatch(fileCompany, accountCompany) {
  if (!fileCompany) return true;
  const a = normalizeForCompare(fileCompany);
  const b = normalizeForCompare(accountCompany || '');
  if (!b) return true;
  return a.includes(b) || b.includes(a);
}

function labelMatchesCity(label, city) {
  if (!label || !city) return true;
  return normalizeForCompare(label).includes(normalizeForCompare(city));
}

module.exports = { getIsoWeekMonday, normalizeForCompare, companiesMatch, labelMatchesCity };
