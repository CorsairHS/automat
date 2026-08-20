/**
 * Wariant testu wykrywalnosci z dodanym playwright-extra + stealth plugin,
 * zeby porownac wyniki z bot-detection-test.js (bez stealth).
 *
 * Uzycie: node scripts/bot-detection-test-stealth.js
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth')();

chromium.use(StealthPlugin);

const OUTPUT_DIR = path.join(__dirname, '..', 'tmp', 'bot-detection-test-stealth');

async function testSannysoft(context) {
  const page = await context.newPage();
  await page.goto('https://bot.sannysoft.com', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'sannysoft.png'), fullPage: true });

  const webdriver = await page.evaluate(() => navigator.webdriver);
  await page.close();
  return { webdriver };
}

async function testCreepjs(context) {
  const page = await context.newPage();
  await page.goto('https://abrahamjuliot.github.io/creepjs/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'creepjs.png'), fullPage: true });
  await page.close();
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const userDataDir = path.join(OUTPUT_DIR, 'browser-sessions', 'bot-test-stealth', 'session1');
  fs.mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    acceptDownloads: true,
    viewport: { width: 1280, height: 900 },
  });

  console.log('Test 1/2: bot.sannysoft.com (ze stealth)');
  const { webdriver } = await testSannysoft(context);
  console.log(`  navigator.webdriver = ${webdriver}`);
  console.log(`  screenshot: ${path.join(OUTPUT_DIR, 'sannysoft.png')}`);

  console.log('Test 2/2: creepjs (ze stealth)');
  await testCreepjs(context);
  console.log(`  screenshot: ${path.join(OUTPUT_DIR, 'creepjs.png')}`);

  await context.close();
  console.log('\nGotowe. Sprawdz zrzuty ekranu w:', OUTPUT_DIR);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
