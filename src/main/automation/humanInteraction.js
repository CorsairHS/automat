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

async function humanDelay(min = 300, max = 800) {
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
    await humanDelay(200, 450);
  }
  await locator.click(options);
}

/**
 * Wpisuje tekst znak po znaku BEZPOSREDNIO w pole (locator.pressSequentially), a potem
 * sprawdza, czy pole faktycznie zawiera caly tekst. Wczesniej znaki szly przez
 * page.keyboard, czyli do elementu, ktory akurat mial fokus - gdy strona w trakcie
 * wpisywania przejela fokus (podpowiedz autouzupelniania Chrome, przerenderowanie
 * formularza), reszta znakow przepadala i do logowania szedl ucięty email/haslo
 * (klient, 2026-10-12: "unitydrivewrocla", "novapartner.warszawa@" w Bolt Food/FreeNow).
 * Przy niezgodnosci - wypelnienie pola bezposrednio przez Playwright (jak w
 * typeIntoLoginField w uber.js). Wartosci nie ujawniamy w bledzie (haslo!).
 */
async function humanFill(locator, text) {
  await locator.waitFor({ state: 'visible', timeout: 30000 });
  try {
    await humanClick(locator, { timeout: 5000 });
  } catch {
    await locator.focus({ timeout: 2000 }).catch(() => {});
  }
  try {
    await locator.fill('', { timeout: 3000 });
    await locator.pressSequentially(text, { delay: randomBetween(70, 140), timeout: 20000 });
  } catch {
    // Obsluzone ponizej przez sprawdzenie wartosci.
  }
  await humanDelay(150, 300);
  const valueMatches = async () => (await locator.inputValue({ timeout: 2000 }).catch(() => null)) === text;
  if (!(await valueMatches())) {
    await locator.fill(text, { timeout: 5000, force: true });
    await humanDelay(150, 300);
    if (!(await valueMatches())) {
      const typedLength = (await locator.inputValue({ timeout: 2000 }).catch(() => '')).length;
      throw new Error(`Pole logowania zawiera ${typedLength} z ${text.length} znakow mimo ponownego wypelnienia.`);
    }
  }
}

module.exports = { humanClick, humanFill, humanDelay };
