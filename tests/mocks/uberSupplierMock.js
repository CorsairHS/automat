const DEFAULT_CREDENTIALS = { email: 'partner@example.com', password: 'secret123' };

function lit(value) {
  return JSON.stringify(value);
}

/**
 * Testuje wykrywanie pola hasla we wszystkich ramkach strony (patrz
 * findVisibleInAnyFrame w uber.js) - symuluje ekran hasla renderowany w osadzonym
 * iframe (zaobserwowane na zywo, klient 2026-09-04: adres iframe modalu Arkose
 * wskazywal na osobna subdomene "auth.uber.com", sugerujac wspolny, osadzony iframe
 * logowania dla dalszych krokow). srcdoc iframe dziedziczy base URL rodzica, wiec
 * relatywny fetch('/api/mock/login') trafia w ten sam przechwycony route.
 */
function loginStep2IframeSrcdoc(expectedPassword) {
  const html = `<!doctype html><html><body>
    <form id="login-step2-form">
      <input id="PASSWORD" type="password" />
      <button type="submit">Dalej</button>
    </form>
    <script>
      document.getElementById('login-step2-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var password = document.getElementById('PASSWORD').value;
        if (password !== ${lit(expectedPassword)}) return;
        fetch('/api/mock/login', { method: 'POST' }).then(function () {
          window.parent.postMessage('uber-mock-logged-in', '*');
        });
      });
    </script>
  </body></html>`;
  return html.replace(/"/g, '&quot;');
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
    organizations = [{ name: 'Unity Drive sp. z o.o.' }],
    failGenerateAttempts = 0,
    prefilledTimeFrameValue = '',
    showArkoseChallenge = false,
    arkoseReturnsToStep1 = false,
    passwordInIframe = false,
    decoyHiddenPasswordInput = false,
    settlementWindowOptions = [],
    settlementSelectionClosesPanel = false,
    timeFramePanelIgnoresTriggerClose = false,
    orgTriggerWithoutAriaControls = false,
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
  ${decoyHiddenPasswordInput ? '<div id="forgot-password-panel" style="display:none"><input type="password" id="decoy-forgot-password" /></div>' : ''}
  <div id="login-step1" style="${state.loggedIn ? 'display:none' : ''}">
    <input id="PHONE_NUMBER_or_EMAIL_ADDRESS" />
    <button id="forward-button">Dalej</button>
  </div>
  <div id="login-step2" style="display:none">
    ${passwordInIframe ? `<iframe id="login-step2-iframe" srcdoc="${loginStep2IframeSrcdoc(expectedPassword)}"></iframe>` : `
    <form id="login-step2-form">
      <input id="PASSWORD" type="password" />
      <button type="submit">Dalej</button>
    </form>`}
  </div>
  <div id="arkose-challenge" role="dialog" aria-modal="true" style="display:none">
    <button id="arkose-solve-button">Rozpocznij zadanie</button>
  </div>

  <div id="app-shell" style="${state.loggedIn ? '' : 'display:none'}">
    <a data-testid="header-nav-/reports" href="#reports">Reports</a>

    <!-- Zakladki nawigacyjne samej aplikacji (poza dialogiem) - istnieja na zywym portalu
         ("Wyniki"/"Raporty"/"Oferty"/"Bankowosc") i sa widoczne CALY CZAS. Sa tu po to,
         zeby zaden kod nie mogl rozpoznawac "czy panel przedzialu czasowego jest otwarty"
         po obecnosci dowolnego role="tab" - takie sprawdzenie dawalo falszywy pozytyw i
         ponownie OTWIERALO zamkniety panel, zaslaniajac pole organizacji. -->
    <div id="app-nav">
      <div role="tab" id="nav-tab-results" aria-selected="false">Wyniki</div>
      <div role="tab" id="nav-tab-reports" aria-selected="true">Raporty</div>
    </div>

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

      <input id="time-frame-trigger" style="display:block" readonly placeholder="Wybierz przedział czasowy raportu" value="${prefilledTimeFrameValue}" />
      <div id="time-frame-panel" style="display:none; position:absolute; z-index:10; background:#fff; border:1px solid #333;">
        <div role="tab" id="tab-settlement" aria-selected="true" aria-controls="settlement-panel">Settlement window</div>
        <div role="tab" id="tab-custom" aria-selected="false" aria-controls="custom-range-fields">Custom range</div>

        <div id="settlement-panel">
          <button data-testid="payment-time-range-picker-button" aria-haspopup="true" aria-expanded="false" aria-controls="settlement-listbox"><div id="settlement-picker-label">${prefilledTimeFrameValue}</div></button>
          <ul id="settlement-listbox" style="display:none">
            ${settlementWindowOptions
              .map((label, i) => `<li role="option" id="settlement-option-${i}">${label}</li>`)
              .join('\n')}
          </ul>
        </div>

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

      ${orgTriggerWithoutAriaControls
        ? // Wariant zaobserwowany na zywym DOM (zrzut od klienta 2026-09-07): zwykla
          // struktura BaseWeb, BEZ aria-haspopup/aria-controls na wrapperze - kod nie moze
          // od nich uzaleznic calego kroku wyboru organizacji.
          `<div data-baseweb="input" id="org-trigger-wrap" style="display:block">
        <div data-baseweb="base-input">
          <input placeholder="Wybierz organizacje, które chcesz uwzględnić w&nbsp;raporcie" readonly type="text" id="org-input" value="" />
        </div>
      </div>`
        : `<span aria-haspopup="true" aria-controls="org-popover" id="org-trigger-wrap" style="display:block">
        <input placeholder="Select organizations to include in report" readonly id="org-input" />
      </span>`}
      <div id="org-popover" style="display:none">
        ${organizations
          .map(
            (org, i) => `<label data-baseweb="checkbox">
          <input type="checkbox" id="org-checkbox-${i}" />
          ${org.name}
        </label>`
          )
          .join('\n')}
      </div>

      <button id="generate-submit-button">Generate</button>
    </div>

    <div id="first-impression-overlay" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; z-index:9999;">
      <button data-testid="first-impression-dismiss">Zamknij</button>
    </div>
  </div>

  <script>
    (function () {
      var state = { step: ${state.loggedIn ? "'loggedIn'" : "'step1'"}, dateSelections: 0, dialogOpenCount: 0 };

      document.getElementById('forward-button').addEventListener('click', function () {
        fetch('/api/mock/forward-click', { method: 'POST' })
          .then(function (res) { return res.json(); })
          .then(function (data) {
            if (!data.transition) return;
            document.getElementById('login-step1').style.display = 'none';
            ${showArkoseChallenge ? "if (!window.__arkoseSolved) { document.getElementById('arkose-challenge').style.display = ''; return; }" : ''}
            document.getElementById('login-step2').style.display = '';
          });
      });

      var arkoseSolveButton = document.getElementById('arkose-solve-button');
      arkoseSolveButton.addEventListener('click', function () {
        window.__arkoseSolved = true;
        fetch('/api/mock/arkose-solved', { method: 'POST' }).then(function () {
          document.getElementById('arkose-challenge').style.display = 'none';
          ${arkoseReturnsToStep1
            ? "document.getElementById('login-step1').style.display = '';"
            : "document.getElementById('login-step2').style.display = '';"}
        });
      });

      ${passwordInIframe ? `
      window.addEventListener('message', function (e) {
        if (e.data !== 'uber-mock-logged-in') return;
        document.getElementById('login-step1').style.display = 'none';
        document.getElementById('login-step2').style.display = 'none';
        document.getElementById('app-shell').style.display = '';
      });` : `
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
      });`}

      document.querySelector('[data-testid="header-nav-/reports"]').addEventListener('click', function (e) {
        e.preventDefault();
        document.getElementById('reports-page').style.display = '';
      });

      document.querySelector('[data-tracking-name="report-generation-initiated"]').addEventListener('click', function () {
        state.dialogOpenCount += 1;
        fetch('/api/mock/dialog-open', { method: 'POST' });
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

      var timeFrameTrigger = document.getElementById('time-frame-trigger');
      // Otwarty panel jest NAKLADKA zakotwiczona pod polem-wyzwalaczem i faktycznie
      // zaslania pola ponizej (organizacje, przycisk "Wygeneruj") - dokladnie to widac w
      // logu z zywego uruchomienia (2026-09-07 07:00): klikniecie w pole organizacji bylo
      // przez ~50 s odbijane przez <div role="tabpanel" data-baseweb="tab-panel">
      // ("subtree intercepts pointer events"). Statyczny layout mocka tego nie oddawal,
      // wiec pozycjonujemy panel z JS wzgledem wyzwalacza.
      function positionTimeFramePanelAsOverlay(panel) {
        // Panel jest popoverem POZA normalnym ukladem (jak na zywym Uberze), zakotwiczonym
        // tuz pod polem-wyzwalaczem i przykrywajacym wszystko ponizej: pole organizacji i
        // przycisk "Wygeneruj". Sam wyzwalacz zostaje odslonięty - inaczej mock testowalby
        // sytuacje, ktorej na zywo nie ma (tam klikniecie w wyzwalacz dochodzi, tylko nie
        // zwija panelu).
        var trigger = timeFrameTrigger.getBoundingClientRect();
        panel.style.position = 'fixed';
        panel.style.top = (trigger.bottom + 1) + 'px';
        panel.style.left = '0px';
        panel.style.width = '100%';
        panel.style.height = '100vh';
      }
      timeFrameTrigger.addEventListener('click', function () {
        var panel = document.getElementById('time-frame-panel');
        var opening = panel.style.display === 'none';
        // Wariant zaobserwowany na zywo: klikniecie w wyzwalacz NIE zwija otwartego panelu
        // (popover BaseWeb zamyka sie na mousedown poza soba, po czym ten sam klik
        // otwiera go z powrotem) - automat nie moze wiec zakladac, ze "klikniecie
        // wyzwalacza = zamkniecie".
        if (opening) {
          panel.style.display = '';
          positionTimeFramePanelAsOverlay(panel);
        } else {
          panel.style.display = ${timeFramePanelIgnoresTriggerClose ? "''" : "'none'"};
        }
        fetch('/api/mock/time-frame-trigger-click', { method: 'POST' });
      });

      // Zagniezdzony picker okien rozliczeniowych WEWNATRZ zakladki "Okno rozliczenia" -
      // lista <li role="option"> jest ukryta, dopoki sie go nie kliknie (tak jak na zywym
      // Uberze, zrzut od klienta 2026-09-07).
      var settlementPicker = document.querySelector('[data-testid="payment-time-range-picker-button"]');
      settlementPicker.addEventListener('click', function () {
        var list = document.getElementById('settlement-listbox');
        var expanding = list.style.display === 'none';
        list.style.display = expanding ? '' : 'none';
        settlementPicker.setAttribute('aria-expanded', expanding ? 'true' : 'false');
        fetch('/api/mock/settlement-picker-click', { method: 'POST' });
      });

      document.getElementById('tab-settlement').addEventListener('click', function () {
        document.getElementById('tab-settlement').setAttribute('aria-selected', 'true');
        document.getElementById('tab-custom').setAttribute('aria-selected', 'false');
        document.getElementById('settlement-panel').style.display = '';
        document.getElementById('custom-range-fields').style.display = 'none';
      });
      document.getElementById('tab-custom').addEventListener('click', function () {
        document.getElementById('tab-custom').setAttribute('aria-selected', 'true');
        document.getElementById('tab-settlement').setAttribute('aria-selected', 'false');
        document.getElementById('settlement-panel').style.display = 'none';
        document.getElementById('custom-range-fields').style.display = '';
        fetch('/api/mock/custom-range-tab-click', { method: 'POST' });
      });

      Array.prototype.forEach.call(document.querySelectorAll('#settlement-listbox [role="option"]'), function (opt) {
        opt.addEventListener('click', function () {
          document.getElementById('settlement-picker-label').textContent = opt.textContent;
          timeFrameTrigger.value = opt.textContent;
          document.getElementById('settlement-listbox').style.display = 'none';
          settlementPicker.setAttribute('aria-expanded', 'false');
          // Dwa zaobserwowane zachowania Ubera po wybraniu okna rozliczenia: albo
          // zewnetrzny panel z zakladkami ZOSTAJE otwarty (i jako nakladka zaslania pola
          // ponizej - automat musi go zwinac sam), albo zamyka sie od razu (i wtedy
          // automat NIE moze go "zwijac", bo klikniecie otworzy go z powrotem).
          ${settlementSelectionClosesPanel
            ? "document.getElementById('time-frame-panel').style.display = 'none';"
            : ''}
          fetch('/api/mock/settlement-window-selected', { method: 'POST', body: opt.textContent });
        });
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

      Array.prototype.forEach.call(document.querySelectorAll('#org-popover input[type="checkbox"]'), function (cb) {
        cb.addEventListener('click', function (e) {
          // Symuluje przejsciowy problem UI ("polkniete" klikniecie) - checkbox nie
          // zaznacza sie mimo klikniecia, dopoki dialog nie zostal otwarty ponownie
          // wystarczajaco duzo razy. Uzywane do przetestowania retry w
          // generateUberReportWithRetry.
          if (state.dialogOpenCount <= ${failGenerateAttempts}) {
            e.preventDefault();
          }
        });
        cb.addEventListener('change', function () {
          if (cb.checked) {
            fetch('/api/mock/org-checked', { method: 'POST', body: cb.closest('label').textContent.trim() });
          }
        });
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
    failForwardClicks = 0,
    failGenerateAttempts = 0,
    organizations,
    csvContent = 'data,column\n1,2\n',
    prefilledTimeFrameValue = '',
    showArkoseChallenge = false,
    arkoseReturnsToStep1 = false,
    passwordInIframe = false,
    decoyHiddenPasswordInput = false,
    settlementWindowOptions = [],
    settlementSelectionClosesPanel = false,
    timeFramePanelIgnoresTriggerClose = false,
    orgTriggerWithoutAriaControls = false,
  } = scenario;

  const state = {
    loggedIn: false,
    reportReady: reportAlreadyExists,
    reportGenerating: false,
    pageLoadCount: 0,
    generatedAtLoadCount: -1,
    popupDismissedCount: 0,
    forwardClickCount: 0,
    dialogOpenCount: 0,
    checkedOrgNames: [],
    customRangeTabClicks: 0,
    arkoseSolvedCount: 0,
    settlementWindowSelected: null,
    settlementPickerClicks: 0,
    timeFrameTriggerClicks: 0,
  };

  const options = {
    expectedEmail: credentials.email,
    expectedPassword: credentials.password,
    reportNamePrefix: scenario.reportNamePrefix || '20260805-20260807-payments_driver',
    fromSlash: scenario.fromSlash || '2026/08/05',
    toSlash: scenario.toSlash || '2026/08/07',
    popupAfterDateSelection,
    failGenerateAttempts,
    prefilledTimeFrameValue,
    showArkoseChallenge,
    arkoseReturnsToStep1,
    passwordInIframe,
    decoyHiddenPasswordInput,
    settlementWindowOptions,
    settlementSelectionClosesPanel,
    timeFramePanelIgnoresTriggerClose,
    orgTriggerWithoutAriaControls,
    ...(organizations ? { organizations } : {}),
  };

  await context.route('**/*', (route) => route.abort('blockedbyclient'));

  await context.route('https://supplier.uber.com/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (url.pathname === '/api/mock/forward-click' && method === 'POST') {
      state.forwardClickCount += 1;
      const transition = state.forwardClickCount > failForwardClicks;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ transition }) });
    }

    if (url.pathname === '/api/mock/arkose-solved' && method === 'POST') {
      state.arkoseSolvedCount += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }

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

    if (url.pathname === '/api/mock/dialog-open' && method === 'POST') {
      state.dialogOpenCount += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }

    if (url.pathname === '/api/mock/custom-range-tab-click' && method === 'POST') {
      state.customRangeTabClicks += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }

    if (url.pathname === '/api/mock/time-frame-trigger-click' && method === 'POST') {
      state.timeFrameTriggerClicks += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }

    if (url.pathname === '/api/mock/settlement-picker-click' && method === 'POST') {
      state.settlementPickerClicks += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }

    if (url.pathname === '/api/mock/settlement-window-selected' && method === 'POST') {
      state.settlementWindowSelected = await route.request().postData();
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }

    if (url.pathname === '/api/mock/org-checked' && method === 'POST') {
      state.checkedOrgNames.push(await route.request().postData());
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
      // charset=utf-8 jest KONIECZNY: bez niego przegladarka dekoduje dokument jako
      // windows-1252 i polskie znaki w tekstach UI (np. placeholder "Wybierz przedział
      // czasowy raportu") rozpadaja sie na po dwa znaki, przez co selektory z uber.js
      // dopasowujace pojedynczy znak diakrytyczny (regex "przedzia.") przestaja trafiac.
      contentType: 'text/html; charset=utf-8',
      body: buildAppHtml(state, options),
    });
  });

  return { state };
}

module.exports = { installUberMock };
