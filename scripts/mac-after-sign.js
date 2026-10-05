/**
 * Hook electron-buildera "afterSign" - podpisuje aplikacje na Maca WLASNYM certyfikatem
 * (scripts/setup-mac-signing.sh) PRZED spakowaniem do DMG i ZIP. ZIP jest plikiem
 * auto-aktualizacji (latest-mac.yml), wiec podpis musi byc w nim, a nie tylko w
 * dist/mac-arm64/*.app - dotychczasowy postbuild (codesign --sign - po zbudowaniu)
 * podpisywal tylko folder dist, a do tego ad-hoc, przez co auto-aktualizacja na Macu
 * zawsze konczyla sie bledem "Code signature ... did not pass validation".
 *
 * Bez certyfikatu build sie NIE udaje (zamiast cicho wypuscic wersje, ktora zepsuje
 * aktualizacje u klientow) - uruchom raz scripts/setup-mac-signing.sh.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

const IDENTITY = 'PartnerTax Automat Signing';
const KEYCHAIN = path.join(os.homedir(), 'Library/Keychains/partnertax-signing.keychain-db');
const PASSWORD_FILE = path.join(os.homedir(), '.partnertax-signing/keychain-password');

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;

  if (!fs.existsSync(KEYCHAIN) || !fs.existsSync(PASSWORD_FILE)) {
    throw new Error(
      `Brak certyfikatu "${IDENTITY}" (${KEYCHAIN}). Uruchom raz: ./scripts/setup-mac-signing.sh ` +
        '(albo przywroc ~/.partnertax-signing z kopii zapasowej - NOWY certyfikat zepsuje auto-aktualizacje u klientow).',
    );
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const password = fs.readFileSync(PASSWORD_FILE, 'utf8').trim();

  execFileSync('security', ['unlock-keychain', '-p', password, KEYCHAIN]);
  execFileSync('xattr', ['-cr', appPath]);
  execFileSync('codesign', ['--force', '--deep', '--sign', IDENTITY, '--keychain', KEYCHAIN, appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });

  const display = spawnSync('codesign', ['-d', '-r-', appPath], { encoding: 'utf8' });
  const requirement = `${display.stdout}${display.stderr}`;
  console.log(`  • podpisano certyfikatem "${IDENTITY}": ${appPath}`);
  if (!/certificate root/.test(requirement)) {
    throw new Error(`Podpis nie opiera sie na certyfikacie (auto-aktualizacja nie zadziala): ${requirement}`);
  }
};
