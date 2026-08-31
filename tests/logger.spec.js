const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('playwright/test');

function freshLogger() {
  // logger.js trzyma sciezke pliku w module-level state (jeden logger na caly proces
  // Electron) - w testach czyscimy cache require, zeby kazdy test dostal niezalezna instancje.
  delete require.cache[require.resolve('../src/main/logger')];
  return require('../src/main/logger');
}

test.describe('logger', () => {
  let userDataRoot;

  test.beforeEach(() => {
    userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-test-'));
  });

  test.afterEach(() => {
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  });

  test('init tworzy katalog logs i plik automat.log', () => {
    const logger = freshLogger();
    logger.init(userDataRoot);
    logger.info('test');

    expect(fs.existsSync(path.join(userDataRoot, 'logs', 'automat.log'))).toBe(true);
  });

  test('info/warn/error zapisuja linie z poziomem, znacznikiem czasu ISO i tresc wiadomosci', () => {
    const logger = freshLogger();
    logger.init(userDataRoot);

    logger.info('poszlo dobrze');
    logger.warn('cos podejrzanego');
    logger.error('wywalilo sie');

    const content = fs.readFileSync(logger.getLogFilePath(), 'utf8');
    const lines = content.trim().split('\n');

    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[INFO\] poszlo dobrze$/);
    expect(lines[1]).toMatch(/\[WARN\] cos podejrzanego$/);
    expect(lines[2]).toMatch(/\[ERROR\] wywalilo sie$/);
  });

  test('write przed init() jest cichym no-opem (logger nie inicjalizowany np. w testach)', () => {
    const logger = freshLogger();
    expect(() => logger.info('cokolwiek')).not.toThrow();
    expect(logger.getLogFilePath()).toBeNull();
  });

  test('rotacja: gdy plik przekroczy limit rozmiaru, zostaje przeniesiony do automat.1.log, a nowy wpis ląduje w świeżym pliku', () => {
    const logger = freshLogger();
    logger.init(userDataRoot);
    const logFilePath = logger.getLogFilePath();

    // Podmieniamy plik na sztucznie "za duzy", zamiast pisac miliony realnych linii.
    fs.writeFileSync(logFilePath, 'x'.repeat(6 * 1024 * 1024));

    logger.info('wpis po rotacji');

    const rotatedPath = logFilePath.replace(/\.log$/, '.1.log');
    expect(fs.existsSync(rotatedPath)).toBe(true);
    expect(fs.statSync(rotatedPath).size).toBeGreaterThan(5 * 1024 * 1024);

    const freshContent = fs.readFileSync(logFilePath, 'utf8');
    expect(freshContent).toContain('wpis po rotacji');
    expect(freshContent.length).toBeLessThan(1000);
  });
});
