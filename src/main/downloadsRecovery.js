const path = require('path');
const fs = require('fs');
const { getDownloadDir, sanitizeFileNamePart } = require('./automation/downloadFiles');
const { validateDownloadedReport, ReportValidationError } = require('./automation/reportValidator');

// Odtworzenie Kontroli pobran z folderu pobranych plikow - dla kont, ktorych nie ma na
// zapisanej liscie (downloadsState.js). Powod: przed wersja 1.1.4 lista byla tylko w
// pamieci i ginela przy restarcie/aktualizacji, a pliki zostawaly na dysku (zgloszone przez
// klienta 2026-10-19). Bierzemy tylko pliki przemianowane przez automat (prefiks
// "Miasto - Firma - Platforma - ") i tylko za okres, ktorego konto teraz oczekuje
// (validateDownloadedReport) - stare tygodnie nie wracaja na liste.

const REPORT_EXTENSIONS = new Set(['.csv', '.xlsx', '.xls']);

function listReportFiles(dir, depth = 2) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // FreeNow rozpakowuje ZIP do podfolderu (earnings_<od>_<do>/).
      if (depth > 1) files.push(...listReportFiles(fullPath, depth - 1));
    } else if (REPORT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Sciezki plikow wgranych do PartnerTax wg logu automatu (automat.1.log + automat.log):
 * "Dodaje Data source: ... plik=<sciezka>..." potwierdzone przez "Zapisano (". Udane
 * "usuwanie raportow" kasuje wszystko, co bylo wgrane wczesniej.
 * Zwraca Map<sciezka, ISO czas zapisu>.
 */
function readUploadedPathsFromLogs(logsDir) {
  const uploaded = new Map();
  let pending = null;
  for (const name of ['automat.1.log', 'automat.log']) {
    let text;
    try {
      text = fs.readFileSync(path.join(logsDir, name), 'utf-8');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const timestamp = line.slice(0, 24);
      const added = line.match(/\[upload\] Dodaje Data source: .*?, plik=(.*)\.\.\.$/);
      if (added) {
        pending = added[1];
      } else if (line.includes('[upload] Zapisano (')) {
        if (pending) uploaded.set(pending, timestamp);
        pending = null;
      } else if (/\[upload\] (blad|start)/.test(line)) {
        pending = null;
      } else if (/\[delete\] sukces, usunieto: [1-9]/.test(line)) {
        uploaded.clear();
      }
    }
  }
  return uploaded;
}

/**
 * accounts: [{ platformId, platformLabel, account }] - tylko konta bez wpisu na liscie.
 * Zwraca wpisy w formacie recordDownload (+ recovered: true, uploadedAt wg logu).
 */
function recoverDownloads({ userDataDir, accounts, uploadedPaths = new Map(), now = new Date() }) {
  const recovered = [];
  for (const { platformId, platformLabel, account } of accounts) {
    const prefix = [account.city, account.company, platformLabel].map(sanitizeFileNamePart).filter(Boolean).join(' - ');
    if (!prefix) continue;
    const candidates = listReportFiles(getDownloadDir(userDataDir, platformId, account))
      .filter((filePath) => path.basename(filePath).startsWith(`${prefix} - `))
      .filter((filePath) => {
        try {
          // Walidator parsuje oryginalna nazwe z serwera platformy - bez naszego prefiksu.
          const originalName = path.basename(filePath).slice(prefix.length + 3);
          validateDownloadedReport({ platformId, account, filePath: path.join(path.dirname(filePath), originalName) });
          return true;
        } catch (error) {
          if (error instanceof ReportValidationError) return false;
          throw error;
        }
      })
      .map((filePath) => ({ filePath, mtime: fs.statSync(filePath).mtime }))
      .sort((a, b) => b.mtime - a.mtime);
    if (candidates.length === 0) continue;

    const { filePath, mtime } = candidates[0];
    const entry = {
      platformId,
      accountId: account.accountId,
      city: account.city,
      company: account.company,
      filePath,
      downloadedAt: (mtime > now ? now : mtime).toISOString(),
      manual: false,
      recovered: true,
    };
    if (uploadedPaths.has(filePath)) entry.uploadedAt = uploadedPaths.get(filePath);
    recovered.push(entry);
  }
  return recovered;
}

module.exports = { recoverDownloads, readUploadedPathsFromLogs };
