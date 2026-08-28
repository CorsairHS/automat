const DEFAULT_CREDENTIALS = { email: 'partner@example.com', password: 'secret123' };

function lit(value) {
  return JSON.stringify(value);
}

/**
 * Uber Supplier Portal jest SPA bez zmiany URL - caly stan (niezalogowany /
 * zalogowany / dialog generowania / tabela raportow) renderuje sie jako JEDEN
 * dokument HTML, ktorego zawartosc zalezy od stanu trzymanego SERWEROWO (w
 * zamykajacym `installUberMock`), bo `page.reload()` (uzywane przez uber.js w
 * dwoch petlach retry) czysci caly stan po stronie klienta. Klient (JS w
 * zwroconym dokumencie) obsluguje interakcje UI-only (przelaczanie krokow
 * logowania, otwieranie dialogu, kalendarz, checkbox) bez zadnego requestu;
 * przejscia ktore MUSZA przetrwac reload (zalogowanie, wygenerowanie raportu,
 * gotowosc pobrania) ida przez `fetch()` do endpointow ponizej.
 */
function buildAppHtml(state, options) {
  const {
    expectedEmail,
    expectedPassword,
    reportNamePrefix,
    fromSlash,
    toSlash,
    popupAfterDateSelection,
  } = options;

  const existingRows = state.reportReady
    ? [{ name: `${reportNamePrefix}-UNITY_DRIVE_sp_z_o_o`, ready: true }]
    : [];
  if (state.reportGenerating) {
    existingRows.push({
      name: `${reportNamePrefix}-UNITY_DRIVE_sp_z_o_o`,
      ready: state.pageLoadCount > state.generatedAtLoadCount,
    });
  }

  const rowsHtml = existingRows
    .map(
      (row) => `<tr role="row">
        <td>${row.name}</td>
        <td>${row.ready ? 'Ready' : 'W toku'}</td>
        <td><button data-report-row="${row.name}" data-ready="${row.ready}">${row.ready ? 'Download' : 'Download'}</button></td>
      </tr>`
    )
    .join('\n');

  return `<!doctype html>
<html>
<body>
  <div id="login-step1" style="${state.loggedIn ? 'display:none' : ''}">
    <input id="PHONE_NUMBER_or_EMAIL_ADDRESS" />
    <button id="forward-button">Dalej</button>
  </div>
  <div id="login-step2" style="display:none">
    <form id="login-step2-form">
      <input id="PASSWORD" type="password" />
      <button type="submit">Dalej</button>
    </form>
  </div>

  <div id="app-shell" style="${state.loggedIn ? '' : 'display:none'}">
    <a data-testid="header-nav-/reports" href="#reports">Reports</a>

    <div id="reports-page" style="display:none">
      <table>
        <thead><tr role="row"><th>Name</th><th>Status</th><th>Action</th></tr></thead>
        <tbody id="reports-tbody">${rowsHtml}</tbody>
      </table>
      <button data-tracking-name="report-generation-initiated">Wygeneruj raport</button>
    </div>

    <div id="generate-dialog" style="display:none">
      <h2>Wygeneruj raport</h2>

      <div id="report-type">Driver Activity</div>
      <div id="report-type-options" style="display:none">
        <div role="option">Driver Activity</div>
        <div role="option">Payments Driver</div>
      </div>

      <input id="time-frame-trigger" placeholder="Select time frame for report" readonly />
      <div id="time-frame-panel" style="display:none">
        <div role="tab" id="tab-settlement" aria-selected="true">Settlement window</div>
        <div role="tab" id="tab-custom" aria-selected="false">Custom range</div>

        <div id="custom-range-fields" style="display:none">
          <input aria-label="Select a date range." id="date-input-0" readonly value="${fromSlash}" />
          <input aria-label="Select a date range." id="date-input-1" readonly value="" />
          <div id="calendar" style="display:none">
            ${Array.from({ length: 31 }, (_, i) => i + 1)
              .map((d) => `<div role="gridcell">${d}</div>`)
              .join('')}
          </div>
        </div>
      </div>

      <span aria-haspopup="true" aria-controls="org-popover" id="org-trigger-wrap">
        <input placeholder="Select organizations to include in report" readonly id="org-input" />
      </span>
      <div id="org-popover" style="display:none">
        <label data-baseweb="checkbox">
          <input type="checkbox" id="org-checkbox-0" />
          Unity Drive sp. z o.o.
        </label>
      </div>

      <button id="generate-submit-button">Generate</button>
    </div>

    <div id="first-impression-overlay" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; z-index:9999;">
      <button data-testid="first-impression-dismiss">Zamknij</button>
    </div>
  </div>

  <script>
    (function () {
      var state = { step: ${state.loggedIn ? "'loggedIn'" : "'step1'"}, dateSelections: 0 };

      document.getElementById('forward-button').addEventListener('click', function () {
        document.getElementById('login-step1').style.display = 'none';
        document.getElementById('login-step2').style.display = '';
      });

      document.getElementById('login-step2-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var email = document.getElementById('PHONE_NUMBER_or_EMAIL_ADDRESS').value;
        var password = document.getElementById('PASSWORD').value;
        if (email !== ${lit(expectedEmail)} || password !== ${lit(expectedPassword)}) return;
        fetch('/api/mock/login', { method: 'POST' }).then(function () {
          document.getElementById('login-step1').style.display = 'none';
          document.getElementById('login-step2').style.display = 'none';
          document.getElementById('app-shell').style.display = '';
        });
      });

      document.querySelector('[data-testid="header-nav-/reports"]').addEventListener('click', function (e) {
        e.preventDefault();
        document.getElementById('reports-page').style.display = '';
      });

      document.querySelector('[data-tracking-name="report-generation-initiated"]').addEventListener('click', function () {
        document.getElementById('generate-dialog').style.display = '';
      });

      document.getElementById('report-type').addEventListener('click', function () {
        document.getElementById('report-type-options').style.display = '';
      });
      Array.prototype.forEach.call(document.querySelectorAll('#report-type-options [role="option"]'), function (opt) {
        opt.addEventListener('click', function () {
          document.getElementById('report-type').textContent = opt.textContent;
          document.getElementById('report-type-options').style.display = 'none';
        });
      });

      document.getElementById('time-frame-trigger').addEventListener('click', function () {
        var panel = document.getElementById('time-frame-panel');
        panel.style.display = panel.style.display === 'none' ? '' : 'none';
      });
      document.getElementById('tab-custom').addEventListener('click', function () {
        document.getElementById('tab-custom').setAttribute('aria-selected', 'true');
        document.getElementById('tab-settlement').setAttribute('aria-selected', 'false');
        document.getElementById('custom-range-fields').style.display = '';
      });

      document.getElementById('date-input-0').addEventListener('click', function () {
        document.getElementById('calendar').style.display = '';
      });

      document.getElementById('calendar').addEventListener('click', function (e) {
        if (e.target.getAttribute('role') !== 'gridcell') return;
        state.dateSelections += 1;
        var day = e.target.textContent;
        if (state.dateSelections === 1) {
          document.getElementById('date-input-0').value = ${lit(fromSlash.slice(0, 8))} + day.padStart(2, '0');
        } else if (state.dateSelections === 2) {
          document.getElementById('date-input-1').value = ${lit(toSlash.slice(0, 8))} + day.padStart(2, '0');
          document.getElementById('calendar').style.display = 'none';
          ${popupAfterDateSelection ? "document.getElementById('first-impression-overlay').style.display = 'block';" : ''}
        }
      });

      document.querySelector('[data-testid="first-impression-dismiss"]').addEventListener('click', function () {
        document.getElementById('first-impression-overlay').style.display = 'none';
        fetch('/api/mock/popup-dismissed', { method: 'POST' });
      });

      document.getElementById('org-trigger-wrap').addEventListener('click', function () {
        document.getElementById('org-popover').style.display = '';
      });

      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (document.getElementById('org-popover').style.display !== 'none') {
          document.getElementById('org-popover').style.display = 'none';
          return;
        }
        document.getElementById('generate-dialog').style.display = 'none';
      });

      document.getElementById('generate-submit-button').addEventListener('click', function () {
        fetch('/api/mock/generate-report', { method: 'POST' }).then(function () {
          document.getElementById('generate-dialog').style.display = 'none';
          var tbody = document.getElementById('reports-tbody');
          var tr = document.createElement('tr');
          tr.setAttribute('role', 'row');
          tr.innerHTML = '<td>${reportNamePrefix}-UNITY_DRIVE_sp_z_o_o</td><td>W toku</td>' +
            '<td><button data-report-row="${reportNamePrefix}-UNITY_DRIVE_sp_z_o_o">Download</button></td>';
          tbody.appendChild(tr);
          attachDownloadHandler(tr.querySelector('button'));
        });
      });

      function attachDownloadHandler(btn) {
        btn.addEventListener('click', function () {
          fetch('/api/mock/csv-export').then(function (res) {
            if (res.status !== 200) return;
            return res.blob().then(function (blob) {
              var url = URL.createObjectURL(blob);
              var a = document.createElement('a');
              a.href = url;
              a.download = 'payments_driver.csv';
              document.body.appendChild(a);
              a.click();
              a.remove();
            });
          });
        });
      }
      Array.prototype.forEach.call(document.querySelectorAll('[data-report-row]'), attachDownloadHandler);
    })();
  </script>
</body>
</html>`;
}

/**
 * Instaluje przechwytywanie ruchu do supplier.uber.com. Uber renderuje caly
 * panel jako jeden dokument SPA (bez zmiany URL), wiec w odroznieniu od
 * bolt.js/boltFleetMock.js nie ma tu wielu "stron" - jest jeden route handler
 * dla dokumentu plus dwa API-podobne endpointy (`/api/mock/login`,
 * `/api/mock/generate-report`) do przejsc, ktore musza przetrwac
 * `page.reload()`, oraz `/api/mock/csv-export` do pobrania pliku.
 */
async function installUberMock(context, scenario = {}) {
  const {
    credentials = DEFAULT_CREDENTIALS,
    reportAlreadyExists = false,
    requireReloadForDownloadReady = false,
    popupAfterDateSelection = false,
    csvContent = 'data,column\n1,2\n',
  } = scenario;

  const state = {
    loggedIn: false,
    reportReady: reportAlreadyExists,
    reportGenerating: false,
    pageLoadCount: 0,
    generatedAtLoadCount: -1,
    popupDismissedCount: 0,
  };

  const options = {
    expectedEmail: credentials.email,
    expectedPassword: credentials.password,
    reportNamePrefix: scenario.reportNamePrefix || '20260805-20260807-payments_driver',
    fromSlash: scenario.fromSlash || '2026/08/05',
    toSlash: scenario.toSlash || '2026/08/07',
    popupAfterDateSelection,
  };

  await context.route('**/*', (route) => route.abort('blockedbyclient'));

  await context.route('https://supplier.uber.com/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (url.pathname === '/api/mock/login' && method === 'POST') {
      state.loggedIn = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }

    if (url.pathname === '/api/mock/generate-report' && method === 'POST') {
      state.reportGenerating = true;
      state.generatedAtLoadCount = requireReloadForDownloadReady ? state.pageLoadCount : -1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }

    if (url.pathname === '/api/mock/popup-dismissed' && method === 'POST') {
      state.popupDismissedCount += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }

    if (url.pathname === '/api/mock/csv-export') {
      const ready =
        state.reportReady ||
        (state.reportGenerating && state.pageLoadCount > state.generatedAtLoadCount);
      if (!ready) {
        return route.fulfill({ status: 204 });
      }
      return route.fulfill({ status: 200, contentType: 'text/csv', body: csvContent });
    }

    // Dokument glowny (kazde zaladowanie/reload). Inne typy requestow
    // (np. favicon) nie powinny liczyc sie jako zaladowanie strony.
    if (route.request().resourceType() !== 'document') {
      return route.fulfill({ status: 404, body: 'not found' });
    }
    state.pageLoadCount += 1;
    return route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: buildAppHtml(state, options),
    });
  });

  return { state };
}

module.exports = { installUberMock };
