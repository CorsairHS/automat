const path = require('path');
const { test, expect } = require('playwright/test');
const { getIsoWeekMonday } = require('../src/main/automation/reportValidator');
const { toISODate } = require('../src/main/automation/dateRange');

test.describe('getIsoWeekMonday', () => {
  test('zwraca poniedzialek (dzien tygodnia = 1)', () => {
    const monday = getIsoWeekMonday(2026, 34);
    expect(monday.getDay()).toBe(1);
  });

  test('kolejne tygodnie sa oddalone o dokladnie 7 dni', () => {
    const week1 = getIsoWeekMonday(2026, 1);
    const week34 = getIsoWeekMonday(2026, 34);
    const diffDays = Math.round((week34 - week1) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(33 * 7);
  });

  test('poniedzialek tygodnia 1 przypada 29 grudnia poprzedniego roku lub pozniej, ale nie pozniej niz 4 stycznia', () => {
    const week1Monday = getIsoWeekMonday(2026, 1);
    expect(toISODate(week1Monday) >= '2025-12-29').toBe(true);
    expect(toISODate(week1Monday) <= '2026-01-04').toBe(true);
  });
});

test.describe('normalizeForCompare', () => {
  const { normalizeForCompare } = require('../src/main/automation/reportValidator');

  test('lowercase, transliteruje polskie znaki, usuwa nie-alfanumeryczne', () => {
    expect(normalizeForCompare('DA Investment - Wrocław')).toBe('dainvestmentwroclaw');
  });
});

test.describe('companiesMatch', () => {
  const { companiesMatch } = require('../src/main/automation/reportValidator');

  test('dopasowuje mimo formatowania w nazwie pliku Bolta', () => {
    expect(companiesMatch('DA INVESTMENT SP_ Z O_O_', 'DA Investment')).toBe(true);
  });

  test('dopasowuje mimo formatowania w nazwie pliku Ubera', () => {
    expect(companiesMatch('DA_INVESTMENT_SPKA_Z_OGRANICZON_ODPOWIEDZIALNOCI', 'DA Investment')).toBe(true);
  });

  test('wykrywa niezgodnosc firmy', () => {
    expect(companiesMatch('UNITY_DRIVE_SP_Z_O_O', 'DA Investment')).toBe(false);
  });

  test('brak firmy w pliku (FreeNow/Bolt Food) = przepuszcza', () => {
    expect(companiesMatch(null, 'DA Investment')).toBe(true);
  });
});

test.describe('labelMatchesCity', () => {
  const { labelMatchesCity } = require('../src/main/automation/reportValidator');

  test('dopasowuje typowy format etykiety konta', () => {
    expect(labelMatchesCity('DA Investment - Wrocław', 'Wrocław')).toBe(true);
  });

  test('wykrywa niezgodnosc miasta w etykiecie', () => {
    expect(labelMatchesCity('DA Investment - Wrocław', 'Warszawa')).toBe(false);
  });
});

test.describe('parseBoltFilename', () => {
  const {
    parseBoltFilename,
  } = require('../src/main/automation/reportValidator');

  test('parsuje polskie nazwy miesiecy i firme', () => {
    const result = parseBoltFilename('Zarobki na kierowcę-31 sie 2026-1 wrz 2026-DA INVESTMENT SP_ Z O_O_.csv');
    expect(result).toEqual({ company: 'DA INVESTMENT SP_ Z O_O_', periodStart: '2026-08-31', periodEnd: '2026-09-01' });
  });

  test('rzuca na nierozpoznana nazwe', () => {
    expect(() => parseBoltFilename('cos_zupelnie_innego.csv')).toThrow();
  });
});

test.describe('parseUberFilename', () => {
  const {
    parseUberFilename,
  } = require('../src/main/automation/reportValidator');

  test('parsuje daty YYYYMMDD i firme', () => {
    const result = parseUberFilename('20260824-20260825-payments_driver-DA_INVESTMENT_SPKA_Z_OGRANICZON_ODPOWIEDZIALNOCI.csv');
    expect(result).toEqual({
      company: 'DA_INVESTMENT_SPKA_Z_OGRANICZON_ODPOWIEDZIALNOCI',
      periodStart: '2026-08-24',
      periodEnd: '2026-08-25',
    });
  });

  test('rzuca na nierozpoznana nazwe', () => {
    expect(() => parseUberFilename('raport.csv')).toThrow();
  });
});

test.describe('parseFreenowFilename', () => {
  const {
    parseFreenowFilename,
  } = require('../src/main/automation/reportValidator');

  test('parsuje zakres dat, brak firmy', () => {
    const result = parseFreenowFilename('earnings_2026-08-31_2026-09-01_with_VAT.csv');
    expect(result).toEqual({ company: null, periodStart: '2026-08-31', periodEnd: '2026-09-01' });
  });

  test('rzuca na nierozpoznana nazwe', () => {
    expect(() => parseFreenowFilename('raport.csv')).toThrow();
  });

  test('odrzuca nazwę z zaśmieciającym prefixem (nie CSV)', () => {
    expect(() => parseFreenowFilename('garbage_earnings_2026-08-31_2026-09-01.exe')).toThrow();
  });

  test('odrzuca nazwę bez suffixu "_with_VAT.csv"', () => {
    expect(() => parseFreenowFilename('earnings_2026-08-31_2026-09-01.csv')).toThrow();
  });
});

test.describe('parseBoltFoodFilename', () => {
  const {
    parseBoltFoodFilename,
  } = require('../src/main/automation/reportValidator');

  test('parsuje numer tygodnia ISO na poniedzialek-niedziele, brak firmy', () => {
    const result = parseBoltFoodFilename('fleet_courier_earnings_and_balances_2026_W34.csv');
    expect(result.company).toBeNull();
    expect(result.periodStart).toBe('2026-08-17');
    expect(result.periodEnd).toBe('2026-08-23');
  });

  test('rzuca na nierozpoznana nazwe', () => {
    expect(() => parseBoltFoodFilename('raport.csv')).toThrow();
  });
});

const { validateDownloadedReport, ReportValidationError } = require('../src/main/automation/reportValidator');

function baseAccount(overrides = {}) {
  return {
    label: 'DA Investment - Wrocław',
    city: 'Wrocław',
    company: 'DA Investment',
    periodMode: 'custom',
    periodFrom: '2026-08-31',
    periodTo: '2026-09-01',
    ...overrides,
  };
}

test.describe('validateDownloadedReport', () => {
  test('przepuszcza zgodny plik Bolt', () => {
    const filePath = path.join('C:', 'downloads', 'bolt', 'DA_Investment_-_Wroc_aw', 'Zarobki na kierowcę-31 sie 2026-1 wrz 2026-DA INVESTMENT SP_ Z O_O_.csv');
    expect(() => validateDownloadedReport({ platformId: 'bolt', account: baseAccount(), filePath })).not.toThrow();
  });

  test('blokuje zly tydzien', () => {
    const filePath = path.join('C:', 'downloads', 'bolt', 'x', 'Zarobki na kierowcę-24 sie 2026-30 sie 2026-DA INVESTMENT SP_ Z O_O_.csv');
    expect(() => validateDownloadedReport({ platformId: 'bolt', account: baseAccount(), filePath }))
      .toThrow(ReportValidationError);
  });

  test('blokuje zla firme (Uber)', () => {
    const filePath = path.join('C:', 'downloads', 'uber', 'x', '20260831-20260901-payments_driver-UNITY_DRIVE_SP_Z_O_O.csv');
    expect(() => validateDownloadedReport({
      platformId: 'uber',
      account: baseAccount({ periodMode: 'custom', periodFrom: '2026-08-31', periodTo: '2026-09-01' }),
      filePath,
    })).toThrow(ReportValidationError);
  });

  test('blokuje niespojnosc etykiety konta z miastem', () => {
    const filePath = path.join('C:', 'downloads', 'bolt', 'x', 'Zarobki na kierowcę-31 sie 2026-1 wrz 2026-DA INVESTMENT SP_ Z O_O_.csv');
    expect(() => validateDownloadedReport({
      platformId: 'bolt',
      account: baseAccount({ label: 'DA Investment - Warszawa' }),
      filePath,
    })).toThrow(ReportValidationError);
  });

  test('FreeNow: przepuszcza mimo braku firmy w pliku', () => {
    const filePath = path.join('C:', 'downloads', 'freenow', 'x', 'earnings_2026-08-31_2026-09-01', 'earnings_2026-08-31_2026-09-01_with_VAT.csv');
    expect(() => validateDownloadedReport({ platformId: 'freenow', account: baseAccount(), filePath })).not.toThrow();
  });

  test('nierozpoznana nazwa pliku blokuje upload', () => {
    const filePath = path.join('C:', 'downloads', 'bolt', 'x', 'niespodziewany_format.csv');
    expect(() => validateDownloadedReport({ platformId: 'bolt', account: baseAccount(), filePath })).toThrow(ReportValidationError);
  });

  test('nierozpoznana platforma blokuje upload', () => {
    const filePath = path.join('C:', 'downloads', 'nowaplatforma', 'x', 'cokolwiek.csv');
    expect(() => validateDownloadedReport({ platformId: 'nowaplatforma', account: baseAccount(), filePath }))
      .toThrow(ReportValidationError);
  });

  // Bolt Food: brak wyboru zakresu dat przy pobieraniu (platforma generuje raporty
  // tygodniowe automatycznie w tle) - walidator zawsze porownuje z "tydzien poprzedni"
  // wzgledem "teraz", NIEZALEZNIE od periodMode/periodFrom/periodTo skonfigurowanych
  // na koncie. Ponizsze testy budowane sa dynamicznie wzgledem biezacej daty, aby nie
  // psuly sie z uplywem czasu (nie hardkodujemy konkretnego numeru tygodnia).
  test.describe('Bolt Food: specjalne traktowanie okresu (ignoruje periodMode konta)', () => {
    // Znajduje rok/numer tygodnia ISO odpowiadajacy danemu poniedzialkowi, uzywajac
    // TEJ SAMEJ logiki co parseBoltFoodFilename (getIsoWeekMonday), zeby test byl
    // niezalezny od jakiejkolwiek innej, potencjalnie niespojnej implementacji ISO-tygodni.
    function findYearWeekForMonday(mondayIso) {
      const year = Number(mondayIso.slice(0, 4));
      for (const y of [year - 1, year, year + 1]) {
        for (let week = 1; week <= 53; week++) {
          const candidate = getIsoWeekMonday(y, week);
          if (toISODate(candidate) === mondayIso) {
            return { year: y, week };
          }
        }
      }
      throw new Error(`Nie znaleziono roku/tygodnia ISO dla poniedzialku ${mondayIso}`);
    }

    function boltFoodFilenameForMonday(mondayIso) {
      const { year, week } = findYearWeekForMonday(mondayIso);
      return `fleet_courier_earnings_and_balances_${year}_W${week}.csv`;
    }

    test('przepuszcza plik z "tygodnia poprzedniego" mimo periodMode="current_week" na koncie', () => {
      const previousWeek = require('../src/main/automation/dateRange').computePeriodRange({ periodMode: 'previous_week' });
      const filename = boltFoodFilenameForMonday(previousWeek.from);
      const filePath = path.join('C:', 'downloads', 'boltfood', 'x', filename);
      expect(() => validateDownloadedReport({
        platformId: 'boltfood',
        account: baseAccount({ periodMode: 'current_week' }),
        filePath,
      })).not.toThrow();
    });

    test('przepuszcza ten sam plik niezaleznie od periodMode konta (custom vs current_week)', () => {
      const previousWeek = require('../src/main/automation/dateRange').computePeriodRange({ periodMode: 'previous_week' });
      const filename = boltFoodFilenameForMonday(previousWeek.from);
      const filePath = path.join('C:', 'downloads', 'boltfood', 'x', filename);

      expect(() => validateDownloadedReport({
        platformId: 'boltfood',
        account: baseAccount({ periodMode: 'custom', periodFrom: '2000-01-01', periodTo: '2000-01-07' }),
        filePath,
      })).not.toThrow();

      expect(() => validateDownloadedReport({
        platformId: 'boltfood',
        account: baseAccount({ periodMode: 'current_week' }),
        filePath,
      })).not.toThrow();
    });

    test('blokuje plik sprzed dwoch tygodni (nie "tydzien poprzedni")', () => {
      const previousWeek = require('../src/main/automation/dateRange').computePeriodRange({ periodMode: 'previous_week' });
      const [y, m, d] = previousWeek.from.split('-').map(Number);
      const twoWeeksAgoMonday = new Date(y, m - 1, d);
      twoWeeksAgoMonday.setDate(twoWeeksAgoMonday.getDate() - 7);
      const filename = boltFoodFilenameForMonday(toISODate(twoWeeksAgoMonday));
      const filePath = path.join('C:', 'downloads', 'boltfood', 'x', filename);
      expect(() => validateDownloadedReport({
        platformId: 'boltfood',
        account: baseAccount({ periodMode: 'current_week' }),
        filePath,
      })).toThrow(ReportValidationError);
    });
  });
});
