const DEFAULT_CREDENTIALS = { email: 'partner@example.com', password: 'secret123' };

/**
 * Menu boczne prawdziwego panelu Bolt Food Fleet (zweryfikowane na zrzucie ekranu z
 * dzialajacej sesji, 2026-10-07). UWAGA: pozycja menu nazywa sie "Raporty", a
 * "Raportowanie" to dopiero naglowek (h1) strony raportow - to NIE jest ten sam tekst
 * i nie wolno ich mylic w selektorach wykrywajacych zalogowanie.
 */
const SIDEBAR_ITEMS = [
  'Wyniki kurierow',
  'Mapa na zywo',
  'Kandydaci',
  'Lista kurierow',
  'Przychody',
  'Raporty',
  'Ustawienia konta',
];

function buildSidebar(reportsPath) {
  return SIDEBAR_ITEMS.map((label) => {
    const href = label === 'Raporty' ? reportsPath : '#';
    return `<a href="${href}">${label}</a>`;
  }).join('\n      ');
}

function buildLoginHtml({ expectedEmail, expectedPassword, redirectUrl }) {
  return `<!doctype html>
<html>
<body>
  <form>
    <input name="username" />
    <input name="password" type="password" />
    <button type="submit">Zaloguj sie</button>
  </form>
  <script>
    document.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const user = document.querySelector('input[name="username"]').value;
      const pass = document.querySelector('input[name="password"]').value;
      if (user === ${JSON.stringify(expectedEmail)} && pass === ${JSON.stringify(expectedPassword)}) {
        window.location.href = ${JSON.stringify(redirectUrl)};
      }
    });
  </script>
</body>
</html>`;
}

function buildDashboardHtml({ reportsPath }) {
  return `<!doctype html>
<html>
<body>
  <nav>
      ${buildSidebar(reportsPath)}
  </nav>
  <h1>Wyniki kurierow</h1>
</body>
</html>`;
}

function buildReportsHtml({ reportsPath, csvFileName, reportTypes, showOnboardingModal }) {
  const rows = reportTypes
    .map(
      (type, index) => `<tr>
        <td>5.10.2026</td><td>REPORT${index}</td><td>2026 W40</td><td>${type}</td>
        <td><button aria-label="Pobierz" data-type="${type}"></button></td>
      </tr>`,
    )
    .join('\n      ');

  return `<!doctype html>
<html>
<body>
  <nav>
      ${buildSidebar(reportsPath)}
  </nav>
  <h1>Raportowanie</h1>
  ${showOnboardingModal ? '<div id="modal"><p>Witaj w panelu zarobkow!</p><button>Zamknij</button></div>' : ''}
  <table><tbody>
      ${rows}
  </tbody></table>
  <script>
    const modal = document.getElementById('modal');
    if (modal) {
      modal.querySelector('button').addEventListener('click', () => modal.remove());
    }
    document.querySelectorAll('button[aria-label="Pobierz"]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (modal && document.body.contains(modal)) return;
        const res = await fetch('/api/report?type=' + encodeURIComponent(button.dataset.type));
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = ${JSON.stringify(csvFileName)};
        document.body.appendChild(a);
        a.click();
        a.remove();
      });
    });
  </script>
</body>
</html>`;
}

/**
 * Serwuje falszywy panel Bolt Food Fleet (dcfo.bolt.eu + ekran logowania iam.bolt.eu),
 * zeby uruchomic prawdziwy, niezmieniony syncBoltFoodAccount() bez kontaktu z Boltem.
 * Odtwarza dwie wlasciwosci prawdziwego systemu wazne dla logowania: przekierowanie na
 * logowanie robi dopiero JS (nie HTTP), a OAuth po zalogowaniu wraca na dashboard, nie
 * na deep-link z raportami.
 */
async function installBoltFoodMock(context, scenario = {}) {
  const {
    orgId = '26424',
    credentials = DEFAULT_CREDENTIALS,
    startLoggedIn = false,
    csvFileName = 'fleet-courier-earnings.csv',
    csvContent = 'data,column\n1,2\n',
    showOnboardingModal = false,
    reportTypes = [
      'Courier orders',
      'Fleet Courier Earnings and Balances',
      'Courier activity periods',
    ],
  } = scenario;

  const reportsPath = `/fleet/${orgId}/reports`;
  const dashboardPath = `/fleet/${orgId}/performance`;
  const dashboardUrl = `https://dcfo.bolt.eu${dashboardPath}`;
  const loginUrl = 'https://iam.bolt.eu/login';

  let loggedIn = startLoggedIn;
  let loginPageViews = 0;
  const downloadedTypes = [];

  await context.route('**/*', (route) => route.abort('blockedbyclient'));

  await context.route('https://iam.bolt.eu/**', async (route) => {
    loginPageViews += 1;
    loggedIn = false; // sesja powstaje dopiero po poprawnym submicie formularza (JS ponizej)
    return route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: buildLoginHtml({
        expectedEmail: credentials.email,
        expectedPassword: credentials.password,
        redirectUrl: `${dashboardUrl}?auth=ok`,
      }),
    });
  });

  await context.route('https://dcfo.bolt.eu/**', async (route) => {
    const url = new URL(route.request().url());

    if (url.searchParams.get('auth') === 'ok') loggedIn = true;

    if (url.pathname === '/api/report') {
      downloadedTypes.push(url.searchParams.get('type'));
      return route.fulfill({ status: 200, contentType: 'text/csv', body: csvContent });
    }

    if (!loggedIn) {
      // Jak prawdziwy panel: najpierw renderuje sie strona docelowa, a dopiero jej JS
      // przekierowuje na ekran logowania OAuth.
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<html><body><p>Ladowanie...</p><script>setTimeout(() => window.location.href = ${JSON.stringify(loginUrl)}, 300)</script></body></html>`,
      });
    }

    if (url.pathname === reportsPath) {
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: buildReportsHtml({ reportsPath, csvFileName, reportTypes, showOnboardingModal }),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: buildDashboardHtml({ reportsPath }),
    });
  });

  return {
    orgId,
    getLoginPageViews: () => loginPageViews,
    getDownloadedTypes: () => downloadedTypes,
  };
}

module.exports = { installBoltFoodMock, DEFAULT_CREDENTIALS };
