const path = require('path');
const fs = require('fs');

// Lista Kontroli pobran (lastDownloads / lastGwarantDownloads w main.js) zapisana na
// dysku, zeby przetrwala restart i aktualizacje aplikacji - klient nie chce tracic
// informacji, co jest pobrane i co juz wgrane do PartnerTax.
const STATE_FILE_NAME = 'downloads-state.json';

function stateFilePath(userDataDir) {
  return path.join(userDataDir, STATE_FILE_NAME);
}

function saveDownloadsState(userDataDir, { defaultMap, gwarantMap }) {
  const filePath = stateFilePath(userDataDir);
  const tmpPath = `${filePath}.tmp`;
  const data = {
    default: Array.from(defaultMap.values()),
    gwarant: Array.from(gwarantMap.values()),
  };
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

function toMap(entries) {
  const map = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    // Pomijamy wpisy, ktorych pliku juz nie ma (np. recznie usuniety folder pobran).
    if (!entry?.platformId || !entry?.accountId || !entry?.filePath || !fs.existsSync(entry.filePath)) continue;
    map.set(`${entry.platformId}:${entry.accountId}`, entry);
  }
  return map;
}

/** Zwraca { defaultMap, gwarantMap }; przy braku/uszkodzeniu pliku - puste mapy. */
function loadDownloadsState(userDataDir) {
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(stateFilePath(userDataDir), 'utf-8')) || {};
  } catch {
    data = {};
  }
  return { defaultMap: toMap(data.default), gwarantMap: toMap(data.gwarant) };
}

module.exports = { saveDownloadsState, loadDownloadsState, STATE_FILE_NAME };
