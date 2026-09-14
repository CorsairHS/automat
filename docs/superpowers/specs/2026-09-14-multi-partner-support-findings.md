# Wsparcie wielu partnerow (nie tylko Nova Partner) - wnioski

Data: 2026-09-14

## Kontekst

Aplikacja jest dzis uzywana przede wszystkim przez Nova Partner. Platformy
zrodlowe (Uber, Bolt, FreeNow, Bolt Food) sa uniwersalne - nie maja hardkodow
partnerskich. Jedynym miejscem z hardkodami "tylko dla Nova Partner" jest
platforma docelowa uploadu: PartnerTax Admin
([src/main/automation/platforms/partnertax.js](../../../src/main/automation/platforms/partnertax.js),
[src/main/platforms.js](../../../src/main/platforms.js)).

## Znalezione hardkody

1. **`BASE_URL` / `loginUrl`** - `https://app.nova-partner.pl` wpisany na
   sztywno w `partnertax.js:13` i `platforms.js:66`. Kazdy partner ma wlasna
   instalacje panelu pod innym adresem.

2. **`SYSTEM_OPTION_VALUES` / `SYSTEM_OPTION_ALIASES`** (`partnertax.js:22-39`)
   - numeryczne ID opcji `<select name="sources-N-system">` (np. Bolt=17,
   Uber=32, FreeNow=2, BoltFood=78).

3. **`CITY_OPTION_VALUES`** (`partnertax.js:45-58`) - numeryczne ID opcji
   `<select name="sources-N-city">` (Wroclaw=7, Warszawa=8, ...).

4. **`COMPANY_OPTION_VALUES`** (`partnertax.js:63-66`) - numeryczne ID opcji
   `<select name="sources-N-company">`, dzis tylko 2 wpisy ("unity drive",
   "da investment") - firmy klienta demo.

## Skad wziely sie te ID

Nie ma zadnego API ani dokumentacji tych wartosci - zostaly odczytane recznie
ze zrzutu ekranu DOM formularza w panelu Nova Partner (2026-08-19,
potwierdzone ponownie 2026-09-14 przez wklejenie zywego `<select>` z admina -
wartosci zgadzaja sie 1:1 z `CITY_OPTION_VALUES`).

To sa surowe primary key'e z bazy danych tej konkretnej instalacji Django
admina (tabela systemow, tabela miast). Dla innej instalacji tego samego
panelu (inny partner) te ID beda inne i losowe - zalezne od kolejnosci
wprowadzania rekordow do ich bazy.

## Dlaczego "niech partner wpisze ID w GUI" to zle rozwiazanie

Partner nie zna numerycznych ID swoich rekordow w bazie - musialby robic to
samo, co my dzis: otwierac DevTools, szukac `<option value="...">` recznie.
Zly UX, podatny na bledy.

## Rekomendowane rozwiazanie

- **URL panelu** - jedyna wartosc, ktora faktycznie warto wystawic jako pole
  tekstowe w GUI per konto/partner (tak jak dzis `city`/`company`).

- **System / City / Company** - nie hardkodowac ID wcale. Zamiast
  `selectOption(value)` z mapy statycznej, dopasowywac opcje w zywym
  `<select>` po widocznym tekscie (np. `selectOption({ label: 'Bolt' })` albo
  reczne dopasowanie po znormalizowanym tekscie opcji, funkcja
  `normalizeTextKey` juz istnieje i robi to co trzeba - case-insensitive,
  bez diakrytykow). To eliminuje potrzebe konfiguracji tych trzech pol przez
  partnera - system name jest staly, city/company partner i tak juz wpisuje
  w konfiguracji konta.

## Status

Wnioski zebrane, implementacja nie zaczeta. Nastepny krok (do potwierdzenia
z uzytkownikiem): refaktor `partnertax.js` na dopasowanie po tekscie opcji +
wyniesienie `loginUrl` do konfiguracji per-konto.
