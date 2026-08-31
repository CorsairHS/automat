const fs = require('fs');
const path = require('path');

/**
 * Prosty logger do pliku (bez zewnetrznych zaleznosci) - jedyny slad diagnostyczny
 * nieudanej synchronizacji poza tym, co zdazyl zobaczyc partner na ekranie (statusCallback
 * jest ulotny, znika po zamknieciu okna). Rotacja po rozmiarze, zeby plik nie rosl bez
 * konca przy dlugo dzialajacej instalacji.
 */
const MAX_LOG_BYTES = 5 * 1024 * 1024;

let logFilePath = null;

function init(userDataRoot) {
  const logsDir = path.join(userDataRoot, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  logFilePath = path.join(logsDir, 'automat.log');
}

function rotateIfNeeded() {
  try {
    if (fs.statSync(logFilePath).size <= MAX_LOG_BYTES) return;
    const rotatedPath = logFilePath.replace(/\.log$/, '.1.log');
    fs.rmSync(rotatedPath, { force: true });
    fs.renameSync(logFilePath, rotatedPath);
  } catch {
    // Brak pliku przy pierwszym uruchomieniu - nic do rotacji.
  }
}

function write(level, message) {
  // Logger niezainicjalizowany (np. w testach, ktore nie przechodza przez main.js) -
  // cichy no-op, zamiast wymagac init() wszedzie tam, gdzie logger jest tylko opcjonalnie uzywany.
  if (!logFilePath) return;
  rotateIfNeeded();
  const line = `${new Date().toISOString()} [${level}] ${message}\n`;
  try {
    fs.appendFileSync(logFilePath, line);
  } catch {
    // Zapis do pliku logu nigdy nie powinien wywrocic operacji, ktora go wywolala.
  }
}

module.exports = {
  init,
  info: (message) => write('INFO', message),
  warn: (message) => write('WARN', message),
  error: (message) => write('ERROR', message),
  getLogFilePath: () => logFilePath,
};
