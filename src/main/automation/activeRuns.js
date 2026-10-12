/**
 * Rejestr trwajacych pobran (klucz "platformId:accountId") - przycisk awaryjny "Przerwij to
 * konto" (klient, 2026-10-12: Uber potrafi "stanac" na kilka minut). Samo zamkniecie
 * kontekstu przegladarki nie wystarcza do szybkiego zakonczenia: czesc petli oczekiwania w
 * platformach lapie wszystkie bledy (isVisible().catch(() => false)) i krecilaby sie do
 * swojego limitu czasu. Dlatego wynik zadania scigamy z obietnica przerwania, ktora
 * odrzuca sie natychmiast, a porzucone zadanie dobiega konca w tle na zamknietej stronie.
 */
class AbortedByUserError extends Error {
  constructor() {
    super('Przerwano recznie.');
    this.name = 'AbortedByUserError';
  }
}

const activeRuns = new Map();

async function runAbortable(key, context, task) {
  let rejectAborted;
  const aborted = new Promise((_, reject) => {
    rejectAborted = reject;
  });
  const run = { context, abort: () => rejectAborted(new AbortedByUserError()) };
  activeRuns.set(key, run);

  const taskPromise = Promise.resolve().then(task);
  // Porzucone po przerwaniu zadanie konczy sie bledem "Target closed" - bez tego
  // lapania trafialoby do unhandledRejection.
  taskPromise.catch(() => {});
  try {
    return await Promise.race([taskPromise, aborted]);
  } finally {
    if (activeRuns.get(key) === run) activeRuns.delete(key);
  }
}

async function abortRun(key) {
  const run = activeRuns.get(key);
  if (!run) return false;
  run.abort();
  await run.context.close().catch(() => {});
  return true;
}

module.exports = { runAbortable, abortRun, AbortedByUserError };
