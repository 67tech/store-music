const DAY_NAMES = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota'];

async function initSchedule() {
  await loadStoreHours();
  await loadExceptions();
  await loadSettings();

  document.getElementById('btn-add-exception').onclick = addException;
}

async function loadStoreHours() {
  const hours = await API.get('/schedule/hours');
  const container = document.getElementById('store-hours');
  container.innerHTML = '';

  const table = document.createElement('table');
  table.className = 'sm-table';
  table.innerHTML = `<thead><tr><th>Dzień</th><th>Otwarcie</th><th>Zamknięcie</th><th>Zamknięte</th></tr></thead>`;
  const tbody = document.createElement('tbody');

  for (const h of hours) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${DAY_NAMES[h.day_of_week]}</td>
      <td><input type="time" value="${h.open_time}" data-day="${h.day_of_week}" data-field="open_time" ${h.is_closed ? 'disabled' : ''}></td>
      <td><input type="time" value="${h.close_time}" data-day="${h.day_of_week}" data-field="close_time" ${h.is_closed ? 'disabled' : ''}></td>
      <td><input type="checkbox" data-day="${h.day_of_week}" data-field="is_closed" ${h.is_closed ? 'checked' : ''}></td>
    `;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'sm-btn sm-btn--primary';
  saveBtn.textContent = 'Zapisz godziny';
  saveBtn.onclick = saveStoreHours;
  container.appendChild(saveBtn);

  // Toggle disabled on closed checkbox
  container.querySelectorAll('input[data-field="is_closed"]').forEach(cb => {
    cb.onchange = () => {
      const day = cb.dataset.day;
      container.querySelectorAll(`input[data-day="${day}"][data-field="open_time"], input[data-day="${day}"][data-field="close_time"]`)
        .forEach(inp => inp.disabled = cb.checked);
    };
  });
}

async function saveStoreHours() {
  const container = document.getElementById('store-hours');
  const hours = [];
  for (let d = 0; d <= 6; d++) {
    const openInp = container.querySelector(`input[data-day="${d}"][data-field="open_time"]`);
    const closeInp = container.querySelector(`input[data-day="${d}"][data-field="close_time"]`);
    const closedInp = container.querySelector(`input[data-day="${d}"][data-field="is_closed"]`);
    hours.push({
      day_of_week: d,
      open_time: openInp.value,
      close_time: closeInp.value,
      is_closed: closedInp.checked,
    });
  }
  await API.put('/schedule/hours', { hours });
  await smAlert('Zapisano!');
}

async function loadExceptions() {
  const exceptions = await API.get('/schedule/exceptions');
  const container = document.getElementById('exceptions-list');
  container.innerHTML = '';

  if (exceptions.length === 0) {
    container.innerHTML = '<p class="sm-empty">Brak wyjątków</p>';
    return;
  }

  for (const ex of exceptions) {
    const div = document.createElement('div');
    div.className = 'sm-exception-card';
    div.innerHTML = `
      <strong>${ex.date}</strong> ${ex.label ? `(${esc(ex.label)})` : ''} —
      ${ex.is_closed ? 'Zamknięte' : `${ex.open_time} - ${ex.close_time}`}
      <button onclick="deleteException(${ex.id})" class="sm-btn sm-btn--danger sm-btn--small">&#10005;</button>
    `;
    container.appendChild(div);
  }
}

async function addException() {
  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modal-body');
  modalBody.innerHTML = `
    <h2>Dodaj wyjątek</h2>
    <div class="sm-form-row"><label>Data: <input type="date" id="exc-date"></label></div>
    <div class="sm-form-row"><label>Etykieta: <input type="text" id="exc-label" placeholder="np. Wielkanoc"></label></div>
    <div class="sm-form-row"><label><input type="checkbox" id="exc-closed"> Zamknięte cały dzień</label></div>
    <div id="exc-times">
      <div class="sm-form-row"><label>Otwarcie: <input type="time" id="exc-open" value="08:00"></label></div>
      <div class="sm-form-row"><label>Zamknięcie: <input type="time" id="exc-close" value="18:00"></label></div>
    </div>
    <button id="exc-save" class="sm-btn sm-btn--primary">Zapisz</button>
  `;

  document.getElementById('exc-closed').onchange = (e) => {
    document.getElementById('exc-times').style.display = e.target.checked ? 'none' : '';
  };

  document.getElementById('exc-save').onclick = async () => {
    const data = {
      date: document.getElementById('exc-date').value,
      label: document.getElementById('exc-label').value,
      is_closed: document.getElementById('exc-closed').checked,
      open_time: document.getElementById('exc-open').value,
      close_time: document.getElementById('exc-close').value,
    };
    if (!data.date) { await smAlert('Wybierz datę!'); return; }
    await API.post('/schedule/exceptions', data);
    modal.classList.remove('sm-modal--open');
    await loadExceptions();
  };

  modal.classList.add('sm-modal--open');
}

async function deleteException(id) {
  if (!await smConfirm('Usunąć wyjątek?')) return;
  await API.del(`/schedule/exceptions/${id}`);
  await loadExceptions();
}

async function loadSettings() {
  const settings = await API.get('/schedule/settings');
  const container = document.getElementById('app-settings');
  container.innerHTML = `
    <div class="sm-form-row"><label><input type="checkbox" id="set-auto-play" ${settings.autoPlayOnOpen ? 'checked' : ''}> Auto-odtwarzanie przy otwarciu</label></div>
    <div class="sm-form-row"><label><input type="checkbox" id="set-auto-stop" ${settings.autoStopOnClose ? 'checked' : ''}> Auto-stop przy zamknięciu</label></div>
    <div class="sm-form-row"><label>Domyślna głośność: <input type="range" id="set-volume" min="0" max="100" value="${settings.volume || 50}"> <span id="set-volume-val">${settings.volume || 50}</span></label></div>
    <div class="sm-form-row"><label>Czas fade (ms): <input type="number" id="set-fade" value="${settings.announcementFadeDurationMs || 2000}" min="0" max="10000" step="500"></label></div>
    <div class="sm-form-row"><label>Silnik TTS:
      <select id="set-tts-engine">
        <option value="google" ${settings.ttsEngine === 'google' ? 'selected' : ''}>Google TTS</option>
        <option value="piper" ${settings.ttsEngine === 'piper' ? 'selected' : ''}>Piper (offline)</option>
      </select>
    </label></div>
    <button onclick="saveSettings()" class="sm-btn sm-btn--primary">Zapisz ustawienia</button>
  `;

  document.getElementById('set-volume').oninput = (e) => {
    document.getElementById('set-volume-val').textContent = e.target.value;
  };
}

async function saveSettings() {
  const data = {
    autoPlayOnOpen: document.getElementById('set-auto-play').checked,
    autoStopOnClose: document.getElementById('set-auto-stop').checked,
    volume: parseInt(document.getElementById('set-volume').value),
    announcementFadeDurationMs: parseInt(document.getElementById('set-fade').value),
    ttsEngine: document.getElementById('set-tts-engine').value,
  };
  await API.put('/schedule/settings', data);
  await smAlert('Zapisano!');
}
