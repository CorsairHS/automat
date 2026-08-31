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
  return `<!doctype html>
<html>
<body>
  <input placeholder="d MMM - d MMM" readonly />
  <div id="calendar" style="display:none">
    <button class="react-datepicker__navigation--previous">Poprzedni</button>
    <button class="react-datepicker__navigation--next">Nastepny</button>
    <div id="days"></div>
  </div>
  <button id="pobierz-button">Pobierz</button>
  <div id="download-menu" style="display:none">
    <div id="csv-menu-item">Eksport CSV danych finansowych kierowcy</div>
  </div>
  <script>
    const today = new Date();
    let displayedYear = today.getFullYear();
    let displayedMonth = today.getMonth();

    function daysInMonth(year, month) {
      return new Date(year, month + 1, 0).getDate();
    }

    function renderDays() {
      const container = document.getElementById('days');
      container.innerHTML = '';
      const count = daysInMonth(displayedYear, displayedMonth);
      for (let d = 1; d <= count; d += 1) {
        const cell = document.createElement('div');
        cell.className = 'react-datepicker__day';
        cell.textContent = String(d);
        container.appendChild(cell);
      }
    }
    renderDays();

    let selectedCount = 0;
    document.querySelector('input').addEventListener('click', () => {
      document.getElementById('calendar').style.display = 'block';
    });

    async function reportNav(direction) {
      await fetch('/api/nav-click', { method: 'POST', body: direction });
    }

    document.querySelector('.react-datepicker__navigation--next').addEventListener('click', async () => {
      displayedMonth += 1;
      if (displayedMonth > 11) { displayedMonth = 0; displayedYear += 1; }
      renderDays();
      await reportNav('next');
    });
    document.querySelector('.react-datepicker__navigation--previous').addEventListener('click', async () => {
      displayedMonth -= 1;
      if (displayedMonth < 0) { displayedMonth = 11; displayedYear -= 1; }
      renderDays();
      await reportNav('previous');
    });

    document.getElementById('days').addEventListener('click', (e) => {
      if (!e.target.classList.contains('react-datepicker__day')) return;
      selectedCount += 1;
      if (selectedCount >= 2) document.getElementById('calendar').style.display = 'none';
    });
    document.getElementById('pobierz-button').addEventListener('click', () => {
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

  let loginRequestCount = 0;
  let navigationClickCount = 0;

  await context.route('**/*', (route) => route.abort('blockedbyclient'));

  await context.route('https://fleets.bolt.eu/**', async (route) => {
    if (networkDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, networkDelayMs));
    }

    const url = new URL(route.request().url());

    if (url.pathname === loginPath) {
      loginRequestCount += 1;
      if (startLoggedIn) {
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: `<script>window.location.replace(${JSON.stringify(reportUrl)})</script>`,
        });
      }
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

    if (url.pathname === '/api/nav-click') {
      navigationClickCount += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
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
    getLoginRequestCount: () => loginRequestCount,
    getNavigationClickCount: () => navigationClickCount,
  };
}

module.exports = { installBoltMock };
