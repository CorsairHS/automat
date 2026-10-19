const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, expect } = require('playwright/test');
const { recoverDownloads, readUploadedPathsFromLogs } = require('../src/main/downloadsRecovery');
const { getDownloadDir } = require('../src/main/automation/downloadFiles');
const { computePeriodRange } = require('../src/main/automation/dateRange');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'automat-recovery-'));
}

const account = { accountId: 'acc1', label: 'Unity Drive Wroclaw', city: 'Wroclaw', company: 'Unity Drive', periodMode: 'previous_week' };

function freenowName({ from, to }) {
  return `Wroclaw - Unity Drive - FreeNow - earnings_${from}_${to}_with_VAT.csv`;
}

test.describe('downloadsRecovery: odtworzenie listy z folderu pobranych', () => {
  test('bierze plik z prefiksem za oczekiwany okres, pomija stary tydzien i pliki bez prefiksu', () => {
    const ud = tmpDir();
    const dir = path.join(getDownloadDir(ud, 'freenow', account), 'sub');
    fs.mkdirSync(dir, { recursive: true });
    const current = computePeriodRange({ periodMode: 'previous_week' });
    const older = computePeriodRange({ periodMode: 'previous_week' }, new Date(Date.now() - 14 * 24 * 3600 * 1000));
    const good = path.join(dir, freenowName(current));
    fs.writeFileSync(good, 'x');
    fs.writeFileSync(path.join(dir, freenowName(older)), 'x');
    fs.writeFileSync(path.join(dir, `earnings_${current.from}_${current.to}_with_VAT.csv`), 'x');

    const result = recoverDownloads({
      userDataDir: ud,
      accounts: [{ platformId: 'freenow', platformLabel: 'FreeNow', account }],
      uploadedPaths: new Map([[good, '2026-10-19T10:00:00.000Z']]),
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ platformId: 'freenow', accountId: 'acc1', filePath: good, recovered: true, uploadedAt: '2026-10-19T10:00:00.000Z' });
  });

  test('brak folderu konta: nic nie odtwarza', () => {
    const result = recoverDownloads({ userDataDir: tmpDir(), accounts: [{ platformId: 'freenow', platformLabel: 'FreeNow', account }] });
    expect(result).toEqual([]);
  });

  test('log: wgrane tylko potwierdzone zapisem, udane usuwanie kasuje wczesniejsze', () => {
    const logs = tmpDir();
    fs.writeFileSync(path.join(logs, 'automat.1.log'), [
      '2026-10-19T09:00:00.000Z [INFO] [upload] Dodaje Data source: system=bolt, miasto=W, firma=F, plik=C:\a.csv...',
      '2026-10-19T09:00:05.000Z [INFO] [upload] Zapisano ("Save and continue editing" / "Zapisz i kontynuuj edycję").',
      '2026-10-19T09:10:00.000Z [INFO] [delete] sukces, usunieto: 1',
    ].join('\n'));
    fs.writeFileSync(path.join(logs, 'automat.log'), [
      '2026-10-19T10:00:00.000Z [INFO] [upload] Dodaje Data source: system=uber, miasto=W, firma=F, plik=C:\b.csv...',
      '2026-10-19T10:00:05.000Z [ERROR] [upload] blad: Error: odrzucono',
      '2026-10-19T10:01:00.000Z [INFO] [upload] Dodaje Data source: system=freenow, miasto=W, firma=F, plik=C:\c.csv...',
      '2026-10-19T10:01:05.000Z [INFO] [upload] Zapisano ("Save and continue editing" / "Zapisz i kontynuuj edycję").',
    ].join('\n'));

    expect(Array.from(readUploadedPathsFromLogs(logs).entries())).toEqual([['C:\c.csv', '2026-10-19T10:01:05.000Z']]);
  });
});
