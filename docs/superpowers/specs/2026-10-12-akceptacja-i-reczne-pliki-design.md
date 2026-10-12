# Akceptacja plikow i reczne pliki per konto - projekt

Data: 2026-10-12. Zrodlo: uwagi klienta po testach na zywo (puste/uciete logowania, Uber
"stanal", prosba o kontrole nad automatem).

## Cel

Klient ma miec kontrole nad kazdym plikiem: moze sprawdzic go od razu po pobraniu, podmienic
na wlasny, przerwac zawieszone konto i wgrac plik recznie, a przy wgrywaniu do PartnerTax
admin - zatrzymac proces i akceptowac kazdy plik. Automat ma tez dzialac wolniej.

Poza zakresem: problem z kontem Leszno (czeka na log `userData/logs/automat.log`, wpisy
`[sync ...:Leszno]`), cofanie juz wgranego pliku w adminie (do tego jest "Usun raporty").

## Czesc 1: reczny plik dla konta (wspolny mechanizm)

Jedna funkcja, wolana z trzech miejsc: przycisk edycji w wierszu Kontroli pobran, panel bledu
pobierania, przycisk awaryjny.

- IPC `downloads:attachManual(platformId, accountId, { filePath?, force? })` w `main.js`:
  - bez `filePath` - systemowy `dialog.showOpenDialog` (CSV/XLSX); anulowanie -> `{ canceled: true }`;
  - `validateDownloadedReport({ platformId, account, filePath })`; przy `ReportValidationError`
    i braku `force` -> `{ ok: false, needsConfirm: true, warning, filePath }` (renderer pyta
    [Uzyj mimo to] / [Wybierz inny plik]; "Uzyj mimo to" wola IPC ponownie z `filePath` i
    `force: true`);
  - plik jest KOPIOWANY (oryginal klienta nietkniety) do folderu konta w
    `userData/downloads/<platform>/<konto>/`, potem `renameDownloadedFile` (miasto - firma -
    platforma - oryginalna nazwa);
  - wpis do `lastDownloads` (albo `lastGwarantDownloads` dla grupy gwarant) z `manual: true`.
- Reczny plik dalej zachowuje sie jak pobrany: kolejnosc rozliczenia, ZIP, wgrywanie.

## Czesc 2: Kontrola pobran i "Pobierz wszystkie"

Wiersz Kontroli pobran:
- nazwa pliku klikalna (gdy plik istnieje) -> IPC `downloads:showFile(filePath)` ->
  `shell.showItemInFolder` (main sprawdza, ze sciezka jest jedna z `lastDownloads`);
- przycisk "Wgraj wlasny plik" przy kazdym wierszu (tez bez pliku) -> Czesc 1;
- oznaczenie "(recznie)" dla `manual: true`; konto z bledem w ostatnim przebiegu na czerwono
  (stan bledu trzymany w rendererze, w pamieci).

"Pobierz wszystkie":
- przelacznik "Akceptuj kazdy plik" (domyslnie wlaczony, `localStorage`, odczyt/zapis w
  try/catch);
- po udanym pobraniu, gdy przelacznik wlaczony - panel: "Pobrano: <platforma> - <konto>,
  <plik> [Pokaz plik] [OK, dalej] [Zly plik -> wgraj wlasny] [Zatrzymaj wszystko]";
- po bledzie lub przerwaniu - panel ZAWSZE (niezaleznie od przelacznika): "Blad: <tresc>
  [Wgraj plik recznie] [Sprobuj ponownie] [Pomin konto] [Zatrzymaj wszystko]";
- "Wgraj plik recznie"/"Zly plik" -> Czesc 1; po udanym podpieciu petla idzie dalej, po
  anulowaniu panel zostaje;
- "Zatrzymaj wszystko" konczy petle (pliki juz pobrane zostaja).

Przycisk awaryjny "Przerwij to konto":
- widoczny przez caly czas pobierania konta (w "Pobierz wszystkie" i przy "Pobierz teraz" na
  karcie konta);
- IPC `sync:abort(platformId, accountId)`; main trzyma `activeContexts: Map<key, context>`
  (wypelniane w `runDownload`), abort ustawia flage i zamyka kontekst; `sync:run` zwraca
  wtedy `{ ok: false, aborted: true, error: 'Przerwano recznie' }`;
- w "Pobierz wszystkie" przerwanie prowadzi do panelu bledu; przy "Pobierz teraz" - do
  pytania o reczny plik.

Wolniejsze tempo:
- losowa przerwa 8-15 s miedzy kontami w "Pobierz wszystkie", z odliczaniem w statusie
  ("Nastepne konto za 10 s..."); "Zatrzymaj wszystko" dziala tez w trakcie odliczania;
- wolniejsze klikanie przy logowaniu: wieksze opoznienia w `humanClick`/`humanFill`.

## Czesc 3: wgrywanie do PartnerTax admin

- `uploadToPartnerTax({ ..., confirmAfterEach, shouldStop })`:
  - `shouldStop()` sprawdzane PRZED kazdym plikiem - przy `true` petla konczy sie bledem
    `UploadStoppedError` z `succeededUploads` (plik w trakcie zapisu jest zawsze dokonczony);
  - `confirmAfterEach(upload, index, total)` (opcjonalne) po kazdym zapisanym pliku; zwraca
    `'continue'` albo `'stop'`; `'stop'` dziala jak `shouldStop`.
- `main.js`: `upload:run(options)` z `{ confirmEach }`; przy `confirmEach` wysyla do renderera
  `upload:confirm { index, total, label }` i czeka na `upload:confirmReply(decision)`; IPC
  `upload:stop` ustawia flage zatrzymania i odpowiada `'stop'` na ewentualne oczekujace pytanie.
- Zatrzymanie: pliki juz wgrane wykreslane z `lastDownloads` (istniejacy mechanizm
  `succeededUploads`), wynik `{ ok: false, stopped: true, count }`; ponowne "Wgraj" konczy
  reszte.
- Renderer: przelacznik "Akceptuj kazdy plik" w sekcji wgrywania (osobny, `localStorage`),
  panel "Wgrano 5/30: Bolt - Leszno [Dalej] [Zatrzymaj]", przycisk "Zatrzymaj" widoczny przez
  caly czas wgrywania. Okno admina zostaje otwarte, wiec klient moze sprawdzic wiersz.

## Testy (Playwright, jak obecne)

- `humanFill`: strona kradnaca fokus w trakcie wpisywania -> pole i tak ma pelny tekst.
- `uploadToPartnerTax` na istniejacym mocku admina: `confirmAfterEach` zwraca `'stop'` po 1.
  pliku -> wgrany 1, blad z `succeededUploads.length === 1`; `shouldStop` przed startem ->
  nic nie wgrane.
- Przerwanie: zamkniecie kontekstu w trakcie `syncXxxAccount` na mocku -> `runDownload`
  odrzuca, a stan przerwania jest rozpoznawalny.
- Reczny plik: logika kopiowania + walidacji wydzielona do funkcji testowalnej bez Electrona
  (`attachManualFile({ platformId, account, sourcePath, downloadDir, force })`): poprawna
  nazwa -> skopiowany i przemianowany; zly tydzien -> ostrzezenie; `force` -> przyjety.
