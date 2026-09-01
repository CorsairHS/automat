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

const PL_MONTHS = { sty: 0, lut: 1, mar: 2, kwi: 3, maj: 4, cze: 5, lip: 6, sie: 7, wrz: 8, paz: 9, lis: 10, gru: 11 };

function parsePolishMonthDate(day, monthAbbrev, year) {
  const key = normalizeForCompare(monthAbbrev).slice(0, 3);
  const monthIndex = PL_MONTHS[key];
  if (monthIndex === undefined) {
    throw new Error(`Nierozpoznany skrot miesiaca: "${monthAbbrev}"`);
  }
  return toISODate(new Date(Number(year), monthIndex, Number(day)));
}

function parseBoltFilename(filename) {
  const match = filename.match(/^Zarobki na kierowc.-(\d{1,2}) (\S+) (\d{4})-(\d{1,2}) (\S+) (\d{4})-(.+)\.csv$/i);
  if (!match) {
    throw new Error(`Nierozpoznany format nazwy pliku Bolt: "${filename}"`);
  }
  const [, d1, m1, y1, d2, m2, y2, company] = match;
  return {
    company,
    periodStart: parsePolishMonthDate(d1, m1, y1),
    periodEnd: parsePolishMonthDate(d2, m2, y2),
  };
}

function parseUberFilename(filename) {
  const match = filename.match(/^(\d{4})(\d{2})(\d{2})-(\d{4})(\d{2})(\d{2})-payments_driver-(.+)\.csv$/i);
  if (!match) {
    throw new Error(`Nierozpoznany format nazwy pliku Uber: "${filename}"`);
  }
  const [, y1, m1, d1, y2, m2, d2, company] = match;
  return {
    company,
    periodStart: `${y1}-${m1}-${d1}`,
    periodEnd: `${y2}-${m2}-${d2}`,
  };
}

function parseFreenowFilename(filename) {
  const match = filename.match(/^earnings_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})_with_VAT\.csv$/i);
  if (!match) {
    throw new Error(`Nierozpoznany format nazwy pliku FreeNow: "${filename}"`);
  }
  const [, periodStart, periodEnd] = match;
  return { company: null, periodStart, periodEnd };
}

function parseBoltFoodFilename(filename) {
  const match = filename.match(/_(\d{4})_W(\d{1,2})\.csv$/i);
  if (!match) {
    throw new Error(`Nierozpoznany format nazwy pliku Bolt Food: "${filename}"`);
  }
  const [, year, week] = match;
  const monday = getIsoWeekMonday(Number(year), Number(week));
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return { company: null, periodStart: toISODate(monday), periodEnd: toISODate(sunday) };
}

module.exports = {
  getIsoWeekMonday,
  normalizeForCompare,
  companiesMatch,
  labelMatchesCity,
  parseBoltFilename,
  parseUberFilename,
  parseFreenowFilename,
  parseBoltFoodFilename,
};
