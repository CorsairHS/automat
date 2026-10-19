const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, safeStorage, dialog, shell } = require('electron');
const archiver = require('archiver');
const credentialStore = require('./credentialStore');
const { sortBySettlementOrder } = require('./settlementOrder');
const { PLATFORMS, PERIOD_MODES } = require('./platforms');
const { runDownload, runUpload, runDeleteReports } = require('./automation/runner');
const { renameDownloadedFile, attachManualFile, getDownloadDir } = require('./automation/downloadFiles');
const { abortRun, AbortedByUserError } = require('./automation/activeRuns');
const { UploadStoppedError } = require('./automation/platforms/partnertax');
const { validateDownloadedReport, ReportValidationError } = require('./automation/reportValidator');
const { readSessionState, writeSessionState } = require('./automation/browserSession');
const { autoUpdater } = require('electron-updater');
const logger = require('./logger');
const { saveDownloadsState, loadDownloadsState } = require('./downloadsState');
const { recoverDownloads, readUploadedPathsFromLogs } = require('./downloadsRecovery');

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
// PartnerTax admin. Zapisywane na dysku (downloadsState.js) i wczytywane przy starcie -
// lista ma przetrwac restart i aktualizacje aplikacji. Konta z grupy "gwarant" (patrz
// credentialStore.listAccounts) trafiaja do OSOBNEJ mapy (lastGwarantDownloads), zeby ich
// pobrania nigdy nie wplynely na wspolna Kontrole pobran/Pobierz wszystkie/wgrywanie do
// PartnerTax - Gwarant ma byc calkowicie niezaleznym obiegiem.
const lastDownloads = new Map();
const lastGwarantDownloads = new Map();

// Kolejnosc wgrywania plikow do PartnerTax admin decyduje o kolejnosci wierszy w
// zapisanym rozliczeniu (kazdy plik to nowy "Add another Data source" na koncu
// formularza) - klient chce dokladnie takiej kolejnosci jak w jego ostatnim zamknietym
// rozliczeniu: firma -> miasto -> platforma (patrz settlementOrder.js), a nie w
// kolejnosci zakonczenia pobran ani pogrupowane po platformie.
function persistDownloads() {
  try {
    saveDownloadsState(app.getPath('userData'), { defaultMap: lastDownloads, gwarantMap: lastGwarantDownloads });
  } catch (error) {
    logger.error(`[downloads] nie udalo sie zapisac listy pobran: ${error.stack || error.message}`);
  }
}

function restoreDownloads() {
  const { defaultMap, gwarantMap } = loadDownloadsState(app.getPath('userData'));
  for (const [key, entry] of defaultMap) lastDownloads.set(key, entry);
  for (const [key, entry] of gwarantMap) lastGwarantDownloads.set(key, entry);
  logger.info(`[downloads] wczytano liste pobran: ${defaultMap.size} + gwarant ${gwarantMap.size}`);

  // Konta bez wpisu - probujemy odtworzyc z folderu pobranych (patrz downloadsRecovery.js).
  // Tylko grupa domyslna: kopia konta w Gwarancie ma ta sama etykiete, wiec i ten sam
  // folder pobran - nie da sie odroznic, dla ktorej listy plik byl pobrany.
  try {
    const accounts = PLATFORMS.filter((p) => p.multiAccount && p.report).flatMap((platform) =>
      credentialStore
        .listAccounts(platform.id, 'default')
        .filter((account) => !lastDownloads.has(`${platform.id}:${account.accountId}`))
        .map((account) => ({ platformId: platform.id, platformLabel: platform.label, account }))
    );
    if (accounts.length === 0) return;
    const recovered = recoverDownloads({
      userDataDir: app.getPath('userData'),
      accounts,
      uploadedPaths: readUploadedPathsFromLogs(path.join(app.getPath('userData'), 'logs')),
    });
    for (const entry of recovered) {
      lastDownloads.set(`${entry.platformId}:${entry.accountId}`, entry);
      logger.info(`[downloads] odtworzono z folderu${entry.uploadedAt ? ' (juz wgrany)' : ''}: ${entry.filePath}`);
    }
    if (recovered.length > 0) persistDownloads();
  } catch (error) {
    logger.error(`[downloads] odtwarzanie z folderu nie powiodlo sie: ${error.stack || error.message}`);
  }
}

function getOrderedDownloads(downloadsMap) {
  return sortBySettlementOrder(Array.from(downloadsMap.values()));
}

function recordDownload(platformId, account, filePath, { manual = false } = {}) {
  const targetMap = account.group === 'gwarant' ? lastGwarantDownloads : lastDownloads;
  targetMap.set(`${platformId}:${account.accountId}`, {
    platformId,
    accountId: account.accountId,
    city: account.city,
    company: account.company,
    filePath,
    downloadedAt: new Date().toISOString(),
    manual,
  });
  persistDownloads();
}

function platformLabelOf(platformId) {
  return PLATFORMS.find((p) => p.id === platformId)?.label || platformId;
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

  // Po migracji kont - odtwarzanie z folderu czyta liste kont.
  restoreDownloads();

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
    const filePath = renameDownloadedFile(result.filePath, { city: account.city, company: account.company, platformLabel: platformLabelOf(platformId) });
    recordDownload(platformId, account, filePath);
    logger.info(`${logPrefix} sukces: ${filePath}`);
    return { ok: true, filePath };
  } catch (error) {
    if (error instanceof AbortedByUserError) {
      logger.info(`${logPrefix} przerwano recznie`);
      return { ok: false, aborted: true, error: error.message };
    }
    logger.error(`${logPrefix} blad: ${error.stack || error.message}`);
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('sync:abort', async (_event, platformId, accountId) => {
  const aborted = await abortRun(`${platformId}:${accountId}`);
  if (aborted) logger.info(`[sync ${platformId}:${accountId}] przerwanie na zyczenie partnera`);
  return { ok: aborted };
});

// Reczny plik dla konta (przycisk "Wgraj wlasny plik" w Kontroli pobran, panel bledu,
// przerwanie konta) - patrz attachManualFile w downloadFiles.js.
ipcMain.handle('downloads:attachManual', async (_event, platformId, accountId, { filePath, force = false } = {}) => {
  const account = credentialStore.listAccounts(platformId).find((a) => a.accountId === accountId);
  if (!account) return { ok: false, error: 'Nie znaleziono konta.' };

  let sourcePath = filePath;
  if (!sourcePath) {
    const dialogResult = await dialog.showOpenDialog(mainWindow, {
      title: `Wybierz plik raportu: ${platformLabelOf(platformId)} - ${account.label || accountId}`,
      filters: [{ name: 'Raport CSV', extensions: ['csv'] }, { name: 'Wszystkie pliki', extensions: ['*'] }],
      properties: ['openFile'],
    });
    if (dialogResult.canceled || dialogResult.filePaths.length === 0) return { ok: false, canceled: true };
    sourcePath = dialogResult.filePaths[0];
  }

  try {
    const result = attachManualFile({
      platformId,
      account,
      sourcePath,
      downloadDir: getDownloadDir(app.getPath('userData'), platformId, account),
      force,
    });
    if (!result.ok) return result;
    const finalPath = renameDownloadedFile(result.filePath, { city: account.city, company: account.company, platformLabel: platformLabelOf(platformId) });
    recordDownload(platformId, account, finalPath, { manual: true });
    logger.info(`[manual ${platformId}:${account.label || accountId}] dodano plik${force ? ' (mimo ostrzezenia)' : ''}: ${finalPath}`);
    return { ok: true, filePath: finalPath };
  } catch (error) {
    logger.error(`[manual ${platformId}:${accountId}] blad: ${error.stack || error.message}`);
    return { ok: false, error: error.message };
  }
});

// Tylko pliki znane z listy pobran - renderer nie moze otworzyc dowolnej sciezki.
ipcMain.handle('downloads:showFile', (_event, filePath) => {
  const known = [...lastDownloads.values(), ...lastGwarantDownloads.values()].some((d) => d.filePath === filePath);
  if (!known || !fs.existsSync(filePath)) return { ok: false, error: 'Plik nie jest juz dostepny.' };
  shell.showItemInFolder(filePath);
  return { ok: true };
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

// Wgrane pliki zostaja w Kontroli pobran (klient chce je nadal widziec i moc otworzyc,
// takze po przerwaniu wgrywania) - tylko oznaczamy je uploadedAt, a upload:run je pomija.
// Oznaczamy tylko gdy plik konta jest nadal ten sam - plik podmieniony w trakcie wgrywania
// (reczny plik / "Pobierz teraz") zostaje do wgrania.
function markUploaded(sourceMap, uploads) {
  const uploadedAt = new Date().toISOString();
  for (const u of uploads) {
    const entry = sourceMap.get(`${u.platformId}:${u.accountId}`);
    if (entry?.filePath === u.filePath) entry.uploadedAt = uploadedAt;
  }
  persistDownloads();
}

// Stan trwajacego wgrywania: flaga "Zatrzymaj" i ewentualne oczekujace pytanie o akceptacje.
let uploadControl = null;

// source: 'default' (Kontrola pobran) albo 'gwarant' (osobna checklista zakladki Gwarant -
// wlasny przycisk wgrywania, pliki z lastGwarantDownloads).
ipcMain.handle('upload:run', async (event, { confirmEach = false, source = 'default' } = {}) => {
  if (uploadControl) return { ok: false, error: 'Wgrywanie juz trwa.' };
  const partnertaxAccount = credentialStore.listAccounts('partnertax')[0];
  if (!partnertaxAccount) {
    return { ok: false, error: 'Brak skonfigurowanego konta PartnerTax admin.' };
  }

  const sourceMap = source === 'gwarant' ? lastGwarantDownloads : lastDownloads;
  const allDownloads = getOrderedDownloads(sourceMap);
  // Pliki juz wgrane zostaja na liscie (oznaczone uploadedAt), ale nie wgrywamy ich drugi raz.
  const uploads = allDownloads.filter((d) => !d.uploadedAt);
  if (allDownloads.length === 0) {
    return { ok: false, error: 'Brak pobranych plikow do wgrania - najpierw pobierz raporty (Uber/Bolt/FreeNow).' };
  }
  if (uploads.length === 0) {
    return { ok: false, error: 'Wszystkie pliki z listy sa juz wgrane do PartnerTax.' };
  }

  const statusCallback = (message) => {
    logger.info(`[upload] ${message}`);
    event.sender.send('upload:status', { message });
  };

  const control = { stopRequested: false, resolveConfirm: null };
  uploadControl = control;
  // Numeracja w pytaniu o akceptacje wg calej listy (razem z juz wgranymi), zeby po
  // wznowieniu bylo widac "Wgrano 5/15", a nie znowu "1/11".
  const positionOf = (upload) => allDownloads.indexOf(upload);
  const confirmAfterEach = confirmEach
    ? (upload) =>
        new Promise((resolve) => {
          if (control.stopRequested) {
            resolve('stop');
            return;
          }
          control.resolveConfirm = resolve;
          event.sender.send('upload:confirm', {
            index: positionOf(upload),
            total: allDownloads.length,
            platformId: upload.platformId,
            accountId: upload.accountId,
            fileName: path.basename(upload.filePath),
          });
        })
    : undefined;

  logger.info(`[upload${source === 'gwarant' ? ' gwarant' : ''}] start, plikow: ${uploads.length}${confirmEach ? ' (z akceptacja kazdego pliku)' : ''}`);
  try {
    await runUpload(app.getPath('userData'), partnertaxAccount, uploads, {
      statusCallback,
      confirmAfterEach,
      shouldStop: () => control.stopRequested,
    });
    markUploaded(sourceMap, uploads);
    logger.info(`[upload] sukces, wgrano: ${uploads.length}`);
    return { ok: true, count: uploads.length };
  } catch (error) {
    // Pliki, ktore zdazyly sie wgrac przed bledem lub zatrzymaniem, sa juz trwale zapisane
    // w PartnerTax - oznaczamy je jako wgrane, zeby ponowna proba nie dodala ich drugi raz
    // (patrz komentarz przy error.succeededUploads w uploadToPartnerTax).
    markUploaded(sourceMap, error.succeededUploads || []);
    if (error instanceof UploadStoppedError) {
      const count = (error.succeededUploads || []).length;
      const next = uploads[count];
      logger.info(`[upload] zatrzymano na zyczenie, wgrano: ${count}${next ? `, nastepny: ${next.filePath}` : ''}`);
      return {
        ok: false,
        stopped: true,
        count,
        nextFile: next ? { position: positionOf(next) + 1, total: allDownloads.length, fileName: path.basename(next.filePath) } : null,
      };
    }
    logger.error(`[upload] blad: ${error.stack || error.message}`);
    return { ok: false, error: error.message };
  } finally {
    if (uploadControl === control) uploadControl = null;
  }
});

function settleUploadConfirm(decision) {
  const resolve = uploadControl?.resolveConfirm;
  if (uploadControl) uploadControl.resolveConfirm = null;
  resolve?.(decision);
}

ipcMain.handle('upload:confirmReply', (_event, decision) => {
  settleUploadConfirm(decision === 'stop' ? 'stop' : 'continue');
  return { ok: true };
});

ipcMain.handle('upload:stop', () => {
  if (!uploadControl) return { ok: false };
  uploadControl.stopRequested = true;
  settleUploadConfirm('stop');
  return { ok: true };
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
    // Raporty zniknely z rozliczenia - pliki z listy trzeba moc wgrac ponownie.
    if (result.deletedCount > 0) {
      for (const entry of [...lastDownloads.values(), ...lastGwarantDownloads.values()]) delete entry.uploadedAt;
      persistDownloads();
    }
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
