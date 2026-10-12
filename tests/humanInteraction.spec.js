const { test, expect, chromium } = require('playwright/test');
const { humanFill } = require('../src/main/automation/humanInteraction');

test.describe('humanFill', () => {
  let browser;
  test.beforeEach(async () => { browser = await chromium.launch(); });
  test.afterEach(async () => { await browser.close(); });

  test('strona kradnie fokus w trakcie wpisywania - pole i tak ma pelny tekst', async () => {
    const page = await browser.newPage();
    // Po 5. znaku strona przenosi fokus na inne pole (jak podpowiedz autouzupelniania /
    // przerenderowanie formularza u klienta, 2026-10-12).
    await page.setContent(`
      <input id="email"><input id="other">
      <script>
        document.getElementById('email').addEventListener('input', (e) => {
          if (e.target.value.length === 5) document.getElementById('other').focus();
        });
      </script>`);
    await humanFill(page.locator('#email'), 'novapartner.warszawa@gmail.com');
    expect(await page.locator('#email').inputValue()).toBe('novapartner.warszawa@gmail.com');
  });

  test('pole, ktore nie przyjmuje tekstu, konczy sie bledem bez ujawniania wartosci', async () => {
    const page = await browser.newPage();
    // Pole aktywnie ucina wartosc do 3 znakow (maxlength nie dziala na locator.fill).
    await page.setContent(`
      <input id="pw">
      <script>
        document.getElementById('pw').addEventListener('input', (e) => {
          if (e.target.value.length > 3) e.target.value = e.target.value.slice(0, 3);
        });
      </script>`);
    const error = await humanFill(page.locator('#pw'), 'tajnehaslo').catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/3 z 10 znakow/);
    expect(error.message).not.toContain('tajnehaslo');
  });
});
