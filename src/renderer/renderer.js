const FIELD_LABELS = {
  email: 'Email',
  username: 'Login',
  password: 'Haslo',
  clientId: 'Client ID',
  clientSecret: 'Client Secret',
  orgId: 'ID organizacji/firmy (z URL panelu po przelaczeniu firmy, np. /fleet/<ORG_ID>/)',
};

const FIELD_TYPES = {
  email: 'text',
  username: 'text',
  password: 'password',
  clientId: 'text',
  clientSecret: 'password',
  orgId: 'text',
};

let CONFIG = null;
const statusElements = new Map();
const runButtons = new Map();
let uploadStatusElement = null;
let deleteStatusElement = null;
let reportAccountsCache = [];
let downloadAllButton = null;
let downloadAllStatusElement = null;
// Konta zdublowane do zakladki Gwarant (przycisk "Dodaj do gwaranta" na karcie konta) -
// osobna checklista/"Pobierz wszystkie" w tej zakladce, calkowicie niezalezna od Kontroli
// pobran/wgrywania powyzej (patrz downloads:statusGwarant w main.js).
let gwarantReportAccountsCache = [];
let gwarantDownloadAllButton = null;
let gwarantDownloadAllStatusElement = null;
// Zakladka platformy aktywna w widoku kont (Uber/Bolt/FreeNow/BoltFood/PartnerTax) -
// trzymana poza render(), zeby przetrwac ponowne wywolania render() (np. po Zapisz/Usun/
// Pobierz teraz) i partner nie wracal za kazdym razem do pierwszej zakladki.
let activePlatformId = null;

// Nadrzedny widok (Konta / Aktualizacje) - osobny od activePlatformId, bo "Aktualizacje"
// to nie platforma z kontami, tylko niezalezna sekcja przelaczana obok calego
// dotychczasowego UI (patrz renderMainTabs).
let activeMainView = 'accounts';
let updateStatusTextElement = null;
let updateVersionElement = null;
let checkUpdateButton = null;
let installUpdateButton = null;
let latestUpdateState = { state: 'idle', message: '' };

// Znacznik uzywany przez glowny proces (patrz loginHelpers.js) do oznaczenia
// jedynego momentu, w ktorym partner moze bezpiecznie recznie kliknac w oknie
// przegladarki (uzupelnienie kodu 2FA) - poza tym momentem automat steruje ta sama
// strona i reczne klikanie moze z nim kolidowac.
const SAFE_TO_HELP_MARKER = '[MOŻESZ POMOC]';

function applyStatusMessage(el, message) {
  if (!el) return;
  const isSafeToHelp = message.startsWith(SAFE_TO_HELP_MARKER);
  el.textContent = isSafeToHelp ? message.slice(SAFE_TO_HELP_MARKER.length).trim() : message;
  el.classList.toggle('run-status--safe-to-help', isSafeToHelp);
}

window.api.onSyncStatus(({ platformId, accountId, message }) => {
  const el = statusElements.get(`${platformId}:${accountId}`);
  applyStatusMessage(el, message);
});

window.api.onUploadStatus(({ message }) => {
  applyStatusMessage(uploadStatusElement, message);
});

window.api.onDeleteStatus(({ message }) => {
  applyStatusMessage(deleteStatusElement, message);
});

window.api.onUpdateStatus((payload) => {
  latestUpdateState = payload;
  applyUpdateState();
});

function applyUpdateState() {
  if (!updateStatusTextElement) return;
  updateStatusTextElement.textContent = latestUpdateState.message || '';
  if (checkUpdateButton) {
    checkUpdateButton.disabled = latestUpdateState.state === 'checking' || latestUpdateState.state === 'downloading';
  }
  if (installUpdateButton) {
    installUpdateButton.style.display = latestUpdateState.state === 'downloaded' ? '' : 'none';
  }
}

async function render() {
  CONFIG = await window.api.getPlatformsConfig();

  reportAccountsCache = [];
  gwarantReportAccountsCache = [];
  statusElements.clear();
  runButtons.clear();

  // Budujemy WSZYSTKIE sekcje platform (z await na listAccounts) do tablicy PRZED
  // dotknieciem #platform-list. Wczesniej kod najpierw czyscil kontener
  // (innerHTML = ''), a dopiero potem odtwarzal sekcje jedna po drugiej - w tej
  // przerwie strona byla chwilowo pusta, wiec przegladarka zerowala scroll (bo nie mial
  // juz czego przewijac) i nie wracal on na miejsce po odtworzeniu tresci (zgloszone
  // przez klienta jako "jak dodaje nowe konto to przewija na sama gore"). Podmiana
  // calego kontenera w jednym, synchronicznym kroku (bez await pomiedzy czyszczeniem a
  // wypelnieniem) eliminuje ta przerwe.
  const platformSections = [];
  for (const platform of CONFIG.platforms) {
    const accounts = await window.api.listAccounts(platform.id, 'default');
    if (platform.report) {
      for (const account of accounts) {
        reportAccountsCache.push({
          platformId: platform.id,
          platformLabel: platform.label,
          accountId: account.accountId,
          label: account.label,
        });
      }
    }
    platformSections.push({ platform, section: await renderPlatformSection(platform, accounts) });
  }

  // Podsekcje zakladki Gwarant - po jednej na platforme z co najmniej jednym zdublowanym
  // kontem (grupa 'gwarant'). PartnerTax admin (multiAccount: false) nie ma kont do
  // dublowania, wiec go pomijamy.
  const gwarantSubsections = [];
  for (const platform of CONFIG.platforms) {
    if (!platform.multiAccount) continue;
    const accounts = await window.api.listAccounts(platform.id, 'gwarant');
    if (accounts.length === 0) continue;
    if (platform.report) {
      for (const account of accounts) {
        gwarantReportAccountsCache.push({
          platformId: platform.id,
          platformLabel: platform.label,
          accountId: account.accountId,
          label: account.label,
        });
      }
    }
    gwarantSubsections.push({
      platform,
      section: await renderPlatformSection(platform, accounts, { showAddButton: false, allowGuarantorButton: false }),
    });
  }

  const tabIds = [...CONFIG.platforms.map((p) => p.id), 'gwarant'];
  if (!activePlatformId || !tabIds.includes(activePlatformId)) {
    activePlatformId = CONFIG.platforms[0]?.id || null;
  }

  const container = document.getElementById('platform-list');
  container.innerHTML = '';
  container.appendChild(renderPlatformTabs([
    ...CONFIG.platforms.map((p) => ({ id: p.id, label: p.label })),
    { id: 'gwarant', label: 'Gwarant' },
  ]));
  for (const { platform, section } of platformSections) {
    section.dataset.platformId = platform.id;
    section.style.display = platform.id === activePlatformId ? '' : 'none';
    container.appendChild(section);
  }

  const gwarantContainer = await renderGwarantSection(gwarantSubsections);
  gwarantContainer.style.display = activePlatformId === 'gwarant' ? '' : 'none';
  container.appendChild(gwarantContainer);

  await renderChecklistSection();
  renderUploadSection();
  renderDeleteSection();
  renderSessionTransferSection();
}

/**
 * Nadrzedny pasek zakladek "Konta" / "Aktualizacje" - przelacza widocznosc calego
 * dotychczasowego UI (#platform-list, budowany przez render()) i nowej, niezaleznej
 * sekcji aktualizacji (#updates-view, patrz renderUpdatesSection). W przeciwienstwie do
 * renderPlatformTabs ten pasek buduje sie raz przy starcie apki (nie przy kazdym render()),
 * bo nie zalezy od CONFIG/kont.
 */
function renderMainTabs() {
  const tabBar = document.getElementById('main-tabs');
  tabBar.innerHTML = '';
  tabBar.className = 'platform-tabs';

  const tabs = [
    { id: 'accounts', label: 'Konta' },
    { id: 'updates', label: 'Aktualizacje' },
  ];

  for (const tab of tabs) {
    const tabBtn = document.createElement('button');
    tabBtn.type = 'button';
    tabBtn.className = 'platform-tab' + (tab.id === activeMainView ? ' active' : '');
    tabBtn.textContent = tab.label;
    tabBtn.onclick = () => {
      activeMainView = tab.id;
      for (const btn of tabBar.querySelectorAll('.platform-tab')) {
        btn.classList.toggle('active', btn === tabBtn);
      }
      document.getElementById('platform-list').style.display = tab.id === 'accounts' ? '' : 'none';
      document.getElementById('updates-view').style.display = tab.id === 'updates' ? '' : 'none';
    };
    tabBar.appendChild(tabBtn);
  }
}

/**
 * Zakladka "Aktualizacje": biezaca wersja apki, status ostatniego sprawdzenia
 * (przekazywany na zywo z autoUpdatera w main.js - patrz onUpdateStatus wyzej) i dwa
 * przyciski - reczne sprawdzenie oraz instalacja juz pobranej aktualizacji. Buduje sie raz
 * przy starcie, bez zaleznosci od CONFIG/kont, wiec nie jest czescia render().
 */
async function renderUpdatesSection() {
  const container = document.getElementById('updates-view');
  container.innerHTML = '';

  const section = document.createElement('section');
  section.className = 'platform-section';

  const header = document.createElement('h2');
  header.textContent = 'Aktualizacje';
  section.appendChild(header);

  const card = document.createElement('div');
  card.className = 'platform-card';

  updateVersionElement = document.createElement('p');
  updateVersionElement.className = 'platform-note';
  updateVersionElement.textContent = `Zainstalowana wersja: ${await window.api.getAppVersion()}`;
  card.appendChild(updateVersionElement);

  const runRow = document.createElement('div');
  runRow.className = 'run-row';

  checkUpdateButton = document.createElement('button');
  checkUpdateButton.className = 'btn-secondary';
  checkUpdateButton.textContent = 'Sprawdz teraz';
  checkUpdateButton.onclick = async () => {
    const result = await window.api.checkForUpdate();
    if (!result.ok) {
      latestUpdateState = { state: 'error', message: result.error };
      applyUpdateState();
    }
  };
  runRow.appendChild(checkUpdateButton);

  installUpdateButton = document.createElement('button');
  installUpdateButton.className = 'btn-run';
  installUpdateButton.textContent = 'Zainstaluj teraz';
  installUpdateButton.style.display = 'none';
  installUpdateButton.onclick = () => window.api.installUpdate();
  runRow.appendChild(installUpdateButton);

  updateStatusTextElement = document.createElement('span');
  updateStatusTextElement.className = 'run-status';
  runRow.appendChild(updateStatusTextElement);

  card.appendChild(runRow);
  section.appendChild(card);
  container.appendChild(section);

  applyUpdateState();
}

/**
 * Pasek zakladek jedna na platforme (Uber/Bolt/FreeNow/BoltFood/PartnerTax) nad lista
 * kont - przelaczanie to czyste pokazywanie/ukrywanie juz zbudowanych sekcji (display),
 * bez ponownego pobierania danych czy wywolywania render() - natychmiastowe, bez
 * przeladowania czy skoku scrolla. Sekcje globalne (Kontrola pobran, wgrywanie/usuwanie
 * w PartnerTax) NIE naleza do zadnej zakladki - zostaja zawsze widoczne ponizej.
 */
function renderPlatformTabs(platforms) {
  const tabBar = document.createElement('div');
  tabBar.className = 'platform-tabs';

  for (const platform of platforms) {
    const tabBtn = document.createElement('button');
    tabBtn.type = 'button';
    tabBtn.className = 'platform-tab' + (platform.id === activePlatformId ? ' active' : '');
    tabBtn.textContent = platform.label;
    tabBtn.onclick = () => {
      activePlatformId = platform.id;
      for (const btn of tabBar.querySelectorAll('.platform-tab')) {
        btn.classList.toggle('active', btn === tabBtn);
      }
      for (const sectionEl of document.querySelectorAll('#platform-list [data-platform-id]')) {
        sectionEl.style.display = sectionEl.dataset.platformId === platform.id ? '' : 'none';
      }
    };
    tabBar.appendChild(tabBtn);
  }

  return tabBar;
}

/**
 * Wstawia sekcje o danym id w odpowiednim miejscu: podmienia istniejacy element,
 * a jesli go nie ma - wstawia przed sekcja uploadu (o ile juz istnieje w DOM), zeby
 * kolejnosc sekcji zostala zachowana przy czesciowych odswiezeniach (np. po pobraniu
 * pojedynczego raportu, bez przebudowy calego widoku i utraty niezapisanych danych).
 */
function appendOrReplaceSection(section) {
  const existing = document.getElementById(section.id);
  if (existing) {
    existing.replaceWith(section);
    return;
  }
  const uploadSection = document.getElementById('upload-section');
  if (uploadSection) {
    uploadSection.before(section);
  } else {
    document.getElementById('platform-list').appendChild(section);
  }
}

/**
 * Warstwa kontrolna: lista wszystkich skonfigurowanych kont Uber/Bolt/FreeNow z
 * checkboxem, ktory zaznacza sie automatycznie na podstawie faktycznego stanu pobrania
 * w biezacej sesji aplikacji (main.js -> lastDownloads), nie da sie go zaznaczyc recznie -
 * ma to byc realna weryfikacja "czy wszystko sie pobralo", nie tylko notatka.
 */
async function renderChecklistSection() {
  const downloads = await window.api.getDownloadsStatus();
  const downloadedMap = new Map(downloads.map((d) => [`${d.platformId}:${d.accountId}`, d]));

  const section = document.createElement('section');
  section.id = 'checklist-section';
  section.className = 'platform-section';

  const header = document.createElement('h2');
  header.textContent = 'Kontrola pobran';
  section.appendChild(header);

  const note = document.createElement('p');
  note.className = 'platform-note';
  note.textContent = 'Checkbox zaznacza sie automatycznie, gdy plik zostanie faktycznie pobrany w tej sesji aplikacji - nie mozna go zaznaczyc recznie.';
  section.appendChild(note);

  if (reportAccountsCache.length > 0) {
    const runRow = document.createElement('div');
    runRow.className = 'run-row';

    const runBtn = document.createElement('button');
    runBtn.className = 'btn-run';
    runBtn.textContent = 'Pobierz wszystkie';
    downloadAllButton = runBtn;

    const statusSpan = document.createElement('span');
    statusSpan.className = 'run-status';
    downloadAllStatusElement = statusSpan;

    runBtn.onclick = () => runAllDownloads();

    runRow.appendChild(runBtn);
    runRow.appendChild(statusSpan);
    section.appendChild(runRow);
  }

  if (reportAccountsCache.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'platform-note';
    empty.textContent = 'Brak skonfigurowanych kont.';
    section.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'checklist-list';

    for (const item of reportAccountsCache) {
      const entry = downloadedMap.get(`${item.platformId}:${item.accountId}`);
      const row = document.createElement('label');
      row.className = 'checklist-item' + (entry ? ' checked' : '');

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = Boolean(entry);
      checkbox.disabled = true;
      row.appendChild(checkbox);

      const text = document.createElement('span');
      const accountLabel = item.label || item.accountId;
      if (entry) {
        const fileName = entry.filePath.split(/[\\/]/).pop();
        const time = new Date(entry.downloadedAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
        text.textContent = `${item.platformLabel} - ${accountLabel}: ${fileName} (${time})`;
      } else {
        text.textContent = `${item.platformLabel} - ${accountLabel}: nie pobrano`;
      }
      row.appendChild(text);

      list.appendChild(row);
    }
    section.appendChild(list);
  }

  appendOrReplaceSection(section);
}

/**
 * Uruchamia pobieranie po kolei (sekwencyjnie, nie rownolegle) dla wszystkich
 * skonfigurowanych kont Uber/Bolt/FreeNow. Sekwencyjnie, bo kazde pobranie otwiera
 * widoczne okno przegladarki (Playwright) - rownolegle uruchomienia mylilyby uzytkownika
 * i utrudnialy reczne dokonczenie 2FA. Blokuje wszystkie przyciski "Pobierz teraz" i
 * "Pobierz wszystkie" na czas trwania, zeby nie odpalic tego samego konta dwa razy naraz.
 */
async function runAllDownloads() {
  if (reportAccountsCache.length === 0) return;

  if (downloadAllButton) downloadAllButton.disabled = true;
  for (const btn of runButtons.values()) btn.disabled = true;

  let doneCount = 0;
  for (const item of reportAccountsCache) {
    const key = `${item.platformId}:${item.accountId}`;
    const accountLabel = item.label || item.accountId;
    if (downloadAllStatusElement) {
      downloadAllStatusElement.textContent = `Pobieram (${doneCount + 1}/${reportAccountsCache.length}): ${item.platformLabel} - ${accountLabel}...`;
    }
    const statusSpan = statusElements.get(key);
    if (statusSpan) statusSpan.textContent = 'Uruchamiam przegladarke...';

    const result = await window.api.runSync(item.platformId, item.accountId);
    if (statusSpan) statusSpan.textContent = result.ok ? `Gotowe: ${result.filePath}` : `Blad: ${result.error}`;
    doneCount += 1;
    // renderChecklistSection() tworzy nowy przycisk "Pobierz wszystkie" (podmienia caly
    // element), wiec trzeba go ponownie zablokowac - inaczej staje sie klikalny w trakcie
    // trwania petli.
    await renderChecklistSection();
    if (downloadAllButton) downloadAllButton.disabled = true;
  }

  if (downloadAllButton) downloadAllButton.disabled = false;
  for (const btn of runButtons.values()) btn.disabled = false;
  if (downloadAllStatusElement) downloadAllStatusElement.textContent = `Gotowe: pobrano ${doneCount}/${reportAccountsCache.length} kont.`;
}

/**
 * Zakladka Gwarant: kontener z wlasna checklista pobran i podsekcjami kont (po jednej na
 * platforme pochodzenia), zbudowanymi tymi samymi kartami co zakladki Uber/Bolt/FreeNow/
 * Bolt Food (pelne pola, "Pobierz teraz", edycja, usuniecie) - tylko bez przyciskow
 * "+ Dodaj konto" i "Dodaj do gwaranta" (patrz options w renderPlatformSection/
 * renderAccountCard). Caly kontener ma dataset.platformId = 'gwarant', wiec dziala z
 * istniejacym przelaczaniem widocznosci zakladek w renderPlatformTabs bez zadnych zmian.
 */
async function renderGwarantSection(subsections) {
  const container = document.createElement('div');
  container.id = 'gwarant-section';
  container.dataset.platformId = 'gwarant';

  const header = document.createElement('h2');
  header.textContent = 'Gwarant';
  container.appendChild(header);

  const note = document.createElement('p');
  note.className = 'platform-note';
  note.textContent = 'Konta dodane przyciskiem "Dodaj do gwaranta" na kartach w zakladkach platform - niezalezne kopie (edycja tutaj nie wplywa na oryginalne konto i odwrotnie). Maja wlasna checkliste i "Pobierz teraz" ponizej - nie wchodza do Kontroli pobran / Pobierz wszystkie / wgrywania do PartnerTax na dole strony.';
  container.appendChild(note);

  container.appendChild(await renderGwarantChecklist());

  if (subsections.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'platform-note';
    empty.textContent = 'Brak kont w zakladce Gwarant. Dodaj konto przyciskiem "Dodaj do gwaranta" w zakladkach Uber/Bolt/FreeNow/Bolt Food.';
    container.appendChild(empty);
  } else {
    for (const { section } of subsections) {
      container.appendChild(section);
    }
  }

  return container;
}

/**
 * Checklista pobran wylacznie dla kont z grupy 'gwarant' - stan "pobrano" czyta z osobnej
 * mapy w main.js (downloads:statusGwarant / lastGwarantDownloads), calkowicie niezaleznej
 * od checklisty domyslnej (downloads:status / lastDownloads), zeby pobrania w tej zakladce
 * nigdy nie wplynely na wspolne "Pobierz wszystkie"/wgrywanie do PartnerTax.
 */
async function renderGwarantChecklist() {
  const section = document.createElement('section');
  section.id = 'gwarant-checklist-section';
  section.className = 'platform-section';

  const header = document.createElement('h3');
  header.textContent = 'Kontrola pobran (Gwarant)';
  section.appendChild(header);

  if (gwarantReportAccountsCache.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'platform-note';
    empty.textContent = 'Brak skonfigurowanych kont w zakladce Gwarant.';
    section.appendChild(empty);
    return section;
  }

  const downloads = await window.api.getGwarantDownloadsStatus();
  const downloadedMap = new Map(downloads.map((d) => [`${d.platformId}:${d.accountId}`, d]));

  const runRow = document.createElement('div');
  runRow.className = 'run-row';

  const runBtn = document.createElement('button');
  runBtn.className = 'btn-run';
  runBtn.textContent = 'Pobierz wszystkie (Gwarant)';
  gwarantDownloadAllButton = runBtn;

  const statusSpan = document.createElement('span');
  statusSpan.className = 'run-status';
  gwarantDownloadAllStatusElement = statusSpan;

  runBtn.onclick = () => runAllGwarantDownloads();

  runRow.appendChild(runBtn);
  runRow.appendChild(statusSpan);
  section.appendChild(runRow);

  const list = document.createElement('div');
  list.className = 'checklist-list';

  for (const item of gwarantReportAccountsCache) {
    const entry = downloadedMap.get(`${item.platformId}:${item.accountId}`);
    const row = document.createElement('label');
    row.className = 'checklist-item' + (entry ? ' checked' : '');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(entry);
    checkbox.disabled = true;
    row.appendChild(checkbox);

    const text = document.createElement('span');
    const accountLabel = item.label || item.accountId;
    if (entry) {
      const fileName = entry.filePath.split(/[\\/]/).pop();
      const time = new Date(entry.downloadedAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
      text.textContent = `${item.platformLabel} - ${accountLabel}: ${fileName} (${time})`;
    } else {
      text.textContent = `${item.platformLabel} - ${accountLabel}: nie pobrano`;
    }
    row.appendChild(text);

    list.appendChild(row);
  }
  section.appendChild(list);

  return section;
}

/**
 * Podmienia w miejscu tylko checkliste Gwaranta wewnatrz #gwarant-section (bez przebudowy
 * calej zakladki) - analogicznie do renderChecklistSection() w petli runAllDownloads.
 */
async function refreshGwarantChecklist() {
  const parent = document.getElementById('gwarant-section');
  if (!parent) return;
  const newSection = await renderGwarantChecklist();
  const existing = document.getElementById('gwarant-checklist-section');
  if (existing) {
    existing.replaceWith(newSection);
  } else {
    parent.insertBefore(newSection, parent.children[2] || null);
  }
}

/**
 * Odpowiednik runAllDownloads() dla zakladki Gwarant - ta sama sekwencyjna logika
 * (jedno widoczne okno przegladarki na raz), ale nad gwarantReportAccountsCache i wlasnymi
 * elementami przycisku/statusu, zeby dzialac calkowicie niezaleznie od "Pobierz wszystkie"
 * w Kontroli pobran.
 */
async function runAllGwarantDownloads() {
  if (gwarantReportAccountsCache.length === 0) return;

  if (gwarantDownloadAllButton) gwarantDownloadAllButton.disabled = true;
  for (const btn of runButtons.values()) btn.disabled = true;

  let doneCount = 0;
  for (const item of gwarantReportAccountsCache) {
    const key = `${item.platformId}:${item.accountId}`;
    const accountLabel = item.label || item.accountId;
    if (gwarantDownloadAllStatusElement) {
      gwarantDownloadAllStatusElement.textContent = `Pobieram (${doneCount + 1}/${gwarantReportAccountsCache.length}): ${item.platformLabel} - ${accountLabel}...`;
    }
    const statusSpan = statusElements.get(key);
    if (statusSpan) statusSpan.textContent = 'Uruchamiam przegladarke...';

    const result = await window.api.runSync(item.platformId, item.accountId);
    if (statusSpan) statusSpan.textContent = result.ok ? `Gotowe: ${result.filePath}` : `Blad: ${result.error}`;
    doneCount += 1;
    await refreshGwarantChecklist();
    if (gwarantDownloadAllButton) gwarantDownloadAllButton.disabled = true;
  }

  if (gwarantDownloadAllButton) gwarantDownloadAllButton.disabled = false;
  for (const btn of runButtons.values()) btn.disabled = false;
  if (gwarantDownloadAllStatusElement) gwarantDownloadAllStatusElement.textContent = `Gotowe: pobrano ${doneCount}/${gwarantReportAccountsCache.length} kont.`;
}

/**
 * Wgrywanie do PartnerTax admin dziala na plikach ostatnio pobranych w tej samej sesji
 * aplikacji (trzymanych w pamieci procesu main - patrz lastDownloads w main.js), wiec
 * przycisk jest jeden, globalny, nie per-konto: klika sie go po pobraniu raportow
 * Uber/Bolt/FreeNow, a automat sam wgrywa wszystko co ma w pamieci do pierwszego
 * niezakonczonego rozliczenia (Finished = False).
 */
function renderUploadSection() {
  const existing = document.getElementById('upload-section');
  if (existing) existing.remove();

  const section = document.createElement('section');
  section.id = 'upload-section';
  section.className = 'platform-section';

  const header = document.createElement('h2');
  header.textContent = 'PartnerTax Admin - wgrywanie';
  section.appendChild(header);

  const note = document.createElement('p');
  note.className = 'platform-note';
  note.textContent = 'Wgrywa do pierwszego niezakonczonego rozliczenia (Finished = False) wszystkie pliki pobrane w tej sesji aplikacji (Uber/Bolt/FreeNow "Pobierz teraz" powyzej).';
  section.appendChild(note);

  const runRow = document.createElement('div');
  runRow.className = 'run-row';

  const runBtn = document.createElement('button');
  runBtn.className = 'btn-run';
  runBtn.textContent = 'Wgraj do PartnerTax';

  const statusSpan = document.createElement('span');
  statusSpan.className = 'run-status';
  uploadStatusElement = statusSpan;

  runBtn.onclick = async () => {
    runBtn.disabled = true;
    statusSpan.textContent = 'Uruchamiam przegladarke...';
    const result = await window.api.runUpload();
    runBtn.disabled = false;
    statusSpan.textContent = result.ok ? `Gotowe: wgrano ${result.count} plik(ow).` : `Blad: ${result.error}`;
  };

  runRow.appendChild(runBtn);
  runRow.appendChild(statusSpan);
  section.appendChild(runRow);

  document.getElementById('platform-list').appendChild(section);
}

/**
 * Usuwanie raportow z PartnerTax admin - ta sama sciezka co wgrywanie (admin -> settlements
 * -> pierwsze niezakonczone rozliczenie), tylko zamiast dodawac Data source, zaznacza
 * checkbox DELETE na istniejacym wierszu i zapisuje. Usuwa TYLKO Uber/Bolt/FreeNow (nic
 * innego), po jednym rekordzie na raz - kazdy system to osobny przejazd sciezki, bo
 * formularz przeladowuje sie po kazdym zapisie. Przycisk jest globalny (nie per-konto),
 * jak przy wgrywaniu.
 */
function renderDeleteSection() {
  const existing = document.getElementById('delete-section');
  if (existing) existing.remove();

  const section = document.createElement('section');
  section.id = 'delete-section';
  section.className = 'platform-section';

  const header = document.createElement('h2');
  header.textContent = 'PartnerTax Admin - usuwanie raportow';
  section.appendChild(header);

  const note = document.createElement('p');
  note.className = 'platform-note';
  note.textContent = 'Usuwa z pierwszego niezakonczonego rozliczenia (Finished = False) po jednym raporcie Uber/Bolt/FreeNow - nic innego. Kazdy system to osobne zaznaczenie DELETE i zapis ("Save and continue editing").';
  section.appendChild(note);

  const runRow = document.createElement('div');
  runRow.className = 'run-row';

  const runBtn = document.createElement('button');
  runBtn.className = 'btn-delete';
  runBtn.textContent = 'Usun raporty';

  const statusSpan = document.createElement('span');
  statusSpan.className = 'run-status';
  deleteStatusElement = statusSpan;

  runBtn.onclick = async () => {
    runBtn.disabled = true;
    statusSpan.textContent = 'Uruchamiam przegladarke...';
    const result = await window.api.runDeleteReports();
    runBtn.disabled = false;
    if (!result.ok) {
      statusSpan.textContent = `Blad: ${result.error}`;
    } else {
      const diagText = result.diagnostics && result.diagnostics.length > 0
        ? ` | ${result.diagnostics.join(' ; ')}`
        : '';
      statusSpan.textContent = `Gotowe: usunieto ${result.count} raport(ow).${diagText}`;
    }
  };

  runRow.appendChild(runBtn);
  runRow.appendChild(statusSpan);
  section.appendChild(runRow);

  document.getElementById('platform-list').appendChild(section);
}

/**
 * Jeden globalny eksport/import sesji logowania (cookies) dla wszystkich skonfigurowanych
 * kont naraz (Uber/Bolt/FreeNow/BoltFood), zamiast osobnych przyciskow przy kazdym koncie -
 * pozwala po jednorazowym zalogowaniu (przejsciu 2FA) na jednym komputerze przeniesc
 * wszystkie sesje jednym plikiem na inny komputer/system. Dopasowanie przy imporcie idzie
 * po platformId+etykiecie konta (nie po accountId), bo accountId to lokalny UUID, ktory
 * rozjezdza sie miedzy komputerami nawet dla "tego samego" konta.
 */
function renderSessionTransferSection() {
  const existing = document.getElementById('session-transfer-section');
  if (existing) existing.remove();

  const section = document.createElement('section');
  section.id = 'session-transfer-section';
  section.className = 'platform-section';

  const header = document.createElement('h2');
  header.textContent = 'Przenoszenie kont i sesji logowania';
  section.appendChild(header);

  const note = document.createElement('p');
  note.className = 'platform-note';
  note.textContent = 'Zapisuje/wczytuje jednym plikiem PELNA konfiguracje wszystkich kont (Uber/Bolt/FreeNow/Bolt Food: etykieta, login, haslo, orgId, miasto/firma, okres) razem z zalogowanymi sesjami, zeby po przejsciu 2FA raz na jednym komputerze nie trzeba bylo tego powtarzac na kolejnych - import sam zaklada brakujace konta. UWAGA: plik zawiera hasla w jawnym tekscie - traktuj go jak zbior hasel, nie wysylaj otwartym tekstem (mail/czat).';
  section.appendChild(note);

  const runRow = document.createElement('div');
  runRow.className = 'run-row';

  const exportBtn = document.createElement('button');
  exportBtn.className = 'btn-secondary';
  exportBtn.textContent = 'Eksportuj wszystkie sesje';

  const importBtn = document.createElement('button');
  importBtn.className = 'btn-secondary';
  importBtn.textContent = 'Importuj wszystkie sesje';

  const statusSpan = document.createElement('span');
  statusSpan.className = 'run-status';

  exportBtn.onclick = async () => {
    exportBtn.disabled = true;
    statusSpan.textContent = 'Eksportuje sesje...';
    const result = await window.api.exportAllSessions();
    exportBtn.disabled = false;
    if (result.canceled) {
      statusSpan.textContent = '';
    } else {
      statusSpan.textContent = result.ok
        ? `Zapisano ${result.count} sesje(i) do: ${result.filePath}`
        : `Blad: ${result.error}`;
    }
  };

  importBtn.onclick = async () => {
    importBtn.disabled = true;
    statusSpan.textContent = 'Importuje sesje...';
    const result = await window.api.importAllSessions();
    if (result.canceled) {
      importBtn.disabled = false;
      statusSpan.textContent = '';
      return;
    }
    if (!result.ok) {
      importBtn.disabled = false;
      statusSpan.textContent = `Blad: ${result.error}`;
      return;
    }
    // render() odtwarza ta sekcje od zera (nowe accountId dla nowo utworzonych kont musza
    // sie pojawic na kartach), wiec komunikat trzeba ustawic na NOWYM elemencie po
    // przebudowie - `statusSpan` z tego domkniecia jest wtedy juz odlaczony od DOM.
    await render();
    const refreshedStatus = document.querySelector('#session-transfer-section .run-status');
    if (refreshedStatus) {
      refreshedStatus.textContent = `Zaimportowano/zaktualizowano ${result.imported.length} konto/konta: ${result.imported.join(', ')}`;
    }
  };

  runRow.appendChild(exportBtn);
  runRow.appendChild(importBtn);
  runRow.appendChild(statusSpan);
  section.appendChild(runRow);

  document.getElementById('platform-list').appendChild(section);
}

async function renderPlatformSection(platform, accounts, options = {}) {
  const { showAddButton = true, allowGuarantorButton = true } = options;
  const section = document.createElement('section');
  section.className = 'platform-section';

  const header = document.createElement('h2');
  header.textContent = platform.label;
  section.appendChild(header);

  if (platform.report) {
    const reportInfo = document.createElement('p');
    reportInfo.className = 'platform-note';
    reportInfo.textContent = `Raport: ${platform.report.name} (${platform.report.menuPath})`;
    section.appendChild(reportInfo);
  }

  if (platform.note) {
    const note = document.createElement('p');
    note.className = 'platform-note';
    note.textContent = platform.note;
    section.appendChild(note);
  }

  const list = document.createElement('div');
  list.className = 'account-list';

  for (const account of accounts) {
    list.appendChild(renderAccountCard(platform, account, { allowGuarantorButton }));
  }
  section.appendChild(list);

  if (showAddButton && (platform.multiAccount || accounts.length === 0)) {
    const addBtn = document.createElement('button');
    addBtn.className = 'btn-add';
    addBtn.textContent = platform.multiAccount ? '+ Dodaj konto' : '+ Dodaj dane logowania';
    addBtn.onclick = () => {
      list.appendChild(renderAccountCard(platform, null, { allowGuarantorButton }));
      addBtn.remove();
    };
    section.appendChild(addBtn);
  }

  return section;
}

function renderAccountCard(platform, account, options = {}) {
  const { allowGuarantorButton = true } = options;
  const isNew = !account;
  const card = document.createElement('div');
  card.className = 'platform-card';

  const inputs = {};

  const labelRow = document.createElement('div');
  labelRow.className = 'field-row';
  const labelLabel = document.createElement('label');
  labelLabel.textContent = 'Nazwa / etykieta ';
  labelRow.appendChild(labelLabel);
  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.placeholder = 'np. <Name> - <City>';
  labelInput.value = account ? account.label || '' : '';
  labelRow.appendChild(labelInput);
  inputs.label = labelInput;
  card.appendChild(labelRow);

  for (const field of platform.fields) {
    const row = document.createElement('div');
    row.className = 'field-row';
    const label = document.createElement('label');
    label.textContent = FIELD_LABELS[field] || field;
    row.appendChild(label);

    const input = document.createElement('input');
    input.type = FIELD_TYPES[field] || 'text';
    const existingFieldData = account ? account.fields[field] : null;

    if (existingFieldData && existingFieldData.masked) {
      input.placeholder = existingFieldData.hasValue ? 'Zapisano - zostaw puste aby nie zmieniac' : FIELD_LABELS[field] || field;
    } else if (existingFieldData) {
      input.value = existingFieldData.value || '';
    } else {
      input.placeholder = FIELD_LABELS[field] || field;
    }
    row.appendChild(input);
    inputs[field] = input;
    card.appendChild(row);
  }

  if (platform.multiAccount) {
    const cityRow = document.createElement('div');
    cityRow.className = 'field-row';
    const cityLabel = document.createElement('label');
    cityLabel.textContent = 'Miasto (cel w PartnerTax)';
    cityRow.appendChild(cityLabel);
    const cityInput = document.createElement('input');
    cityInput.type = 'text';
    cityInput.placeholder = 'np. Wroclaw';
    cityInput.value = account ? account.city || '' : '';
    cityRow.appendChild(cityInput);
    inputs.city = cityInput;
    card.appendChild(cityRow);

    const companyRow = document.createElement('div');
    companyRow.className = 'field-row';
    const companyLabel = document.createElement('label');
    companyLabel.textContent = 'Firma (cel w PartnerTax)';
    companyRow.appendChild(companyLabel);
    const companyInput = document.createElement('input');
    companyInput.type = 'text';
    companyInput.placeholder = 'np. <Name>';
    companyInput.value = account ? account.company || '' : '';
    companyRow.appendChild(companyInput);
    inputs.company = companyInput;
    card.appendChild(companyRow);

    const periodBlock = renderPeriodSelector(account, platform);
    card.appendChild(periodBlock.element);
    inputs.periodMode = periodBlock.getMode;
    inputs.periodFrom = periodBlock.getFrom;
    inputs.periodTo = periodBlock.getTo;
  }

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  function collectAccountPayload() {
    const fields = {};
    for (const field of platform.fields) {
      fields[field] = inputs[field].value;
    }
    const payload = {
      accountId: account ? account.accountId : undefined,
      label: inputs.label.value,
      fields,
    };
    if (platform.multiAccount) {
      payload.city = inputs.city.value;
      payload.company = inputs.company.value;
      payload.periodMode = inputs.periodMode();
      payload.periodFrom = inputs.periodFrom();
      payload.periodTo = inputs.periodTo();
    }
    return payload;
  }

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn-save';
  saveBtn.textContent = 'Zapisz';
  saveBtn.onclick = async () => {
    await window.api.saveAccount(platform.id, collectAccountPayload());
    await render();
  };
  actions.appendChild(saveBtn);

  if (!isNew) {
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-delete';
    deleteBtn.textContent = 'Usun';
    deleteBtn.onclick = async () => {
      await window.api.deleteAccount(platform.id, account.accountId);
      await render();
    };
    actions.appendChild(deleteBtn);

    // Tworzy NIEZALEZNA kopie tego konta w zakladce Gwarant (nowy accountId, wlasne
    // dane) - edycja jednej strony nie wplywa na druga. Nie pokazujemy tego przycisku na
    // kartach juz znajdujacych sie w Gwarancie (allowGuarantorButton: false), zeby nie
    // dublowac w nieskonczonosc.
    if (allowGuarantorButton && platform.multiAccount) {
      const guarantorBtn = document.createElement('button');
      guarantorBtn.className = 'btn-secondary';
      guarantorBtn.textContent = 'Dodaj do gwaranta';
      guarantorBtn.onclick = async () => {
        guarantorBtn.disabled = true;
        await window.api.duplicateToGuarantor(platform.id, account.accountId);
        await render();
      };
      actions.appendChild(guarantorBtn);
    }
  }

  card.appendChild(actions);

  // Przycisk "Pobierz" widoczny tylko dla platform ze zdefiniowanym raportem
  // (Uber/Bolt/FreeNow) - PartnerTax to osobny modul (upload/usuwanie), bez wlasnego
  // pobierania, wiec platform.report jest dla niej celowo nieustawione.
  if (!isNew && platform.report) {
    const runRow = document.createElement('div');
    runRow.className = 'run-row';

    const runBtn = document.createElement('button');
    runBtn.className = 'btn-run';
    runBtn.textContent = 'Pobierz teraz';

    const statusSpan = document.createElement('span');
    statusSpan.className = 'run-status';
    const statusKey = `${platform.id}:${account.accountId}`;
    statusElements.set(statusKey, statusSpan);
    runButtons.set(statusKey, runBtn);

    runBtn.onclick = async () => {
      runBtn.disabled = true;
      statusSpan.textContent = 'Zapisuje ustawienia i uruchamiam przegladarke...';
      // "Pobierz teraz" uruchamia synchronizacje na podstawie configu zapisanego na
      // dysku (window.api.runSync przyjmuje tylko accountId - runner.js/credentialStore
      // odczytuja reszte z pliku), NIE na podstawie tego, co aktualnie widac w
      // formularzu. Bez zapisania biezacego stanu formularza przed uruchomieniem, zmiana
      // np. okresu pobierania bez wczesniejszego kliknieca "Zapisz" byla cicho ignorowana
      // - automat uzywal starego, wczesniej zapisanego okresu (zaobserwowane na zywo
      // 2026-08-25, konto Warszawa: partner zmienil zakres na 20-25 sierpnia, ale automat
      // pobral raport za "tydzien biezacy" = 24-25 sierpnia, bo to byl ostatni zapisany
      // tryb). Zapisujemy wiec biezacy stan formularza tuz przed uruchomieniem.
      await window.api.saveAccount(platform.id, collectAccountPayload());
      const result = await window.api.runSync(platform.id, account.accountId);
      runBtn.disabled = false;
      statusSpan.textContent = result.ok ? `Gotowe: ${result.filePath}` : `Blad: ${result.error}`;
      if (result.ok) await renderChecklistSection();
    };

    runRow.appendChild(runBtn);
    runRow.appendChild(statusSpan);
    card.appendChild(runRow);
  }

  return card;
}

function renderPeriodSelector(account, platform) {
  const wrapper = document.createElement('div');
  wrapper.className = 'field-row period-row';

  const label = document.createElement('label');
  label.textContent = 'Okres pobierania';
  wrapper.appendChild(label);

  const radioGroup = document.createElement('div');
  radioGroup.className = 'period-options';

  const groupName = 'period-' + Math.random().toString(36).slice(2);
  const currentMode = (account && account.periodMode) || platform.defaultPeriodMode || 'current_week';

  const customDates = document.createElement('div');
  customDates.className = 'period-custom-dates';
  const fromInput = document.createElement('input');
  fromInput.type = 'date';
  fromInput.value = (account && account.periodFrom) || '';
  const toInput = document.createElement('input');
  toInput.type = 'date';
  toInput.value = (account && account.periodTo) || '';
  customDates.appendChild(fromInput);
  const dash = document.createElement('span');
  dash.textContent = ' - ';
  customDates.appendChild(dash);
  customDates.appendChild(toInput);
  customDates.style.display = currentMode === 'custom' ? 'flex' : 'none';

  const radios = [];
  for (const mode of CONFIG.periodModes) {
    const optionLabel = document.createElement('label');
    optionLabel.className = 'period-option';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = groupName;
    radio.value = mode.id;
    radio.checked = mode.id === currentMode;
    radio.onchange = () => {
      customDates.style.display = mode.id === 'custom' ? 'flex' : 'none';
    };
    radios.push(radio);

    optionLabel.appendChild(radio);
    optionLabel.append(' ' + mode.label);
    radioGroup.appendChild(optionLabel);
  }

  wrapper.appendChild(radioGroup);
  wrapper.appendChild(customDates);

  return {
    element: wrapper,
    getMode: () => radios.find((r) => r.checked)?.value || platform.defaultPeriodMode,
    getFrom: () => fromInput.value || null,
    getTo: () => toInput.value || null,
  };
}

render();

renderMainTabs();
renderUpdatesSection();
