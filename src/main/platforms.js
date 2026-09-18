const PERIOD_MODES = [
  { id: 'current_week', label: 'Tydzien biezacy' },
  { id: 'previous_week', label: 'Tydzien poprzedni' },
  { id: 'custom', label: 'Zakres niestandardowy' },
];

/**
 * Pozycje listy "Typ zgloszenia" (Report type) w dialogu "Wygeneruj raport" Ubera.
 *
 * `label` to tekst opcji w polskim UI (spisany z zywego DOM listy, zrzut od klienta
 * 2026-09-18), `labelEn` - w angielskim. Oba warianty sa potrzebne, bo Uber przelacza
 * jezyk portalu nieprzewidywalnie (ten sam klient widzial polski i angielski w roznych
 * sesjach). Dopasowanie idzie PO TEKSCIE, bo opcje listy (li[role="option"]) nie maja
 * zadnego stabilnego atrybutu - `value="REPORT_TYPE_*"` siedzi wylacznie na divie z juz
 * WYBRANA wartoscia comboboksa, nie na pozycjach listy.
 *
 * UWAGA co do `labelEn`: pewne sa tylko "Payments Driver" i "Driver Activity" (widziane
 * na zywo). Pozostale to najlepsze znane odpowiedniki - jesli ktorys typ nie znajdzie sie
 * na liscie przy angielskim UI, komunikat bledu wypisze faktyczne teksty opcji ze strony
 * i poprawka sprowadza sie do jednej linijki tutaj.
 *
 * `fileSlug` to czlon nazwy pobieranego pliku/wiersza w tabeli raportow
 * ("RRRRMMDD-RRRRMMDD-<fileSlug>-<FIRMA>.csv"); dla payments_driver zweryfikowany na
 * pobranych plikach, dla pozostalych typow przyjety jako rowny `id` (Uber uzywa tej samej
 * konwencji snake_case).
 *
 * UWAGA: dalszy przebieg synchronizacji (okno rozliczenia, walidacja kolumn CSV, import do
 * PartnerTax) byl budowany pod raport platniczy. Typy nieplatnicze ("Przejazdy", "Status
 * kierowcy", ...) maja inny uklad kolumn i moga nie przejsc walidacji - sa tu, bo klient
 * poprosil o pelna liste, ale nie byly sprawdzone od poczatku do konca.
 */
const UBER_REPORT_TYPES = [
  { id: 'driver_time_and_distance', label: 'Czas i odległość kierowcy', labelEn: 'Driver Time and Distance' },
  { id: 'vehicle_time_and_distance', label: 'Czas i odległość pojazdu', labelEn: 'Vehicle Time and Distance' },
  { id: 'driver_quality_of_service', label: 'Jakość obsługi oferowanej przez kierowcę', labelEn: 'Driver Quality of Service' },
  { id: 'vehicle_performance', label: 'Osiągi pojazdu', labelEn: 'Vehicle Performance' },
  { id: 'payments_driver', label: 'Płatności – kierowca', labelEn: 'Payments Driver' },
  { id: 'payments_organization', label: 'Płatności – organizacja', labelEn: 'Payments Organization' },
  { id: 'trips', label: 'Przejazdy', labelEn: 'Trips' },
  {
    id: 'driver_auto_positioning_effectiveness',
    label: 'Skuteczność automatycznego pozycjonowania kierowcy',
    labelEn: 'Driver Auto-positioning Effectiveness',
  },
  { id: 'driver_status', label: 'Status kierowcy', labelEn: 'Driver Status' },
  { id: 'payment_transaction', label: 'Transakcja płatnicza', labelEn: 'Payment Transaction' },
  { id: 'driver_activity', label: 'Wyświetl aktywność kierowcy', labelEn: 'Driver Activity' },
].map((type) => ({ ...type, fileSlug: type.id }));

// Typ uzywany do tej pory na sztywno w kodzie - konta zapisane przed dodaniem wyboru typu
// (oraz konta, na ktorych nikt nic nie zmienil) dzialaja dokladnie tak jak wczesniej.
const DEFAULT_UBER_REPORT_TYPE_ID = 'payments_driver';

const PLATFORMS = [
  {
    id: 'uber',
    label: 'Uber',
    fields: ['email', 'password'],
    sensitiveFields: ['password'],
    multiAccount: true,
    loginUrl: 'https://supplier.uber.com/',
    report: {
      name: 'Platnosci kierowca',
      menuPath: 'Raporty > Wygeneruj raport > Platnosci kierowca',
    },
    reportTypes: UBER_REPORT_TYPES,
    defaultReportType: DEFAULT_UBER_REPORT_TYPE_ID,
    defaultPeriodMode: 'current_week'
  },
  {
    id: 'bolt',
    label: 'Bolt',
    fields: ['email', 'password', 'orgId'],
    sensitiveFields: ['password'],
    multiAccount: true,
    loginUrl: 'https://fleets.bolt.eu/login?to=%2F{orgId}%2Ffinances%2Freports%2FdriverEarnings&tab=email_username',
    report: {
      name: 'Zarobki na kierowce (CSV)',
      menuPath: 'Finanse > Zarobki na kierowce > Eksport CSV',
    },
    defaultPeriodMode: 'current_week'
  },
  {
    id: 'freenow',
    label: 'FreeNow',
    fields: ['email', 'password'],
    sensitiveFields: ['password'],
    multiAccount: true,
    loginUrl: 'https://portal.free-now.com/login',
    report: {
      name: 'Zarobki (WITH VAT)',
      menuPath: 'Zarobki > Pobierz > wariant WITH VAT',
    },
    defaultPeriodMode: 'current_week'
  },
  {
    id: 'boltfood',
    label: 'Bolt Food',
    fields: ['email', 'password', 'orgId'],
    sensitiveFields: ['password'],
    multiAccount: true,
    loginUrl: 'https://dcfo.bolt.eu/fleet/{orgId}/reports',
    report: {
      name: 'Fleet Courier Earnings and Balances (CSV)',
      menuPath: 'Raportowanie > Wygenerowane raporty > najnowszy "Fleet Courier Earnings and Balances"',
    },
    defaultPeriodMode: 'current_week'
  },
  {
    id: 'partnertax',
    label: 'PartnerTax Admin',
    fields: ['baseUrl', 'username', 'password'],
    sensitiveFields: ['password'],
    multiAccount: false,
  },
];

module.exports = { PLATFORMS, PERIOD_MODES, UBER_REPORT_TYPES, DEFAULT_UBER_REPORT_TYPE_ID };
