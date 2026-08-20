const path = require('path');
const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const credentialStore = require('./credentialStore');
const { PLATFORMS, PERIOD_MODES } = require('./platforms');
const { runDownload, runUpload } = require('./automation/runner');

let mainWindow;

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
    return { ok: true, count: uploads.length };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});
