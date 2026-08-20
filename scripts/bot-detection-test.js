/**
 * Test wykrywalnosci automatyzacji: uruchamia taka sama konfiguracje przegladarki
 * jak produkcyjny browserSession.js (persistent context, headless:false) i odwiedza
 * strony testowe wykrywajace boty/automatyzacje, zebierajac wyniki do sprawdzenia.
 *
 * Uzycie: node scripts/bot-detection-test.js
 */

const path = require('path');
const fs = require('fs');
const { launchPlatformContext } = require('../src/main/automation/browserSession');

const OUTPUT_DIR = path.join(__dirname, '..', 'tmp', 'bot-detection-test');

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

  const context = await launchPlatformContext(OUTPUT_DIR, 'bot-test', 'session1', { headless: false });

  console.log('Test 1/2: bot.sannysoft.com');
  const { webdriver } = await testSannysoft(context);
  console.log(`  navigator.webdriver = ${webdriver}`);
  console.log(`  screenshot: ${path.join(OUTPUT_DIR, 'sannysoft.png')}`);

  console.log('Test 2/2: creepjs (pelny fingerprint, w tym wykrywanie automatyzacji)');
  await testCreepjs(context);
  console.log(`  screenshot: ${path.join(OUTPUT_DIR, 'creepjs.png')}`);

  await context.close();
  console.log('\nGotowe. Sprawdz zrzuty ekranu w:', OUTPUT_DIR);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
