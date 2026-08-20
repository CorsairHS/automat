const FIELD_LABELS = {
  email: 'Email',
  username: 'Login',
  password: 'Haslo',
  clientId: 'Client ID',
  clientSecret: 'Client Secret',
};

const FIELD_TYPES = {
  email: 'text',
  username: 'text',
  password: 'password',
  clientId: 'text',
  clientSecret: 'password',
};

let CONFIG = null;
const statusElements = new Map();
const runButtons = new Map();
let uploadStatusElement = null;
let reportAccountsCache = [];
let downloadAllButton = null;
let downloadAllStatusElement = null;

window.api.onSyncStatus(({ platformId, accountId, message }) => {
  const el = statusElements.get(`${platformId}:${accountId}`);
  if (el) el.textContent = message;
});

window.api.onUploadStatus(({ message }) => {
  if (uploadStatusElement) uploadStatusElement.textContent = message;
});

async function render() {
  CONFIG = await window.api.getPlatformsConfig();
  const container = document.getElementById('platform-list');
  container.innerHTML = '';

  reportAccountsCache = [];
  statusElements.clear();
  runButtons.clear();
  for (const platform of CONFIG.platforms) {
    const accounts = await window.api.listAccounts(platform.id);
    if (platform.report) {
      for (const account of accounts) {
        reportAccountsCache.push({
          platformId: platform.id,
          platformLabel: platform.label,
          accountId: account.accountId,
          label: account.label,
        });
      }
    }
    container.appendChild(await renderPlatformSection(platform, accounts));
  }

  await renderChecklistSection();
  renderUploadSection();
}

/**
 * Wstawia sekcje o danym id w odpowiednim miejscu: podmienia istniejacy element,
 * a jesli go nie ma - wstawia przed sekcja uploadu (o ile juz istnieje w DOM), zeby
 * kolejnosc sekcji zostala zachowana przy czesciowych odswiezeniach (np. po pobraniu
 * pojedynczego raportu, bez przebudowy calego widoku i utraty niezapisanych danych).
 */
function appendOrReplaceSection(section) {
  const existing = document.getElementById(section.id);
  if (existing) {
    existing.replaceWith(section);
    return;
  }
  const uploadSection = document.getElementById('upload-section');
  if (uploadSection) {
    uploadSection.before(section);
  } else {
    document.getElementById('platform-list').appendChild(section);
  }
}

/**
 * Warstwa kontrolna: lista wszystkich skonfigurowanych kont Uber/Bolt/FreeNow z
 * checkboxem, ktory zaznacza sie automatycznie na podstawie faktycznego stanu pobrania
 * w biezacej sesji aplikacji (main.js -> lastDownloads), nie da sie go zaznaczyc recznie -
 * ma to byc realna weryfikacja "czy wszystko sie pobralo", nie tylko notatka.
 */
async function renderChecklistSection() {
  const downloads = await window.api.getDownloadsStatus();
  const downloadedMap = new Map(downloads.map((d) => [`${d.platformId}:${d.accountId}`, d]));

  const section = document.createElement('section');
  section.id = 'checklist-section';
  section.className = 'platform-section';

  const header = document.createElement('h2');
  header.textContent = 'Kontrola pobran';
  section.appendChild(header);

  const note = document.createElement('p');
  note.className = 'platform-note';
  note.textContent = 'Checkbox zaznacza sie automatycznie, gdy plik zostanie faktycznie pobrany w tej sesji aplikacji - nie mozna go zaznaczyc recznie.';
  section.appendChild(note);

  if (reportAccountsCache.length > 0) {
    const runRow = document.createElement('div');
    runRow.className = 'run-row';

    const runBtn = document.createElement('button');
    runBtn.className = 'btn-run';
    runBtn.textContent = 'Pobierz wszystkie';
    downloadAllButton = runBtn;

    const statusSpan = document.createElement('span');
    statusSpan.className = 'run-status';
    downloadAllStatusElement = statusSpan;

    runBtn.onclick = () => runAllDownloads();

    runRow.appendChild(runBtn);
    runRow.appendChild(statusSpan);
    section.appendChild(runRow);
  }

  if (reportAccountsCache.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'platform-note';
    empty.textContent = 'Brak skonfigurowanych kont.';
    section.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'checklist-list';

    for (const item of reportAccountsCache) {
      const entry = downloadedMap.get(`${item.platformId}:${item.accountId}`);
      const row = document.createElement('label');
      row.className = 'checklist-item' + (entry ? ' checked' : '');

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = Boolean(entry);
      checkbox.disabled = true;
      row.appendChild(checkbox);

      const text = document.createElement('span');
      const accountLabel = item.label || item.accountId;
      if (entry) {
        const fileName = entry.filePath.split(/[\\/]/).pop();
        const time = new Date(entry.downloadedAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
        text.textContent = `${item.platformLabel} - ${accountLabel}: ${fileName} (${time})`;
      } else {
        text.textContent = `${item.platformLabel} - ${accountLabel}: nie pobrano`;
      }
      row.appendChild(text);

      list.appendChild(row);
    }
    section.appendChild(list);
  }

  appendOrReplaceSection(section);
}

/**
 * Uruchamia pobieranie po kolei (sekwencyjnie, nie rownolegle) dla wszystkich
 * skonfigurowanych kont Uber/Bolt/FreeNow. Sekwencyjnie, bo kazde pobranie otwiera
 * widoczne okno przegladarki (Playwright) - rownolegle uruchomienia mylylyby uzytkownika
 * i utrudnialy reczne dokonczenie 2FA. Blokuje wszystkie przyciski "Pobierz teraz" i
 * "Pobierz wszystkie" na czas trwania, zeby nie odpalic tego samego konta dwa razy naraz.
 */
async function runAllDownloads() {
  if (reportAccountsCache.length === 0) return;

  if (downloadAllButton) downloadAllButton.disabled = true;
  for (const btn of runButtons.values()) btn.disabled = true;

  let doneCount = 0;
  for (const item of reportAccountsCache) {
    const key = `${item.platformId}:${item.accountId}`;
    const accountLabel = item.label || item.accountId;
    if (downloadAllStatusElement) {
      downloadAllStatusElement.textContent = `Pobieram (${doneCount + 1}/${reportAccountsCache.length}): ${item.platformLabel} - ${accountLabel}...`;
    }
    const statusSpan = statusElements.get(key);
    if (statusSpan) statusSpan.textContent = 'Uruchamiam przegladarke...';

    const result = await window.api.runSync(item.platformId, item.accountId);
    if (statusSpan) statusSpan.textContent = result.ok ? `Gotowe: ${result.filePath}` : `Blad: ${result.error}`;
    doneCount += 1;
    // renderChecklistSection() tworzy nowy przycisk "Pobierz wszystkie" (podmienia caly
    // element), wiec trzeba go ponownie zablokowac - inaczej staje sie klikalny w trakcie
    // trwania petli.
    await renderChecklistSection();
    if (downloadAllButton) downloadAllButton.disabled = true;
  }

  if (downloadAllButton) downloadAllButton.disabled = false;
  for (const btn of runButtons.values()) btn.disabled = false;
  if (downloadAllStatusElement) downloadAllStatusElement.textContent = `Gotowe: pobrano ${doneCount}/${reportAccountsCache.length} kont.`;
}

/**
 * Wgrywanie do PartnerTax admin dziala na plikach ostatnio pobranych w tej samej sesji
 * aplikacji (trzymanych w pamieci procesu main - patrz lastDownloads w main.js), wiec
 * przycisk jest jeden, globalny, nie per-konto: klika sie go po pobraniu raportow
 * Uber/Bolt/FreeNow, a automat sam wgrywa wszystko co ma w pamieci do pierwszego
 * niezakonczonego rozliczenia (Finished = False).
 */
function renderUploadSection() {
  const existing = document.getElementById('upload-section');
  if (existing) existing.remove();

  const section = document.createElement('section');
  section.id = 'upload-section';
  section.className = 'platform-section';

  const header = document.createElement('h2');
  header.textContent = 'PartnerTax Admin - wgrywanie';
  section.appendChild(header);

  const note = document.createElement('p');
  note.className = 'platform-note';
  note.textContent = 'Wgrywa do pierwszego niezakonczonego rozliczenia (Finished = False) wszystkie pliki pobrane w tej sesji aplikacji (Uber/Bolt/FreeNow "Pobierz teraz" powyzej).';
  section.appendChild(note);

  const runRow = document.createElement('div');
  runRow.className = 'run-row';

  const runBtn = document.createElement('button');
  runBtn.className = 'btn-run';
  runBtn.textContent = 'Wgraj do PartnerTax';

  const statusSpan = document.createElement('span');
  statusSpan.className = 'run-status';
  uploadStatusElement = statusSpan;

  runBtn.onclick = async () => {
    runBtn.disabled = true;
    statusSpan.textContent = 'Uruchamiam przegladarke...';
    const result = await window.api.runUpload();
    runBtn.disabled = false;
    statusSpan.textContent = result.ok ? `Gotowe: wgrano ${result.count} plik(ow).` : `Blad: ${result.error}`;
  };

  runRow.appendChild(runBtn);
  runRow.appendChild(statusSpan);
  section.appendChild(runRow);

  document.getElementById('platform-list').appendChild(section);
}

async function renderPlatformSection(platform, accounts) {
  const section = document.createElement('section');
  section.className = 'platform-section';

  const header = document.createElement('h2');
  header.textContent = platform.label;
  section.appendChild(header);

  if (platform.report) {
    const reportInfo = document.createElement('p');
    reportInfo.className = 'platform-note';
    reportInfo.textContent = `Raport: ${platform.report.name} (${platform.report.menuPath})`;
    section.appendChild(reportInfo);
  }

  if (platform.note) {
    const note = document.createElement('p');
    note.className = 'platform-note';
    note.textContent = platform.note;
    section.appendChild(note);
  }

  const list = document.createElement('div');
  list.className = 'account-list';

  for (const account of accounts) {
    list.appendChild(renderAccountCard(platform, account));
  }
  section.appendChild(list);

  if (platform.multiAccount || accounts.length === 0) {
    const addBtn = document.createElement('button');
    addBtn.className = 'btn-add';
    addBtn.textContent = platform.multiAccount ? '+ Dodaj konto' : '+ Dodaj dane logowania';
    addBtn.onclick = () => {
      list.appendChild(renderAccountCard(platform, null));
      addBtn.remove();
    };
    section.appendChild(addBtn);
  }

  return section;
}

function renderAccountCard(platform, account) {
  const isNew = !account;
  const card = document.createElement('div');
  card.className = 'platform-card';

  const inputs = {};

  const labelRow = document.createElement('div');
  labelRow.className = 'field-row';
  const labelLabel = document.createElement('label');
  labelLabel.textContent = 'Nazwa / etykieta (np. Unity Drive)';
  labelRow.appendChild(labelLabel);
  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.placeholder = 'np. Unity Drive - Wroclaw';
  labelInput.value = account ? account.label || '' : '';
  labelRow.appendChild(labelInput);
  inputs.label = labelInput;
  card.appendChild(labelRow);

  for (const field of platform.fields) {
    const row = document.createElement('div');
    row.className = 'field-row';
    const label = document.createElement('label');
    label.textContent = FIELD_LABELS[field] || field;
    row.appendChild(label);

    const input = document.createElement('input');
    input.type = FIELD_TYPES[field] || 'text';
    const existingFieldData = account ? account.fields[field] : null;

    if (existingFieldData && existingFieldData.masked) {
      input.placeholder = existingFieldData.hasValue ? 'Zapisano - zostaw puste aby nie zmieniac' : FIELD_LABELS[field] || field;
    } else if (existingFieldData) {
      input.value = existingFieldData.value || '';
    } else {
      input.placeholder = FIELD_LABELS[field] || field;
    }
    row.appendChild(input);
    inputs[field] = input;
    card.appendChild(row);
  }

  if (platform.multiAccount) {
    const cityRow = document.createElement('div');
    cityRow.className = 'field-row';
    const cityLabel = document.createElement('label');
    cityLabel.textContent = 'Miasto (cel w PartnerTax)';
    cityRow.appendChild(cityLabel);
    const cityInput = document.createElement('input');
    cityInput.type = 'text';
    cityInput.placeholder = 'np. Wroclaw';
    cityInput.value = account ? account.city || '' : '';
    cityRow.appendChild(cityInput);
    inputs.city = cityInput;
    card.appendChild(cityRow);

    const companyRow = document.createElement('div');
    companyRow.className = 'field-row';
    const companyLabel = document.createElement('label');
    companyLabel.textContent = 'Firma (cel w PartnerTax)';
    companyRow.appendChild(companyLabel);
    const companyInput = document.createElement('input');
    companyInput.type = 'text';
    companyInput.placeholder = 'np. Unity Drive';
    companyInput.value = account ? account.company || '' : '';
    companyRow.appendChild(companyInput);
    inputs.company = companyInput;
    card.appendChild(companyRow);

    const periodBlock = renderPeriodSelector(account, platform);
    card.appendChild(periodBlock.element);
    inputs.periodMode = periodBlock.getMode;
    inputs.periodFrom = periodBlock.getFrom;
    inputs.periodTo = periodBlock.getTo;
  }

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn-save';
  saveBtn.textContent = 'Zapisz';
  saveBtn.onclick = async () => {
    const fields = {};
    for (const field of platform.fields) {
      fields[field] = inputs[field].value;
    }
    const payload = {
      accountId: account ? account.accountId : undefined,
      label: inputs.label.value,
      fields,
    };
    if (platform.multiAccount) {
      payload.city = inputs.city.value;
      payload.company = inputs.company.value;
      payload.periodMode = inputs.periodMode();
      payload.periodFrom = inputs.periodFrom();
      payload.periodTo = inputs.periodTo();
    }
    await window.api.saveAccount(platform.id, payload);
    await render();
  };
  actions.appendChild(saveBtn);

  if (!isNew) {
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-delete';
    deleteBtn.textContent = 'Usun';
    deleteBtn.onclick = async () => {
      await window.api.deleteAccount(platform.id, account.accountId);
      await render();
    };
    actions.appendChild(deleteBtn);
  }

  card.appendChild(actions);

  // Pobieranie raportu jest zaimplementowane tylko dla platform ze zdefiniowanym
  // raportem (Uber/Bolt/FreeNow) - PartnerTax (upload) to osobny modul, jeszcze niegotowy.
  if (!isNew && platform.report) {
    const runRow = document.createElement('div');
    runRow.className = 'run-row';

    const runBtn = document.createElement('button');
    runBtn.className = 'btn-run';
    runBtn.textContent = 'Pobierz teraz';

    const statusSpan = document.createElement('span');
    statusSpan.className = 'run-status';
    const statusKey = `${platform.id}:${account.accountId}`;
    statusElements.set(statusKey, statusSpan);
    runButtons.set(statusKey, runBtn);

    runBtn.onclick = async () => {
      runBtn.disabled = true;
      statusSpan.textContent = 'Uruchamiam przegladarke...';
      const result = await window.api.runSync(platform.id, account.accountId);
      runBtn.disabled = false;
      statusSpan.textContent = result.ok ? `Gotowe: ${result.filePath}` : `Blad: ${result.error}`;
      if (result.ok) await renderChecklistSection();
    };

    runRow.appendChild(runBtn);
    runRow.appendChild(statusSpan);
    card.appendChild(runRow);
  }

  return card;
}

function renderPeriodSelector(account, platform) {
  const wrapper = document.createElement('div');
  wrapper.className = 'field-row period-row';

  const label = document.createElement('label');
  label.textContent = 'Okres pobierania';
  wrapper.appendChild(label);

  const radioGroup = document.createElement('div');
  radioGroup.className = 'period-options';

  const groupName = 'period-' + Math.random().toString(36).slice(2);
  const currentMode = (account && account.periodMode) || platform.defaultPeriodMode || 'current_week';

  const customDates = document.createElement('div');
  customDates.className = 'period-custom-dates';
  const fromInput = document.createElement('input');
  fromInput.type = 'date';
  fromInput.value = (account && account.periodFrom) || '';
  const toInput = document.createElement('input');
  toInput.type = 'date';
  toInput.value = (account && account.periodTo) || '';
  customDates.appendChild(fromInput);
  const dash = document.createElement('span');
  dash.textContent = ' - ';
  customDates.appendChild(dash);
  customDates.appendChild(toInput);
  customDates.style.display = currentMode === 'custom' ? 'flex' : 'none';

  const radios = [];
  for (const mode of CONFIG.periodModes) {
    const optionLabel = document.createElement('label');
    optionLabel.className = 'period-option';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = groupName;
    radio.value = mode.id;
    radio.checked = mode.id === currentMode;
    radio.onchange = () => {
      customDates.style.display = mode.id === 'custom' ? 'flex' : 'none';
    };
    radios.push(radio);

    optionLabel.appendChild(radio);
    optionLabel.append(' ' + mode.label);
    radioGroup.appendChild(optionLabel);
  }

  wrapper.appendChild(radioGroup);
  wrapper.appendChild(customDates);

  return {
    element: wrapper,
    getMode: () => radios.find((r) => r.checked)?.value || platform.defaultPeriodMode,
    getFrom: () => fromInput.value || null,
    getTo: () => toInput.value || null,
  };
}

render();
