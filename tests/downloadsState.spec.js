const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, expect } = require('playwright/test');
const { saveDownloadsState, loadDownloadsState, STATE_FILE_NAME } = require('../src/main/downloadsState');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'automat-state-'));
}

test.describe('downloadsState: lista pobran przetrwa restart', () => {
  test('zapis i odczyt zachowuje wpisy z uploadedAt, rozdzielnie default/gwarant', () => {
    const dir = tmpDir();
    const fileA = path.join(dir, 'a.csv');
    const fileB = path.join(dir, 'b.csv');
    fs.writeFileSync(fileA, 'x');
    fs.writeFileSync(fileB, 'y');
    const a = { platformId: 'bolt', accountId: 'acc1', filePath: fileA, downloadedAt: '2026-10-19T10:00:00Z', uploadedAt: '2026-10-19T11:00:00Z' };
    const b = { platformId: 'uber', accountId: 'acc2', filePath: fileB, downloadedAt: '2026-10-19T10:05:00Z' };

    saveDownloadsState(dir, { defaultMap: new Map([['bolt:acc1', a]]), gwarantMap: new Map([['uber:acc2', b]]) });
    const { defaultMap, gwarantMap } = loadDownloadsState(dir);

    expect(Array.from(defaultMap.entries())).toEqual([['bolt:acc1', a]]);
    expect(Array.from(gwarantMap.entries())).toEqual([['uber:acc2', b]]);
  });

  test('pomija wpisy, ktorych plik zniknal z dysku', () => {
    const dir = tmpDir();
    const missing = { platformId: 'bolt', accountId: 'acc1', filePath: path.join(dir, 'brak.csv'), downloadedAt: 'x' };
    saveDownloadsState(dir, { defaultMap: new Map([['bolt:acc1', missing]]), gwarantMap: new Map() });
    expect(loadDownloadsState(dir).defaultMap.size).toBe(0);
  });

  test('brak lub uszkodzony plik stanu: puste mapy zamiast bledu', () => {
    const dir = tmpDir();
    expect(loadDownloadsState(dir).defaultMap.size).toBe(0);
    fs.writeFileSync(path.join(dir, STATE_FILE_NAME), '{zepsuty');
    const { defaultMap, gwarantMap } = loadDownloadsState(dir);
    expect(defaultMap.size).toBe(0);
    expect(gwarantMap.size).toBe(0);
  });
});
