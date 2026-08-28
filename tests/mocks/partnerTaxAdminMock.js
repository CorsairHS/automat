const DEFAULT_CREDENTIALS = { username: 'partner', password: 'secret123' };

function lit(value) {
  return JSON.stringify(value);
}

const BASE_URL = 'https://app.nova-partner.pl';

/**
 * Django admin renderuje caly panel jako standardowe formularze server-rendered
 * (nie SPA jak Uber, nie wielostronicowa fasada zewnetrznej platformy jak
 * Bolt/FreeNow) - ale formularz "Data source" (formset) MUSI byc prawdziwym
 * <form method="post">, zeby klikniecie "Save and continue editing" wywolalo
 * PRAWDZIWA nawigacje (partnertax.js czeka na `page.waitForLoadState('domcontentloaded')`
 * po kliknieciu, wiec bez realnej nawigacji ten mechanizm nigdy by sie nie
 * uruchomil). Zeby uniknac parsowania multipart/form-data POST-a (plik +
 * kilka pol select), kazdy <select>/checkbox/plik w formularzu wysyla swoja
 * wartosc do serwera OD RAZU przy zmianie (fetch na /api/mock/pending-*) -
 * serwer wie wiec juz PRZED kliknieciem "Zapisz", co jest w formularzu, i przy
 * faktycznym POST-cie (ktorego tresci nie parsujemy w ogole) po prostu
 * "zatwierdza" znane juz dane.
 */
function buildLoginHtml({ expectedUsername, expectedPassword, redirectTo }) {
  return `<!doctype html>
<html>
<body>
  <input id="id_username" />
  <input id="id_password" type="password" />
  <button>Log in</button>
  <script>
    document.querySelector('button').addEventListener('click', () => {
      const username = document.getElementById('id_username').value;
      const password = document.getElementById('id_password').value;
      if (username === ${lit(expectedUsername)} && password === ${lit(expectedPassword)}) {
        fetch('/api/mock/login', { method: 'POST' }).then(() => {
          window.location.href = ${lit(redirectTo)};
        });
      }
    });
  </script>
</body>
</html>`;
}

function buildReckoningListHtml({ changeFormUrl }) {
  return `<!doctype html>
<html>
<body>
  <table id="result_list">
    <tbody>
      <tr>
        <td><a href="${changeFormUrl}">Rozliczenie #1</a></td>
        <td>False</td>
      </tr>
    </tbody>
  </table>
</body>
</html>`;
}

const KNOWN_SYSTEMS = [
  ['17', 'Bolt'],
  ['32', 'Uber'],
  ['2', 'FreeNow'],
  ['78', 'Bolt Food'],
];
const KNOWN_CITIES = [
  ['7', 'Wroclaw'],
  ['8', 'Warszawa'],
];
const KNOWN_COMPANIES = [
  ['5', 'Unity Drive'],
  ['4', 'Da Investment'],
];

function optionsHtml(pairs) {
  return `<option value=""></option>` + pairs.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
}

function buildChangeFormHtml(state, { changeFormUrl }) {
  const savedRowsHtml = state.savedSources
    .map(
      (row, i) => `<div class="source-row">
        <a href="/admin/systems/system/${row.system}/change/">System</a>
        <input type="checkbox" name="sources-${i}-DELETE" style="display:none" class="delete-checkbox" data-row="${i}" />
      </div>`
    )
    .join('\n');

  return `<!doctype html>
<html>
<body>
  <form method="post" action="${changeFormUrl}">
    <div id="saved-sources">${savedRowsHtml}</div>

    <!-- Formset "empty form" template - zawsze w DOM, zawsze niewidoczny, indeks
         literalny "__prefix__" - selektory produkcyjne musza go wykluczac. -->
    <tr style="display:none">
      <select name="sources-__prefix__-system">${optionsHtml(KNOWN_SYSTEMS)}</select>
      <select name="sources-__prefix__-city">${optionsHtml(KNOWN_CITIES)}</select>
      <select name="sources-__prefix__-company">${optionsHtml(KNOWN_COMPANIES)}</select>
      <input type="file" name="sources-__prefix__-file" />
      <input type="checkbox" name="sources-__prefix__-DELETE" />
    </tr>

    <div id="pending-sources"></div>

    <a href="#" id="add-source-link">Add another Data source / Dodaj kolejne Źródło danych</a>

    <button type="submit">Save and continue editing / Zapisz i kontynuuj edycję</button>
  </form>

  <script>
    let nextIndex = ${state.savedSources.length};

    document.getElementById('add-source-link').addEventListener('click', (e) => {
      e.preventDefault();
      const rowIndex = nextIndex;
      nextIndex += 1;

      const row = document.createElement('div');
      row.innerHTML = \`
        <select name="sources-\${rowIndex}-system">${optionsHtml(KNOWN_SYSTEMS)}</select>
        <select name="sources-\${rowIndex}-city">${optionsHtml(KNOWN_CITIES)}</select>
        <select name="sources-\${rowIndex}-company">${optionsHtml(KNOWN_COMPANIES)}</select>
        <input type="file" name="sources-\${rowIndex}-file" />
      \`;
      document.getElementById('pending-sources').appendChild(row);

      const post = (field, value) =>
        fetch('/api/mock/pending-new-row-field', {
          method: 'POST',
          body: JSON.stringify({ row: rowIndex, field, value }),
        });

      row.querySelector('select[name$="-system"]').addEventListener('change', (ev) => post('system', ev.target.value));
      row.querySelector('select[name$="-city"]').addEventListener('change', (ev) => post('city', ev.target.value));
      row.querySelector('select[name$="-company"]').addEventListener('change', (ev) => post('company', ev.target.value));
      row.querySelector('input[type="file"]').addEventListener('change', (ev) => post('file', ev.target.files.length > 0 ? '1' : ''));
    });

    Array.prototype.forEach.call(document.querySelectorAll('.delete-checkbox'), (cb) => {
      cb.addEventListener('change', () => {
        fetch('/api/mock/pending-delete', {
          method: 'POST',
          body: JSON.stringify({ row: Number(cb.dataset.row) }),
        });
      });
    });
  </script>
</body>
</html>`;
}

/**
 * Instaluje przechwytywanie ruchu do app.nova-partner.pl. Login jak w
 * Bolcie/FreeNow (wielostronicowa nawigacja, klienckie przekierowanie zamiast
 * HTTP 302 - patrz historia poprzednich mockow w tym repo, dlaczego). Formularz
 * "Data source" to prawdziwy <form method="post"> (patrz komentarz nad
 * buildChangeFormHtml) - kazda zmiana pola wysyla stan na biezaco, a POST przy
 * "Zapisz" tylko zatwierdza juz znane dane (bez parsowania multipart/form-data).
 */
async function installPartnerTaxMock(context, scenario = {}) {
  const {
    credentials = DEFAULT_CREDENTIALS,
    preSeedSavedSources = [],
    hangOnFirstSave = false,
  } = scenario;

  const loginPath = '/admin/login/';
  const adminIndexPath = '/admin/';
  const reckoningListPath = '/admin/finances/reckoning/';
  const changeFormPath = '/admin/finances/reckoning/1/change/';

  const state = {
    loggedIn: false,
    savedSources: preSeedSavedSources.map((s) => ({ ...s })),
    pendingNewRows: {},
    pendingDeletes: new Set(),
    saveAttemptCount: 0,
  };

  function commitPending() {
    for (const [rowStr, fields] of Object.entries(state.pendingNewRows)) {
      if (fields.system && fields.city && fields.company && fields.file) {
        state.savedSources.push({ system: fields.system });
        delete state.pendingNewRows[rowStr];
      }
    }
    if (state.pendingDeletes.size > 0) {
      const indices = [...state.pendingDeletes].sort((a, b) => b - a);
      for (const idx of indices) {
        state.savedSources.splice(idx, 1);
      }
      state.pendingDeletes.clear();
    }
  }

  await context.route('**/*', (route) => route.abort('blockedbyclient'));

  await context.route(`${BASE_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (url.pathname === '/api/mock/login') {
      state.loggedIn = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }

    if (url.pathname === adminIndexPath) {
      if (!state.loggedIn) {
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: `<script>window.location.replace(${lit(BASE_URL + loginPath)})</script>`,
        });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Admin index</body></html>' });
    }

    if (url.pathname === loginPath) {
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: buildLoginHtml({
          expectedUsername: credentials.username,
          expectedPassword: credentials.password,
          redirectTo: BASE_URL + adminIndexPath,
        }),
      });
    }

    if (url.pathname === reckoningListPath) {
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: buildReckoningListHtml({ changeFormUrl: BASE_URL + changeFormPath }),
      });
    }

    if (url.pathname === '/api/mock/pending-new-row-field') {
      const { row, field, value } = route.request().postDataJSON();
      state.pendingNewRows[row] = state.pendingNewRows[row] || {};
      state.pendingNewRows[row][field] = value;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }

    if (url.pathname === '/api/mock/pending-delete') {
      const { row } = route.request().postDataJSON();
      state.pendingDeletes.add(row);
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }

    if (url.pathname === changeFormPath) {
      commitPending();

      if (method === 'POST' && hangOnFirstSave && state.saveAttemptCount === 0) {
        state.saveAttemptCount += 1;
        // Zweryfikowane empirycznie w tej sesji (patrz spec): page.waitForLoadState()
        // wywolane po kliknieciu z {noWaitAfter:true} NIE wykrywa niezawodnie trwajacej
        // nawigacji w tej wersji Playwrighta - zawsze rozwiazuje sie natychmiast,
        // niezaleznie od tego, czy odpowiedz jest wolna, przerwana (abort), czy w ogole
        // nigdy nie nadchodzi. Realna odpornosc na wolny zapis pochodzi z zewnetrznej
        // petli w clickSaveAndVerify, ktora co sekunde odpytuje verifyFn() (oparte na
        // Playwrightowych lokatorach z auto-czekaniem) - dlatego symulujemy realne,
        // dlugie (ale KONCZACE SIE) opoznienie, a nie przerwane/nigdy-nie-konczace sie
        // zadanie (ktore prowadziloby do 15-minutowego timeoutu bez szans na sukces).
        await new Promise((resolve) => setTimeout(resolve, 25000));
      }

      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: buildChangeFormHtml(state, { changeFormUrl: BASE_URL + changeFormPath }),
      });
    }

    return route.fulfill({ status: 404, body: 'not found' });
  });

  return { state };
}

module.exports = { installPartnerTaxMock };
