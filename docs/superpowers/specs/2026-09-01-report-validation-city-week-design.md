# Walidacja pobranych raportów przed uploadem (miasto + tydzień) — design

Data: 2026-09-01

## Cel

Zapobiec finansowo krytycznemu błędowi: raport trafia do złego miasta w PartnerTax, lub raport z niewłaściwego tygodnia zostaje wgrany jako dane bieżącego/poprzedniego okresu. Dziś (`src/main/main.js`, `src/main/automation/platforms/partnertax.js`, `src/main/automation/dateRange.js`) nic tego nie sprawdza: `account.city` to wolny tekst wpisany raz przy konfiguracji konta, a zakres tygodnia (`computePeriodRange`) jest liczony z zegara systemowego w momencie *pobierania* — żadna z tych dwóch wartości nie jest nigdy skonfrontowana z tym, co faktycznie znalazło się w pobranym pliku.

## Ustalenia z sesji

- Otwarte rozliczenie w PartnerTax (`Finished = False`) zawsze jest dokładnie jedno naraz — wybór "pierwszego niezakończonego" (`openUnfinishedReckoning`, `partnertax.js:153`) nie jest w praktyce źródłem błędu i **nie jest przedmiotem tego designu**.
- Nazwa/ścieżka pobranego pliku dla każdej z czterech platform już zawiera prawdę o mieście i zakresie dat, np.:
  - Bolt: `.../bolt/DA_Investment_-_Wroc_aw/Zarobki na kierowcę-31 sie 2026-1 wrz 2026-....csv`
  - Bolt Food: `.../boltfood/Da_Investment/fleet_courier_earnings_and_balances_2026_W34.csv` (brak miasta w ścieżce — jedna firma na folder)
  - FreeNow: `.../freenow/DA_Investment_-_Wroc_aw/earnings_2026-08-31_2026-09-01/earnings_2026-08-31_2026-09-01_with_VAT.csv`
  - Uber: `.../uber/DA_Investment_-_Warszawa/20260824-20260825-payments_driver-....csv`
- Dopasowanie tygodnia ma być **dokładne**: dla `periodMode = current_week` cały bieżący tydzień (pon-niedz), dla `previous_week` cały poprzedni tydzień — bez marginesu tolerancji.
- Rozważany alternatywnie pomysł użytkownika (porównanie listy kierowców z poprzednio wgranym raportem z tego samego miasta, oczekiwane ~70% pokrycia) **odrzucony jako mechanizm główny**: nie odróżnia dobrze złego tygodnia od dobrego dla tego samego miasta (sąsiednie tygodnie mają podobny skład kierowców). Zostaje jako możliwe przyszłe rozszerzenie (druga warstwa obrony), poza zakresem tej iteracji.
- Przy niezgodności: **twarda blokada uploadu**, nie ostrzeżenie z potwierdzeniem — użytkownik wolał wykluczyć ryzyko przypadkowego zatwierdzenia błędnych danych.

## Zakres

1. Parser nazwy pliku/folderu per platforma (Bolt, Bolt Food, FreeNow, Uber), zwracający `{ city: string | null, periodStart: Date, periodEnd: Date }`. Bolt Food zwraca `city: null` (nie ma go w ścieżce) — walidacja miasta jest wtedy pomijana dla tej platformy, walidacja tygodnia nadal obowiązuje.
2. Funkcja walidująca, wywoływana zaraz po pobraniu pliku (w `runner.js`, przed dopisaniem wpisu do `lastDownloads`), porównująca dane sparsowane z pliku z:
   - `account.city` (dopasowanie tekstowe, tolerancyjne na formatowanie/wielkość liter tak samo jak dziś robi to `resolveCityValue`),
   - zakresem z `computePeriodRange(account.periodMode, ...)` użytym do pobrania tego pliku (dokładna zgodność początku i końca tygodnia).
3. Przy niezgodności: plik nie trafia do `lastDownloads`, pobieranie dla tego konta kończy się czytelnym błędem (miasto/tydzień oczekiwane vs. znalezione w pliku), zdarzenie trafia do logu aplikacji (istniejący mechanizm logowania do pliku).
4. Testy jednostkowe parserów nazw plików (na bazie rzeczywistych przykładów z tej sesji, per platforma) + test integracyjny weryfikujący, że niezgodność blokuje upload i generuje odpowiedni błąd.

## Poza zakresem

- Naprawa/zmiana logiki `openUnfinishedReckoning` (brak dowodu, że to realny problem — zawsze jedno otwarte rozliczenie).
- Mechanizm porównania list kierowców między tygodniami (odrzucony jako główny mechanizm, patrz wyżej).
- Ogólny ekran podglądu/potwierdzenia przed uploadem pokazujący pełną listę plików/miast/okresów — rozważane wcześniej jako dodatkowa warstywa UX, ale użytkownik zdecydował się na twardą blokadę automatyczną zamiast dodatkowego kroku manualnego potwierdzenia.
- Rozszerzenie na inne platformy niż obecne cztery (Bolt, Bolt Food, FreeNow, Uber).
