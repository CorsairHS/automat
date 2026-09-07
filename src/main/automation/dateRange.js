/**
 * Wylicza zakres dat na podstawie wyboru partnera w GUI (Tydzien biezacy /
 * Tydzien poprzedni / Zakres niestandardowy). Tydzien liczony od poniedzialku.
 */
/**
 * Formatuje date wg lokalnej strefy czasowej (NIE toISOString() - to konwertuje do UTC,
 * co przy CEST/CET przesuwa polnoc lokalna na poprzedni dzien i psuje wyliczenia tygodnia).
 */
function toISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMondayOfWeek(date) {
  const result = new Date(date);
  const day = result.getDay(); // 0 = niedziela
  const diffToMonday = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + diffToMonday);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * `mondayToMonday`: Uber rozlicza okresy tygodniowe od poniedzialku 4:01 do KOLEJNEGO
 * poniedzialku 4:01 (7 dni, nie 6) - potwierdzone na zywym DOM (pole "Report time range":
 * "24 sierpnia - 31 sierpnia") i w nazwach pobranych plikow (np.
 * "20260824-20260831-payments_driver..."). Pozostale platformy (Bolt/FreeNow/Bolt Food)
 * uzywaja standardowego tygodnia poniedzialek-niedziela, wiec ta opcja domyslnie jest
 * wylaczona.
 */
function computePeriodRange({ periodMode, periodFrom, periodTo }, now = new Date(), { mondayToMonday = false } = {}) {
  if (periodMode === 'custom') {
    if (!periodFrom || !periodTo) {
      throw new Error('Zakres niestandardowy wymaga ustawionych dat "od" i "do".');
    }
    return { from: periodFrom, to: periodTo };
  }

  const monday = getMondayOfWeek(now);
  if (periodMode === 'previous_week') {
    monday.setDate(monday.getDate() - 7);
  } else if (periodMode !== 'current_week') {
    throw new Error(`Nieznany tryb okresu: ${periodMode}`);
  }

  const weekEnd = new Date(monday);
  weekEnd.setDate(weekEnd.getDate() + (mondayToMonday ? 7 : 6));

  // Platformy (np. Bolt) nie maja danych za dni, ktore jeszcze nie nastapily - dla
  // "tydzien biezacy" ograniczamy koniec zakresu do dzisiaj, jesli koniec tego tygodnia
  // jeszcze nie nadszedl.
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = periodMode === 'current_week' && weekEnd > today ? today : weekEnd;

  return { from: toISODate(monday), to: toISODate(to) };
}

module.exports = { computePeriodRange, getMondayOfWeek, toISODate };
