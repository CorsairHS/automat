const { test, expect } = require('playwright/test');
const { runAbortable, abortRun, AbortedByUserError } = require('../src/main/automation/activeRuns');

function fakeContext() {
  return { closed: false, async close() { this.closed = true; } };
}

test('abortRun przerywa wiszace zadanie i zamyka kontekst', async () => {
  const context = fakeContext();
  const running = runAbortable('uber:a', context, () => new Promise(() => {}));
  expect(await abortRun('uber:a')).toBe(true);
  await expect(running).rejects.toBeInstanceOf(AbortedByUserError);
  expect(context.closed).toBe(true);
});

test('zadanie zakonczone normalnie zwraca wynik i wypisuje sie z rejestru', async () => {
  const result = await runAbortable('bolt:b', fakeContext(), async () => 'plik.csv');
  expect(result).toBe('plik.csv');
  expect(await abortRun('bolt:b')).toBe(false);
});

test('blad zadania przechodzi bez zmian', async () => {
  await expect(runAbortable('bolt:c', fakeContext(), async () => { throw new Error('logowanie'); })).rejects.toThrow('logowanie');
});

test('abortRun dla nieznanego klucza zwraca false', async () => {
  expect(await abortRun('nie:ma')).toBe(false);
});
