const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

function getPlaywrightCliPath() {
  return path.join(path.dirname(require.resolve('playwright')), 'cli.js');
}

let installPromise = null;

/**
 * Playwright pobiera binarke przegladarki do lokalnego cache uzytkownika
 * (%LOCALAPPDATA%\ms-playwright na Windows) przy `npm install` (skrypt `postinstall` w
 * package.json) - to dziala u deweloperow, ale spakowany .exe dystrybuowany do partnerow
 * nigdy nie odpala `npm install`, wiec ta binarka nigdy tam sie nie pojawia sama z siebie
 * ("Executable doesn't exist ... chrome.exe" przy pierwszym "Pobierz teraz" u klienta,
 * zaobserwowane na zywo 2026-08-21). Naprawa: przy kazdym uruchomieniu kontekstu
 * sprawdzamy, czy binarka istnieje, a jesli nie - odpalamy wbudowane w paczke aplikacji
 * `playwright/cli.js install chromium` jako podproces (binarka Electrona z
 * ELECTRON_RUN_AS_NODE=1, zeby dzialac jak zwykly `node`, bez wymagania osobnej instalacji
 * Node.js na komputerze partnera). Wymaga jednorazowo polaczenia z internetem (~150 MB) -
 * kolejne uruchomienia znajduja juz pobrana binarke i pomijaja ten krok.
 */
async function ensureChromiumInstalled(statusCallback) {
  const log = (msg) => statusCallback?.(msg);
  const executablePath = chromium.executablePath();
  if (fs.existsSync(executablePath)) return;

  if (!installPromise) {
    installPromise = new Promise((resolve, reject) => {
      log('Pierwsze uruchomienie - pobieram wymagana przegladarke (Chromium, ok. 150 MB, wymaga internetu)...');
      const child = spawn(process.execPath, [getPlaywrightCliPath(), 'install', 'chromium'], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        windowsHide: true,
      });

      child.stdout.on('data', (chunk) => log(chunk.toString().trim()));
      child.stderr.on('data', (chunk) => log(chunk.toString().trim()));
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          log('Chromium pobrane.');
          resolve();
        } else {
          reject(new Error(`Instalacja Chromium zakonczyla sie kodem ${code}.`));
        }
      });
    }).finally(() => {
      installPromise = null;
    });
  }

  await installPromise;

  if (!fs.existsSync(executablePath)) {
    throw new Error('Instalacja Chromium zakonczona, ale binarka nadal nie istnieje - sprawdz polaczenie z internetem i sprobuj ponownie.');
  }
}

/**
 * Uruchamia trwaly (persistent) kontekst przegladarki per platforma+konto, zeby
 * sesja/cookies przetrwaly miedzy uruchomieniami - ogranicza to jak czesto trzeba
 * przechodzic przez 2FA. headless:false, bo przy 2FA partner musi widziec okno
 * i recznie wpisac kod.
 */
async function launchPlatformContext(userDataRoot, platformId, accountId, { headless = false, statusCallback } = {}) {
  await ensureChromiumInstalled(statusCallback);

  const userDataDir = path.join(userDataRoot, 'browser-sessions', platformId, accountId);
  fs.mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    acceptDownloads: true,
    viewport: { width: 1280, height: 900 },
    // Bez wymuszenia jezyka strony (Uber/Bolt/FreeNow) renderuja UI w jezyku wykrytym
    // z konta/geolokalizacji, co bywa nieprzewidywalne (obserwowane PL, EN, a nawet RU dla
    // tego samego konta w roznych sesjach) i psuje selektory oparte o tekst przyciskow.
    // locale ustawia Accept-Language/navigator.language, --lang wymusza jezyk UI Chromium.
    locale: 'pl-PL',
    args: ['--lang=pl-PL'],
  });

  return context;
}

module.exports = { launchPlatformContext };
