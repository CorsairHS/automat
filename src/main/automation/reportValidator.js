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

module.exports = { getIsoWeekMonday };
