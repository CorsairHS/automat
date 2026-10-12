// src/main/automation/downloadFiles.js
const path = require('path');
const fs = require('fs');
const { validateDownloadedReport, ReportValidationError } = require('./reportValidator');

function sanitizeFolderName(name) {
  return name.replace(/[^a-z0-9\-_]+/gi, '_');
}

function sanitizeFileNamePart(value) {
  return String(value || '').trim().replace(/[\\/:*?"<>|]+/g, '_');
}

function getDownloadDir(userDataRoot, platformId, account) {
  return path.join(userDataRoot, 'downloads', platformId, sanitizeFolderName(account.label || account.accountId));
}

// Przeniesione z main.js bez zmian zachowania (patrz komentarz historyczny: klient chcial
// miasto/firme/platforme w nazwie pliku; zmiana nazwy PO walidacji, bo walidator parsuje
// oryginalna nazwe serwera). Nowe: plik, ktory juz ma prefiks (klient wybral recznie plik
// z folderu pobran), nie dostaje go drugi raz.
function renameDownloadedFile(filePath, { city, company, platformLabel }) {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const originalBase = path.basename(filePath, ext);
  const prefix = [city, company, platformLabel].map(sanitizeFileNamePart).filter(Boolean).join(' - ');
  if (!prefix || originalBase.startsWith(`${prefix} - `)) return filePath;

  const newPath = path.join(dir, `${prefix} - ${originalBase}${ext}`);
  fs.renameSync(filePath, newPath);
  return newPath;
}

/**
 * Plik wskazany recznie przez klienta dla konkretnego konta (przycisk "Wgraj wlasny plik",
 * panel bledu pobierania, przerwanie konta). Walidacja jak dla pobranego automatem - przy
 * niezgodnosci (zly tydzien/firma) zwracamy ostrzezenie, a decyzja "Uzyj mimo to" (force)
 * nalezy do klienta. Plik jest KOPIOWANY do folderu konta - oryginal zostaje nietkniety.
 */
function attachManualFile({ platformId, account, sourcePath, downloadDir, force = false }) {
  if (!fs.existsSync(sourcePath)) {
    return { ok: false, error: `Plik nie istnieje: ${sourcePath}` };
  }
  try {
    validateDownloadedReport({ platformId, account, filePath: sourcePath });
  } catch (error) {
    if (!(error instanceof ReportValidationError)) throw error;
    if (!force) {
      return { ok: false, needsConfirm: true, warning: error.message, filePath: sourcePath };
    }
  }
  fs.mkdirSync(downloadDir, { recursive: true });
  const targetPath = path.join(downloadDir, path.basename(sourcePath));
  if (path.resolve(targetPath) !== path.resolve(sourcePath)) {
    fs.copyFileSync(sourcePath, targetPath);
  }
  return { ok: true, filePath: targetPath };
}

module.exports = { getDownloadDir, renameDownloadedFile, attachManualFile };
