// Adres instalacji panelu, z ktorej korzystala aplikacja zanim adres stal sie
// polem konta - uzywany WYLACZNIE w jednorazowej migracji istniejacych kont.
const LEGACY_NOVA_BASE_URL = 'https://app.nova-partner.pl';

const BASE_URL_MIGRATION_KEY = 'partnertaxBaseUrl';

/**
 * Kazdy partner ma wlasna instalacje panelu PartnerTax admin pod innym adresem.
 * Przyjmujemy to, co partner wkleil (z /admin/ na koncu, bez schematu itp.) i
 * sprowadzamy do samego origin - sciezki admina doklada buildAdminUrls.
 */
function normalizeBaseUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    throw new Error('Brak adresu panelu PartnerTax admin w konfiguracji konta (pole "Adres panelu PartnerTax").');
  }
  const withScheme = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`Nieprawidlowy adres panelu PartnerTax admin: "${raw}".`);
  }
  if (!url.hostname) {
    throw new Error(`Nieprawidlowy adres panelu PartnerTax admin: "${raw}".`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`Adres panelu PartnerTax admin musi zaczynac sie od https:// (podano "${raw}").`);
  }
  return url.origin;
}

function buildAdminUrls(baseUrl) {
  return {
    loginUrl: `${baseUrl}/admin/`,
    reckoningListUrl: `${baseUrl}/admin/finances/reckoning/`,
  };
}

/**
 * Jednorazowo uzupelnia adres Nova w kontach PartnerTax zapisanych przed pojawieniem
 * sie pola baseUrl (wszystkie takie instalacje to Nova). Flaga w _migrations pilnuje,
 * zeby nowy partner, ktory pozniej doda konto bez adresu, dostal czytelny blad zamiast
 * po cichu ustawionego adresu Nova.
 */
function applyLegacyBaseUrlMigration(store) {
  const migrations = store._migrations || {};
  if (migrations[BASE_URL_MIGRATION_KEY]) {
    return { store, changed: false };
  }

  const next = { ...store, _migrations: { ...migrations, [BASE_URL_MIGRATION_KEY]: true } };
  if (store.partnertax) {
    next.partnertax = store.partnertax.map((account) => {
      const fields = account.fields || {};
      if (fields.baseUrl && fields.baseUrl.value) return account;
      return { ...account, fields: { ...fields, baseUrl: { enc: false, value: LEGACY_NOVA_BASE_URL } } };
    });
  }
  return { store: next, changed: true };
}

module.exports = {
  LEGACY_NOVA_BASE_URL,
  normalizeBaseUrl,
  buildAdminUrls,
  applyLegacyBaseUrlMigration,
};
