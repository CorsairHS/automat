const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, safeStorage, dialog } = require('electron');
const credentialStore = require('./credentialStore');
const { PLATFORMS, PERIOD_MODES } = require('./platforms');
const { runDownload, runUpload, runDeleteReports } = require('./automation/runner');
const { readSessionState, writeSessionState } = require('./automation/browserSession');

let mainWindow;
//commit
// Ostatni udany download per (platformId, accountId) - zrodlo dla uploadu do
// PartnerTax admin. Tylko w pamieci procesu (nie trzeba trwalosci miedzy uruchomieniami
// aplikacji - upload robi sie zaraz po pobraniu).
const lastDownloads = new Map();

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
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('safeStorage encryption is not available on this system - credentials would be stored unencrypted.');
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
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

ipcMain.handle('accounts:list', (_event, platformId) => {
  const platform = PLATFORMS.find((p) => p.id === platformId);
  const accounts = credentialStore.listAccounts(platformId);
  return accounts.map((account) => maskAccountForRenderer(platform, account));
});

ipcMain.handle('accounts:save', (_event, platformId, account) => {
  const accountId = credentialStore.saveAccount(platformId, account);
  return { ok: true, accountId };
});

ipcMain.handle('accounts:delete', (_event, platformId, accountId) => {
  credentialStore.deleteAccount(platformId, accountId);
  return { ok: true };
});

ipcMain.handle('sync:run', async (event, platformId, accountId) => {
  const account = credentialStore.listAccounts(platformId).find((a) => a.accountId === accountId);
  if (!account) {
    return { ok: false, error: 'Nie znaleziono konta.' };
  }

  const statusCallback = (message) => {
    event.sender.send('sync:status', { platformId, accountId, message });
  };

  try {
    const result = await runDownload(app.getPath('userData'), platformId, account, { statusCallback });
    lastDownloads.set(`${platformId}:${accountId}`, {
      platformId,
      accountId,
      city: account.city,
      company: account.company,
      filePath: result.filePath,
      downloadedAt: new Date().toISOString(),
    });
    return { ok: true, filePath: result.filePath };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

// Warstwa kontrolna: pozwala rendererowi sprawdzic, ktore skonfigurowane konta maja juz
// pobrany plik w biezacej sesji (checklista "co sie pobralo" przed uploadem do PartnerTax).
ipcMain.handle('downloads:status', () => {
  return Array.from(lastDownloads.values());
});

ipcMain.handle('upload:run', async (event) => {
  const partnertaxAccount = credentialStore.listAccounts('partnertax')[0];
  if (!partnertaxAccount) {
    return { ok: false, error: 'Brak skonfigurowanego konta PartnerTax admin.' };
  }

  const uploads = Array.from(lastDownloads.values());
  if (uploads.length === 0) {
    return { ok: false, error: 'Brak pobranych plikow do wgrania - najpierw pobierz raporty (Uber/Bolt/FreeNow).' };
  }

  const statusCallback = (message) => {
    event.sender.send('upload:status', { message });
  };

  try {
    await runUpload(app.getPath('userData'), partnertaxAccount, uploads, { statusCallback });
    lastDownloads.clear();
    return { ok: true, count: uploads.length };
  } catch (error) {
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
    event.sender.send('delete:status', { message });
  };

  try {
    const result = await runDeleteReports(app.getPath('userData'), partnertaxAccount, { statusCallback });
    return { ok: true, count: result.deletedCount, diagnostics: result.diagnostics };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});
