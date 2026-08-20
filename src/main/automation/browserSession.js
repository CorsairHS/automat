const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

/**
 * Uruchamia trwaly (persistent) kontekst przegladarki per platforma+konto, zeby
 * sesja/cookies przetrwaly miedzy uruchomieniami - ogranicza to jak czesto trzeba
 * przechodzic przez 2FA. headless:false, bo przy 2FA partner musi widziec okno
 * i recznie wpisac kod.
 */
async function launchPlatformContext(userDataRoot, platformId, accountId, { headless = false } = {}) {
  const userDataDir = path.join(userDataRoot, 'browser-sessions', platformId, accountId);
  fs.mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    acceptDownloads: true,
    viewport: { width: 1280, height: 900 },
  });

  return context;
}

module.exports = { launchPlatformContext };
