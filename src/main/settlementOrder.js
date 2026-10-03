/**
 * Kolejnosc raportow taka sama jak w ostatnim zamknietym rozliczeniu klienta w PartnerTax
 * admin (zrzuty ekranu od klienta, 2026-10-03). Tam wiersze Data source NIE sa pogrupowane
 * po platformie, tylko: firma -> miasto -> platforma, np.
 *
 *   DA INVESTMENT:  Wroclaw (Bolt, FreeNow, Uber), Warszawa (Bolt, ...)
 *   UNITY DRIVE:    Wroclaw (Bolt Food, Bolt, FreeNow, Uber), Warszawa (Bolt, FreeNow, Uber),
 *                   Legnica, Krakow, Bialystok, Walbrzych/Jelenia Gora, Lubin,
 *                   Suwalki/Augustow, Poznan, Leszno
 *
 * Ta sama kolejnosc obowiazuje w "Kontrola pobran", przy "Pobierz wszystkie", w ZIP-ie i
 * przy wgrywaniu (kolejnosc wgrywania = kolejnosc wierszy w rozliczeniu).
 *
 * Dopasowanie po znormalizowanym tekscie (bez polskich znakow, male litery, "zawiera"),
 * bo nazwy miast/firm w kontach roznia sie zapisem ("Poznan"/"Poznań",
 * "sulawki/augustow uber", "UNITY DRIVE SP Z O O"). Konta spoza listy (nowa firma/miasto)
 * trafiaja za znanymi, w kolejnosci zapisu kont - nic nie znika. Nowe miasto/firme
 * dopisuje sie tu jedna linijka.
 */
const COMPANY_ORDER = ['da invest', 'unity'];

const CITY_ORDER = [
  'wroclaw',
  'warszawa',
  'legnica',
  'krakow',
  'bialystok',
  'walbrzych',
  'lubin',
  'augustow',
  'poznan',
  'leszno',
];

const PLATFORM_ORDER = ['boltfood', 'bolt', 'freenow', 'uber'];

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function rankByTokens(value, tokens) {
  const normalized = normalize(value);
  const index = tokens.findIndex((token) => normalized.includes(token));
  return index === -1 ? tokens.length : index;
}

function rankPlatform(platformId) {
  const index = PLATFORM_ORDER.indexOf(platformId);
  return index === -1 ? PLATFORM_ORDER.length : index;
}

/**
 * Sortuje (stabilnie) elementy z polami { platformId, city, company, label }. Miasto
 * bierze z `city`, a gdy puste - z etykiety konta (etykieta i tak musi zawierac miasto,
 * patrz reportValidator).
 */
function sortBySettlementOrder(items) {
  return items
    .map((item, index) => ({
      item,
      key: [
        rankByTokens(item.company, COMPANY_ORDER),
        rankByTokens(item.city || item.label, CITY_ORDER),
        rankPlatform(item.platformId),
        index,
      ],
    }))
    .sort((a, b) => {
      for (let i = 0; i < a.key.length; i += 1) {
        if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i];
      }
      return 0;
    })
    .map(({ item }) => item);
}

module.exports = { sortBySettlementOrder, normalize };
