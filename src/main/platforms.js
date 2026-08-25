/**
 * Konfiguracja obslugiwanych platform, ustalona na podstawie demo klienta (2026-08-18).
 * loginUrl i szczegoly formularza PartnerTax sa nadal placeholderami do potwierdzenia
 * po uzyskaniu pelnego dostepu do systemu.
 */

const PERIOD_MODES = [
  { id: 'current_week', label: 'Tydzien biezacy' },
  { id: 'previous_week', label: 'Tydzien poprzedni' },
  { id: 'custom', label: 'Zakres niestandardowy' },
];

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
    defaultPeriodMode: 'current_week'
  },
  {
    id: 'bolt',
    label: 'Bolt',
    fields: ['email', 'password'],
    sensitiveFields: ['password'],
    multiAccount: true,
    loginUrl: 'https://fleets.bolt.eu/login?to=%2F59449%2Ffinances%2Freports%2FdriverEarnings&tab=email_username',
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
    fields: ['username', 'password'],
    sensitiveFields: ['password'],
    multiAccount: false,
    loginUrl: 'https://app.nova-partner.pl/admin/'
  },
];

module.exports = { PLATFORMS, PERIOD_MODES };
