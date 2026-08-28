const DEFAULT_CREDENTIALS = { email: 'partner@example.com', password: 'secret123' };

function toScriptLiteral(value) {
  return JSON.stringify(value);
}

function buildLoginHtml({ expectedEmail, expectedPassword, reportUrl }) {
  return `<!doctype html>
<html>
<body>
  <input id="email" />
  <input id="current-password" type="password" />
  <button>Zaloguj się</button>
  <script>
    document.querySelector('button').addEventListener('click', () => {
      const email = document.getElementById('email').value;
      const password = document.getElementById('current-password').value;
      if (email === ${toScriptLiteral(expectedEmail)} && password === ${toScriptLiteral(expectedPassword)}) {
        window.location.href = ${toScriptLiteral(reportUrl)};
      }
    });
  </script>
</body>
</html>`;
}

function buildReportHtml({ csvFileName, loginUrl }) {
  const dayCells = Array.from({ length: 31 }, (_, i) => i + 1)
    .map((day) => `<div class="react-datepicker__day">${day}</div>`)
    .join('');

  return `<!doctype html>
<html>
<body>
  <input placeholder="d MMM - d MMM" readonly />
  <div id="calendar" style="display:none">${dayCells}</div>
  <button>Pobierz</button>
  <div id="download-menu" style="display:none">
    <div id="csv-menu-item">Eksport CSV danych finansowych kierowcy</div>
  </div>
  <script>
    let selectedCount = 0;
    document.querySelector('input').addEventListener('click', () => {
      document.getElementById('calendar').style.display = 'block';
    });
    document.getElementById('calendar').addEventListener('click', (e) => {
      if (!e.target.classList.contains('react-datepicker__day')) return;
      selectedCount += 1;
      if (selectedCount >= 2) document.getElementById('calendar').style.display = 'none';
    });
    document.querySelector('button').addEventListener('click', () => {
      document.getElementById('download-menu').style.display = 'block';
    });
    document.getElementById('csv-menu-item').addEventListener('click', async () => {
      const res = await fetch('/api/csv-export');
      if (res.status === 200) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = ${toScriptLiteral(csvFileName)};
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        window.location.href = ${toScriptLiteral(loginUrl)};
      }
    });
  </script>
</body>
</html>`;
}

/**
 * Instaluje przechwytywanie ruchu do fleets.bolt.eu na danym Playwrightowym
 * BrowserContext, serwując w locie fałszywy panel Bolt. Pozwala uruchomić
 * prawdziwy, niezmieniony syncBoltAccount() bez kontaktu z prawdziwym Boltem.
 */
async function installBoltMock(context, scenario = {}) {
  const {
    orgId = 'test-org',
    credentials = DEFAULT_CREDENTIALS,
    startLoggedIn = false,
    networkDelayMs = 0,
    expireAfterDateSelected = false,
    csvFileName = 'zarobki-test-org.csv',
    csvContent = 'data,column\n1,2\n',
  } = scenario;

  const loginPath = '/login';
  const reportPath = `/${orgId}/finances/reports/driverEarnings`;
  const reportUrl = `https://fleets.bolt.eu${reportPath}`;
  const loginUrl = `https://fleets.bolt.eu${loginPath}`;

  let loginPageServedCount = 0;

  await context.route('https://fleets.bolt.eu/**', async (route) => {
    if (networkDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, networkDelayMs));
    }

    const url = new URL(route.request().url());

    if (url.pathname === loginPath) {
      if (startLoggedIn) {
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: `<script>window.location.replace(${JSON.stringify(reportUrl)})</script>`,
        });
      }
      loginPageServedCount += 1;
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: buildLoginHtml({
          expectedEmail: credentials.email,
          expectedPassword: credentials.password,
          reportUrl,
        }),
      });
    }

    if (url.pathname === reportPath) {
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: buildReportHtml({ csvFileName, loginUrl }),
      });
    }

    if (url.pathname === '/api/csv-export') {
      if (expireAfterDateSelected) {
        return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
      }
      return route.fulfill({ status: 200, contentType: 'text/csv', body: csvContent });
    }

    return route.fulfill({ status: 404, body: 'not found' });
  });

  return {
    reportUrl,
    loginUrl,
    getLoginPageServedCount: () => loginPageServedCount,
  };
}

module.exports = { installBoltMock };
