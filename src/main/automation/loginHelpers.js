/**
 * Zaraz po otwarciu URL logowania SPA (Bolt/Uber/FreeNow) strona najpierw laduje sie
 * pod adresem /login, a dopiero JS (po sprawdzeniu ciasteczek sesji) ewentualnie
 * przekierowuje dalej - to zajmuje chwile. Sprawdzenie page.url() od razu po goto()
 * dawalo falszywy wynik "niezalogowany" nawet gdy sesja byla wazna z poprzedniego
 * uruchomienia. Ta funkcja czeka az jeden z dwoch stanow sie ustali: albo pojawi sie
 * formularz logowania, albo strona przekieruje poza /login.
 */
async function waitForAuthStateToSettle(page, { isLoggedIn, isLoginFormVisible, timeoutMs = 10000, pollIntervalMs = 200 }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isLoggedIn()) return;
    if (await isLoginFormVisible()) return;
    await page.waitForTimeout(pollIntervalMs);
  }
}

/**
 * Czeka az `isLoggedIn(page)` zwroci true. Uzywane po wyslaniu formularza logowania -
 * jesli platforma wymaga 2FA, okno przegladarki jest widoczne (headless:false) i partner
 * moze recznie wpisac kod, a automat po prostu czeka na zmiane stanu strony.
 */
async function waitForLoginCompletion(page, { isLoggedIn, statusCallback, timeoutMs = 5 * 60 * 1000, pollIntervalMs = 2000 }) {
  const start = Date.now();
  let notifiedWaiting = false;

  while (Date.now() - start < timeoutMs) {
    if (await isLoggedIn(page)) return true;

    if (!notifiedWaiting && Date.now() - start > 5000) {
      statusCallback?.('Oczekiwanie na dokonczenie logowania (mozliwe 2FA) - uzupelnij dane w otwartym oknie przegladarki...');
      notifiedWaiting = true;
    }

    await page.waitForTimeout(pollIntervalMs);
  }

  return false;
}

module.exports = { waitForAuthStateToSettle, waitForLoginCompletion };
