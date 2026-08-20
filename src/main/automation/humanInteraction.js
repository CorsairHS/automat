/**
 * Pomocnicze funkcje do bardziej "ludzkiego" wypelniania formularzy logowania: kursor
 * przesuwa sie do elementu w wielu krokach (zamiast teleportacji Playwrighta), z
 * losowym opoznieniem przed klikiem, a tekst jest wpisywany znak po znaku z losowym
 * odstepem - to ogranicza najbardziej oczywiste sygnaly automatyzacji na etapie
 * logowania, ktory jest najczesciej monitorowany przez systemy antybotowe.
 */

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

async function humanDelay(min = 150, max = 450) {
  await new Promise((resolve) => setTimeout(resolve, randomBetween(min, max)));
}

async function humanClick(locator, options = {}) {
  const page = locator.page();
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const box = await locator.boundingBox();
  if (box) {
    const x = box.x + box.width * randomBetween(0.3, 0.7);
    const y = box.y + box.height * randomBetween(0.3, 0.7);
    await page.mouse.move(x, y, { steps: Math.round(randomBetween(15, 30)) });
    await humanDelay(80, 220);
  }
  await locator.click(options);
}

async function humanFill(locator, text) {
  await humanClick(locator);
  const page = locator.page();
  await locator.fill('');
  for (const char of text) {
    await page.keyboard.type(char, { delay: randomBetween(30, 110) });
  }
}

module.exports = { humanClick, humanFill, humanDelay };
