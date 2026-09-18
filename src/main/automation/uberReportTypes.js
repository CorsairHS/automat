const { UBER_REPORT_TYPES, DEFAULT_UBER_REPORT_TYPE_ID } = require('../platforms');
const { normalizeForCompare } = require('./reportValidator');

/**
 * Wybor pozycji z listy "Typ zgloszenia" w dialogu "Wygeneruj raport" Ubera.
 *
 * Dopasowanie po tekscie jest tu wymuszone (opcje listy nie maja zadnego stabilnego
 * atrybutu - patrz komentarz przy UBER_REPORT_TYPES w platforms.js), a sam tekst na zywej
 * stronie zawiera pulapki: twarda spacje (&nbsp;) w "Czas i odleglosc kierowcy" i
 * polkwadrat "–" zamiast dywizu w "Platnosci – kierowca". Dlatego porownujemy przez
 * normalizeForCompare, ktory sprowadza tekst do samych liter i cyfr bez polskich znakow -
 * tak samo, jak robi to dopasowanie opcji w panelu PartnerTax (optionMatching.js).
 *
 * Tylko ROWNOSC po normalizacji, nigdy "zawiera": "Platnosci - kierowca" nie moze trafic
 * w "Platnosci - organizacja" ani odwrotnie.
 */

function resolveUberReportType(reportTypeId) {
  if (!reportTypeId) {
    return UBER_REPORT_TYPES.find((type) => type.id === DEFAULT_UBER_REPORT_TYPE_ID);
  }
  const type = UBER_REPORT_TYPES.find((t) => t.id === reportTypeId);
  if (!type) {
    throw new Error(
      `Nieznany typ raportu Ubera zapisany na koncie: "${reportTypeId}". Wybierz typ ponownie w konfiguracji konta. Dostepne: ${UBER_REPORT_TYPES.map((t) => t.id).join(', ')}.`
    );
  }
  return type;
}

/**
 * Indeks pozycji listy odpowiadajacej danemu typowi, albo -1 gdy takiej pozycji nie ma
 * (lista roznia sie miedzy kontami - zrzuty od klienta z 2026-09-18 pokazuja raz 10, raz
 * 11 pozycji). Wywolujacy odpowiada za blad z wypisaniem faktycznych opcji ze strony.
 */
function pickReportTypeOptionIndex(optionTexts, reportType) {
  const candidates = [reportType.label, reportType.labelEn]
    .filter(Boolean)
    .map(normalizeForCompare);
  return optionTexts.findIndex((text) => candidates.includes(normalizeForCompare(text || '')));
}

module.exports = { resolveUberReportType, pickReportTypeOptionIndex };
