const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, safeStorage, dialog, shell } = require('electron');
const archiver = require('archiver');
const credentialStore = require('./credentialStore');
const { sortBySettlementOrder } = require('./settlementOrder');
const { PLATFORMS, PERIOD_MODES } = require('./platforms');
const { runDownload, runUpload, runDeleteReports } = require('./automation/runner');
const { validateDownloadedReport, ReportValidationError } = require('./automation/reportValidator');
const { readSessionState, writeSessionState } = require('./automation/browserSession');
const { autoUpdater } = require('electron-updater');
const logger = require('./logger');

// Przekazuje stan autoUpdatera do zakladki "Aktualizacje" w rendererze (patrz
// renderUpdatesSection w renderer.js) - oprocz logowania do pliku, partner widzi ten sam
// stan na zywo w oknie aplikacji, zamiast polegac wylacznie na natywnym powiadomieniu OS.
function sendUpdateStatus(payload) {
  mainWindow?.webContents.send('update:status', payload);
}

autoUpdater.on('checking-for-update', () => {
  logger.info('[update] sprawdzam dostepnosc aktualizacji...');
  sendUpdateStatus({ state: 'checking', message: 'Sprawdzam dostepnosc aktualizacji...' });
});
autoUpdater.on('update-available', (info) => {
  logger.info(`[update] dostepna nowa wersja: ${info.version}`);
  sendUpdateStatus({ state: 'downloading', message: `Dostepna nowa wersja ${info.version} - pobieram...`, version: info.version });
});
autoUpdater.on('update-not-available', () => {
  logger.info('[update] aplikacja jest aktualna.');
  sendUpdateStatus({ state: 'not-available', message: `Masz najnowsza wersje (${app.getVersion()}).` });
});
autoUpdater.on('update-downloaded', (info) => {
  updateDownloaded = true;
  logger.info(`[update] pobrano wersje ${info.version} - zostanie zainstalowana przy nastepnym uruchomieniu aplikacji.`);
  sendUpdateStatus({ state: 'downloaded', message: `Pobrano wersje ${info.version} - gotowe do instalacji.`, version: info.version });
});
autoUpdater.on('error', (error) => {
  logger.error(`[update] blad: ${error.stack || error.message}`);
  sendUpdateStatus({ state: 'error', message: `Blad sprawdzania aktualizacji: ${shortUpdateError(error)}` });
  scheduleUpdateRetry();
});

// Blad HTTP z electron-updatera zawiera w message cala strone HTML odpowiedzi GitHuba
// (np. "500 ... Data: <!DOCTYPE html>...") - partner widzial w zakladce sciane tekstu.
// Pelna tresc idzie do logu, w oknie zostaje sam status i adres.
function shortUpdateError(error) {
  const firstPart = String(error.message || error).split(/\r?\n\s*\r?\n\s*Data:/)[0];
  const oneLine = firstPart.replace(/\\n|\s+/g, ' ').trim();
  return oneLine.length > 200 ? `${oneLine.slice(0, 200)}...` : oneLine;
}

// Zgloszenie 2026-09-14 (wersja 1.0.8): wydanie na GitHubie jest publiczne od razu, a pliki
// (latest.yml, instalator) dogrywaja sie jeszcze kilkanascie sekund - apka klienta sprawdzila
// w tym oknie (albo trafila na chwilowe 500 GitHuba) i dostala blad. Wczesniej sprawdzalismy
// tylko przy starcie, wiec klient bez restartu juz nigdy nie dostal aktualizacji. Teraz po
// bledzie ponawiamy po kilku minutach, a niezaleznie sprawdzamy cyklicznie co kilka godzin.
const UPDATE_RETRY_DELAY_MS = 5 * 60 * 1000;
const UPDATE_PERIODIC_INTERVAL_MS = 4 * 60 * 60 * 1000;
let updateRetryTimer = null;
let updateDownloaded = false;

function checkForUpdatesSafely() {
  if (!app.isPackaged || updateDownloaded) return;
  autoUpdater.checkForUpdates().catch(() => {
    // Blad jest juz obsluzony w autoUpdater.on('error') (log + status + ponowienie).
  });
}

function scheduleUpdateRetry() {
  if (!app.isPackaged || updateDownloaded || updateRetryTimer) return;
  updateRetryTimer = setTimeout(() => {
    updateRetryTimer = null;
    checkForUpdatesSafely();
  }, UPDATE_RETRY_DELAY_MS);
}

process.on('uncaughtException', (error) => {
  logger.error(`Nieobsluzony wyjatek: ${error.stack || error.message}`);
});
process.on('unhandledRejection', (reason) => {
  logger.error(`Nieobsluzone odrzucenie Promise: ${reason instanceof Error ? reason.stack || reason.message : reason}`);
});

let mainWindow;
// Ostatni udany download per (platformId, accountId) - zrodlo dla uploadu do
// PartnerTax admin. Tylko w pamieci procesu (nie trzeba trwalosci miedzy uruchomieniami
// aplikacji - upload robi sie zaraz po pobraniu). Konta z grupy "gwarant" (patrz
// credentialStore.listAccounts) trafiaja do OSOBNEJ mapy (lastGwarantDownloads), zeby ich
// pobrania nigdy nie wplynely na wspolna Kontrole pobran/Pobierz wszystkie/wgrywanie do
// PartnerTax - Gwarant ma byc calkowicie niezaleznym obiegiem.
const lastDownloads = new Map();
const lastGwarantDownloads = new Map();

function sanitizeFileNamePart(value) {
  return String(value || '').trim().replace(/[\\/:*?"<>|]+/g, '_');
}

// Klient poprosil, zeby po pobraniu plik od razu niosl w nazwie miasto, firme i
// platforme (do tej pory plik mial dokladnie taka nazwe, jaka podpowiadal serwer
// platformy, np. "20260914-20260921-payments_driver-UNITY_DRIVE...csv" - bez kontekstu
// konta widocznego samym plikiem, np. przy przegladaniu folderu pobranych plikow albo
// ZIP-a z nimi). Zmiana nazwy dzieje sie PO validateDownloadedReport (patrz sync:run) -
// walidator parsuje tydzien/firme z ORYGINALNEJ nazwy nadanej przez serwer platformy, wiec
// nie moze dzialac na juz zmienionej nazwie. Oryginalna nazwa zostaje na koncu (nie jest
// tracona) - zawiera dokladny zakres dat i typ raportu, przydatne przy weryfikacji.
function renameDownloadedFile(filePath, { city, company, platformLabel }) {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const originalBase = path.basename(filePath, ext);
  const prefix = [city, company, platformLabel].map(sanitizeFileNamePart).filter(Boolean).join(' - ');
  if (!prefix) return filePath;

  const newPath = path.join(dir, `${prefix} - ${originalBase}${ext}`);
  if (newPath === filePath) return filePath;
  fs.renameSync(filePath, newPath);
  return newPath;
}

// Kolejnosc wgrywania plikow do PartnerTax admin decyduje o kolejnosci wierszy w
// zapisanym rozliczeniu (kazdy plik to nowy "Add another Data source" na koncu
// formularza) - klient chce dokladnie takiej kolejnosci jak w jego ostatnim zamknietym
// rozliczeniu: firma -> miasto -> platforma (patrz settlementOrder.js), a nie w
// kolejnosci zakonczenia pobran ani pogrupowane po platformie.
function getOrderedDownloads(downloadsMap) {
  return sortBySettlementOrder(Array.from(downloadsMap.values()));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 820,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  logger.init(app.getPath('userData'));
  logger.info('Aplikacja wystartowala.');

  try {
    if (credentialStore.runMigrations()) {
      logger.info('Migracja magazynu kont zakonczona.');
    }
  } catch (error) {
    logger.error(`Migracja magazynu kont nie powiodla sie: ${error.stack || error.message}`);
  }

  if (!safeStorage.isEncryptionAvailable()) {
    logger.warn('safeStorage encryption niedostepne na tym systemie - dane logowania bylyby zapisywane bez szyfrowania.');
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Sprawdzanie aktualizacji tylko dla spakowanej apki - w trybie dev (npm start) nie ma
  // wygenerowanych metadanych update'u i electron-updater i tak by od razu zglosil blad.
  if (app.isPackaged) {
    checkForUpdatesSafely();
    setInterval(checkForUpdatesSafely, UPDATE_PERIODIC_INTERVAL_MS);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/**
 * Maskuje wartosci pol wrazliwych przed wyslaniem do renderera - odszyfrowane
 * hasla nie powinny nigdy trafiac do procesu renderera / devtools.
 */
function maskAccountForRenderer(platform, account) {
  const maskedFields = {};
  for (const [key, value] of Object.entries(account.fields)) {
    const isSensitive = (platform.sensitiveFields || []).includes(key);
    maskedFields[key] = isSensitive ? { masked: true, hasValue: Boolean(value) } : { masked: false, value };
  }
  return { ...account, fields: maskedFields };
}

ipcMain.handle('platforms:config', () => {
  return { platforms: PLATFORMS, periodModes: PERIOD_MODES };
});

ipcMain.handle('accounts:list', (_event, platformId, group) => {
  const platform = PLATFORMS.find((p) => p.id === platformId);
  const accounts = credentialStore.listAccounts(platformId, group);
  return accounts.map((account) => maskAccountForRenderer(platform, account));
});

// Kolejnosc kont z raportami (klucze "platformId:accountId") wg ostatniego zamknietego
// rozliczenia klienta - renderer uklada wg niej "Kontrola pobran" i "Pobierz wszystkie".
ipcMain.handle('accounts:reportOrder', (_event, group = 'default') => {
  const items = [];
  for (const platform of PLATFORMS) {
    if (!platform.report) continue;
    for (const account of credentialStore.listAccounts(platform.id, group)) {
      items.push({ platformId: platform.id, accountId: account.accountId, city: account.city, company: account.company, label: account.label });
    }
  }
  return sortBySettlementOrder(items).map((item) => `${item.platformId}:${item.accountId}`);
});

ipcMain.handle('accounts:save', (_event, platformId, account) => {
  const accountId = credentialStore.saveAccount(platformId, account);
  return { ok: true, accountId };
});

ipcMain.handle('accounts:delete', (_event, platformId, accountId) => {
  credentialStore.deleteAccount(platformId, accountId);
  return { ok: true };
});

// Przycisk "Wszystkie konta: tydzien poprzedni/biezacy" (renderer.js) - hurtowa zmiana
// trybu okresu na kontach wszystkich platform z raportami (Uber/Bolt/FreeNow/Bolt Food).
ipcMain.handle('accounts:setPeriodModeAll', (_event, periodMode, group = 'default') => {
  if (!['current_week', 'previous_week'].includes(periodMode)) {
    return { ok: false, error: `Nieobslugiwany tryb okresu: ${periodMode}` };
  }
  const platformIds = PLATFORMS.filter((p) => p.multiAccount && p.report).map((p) => p.id);
  const count = credentialStore.setPeriodModeForAll(platformIds, group, periodMode);
  return { ok: true, count };
});

// Duplikuje istniejace konto (dowolnej grupy) do zakladki Gwarant jako NOWY, niezalezny
// wpis (nowy accountId, group: 'gwarant') - patrz renderer.js przycisk "Dodaj do gwaranta".
// Po utworzeniu kopia zyje wlasnym zyciem: edycja oryginalu jej nie dotyczy i odwrotnie.
ipcMain.handle('accounts:duplicateToGuarantor', (_event, platformId, accountId) => {
  const source = credentialStore.listAccounts(platformId).find((a) => a.accountId === accountId);
  if (!source) {
    return { ok: false, error: 'Nie znaleziono konta.' };
  }
  const newAccountId = credentialStore.saveAccount(platformId, {
    label: source.label,
    city: source.city,
    company: source.company,
    periodMode: source.periodMode,
    reportType: source.reportType,
    periodFrom: source.periodFrom,
    periodTo: source.periodTo,
    fields: source.fields,
    group: 'gwarant',
  });
  return { ok: true, accountId: newAccountId };
});

ipcMain.handle('sync:run', async (event, platformId, accountId) => {
  const account = credentialStore.listAccounts(platformId).find((a) => a.accountId === accountId);
  if (!account) {
    return { ok: false, error: 'Nie znaleziono konta.' };
  }

  const logPrefix = `[sync ${platformId}:${account.label || accountId}]`;
  const statusCallback = (message) => {
    logger.info(`${logPrefix} ${message}`);
    event.sender.send('sync:status', { platformId, accountId, message });
  };

  logger.info(`${logPrefix} start`);
  try {
    const result = await runDownload(app.getPath('userData'), platformId, account, { statusCallback });
    validateDownloadedReport({ platformId, account, filePath: result.filePath });
    const platformLabel = PLATFORMS.find((p) => p.id === platformId)?.label || platformId;
    const filePath = renameDownloadedFile(result.filePath, { city: account.city, company: account.company, platformLabel });
    const targetMap = account.group === 'gwarant' ? lastGwarantDownloads : lastDownloads;
    targetMap.set(`${platformId}:${accountId}`, {
      platformId,
      accountId,
      city: account.city,
      company: account.company,
      filePath,
      downloadedAt: new Date().toISOString(),
    });
    logger.info(`${logPrefix} sukces: ${filePath}`);
    return { ok: true, filePath };
  } catch (error) {
    logger.error(`${logPrefix} blad: ${error.stack || error.message}`);
    return { ok: false, error: error.message };
  }
});

// Warstwa kontrolna: pozwala rendererowi sprawdzic, ktore skonfigurowane konta maja juz
// pobrany plik w biezacej sesji (checklista "co sie pobralo" przed uploadem do PartnerTax).
// Tylko konta domyslnej grupy - gwarant ma swoja wlasna checkliste, patrz downloads:statusGwarant.
ipcMain.handle('downloads:status', () => {
  return Array.from(lastDownloads.values());
});

ipcMain.handle('downloads:statusGwarant', () => {
  return Array.from(lastGwarantDownloads.values());
});

// Klient chce miec mozliwosc sprawdzic pobrane pliki przed/po wgraniu do PartnerTax -
// dwa sposoby: podglad "na zywo" w Finderze/Eksploratorze (folder z biezacej sesji, patrz
// downloads:showFolder) albo jeden plik ZIP do pobrania/przeslania dalej (patrz
// downloads:exportZip). Oba dzialaja na tych samych plikach co checklista "Kontrola
// pobran" (lastDownloads) - juz przemianowanych (miasto/firma/platforma, patrz
// renameDownloadedFile), w tej samej kolejnosci co wgrywanie (getOrderedDownloads).
ipcMain.handle('downloads:showFolder', () => {
  const downloadsRoot = path.join(app.getPath('userData'), 'downloads');
  fs.mkdirSync(downloadsRoot, { recursive: true });
  shell.openPath(downloadsRoot);
  return { ok: true };
});

ipcMain.handle('downloads:exportZip', async () => {
  const downloads = getOrderedDownloads(lastDownloads);
  if (downloads.length === 0) {
    return { ok: false, error: 'Brak pobranych plikow do spakowania - najpierw pobierz raporty.' };
  }

  const defaultName = `PartnerTax-pobrane-${new Date().toISOString().slice(0, 10)}.zip`;
  const dialogResult = await dialog.showSaveDialog(mainWindow, {
    title: 'Eksportuj pobrane pliki do ZIP',
    defaultPath: path.join(app.getPath('downloads'), defaultName),
    filters: [{ name: 'Archiwum ZIP', extensions: ['zip'] }],
  });
  if (dialogResult.canceled || !dialogResult.filePath) {
    return { ok: false, canceled: true };
  }

  try {
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(dialogResult.filePath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      for (const entry of downloads) {
        // Nazwy w ZIP-ie ("Wroclaw - Unity Drive - Bolt - ...csv") juz zawieraja
        // miasto/firme/platforme dzieki renameDownloadedFile - flat (bez podfolderow per
        // konto) wystarczy do przejrzenia zawartosci.
        archive.file(entry.filePath, { name: path.basename(entry.filePath) });
      }
      archive.finalize();
    });
    shell.showItemInFolder(dialogResult.filePath);
    return { ok: true, filePath: dialogResult.filePath, count: downloads.length };
  } catch (error) {
    logger.error(`[downloads:exportZip] blad: ${error.stack || error.message}`);
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('upload:run', async (event) => {
  const partnertaxAccount = credentialStore.listAccounts('partnertax')[0];
  if (!partnertaxAccount) {
    return { ok: false, error: 'Brak skonfigurowanego konta PartnerTax admin.' };
  }

  const uploads = getOrderedDownloads(lastDownloads);
  if (uploads.length === 0) {
    return { ok: false, error: 'Brak pobranych plikow do wgrania - najpierw pobierz raporty (Uber/Bolt/FreeNow).' };
  }

  const statusCallback = (message) => {
    logger.info(`[upload] ${message}`);
    event.sender.send('upload:status', { message });
  };

  logger.info(`[upload] start, plikow: ${uploads.length}`);
  try {
    await runUpload(app.getPath('userData'), partnertaxAccount, uploads, { statusCallback });
    lastDownloads.clear();
    logger.info(`[upload] sukces, wgrano: ${uploads.length}`);
    return { ok: true, count: uploads.length };
  } catch (error) {
    logger.error(`[upload] blad: ${error.stack || error.message}`);
    // Pliki, ktore zdazyly sie wgrac przed bledem, sa juz trwale zapisane w PartnerTax -
    // wykreslamy je z listy "do wgrania", zeby ponowna proba nie dodala ich drugi raz
    // (patrz komentarz przy error.succeededUploads w uploadToPartnerTax).
    for (const upload of error.succeededUploads || []) {
      lastDownloads.delete(`${upload.platformId}:${upload.accountId}`);
    }
    return { ok: false, error: error.message };
  }
});

// Jeden zbiorczy plik na wszystkie konta naraz (nie osobny plik/przycisk per konto) - patrz
// renderSessionTransferSection w renderer.js. Zawiera PELNA konfiguracje kazdego konta
// (etykieta, pola logowania w JAWNYM TEKSCIE, miasto/firma, okres) plus sesje logowania
// (cookies) - swiadoma decyzja, zeby import na nowym komputerze mogl sam utworzyc brakujace
// konta i podpiac im sesje, bez wczesniejszego recznego zakladania kont o pasujacych
// etykietach. To znaczy, ze ten plik trzeba traktowac jak zbior hasel (nie wysylac otwartym
// tekstem) - patrz ostrzezenie w UI.
ipcMain.handle('sessions:exportAll', async () => {
  const dialogResult = await dialog.showSaveDialog(mainWindow, {
    title: 'Eksportuj wszystkie sesje',
    defaultPath: 'sesje-logowania.json',
    filters: [{ name: 'Plik sesji (JSON)', extensions: ['json'] }],
  });
  if (dialogResult.canceled || !dialogResult.filePath) {
    return { ok: false, canceled: true };
  }

  try {
    const sessions = [];
    for (const platform of PLATFORMS) {
      if (!platform.report) continue;
      for (const account of credentialStore.listAccounts(platform.id)) {
        const storageState = await readSessionState(app.getPath('userData'), platform.id, account.accountId);
        sessions.push({
          platformId: platform.id,
          label: account.label,
          city: account.city,
          company: account.company,
          periodMode: account.periodMode,
          reportType: account.reportType,
          periodFrom: account.periodFrom,
          periodTo: account.periodTo,
          fields: account.fields,
          storageState,
        });
      }
    }
    fs.writeFileSync(dialogResult.filePath, JSON.stringify({ exportedAt: new Date().toISOString(), sessions }, null, 2));
    return { ok: true, filePath: dialogResult.filePath, count: sessions.length };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

// Dopasowanie po platformId+etykiecie (accountId to lokalny UUID, inny na kazdym
// komputerze). Gdy konto o danej etykiecie nie istnieje lokalnie - tworzymy je z pelnej
// konfiguracji z pliku; gdy istnieje - nadpisujemy jego dane danymi z pliku, zeby zrodlem
// prawdy bylo to, co wyeksportowano. Dopiero potem doczepiamy sesje pod finalny accountId.
ipcMain.handle('sessions:importAll', async () => {
  const dialogResult = await dialog.showOpenDialog(mainWindow, {
    title: 'Importuj wszystkie sesje',
    filters: [{ name: 'Plik sesji (JSON)', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
    return { ok: false, canceled: true };
  }

  try {
    const data = JSON.parse(fs.readFileSync(dialogResult.filePaths[0], 'utf-8'));
    const imported = [];
    for (const entry of data.sessions || []) {
      const existingAccount = credentialStore.listAccounts(entry.platformId).find((a) => a.label === entry.label);
      const accountId = credentialStore.saveAccount(entry.platformId, {
        accountId: existingAccount ? existingAccount.accountId : undefined,
        label: entry.label,
        city: entry.city,
        company: entry.company,
        periodMode: entry.periodMode,
        reportType: entry.reportType,
        periodFrom: entry.periodFrom,
        periodTo: entry.periodTo,
        fields: entry.fields,
      });
      await writeSessionState(app.getPath('userData'), entry.platformId, accountId, entry.storageState);
      imported.push(`${entry.platformId}:${entry.label}`);
    }
    return { ok: true, imported };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('reports:delete', async (event) => {
  const partnertaxAccount = credentialStore.listAccounts('partnertax')[0];
  if (!partnertaxAccount) {
    return { ok: false, error: 'Brak skonfigurowanego konta PartnerTax admin.' };
  }

  const statusCallback = (message) => {
    logger.info(`[delete] ${message}`);
    event.sender.send('delete:status', { message });
  };

  logger.info('[delete] start');
  try {
    const result = await runDeleteReports(app.getPath('userData'), partnertaxAccount, { statusCallback });
    logger.info(`[delete] sukces, usunieto: ${result.deletedCount}`);
    return { ok: true, count: result.deletedCount, diagnostics: result.diagnostics };
  } catch (error) {
    logger.error(`[delete] blad: ${error.stack || error.message}`);
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('app:version', () => app.getVersion());

ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) {
    return { ok: false, error: 'Sprawdzanie aktualizacji jest dostepne tylko w spakowanej wersji aplikacji.' };
  }
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (error) {
    logger.error(`[update] blad recznego sprawdzenia: ${error.stack || error.message}`);
    return { ok: false, error: `Blad sprawdzania aktualizacji: ${shortUpdateError(error)}` };
  }
});

ipcMain.handle('update:install', () => {
  autoUpdater.quitAndInstall();
});
