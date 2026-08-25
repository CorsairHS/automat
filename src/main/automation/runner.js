const path = require('path');
const fs = require('fs');
const { launchPlatformContext } = require('./browserSession');
const { syncUberAccount } = require('./platforms/uber');
const { syncBoltAccount } = require('./platforms/bolt');
const { syncFreenowAccount } = require('./platforms/freenow');
const { syncBoltFoodAccount } = require('./platforms/boltfood');
const { uploadToPartnerTax, deleteReportsFromPartnerTax } = require('./platforms/partnertax');

const SYNC_FUNCTIONS = {
  uber: syncUberAccount,
  bolt: syncBoltAccount,
  freenow: syncFreenowAccount,
  boltfood: syncBoltFoodAccount,
};

function sanitizeFolderName(name) {
  return name.replace(/[^a-z0-9\-_]+/gi, '_');
}

/**
 * Uruchamia pobieranie raportu dla jednego konta. Otwiera widoczne okno przegladarki
 * (partner moze recznie dokonczyc 2FA), pobiera plik i zwraca jego sciezke lokalna.
 * PartnerTax platforma (upload) nie jest tu obslugiwana - to osobny modul (krok 5).
 */
async function runDownload(userDataRoot, platformId, account, { statusCallback } = {}) {
  const syncFn = SYNC_FUNCTIONS[platformId];
  if (!syncFn) {
    throw new Error(`Pobieranie nie jest obslugiwane dla platformy: ${platformId}`);
  }

  const downloadDir = path.join(userDataRoot, 'downloads', platformId, sanitizeFolderName(account.label || account.accountId));
  fs.mkdirSync(downloadDir, { recursive: true });

  const context = await launchPlatformContext(userDataRoot, platformId, account.accountId, { statusCallback });
  try {
    return await syncFn({ context, account, downloadDir, statusCallback });
  } finally {
    await context.close();
  }
}

/**
 * Wgrywa liste plikow (pobranych wczesniej przez runDownload) do PartnerTax admin,
 * na jednym, wspolnym koncie PartnerTax (multiAccount:false - patrz platforms.js).
 * uploads: [{ platformId, city, filePath }]
 */
async function runUpload(userDataRoot, account, uploads, { statusCallback } = {}) {
  const context = await launchPlatformContext(userDataRoot, 'partnertax', account.accountId, { statusCallback });
  try {
    await uploadToPartnerTax({ context, account, uploads, statusCallback });
  } finally {
    await context.close();
  }
}

/**
 * Usuwa po jednym Data source dla Uber/Bolt/FreeNow z pierwszego niezakonczonego
 * rozliczenia w PartnerTax admin (patrz deleteReportsFromPartnerTax) - na tym samym,
 * wspolnym koncie PartnerTax co runUpload.
 */
async function runDeleteReports(userDataRoot, account, { statusCallback } = {}) {
  const context = await launchPlatformContext(userDataRoot, 'partnertax', account.accountId, { statusCallback });
  try {
    return await deleteReportsFromPartnerTax({ context, account, statusCallback });
  } finally {
    await context.close();
  }
}

module.exports = { runDownload, runUpload, runDeleteReports };
