const DAY_NAMES = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota'];

async function initSchedule() {
  // Timeline date picker
  const dateInput = document.getElementById('timeline-date');
  dateInput.value = new Date().toISOString().slice(0, 10);
  dateInput.onchange = () => loadTimeline(dateInput.value);

  await loadTimeline();
  await loadStoreHours();
  await loadExceptions();
  await loadMatchDays();
  await loadSettings();

  document.getElementById('btn-add-exception').onclick = addException;
}

async function loadTimeline(dateStr) {
  const container = document.getElementById('timeline-container');
  const date = dateStr || new Date().toISOString().slice(0, 10);

  try {
    const timeline = await API.get(`/schedule/timeline?date=${date}`);

    if (timeline.closed) {
      container.innerHTML = '<div class="sm-timeline-closed">Sklep zamknięty w tym dniu</div>';
      return;
    }

    const now = new Date();
    const isToday = date === now.toISOString().slice(0, 10);
    const currentTime = isToday
      ? `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      : null;

    let html = '<div class="sm-timeline">';
    let nowInserted = false;

    for (const event of timeline.events) {
      // Insert "now" marker
      if (isToday && currentTime && !nowInserted && event.time > currentTime) {
        html += `<div class="sm-timeline-now-line">Teraz ${currentTime}</div>`;
        nowInserted = true;
      }

      const isPast = isToday && currentTime && event.time < currentTime;
      const isNow = isToday && currentTime && event.time === currentTime;

      const typeClass = `sm-timeline-event--${event.type}`;
      const pastClass = isPast ? 'sm-timeline-event--past' : '';
      const nowClass = isNow ? 'sm-timeline-event--now' : '';

      html += `
        <div class="sm-timeline-event ${typeClass} ${pastClass} ${nowClass}">
          <span class="sm-timeline-time">${event.time}</span>
          <span class="sm-timeline-label">${esc(event.label)}</span>
          ${event.detail ? `<span class="sm-timeline-detail">${esc(event.detail)}</span>` : ''}
          ${event.duration ? `<span class="sm-timeline-detail">${formatTime(event.duration)}</span>` : ''}
        </div>
      `;
    }

    // Insert "now" at the end if not yet inserted
    if (isToday && currentTime && !nowInserted) {
      html += `<div class="sm-timeline-now-line">Teraz ${currentTime}</div>`;
    }

    html += '</div>';

    if (timeline.events.length === 0) {
      html = '<div class="sm-timeline-closed">Brak zaplanowanych wydarzeń</div>';
    }

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<p class="sm-empty">Błąd ładowania timeline: ${err.message}</p>`;
  }
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
  await loadTimeline();
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
    await loadTimeline();
  };

  modal.classList.add('sm-modal--open');
}

async function deleteException(id) {
  if (!await smConfirm('Usunąć wyjątek?')) return;
  await API.del(`/schedule/exceptions/${id}`);
  await loadExceptions();
  await loadTimeline();
}

async function loadSettings() {
  const settings = await API.get('/schedule/settings');
  const container = document.getElementById('app-settings');
  container.innerHTML = `
    <div class="sm-form-row"><label><input type="checkbox" id="set-auto-play" ${settings.autoPlayOnOpen ? 'checked' : ''}> Auto-odtwarzanie przy otwarciu</label></div>
    <div class="sm-form-row"><label><input type="checkbox" id="set-auto-stop" ${settings.autoStopOnClose ? 'checked' : ''}> Auto-stop przy zamknięciu</label></div>
    <div class="sm-form-row"><label>Domyślna głośność: <input type="range" id="set-volume" min="0" max="100" value="${settings.volume || 50}"> <span id="set-volume-val">${settings.volume || 50}</span></label></div>
    <div class="sm-form-row"><label>Czas fade komunikatów (ms): <input type="number" id="set-fade" value="${settings.announcementFadeDurationMs || 2000}" min="0" max="10000" step="500"></label></div>
    <div class="sm-form-row"><label>Crossfade między utworami (ms): <input type="number" id="set-crossfade" value="${settings.crossfadeDurationMs || 0}" min="0" max="12000" step="500"> <span class="sm-text-muted">(0 = wyłączony)</span></label></div>
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
    crossfadeDurationMs: parseInt(document.getElementById('set-crossfade').value),
    ttsEngine: document.getElementById('set-tts-engine').value,
  };
  await API.put('/schedule/settings', data);
  await smAlert('Zapisano!');
}

// --- Match Days ---
let matchdayDates = [];

async function loadMatchDays() {
  const container = document.getElementById('matchday-section');
  const template = await API.get('/schedule/matchdays/template');

  container.innerHTML = `
    <div class="sm-card-body">
      <p style="font-size: 0.82rem; color: var(--sm-text-muted); margin-bottom: 10px;">
        Ustaw szablon godzin dla dni meczowych, a nastepnie wybierz daty.
      </p>
      <div style="display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 12px;">
        <div class="sm-form-row" style="flex:1; min-width: 120px; margin-bottom: 0;">
          <label>Otwarcie: <input type="time" id="md-open" value="${template.open_time}"></label>
        </div>
        <div class="sm-form-row" style="flex:1; min-width: 120px; margin-bottom: 0;">
          <label>Zamkniecie: <input type="time" id="md-close" value="${template.close_time}"></label>
        </div>
        <div class="sm-form-row" style="flex:1; min-width: 150px; margin-bottom: 0;">
          <label>Etykieta: <input type="text" id="md-label" value="${esc(template.label)}"></label>
        </div>
      </div>
      <button onclick="saveMatchdayTemplate()" class="sm-btn sm-btn--small" style="margin-bottom: 16px;">Zapisz szablon</button>

      <div style="border-top: 1px solid var(--sm-border); padding-top: 12px;">
        <div class="sm-form-row" style="margin-bottom: 8px;">
          <label>Dodaj date: <input type="date" id="md-date-input" min="${new Date().toISOString().slice(0, 10)}"></label>
        </div>
        <button onclick="addMatchdayDate()" class="sm-btn sm-btn--small" style="margin-bottom: 8px;">+ Dodaj date</button>
        <div class="sm-matchday-dates" id="md-dates-list"></div>
        <button onclick="applyMatchdays()" class="sm-btn sm-btn--primary sm-btn--small" style="margin-top: 8px;" id="md-apply-btn" disabled>Zastosuj do harmonogramu</button>
      </div>
    </div>
  `;

  matchdayDates = [];
  renderMatchdayDates();
}

async function saveMatchdayTemplate() {
  await API.put('/schedule/matchdays/template', {
    open_time: document.getElementById('md-open').value,
    close_time: document.getElementById('md-close').value,
    label: document.getElementById('md-label').value,
  });
  await smAlert('Szablon zapisany!');
}

function addMatchdayDate() {
  const input = document.getElementById('md-date-input');
  const date = input.value;
  if (!date) return;
  if (matchdayDates.includes(date)) return;
  matchdayDates.push(date);
  matchdayDates.sort();
  input.value = '';
  renderMatchdayDates();
}

function removeMatchdayDate(date) {
  matchdayDates = matchdayDates.filter(d => d !== date);
  renderMatchdayDates();
}

function renderMatchdayDates() {
  const container = document.getElementById('md-dates-list');
  if (!container) return;
  const applyBtn = document.getElementById('md-apply-btn');

  if (matchdayDates.length === 0) {
    container.innerHTML = '<span style="font-size: 0.82rem; color: var(--sm-text-muted);">Brak wybranych dat</span>';
    if (applyBtn) applyBtn.disabled = true;
    return;
  }

  container.innerHTML = matchdayDates.map(d =>
    `<span class="sm-matchday-date">${d} <button onclick="removeMatchdayDate('${d}')">&times;</button></span>`
  ).join('');

  if (applyBtn) applyBtn.disabled = false;
}

async function applyMatchdays() {
  if (matchdayDates.length === 0) return;
  if (!await smConfirm(`Zastosowac szablon meczowy do ${matchdayDates.length} dat?`)) return;

  try {
    await API.post('/schedule/matchdays/apply', { dates: matchdayDates });
    matchdayDates = [];
    renderMatchdayDates();
    await loadExceptions();
    await loadTimeline();
    await smAlert('Daty meczowe dodane do wyjatkow!');
  } catch (err) {
    await smAlert('Blad: ' + err.message);
  }
}
