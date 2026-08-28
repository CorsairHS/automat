const { buildZip } = require('./zipBuilder');

const DEFAULT_CREDENTIALS = { email: 'partner@example.com', password: 'secret123' };

function lit(value) {
  return JSON.stringify(value);
}

function buildLoginHtml({ expectedEmail, expectedPassword, dashboardUrl }) {
  return `<!doctype html>
<html>
<body>
  <input id="username" />
  <input id="password" type="password" />
  <button data-testid="login-button">Zaloguj</button>
  <script>
    document.querySelector('[data-testid="login-button"]').addEventListener('click', () => {
      const email = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      if (email === ${lit(expectedEmail)} && password === ${lit(expectedPassword)}) {
        window.location.href = ${lit(dashboardUrl)};
      }
    });
  </script>
</body>
</html>`;
}

function buildDashboardHtml({ earningsUrl, duplicateEarningsLink }) {
  // Odtwarza realnie naprawiony bug (2026-08-19): dashboard moze miec DRUGI link
  // z tym samym href="/earnings", ale innym tekstem ("Szczegoly zarobkow") - kod
  // musi dopasowac dokladnie po tekscie "Zarobki", nie po samym href.
  const extraLink = duplicateEarningsLink
    ? `<a href="${earningsUrl}">Szczegoly zarobkow</a>`
    : '';
  return `<!doctype html>
<html>
<body>
  <a href="${earningsUrl}">Zarobki</a>
  ${extraLink}
</body>
</html>`;
}

function buildEarningsHtml({ zipDownloadUrl }) {
  return `<!doctype html>
<html>
<body>
  <button>Zarobki bez VAT</button>
  <button id="with-vat-toggle">Zarobki z VAT</button>
  <input data-testid="start-date-input" />
  <input data-testid="end-date-input" />
  <button data-testid="download-csv-file">Pobierz CSV</button>
  <script>
    document.querySelector('[data-testid="download-csv-file"]').addEventListener('click', async () => {
      const res = await fetch(${lit(zipDownloadUrl)});
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'earnings_export.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  </script>
</body>
</html>`;
}

/**
 * Instaluje przechwytywanie ruchu do portal.free-now.com. Architektura jak w
 * Bolcie (wielostronicowa nawigacja: /login -> /dashboard -> /earnings, kazda
 * to osobny URL przechwytywany przez ten sam route handler), bo freenow.js -
 * podobnie jak bolt.js - sprawdza zalogowanie po URL (`!/login|signin/.test`),
 * nie po elemencie DOM jak Uber. Pobierany plik to PRAWDZIWY ZIP (budowany
 * przez `zipBuilder.js`) - freenow.js realnie go rozpakowuje przez
 * `extract-zip`, wiec atrapa pod nazwa ".zip" by nie zadzialala.
 */
async function installFreenowMock(context, scenario = {}) {
  const {
    credentials = DEFAULT_CREDENTIALS,
    startLoggedIn = false,
    duplicateEarningsLink = false,
    includeWithVatFile = true,
    csvWithVatContent = 'with_vat,column\n1,2\n',
    csvWithoutVatContent = 'without_vat,column\n3,4\n',
  } = scenario;

  const loginPath = '/login';
  const dashboardPath = '/dashboard';
  const earningsPath = '/earnings';
  const zipPath = '/api/mock/earnings-export.zip';
  const origin = 'https://portal.free-now.com';

  await context.route('**/*', (route) => route.abort('blockedbyclient'));

  await context.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname === loginPath) {
      if (startLoggedIn) {
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: `<script>window.location.replace(${lit(origin + dashboardPath)})</script>`,
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: buildLoginHtml({
          expectedEmail: credentials.email,
          expectedPassword: credentials.password,
          dashboardUrl: origin + dashboardPath,
        }),
      });
    }

    if (url.pathname === dashboardPath) {
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: buildDashboardHtml({
          earningsUrl: origin + earningsPath,
          duplicateEarningsLink,
        }),
      });
    }

    if (url.pathname === earningsPath) {
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: buildEarningsHtml({ zipDownloadUrl: origin + zipPath }),
      });
    }

    if (url.pathname === zipPath) {
      const entries = [{ name: 'earnings_without_VAT.csv', content: csvWithoutVatContent }];
      if (includeWithVatFile) {
        entries.push({ name: 'earnings_with_VAT.csv', content: csvWithVatContent });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/zip',
        body: buildZip(entries),
      });
    }

    return route.fulfill({ status: 404, body: 'not found' });
  });
}

module.exports = { installFreenowMock };
