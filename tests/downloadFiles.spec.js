const path = require('path');
const os = require('os');
const fs = require('fs');
const { test, expect } = require('playwright/test');
const { attachManualFile, renameDownloadedFile, getDownloadDir, uploadFileName } = require('../src/main/automation/downloadFiles');

const account = {
  accountId: 'acc-1',
  label: 'Uber - Leszno',
  city: 'Leszno',
  company: 'Unity Drive',
  periodMode: 'custom',
  periodFrom: '2026-10-05',
  periodTo: '2026-10-12',
};

function makeSource(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-src-'));
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, 'a,b\n1,2\n');
  return filePath;
}

test.describe('attachManualFile', () => {
  test('poprawny plik: kopiuje do folderu konta, oryginal zostaje', () => {
    const sourcePath = makeSource('20261005-20261012-payments_driver-UNITY_DRIVE_SP_Z_O_O.csv');
    const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-dst-'));
    const result = attachManualFile({ platformId: 'uber', account, sourcePath, downloadDir });
    expect(result.ok).toBe(true);
    expect(path.dirname(result.filePath)).toBe(downloadDir);
    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(fs.existsSync(sourcePath)).toBe(true);
  });

  test('zly tydzien bez force: ostrzezenie, nic nie skopiowane', () => {
    const sourcePath = makeSource('20260928-20261005-payments_driver-UNITY_DRIVE_SP_Z_O_O.csv');
    const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-dst-'));
    const result = attachManualFile({ platformId: 'uber', account, sourcePath, downloadDir });
    expect(result).toMatchObject({ ok: false, needsConfirm: true, filePath: sourcePath });
    expect(result.warning).toMatch(/Zly tydzien/);
    expect(fs.readdirSync(downloadDir)).toEqual([]);
  });

  test('zly tydzien z force: przyjety', () => {
    const sourcePath = makeSource('20260928-20261005-payments_driver-UNITY_DRIVE_SP_Z_O_O.csv');
    const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-dst-'));
    const result = attachManualFile({ platformId: 'uber', account, sourcePath, downloadDir, force: true });
    expect(result.ok).toBe(true);
  });

  test('nieistniejacy plik: blad', () => {
    const result = attachManualFile({ platformId: 'uber', account, sourcePath: 'C:/nie/ma/takiego.csv', downloadDir: os.tmpdir() });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/nie istnieje/);
  });
});

test.describe('renameDownloadedFile', () => {
  test('dokleja prefiks miasto - firma - platforma', () => {
    const filePath = makeSource('raport.csv');
    const renamed = renameDownloadedFile(filePath, { city: 'Leszno', company: 'Unity Drive', platformLabel: 'Uber' });
    expect(path.basename(renamed)).toBe('Leszno - Unity Drive - Uber - raport.csv');
  });

  test('nie dokleja prefiksu drugi raz (plik wybrany ponownie z folderu pobran)', () => {
    const filePath = makeSource('Leszno - Unity Drive - Uber - raport.csv');
    const renamed = renameDownloadedFile(filePath, { city: 'Leszno', company: 'Unity Drive', platformLabel: 'Uber' });
    expect(renamed).toBe(filePath);
  });
});

test('getDownloadDir: folder per platforma i etykieta konta', () => {
  expect(getDownloadDir('/root', 'uber', account)).toBe(path.join('/root', 'downloads', 'uber', 'Uber_-_Leszno'));
});

test.describe('uploadFileName', () => {
  test('usuwa prefiks Miasto - Firma - Platforma (Uber, 115 -> 84 znaki)', () => {
    const name = uploadFileName(
      'C:/x/Wrocław - Unity Drive - Uber - 20261012-20261014-payments_driver-UNITY_DRIVE_SPKA_Z_OGRANICZON_ODPOWIEDZIALNOCI.csv',
      { city: 'Wrocław', company: 'Unity Drive' },
    );
    expect(name).toBe('20261012-20261014-payments_driver-UNITY_DRIVE_SPKA_Z_OGRANICZON_ODPOWIEDZIALNOCI.csv');
  });

  test('platforma ze spacja (Bolt Food)', () => {
    expect(uploadFileName('/x/Poznań - DA Investment - Bolt Food - raport.csv', { city: 'Poznań', company: 'DA Investment' }))
      .toBe('raport.csv');
  });

  test('plik bez prefiksu zostaje bez zmian', () => {
    expect(uploadFileName('/x/raport-2026W41.csv', { city: 'Wrocław', company: 'Unity Drive' })).toBe('raport-2026W41.csv');
  });

  test('za dluga nazwa przycieta do 100 znakow z rozszerzeniem', () => {
    const name = uploadFileName(`/x/${'a'.repeat(150)}.csv`, { city: 'Wrocław', company: 'Unity Drive' });
    expect(name).toHaveLength(100);
    expect(name.endsWith('.csv')).toBe(true);
  });
});
