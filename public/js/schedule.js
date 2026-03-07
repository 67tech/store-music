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

  // Playback settings
  const playbackContainer = document.getElementById('app-settings');
  if (playbackContainer) {
    playbackContainer.innerHTML = `
      <div class="sm-form-row"><label><input type="checkbox" id="set-auto-play" ${settings.autoPlayOnOpen ? 'checked' : ''}> Auto-odtwarzanie przy otwarciu sklepu</label></div>
      <div class="sm-form-row"><label><input type="checkbox" id="set-auto-stop" ${settings.autoStopOnClose ? 'checked' : ''}> Auto-stop przy zamknieciu sklepu</label></div>
      <div class="sm-form-row"><label>Domyslna glosnosc: <input type="range" id="set-volume" min="0" max="100" value="${settings.volume || 50}"> <span id="set-volume-val">${settings.volume || 50}</span>%</label></div>
      <div class="sm-form-row"><label>Crossfade miedzy utworami (ms): <input type="number" id="set-crossfade" class="sm-input" value="${settings.crossfadeDurationMs || 0}" min="0" max="12000" step="500" style="max-width:120px;"> <span class="sm-text-muted">(0 = wylaczony)</span></label></div>
      <div class="sm-form-row"><label>Czas fade komunikatow (ms): <input type="number" id="set-fade" class="sm-input" value="${settings.announcementFadeDurationMs || 2000}" min="0" max="10000" step="500" style="max-width:120px;"></label></div>
      <button onclick="saveSettings()" class="sm-btn sm-btn--primary sm-btn--small" style="margin-top:4px;">Zapisz</button>
    `;
    document.getElementById('set-volume').oninput = (e) => {
      document.getElementById('set-volume-val').textContent = e.target.value;
    };
  }

  // TTS settings
  const ttsContainer = document.getElementById('tts-settings');
  if (ttsContainer) {
    ttsContainer.innerHTML = `
      <div class="sm-form-row"><label>Domyslny silnik TTS:
        <select id="set-tts-engine" class="sm-input" style="max-width:200px;" onchange="toggleElevenLabsSettings()">
          <option value="elevenlabs" ${settings.ttsEngine === 'elevenlabs' ? 'selected' : ''}>ElevenLabs (premium)</option>
          <option value="edge" ${settings.ttsEngine === 'edge' ? 'selected' : ''}>Edge TTS (najlepsze glosy)</option>
          <option value="google" ${settings.ttsEngine === 'google' ? 'selected' : ''}>Google TTS</option>
          <option value="piper" ${settings.ttsEngine === 'piper' ? 'selected' : ''}>Piper (offline)</option>
        </select>
      </label></div>
      <div class="sm-form-row"><label>Domyslny jezyk TTS:
        <select id="set-tts-lang" class="sm-input" style="max-width:200px;">
          <option value="pl" ${(settings.ttsLanguage || 'pl') === 'pl' ? 'selected' : ''}>Polski</option>
          <option value="en" ${settings.ttsLanguage === 'en' ? 'selected' : ''}>English</option>
          <option value="de" ${settings.ttsLanguage === 'de' ? 'selected' : ''}>Deutsch</option>
        </select>
      </label></div>
      <div id="elevenlabs-settings" style="display: ${settings.ttsEngine === 'elevenlabs' ? 'block' : 'none'}; border: 1px solid var(--sm-border); border-radius: 8px; padding: 12px; margin-top: 8px; background: var(--sm-bg-light);">
        <h4 style="margin-bottom: 8px; font-size: 0.9rem;">ElevenLabs</h4>
        <div class="sm-form-row"><label>API Key:
          <input type="password" id="set-el-apikey" class="sm-input" style="max-width:300px;" value="${esc(settings.elevenlabsApiKey || '')}" placeholder="sk_...">
        </label></div>
        <div class="sm-form-row"><label>Glos:
          <select id="set-el-voice" class="sm-input" style="max-width:250px;">
            <option value="">Ladowanie...</option>
          </select>
          <button onclick="loadElevenLabsVoices()" class="sm-btn sm-btn--small" style="margin-left:4px;">Odswiez</button>
        </label></div>
        <p style="font-size: 0.78rem; color: var(--sm-text-muted); margin-top: 4px;">
          Darmowy plan: 10 000 zn./mies. (~10 min audio). <a href="https://elevenlabs.io" target="_blank" style="color: var(--sm-primary);">elevenlabs.io</a>
        </p>
      </div>
      <button onclick="saveTtsSettings()" class="sm-btn sm-btn--primary sm-btn--small" style="margin-top:8px;">Zapisz</button>
    `;
    // Load ElevenLabs voices if key is present
    if (settings.elevenlabsApiKey) {
      loadElevenLabsVoices(settings.elevenlabsVoiceId);
    }
  }

  // Backup settings
  loadBackupSettings();

  // Info panel
  const infoContainer = document.getElementById('settings-info');
  if (infoContainer) {
    const defaultPl = await API.get('/playlists').then(pl => pl.find(p => p.is_default));
    const calToday = await API.get('/schedule/calendar/today').catch(() => null);
    infoContainer.innerHTML = `
      <div style="font-size:0.85rem;">
        <div style="margin-bottom:6px;"><strong>Domyslna playlista:</strong> ${defaultPl ? esc(defaultPl.name) : '<em>brak</em>'}</div>
        <div style="margin-bottom:6px;"><strong>Playlista na dzis:</strong> ${calToday ? esc(calToday.playlist_name) : '<em>domyslna</em>'}</div>
        <div style="margin-bottom:6px;"><strong>Crossfade:</strong> ${(settings.crossfadeDurationMs || 0) > 0 ? (settings.crossfadeDurationMs / 1000) + 's' : 'wylaczony'}</div>
        <div><strong>Auto-play/stop:</strong> ${settings.autoPlayOnOpen ? 'Tak' : 'Nie'} / ${settings.autoStopOnClose ? 'Tak' : 'Nie'}</div>
      </div>
    `;
  }
}

async function saveSettings() {
  const data = {
    autoPlayOnOpen: document.getElementById('set-auto-play').checked,
    autoStopOnClose: document.getElementById('set-auto-stop').checked,
    volume: parseInt(document.getElementById('set-volume').value),
    announcementFadeDurationMs: parseInt(document.getElementById('set-fade').value),
    crossfadeDurationMs: parseInt(document.getElementById('set-crossfade').value),
  };
  await API.put('/schedule/settings', data);
  await smAlert('Zapisano!');
  loadSettings();
}

function toggleElevenLabsSettings() {
  const engine = document.getElementById('set-tts-engine').value;
  const el = document.getElementById('elevenlabs-settings');
  if (el) el.style.display = engine === 'elevenlabs' ? 'block' : 'none';
}

async function loadElevenLabsVoices(selectedVoiceId) {
  const select = document.getElementById('set-el-voice');
  if (!select) return;

  // If API key field exists, temporarily save it so the endpoint can use it
  const apiKeyInput = document.getElementById('set-el-apikey');
  if (apiKeyInput && apiKeyInput.value) {
    await API.put('/schedule/settings', { elevenlabsApiKey: apiKeyInput.value });
  }

  try {
    const voices = await API.get('/announcements/tts/elevenlabs/voices');
    if (voices.length === 0) {
      select.innerHTML = '<option value="">Brak glosow (sprawdz klucz API)</option>';
      return;
    }
    const premade = voices.filter(v => v.category === 'premade' || v.category === 'cloned');
    const library = voices.filter(v => v.category !== 'premade' && v.category !== 'cloned');

    let html = '';
    if (premade.length > 0) {
      html += '<optgroup label="Dostepne (wbudowane + sklonowane)">';
      html += premade.map(v => {
        const lang = v.labels?.language || '';
        const sel = v.id === selectedVoiceId ? ' selected' : '';
        return `<option value="${v.id}"${sel}>${esc(v.name)}${lang ? ` (${lang})` : ''}</option>`;
      }).join('');
      html += '</optgroup>';
    }
    if (library.length > 0) {
      html += '<optgroup label="Biblioteka (wymaga platnego planu)">';
      html += library.map(v => {
        const lang = v.labels?.language || '';
        const sel = v.id === selectedVoiceId ? ' selected' : '';
        return `<option value="${v.id}"${sel}>${esc(v.name)}${lang ? ` (${lang})` : ''} [platny]</option>`;
      }).join('');
      html += '</optgroup>';
    }
    select.innerHTML = html || '<option value="">Brak glosow</option>';
  } catch {
    select.innerHTML = '<option value="">Blad ladowania glosow</option>';
  }
}

async function saveTtsSettings() {
  const data = {
    ttsEngine: document.getElementById('set-tts-engine').value,
    ttsLanguage: document.getElementById('set-tts-lang').value,
  };

  // ElevenLabs settings
  const apiKeyInput = document.getElementById('set-el-apikey');
  const voiceSelect = document.getElementById('set-el-voice');
  if (apiKeyInput) data.elevenlabsApiKey = apiKeyInput.value;
  if (voiceSelect && voiceSelect.value) data.elevenlabsVoiceId = voiceSelect.value;

  await API.put('/schedule/settings', data);
  await smAlert('Zapisano!');
}

// --- Match Days ---
let matchdayDates = [];

async function loadMatchDays() {
  const container = document.getElementById('matchday-section');
  const template = await API.get('/schedule/matchdays/template');
  const lineup = await API.get('/schedule/matchdays/lineup');

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
        <div class="sm-form-row" style="flex:1; min-width: 120px; margin-bottom: 0;">
          <label>Godz. meczu: <input type="time" id="md-match-time" value="${template.match_time || '18:00'}"></label>
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

      <div style="border-top: 1px solid var(--sm-border); padding-top: 12px; margin-top: 16px;">
        <h4 style="margin-bottom: 8px;">Sklad meczowy (TTS)</h4>
        <p style="font-size: 0.82rem; color: var(--sm-text-muted); margin-bottom: 8px;">
          Wklej tekst skladu — system wygeneruje komunikat glosowy i pusci go automatycznie co 10 min przed meczem.
          Mozesz tez wrzucic tekst do pliku <code>data/matchday/lineup.txt</code> — system sam go wykryje.
        </p>
        <div class="sm-form-row" style="margin-bottom: 8px;">
          <textarea id="md-lineup-text" rows="5" style="width:100%; font-size: 0.9rem; background: var(--sm-bg-light); color: var(--sm-text); border: 1px solid var(--sm-border); border-radius: 6px; padding: 8px; resize: vertical;"
            placeholder="np. Dzisiejszy sklad na mecz z Legią: Bramka: Skorupski. Obrona: Dawidowicz, Bednarek...">${esc(lineup.text || '')}</textarea>
        </div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
          <div class="sm-form-row" style="margin-bottom: 0;">
            <label style="font-size: 0.82rem;">Przed meczem (min):
              <input type="number" id="md-lineup-before" value="60" min="5" max="180" style="width: 60px;">
            </label>
          </div>
          <div class="sm-form-row" style="margin-bottom: 0;">
            <label style="font-size: 0.82rem;">Powtarzaj co (min):
              <input type="number" id="md-lineup-repeat" value="10" min="1" max="60" style="width: 60px;">
            </label>
          </div>
          <button onclick="submitLineup()" class="sm-btn sm-btn--primary sm-btn--small">Generuj i zaplanuj</button>
          <button onclick="saveLineupFile()" class="sm-btn sm-btn--small" title="Zapisz tekst do pliku (bez generowania)">Zapisz tekst</button>
        </div>
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
    match_time: document.getElementById('md-match-time').value,
    label: document.getElementById('md-label').value,
  });
  await smAlert('Szablon zapisany!');
}

async function submitLineup() {
  const text = document.getElementById('md-lineup-text').value.trim();
  if (!text) return await smAlert('Wpisz tekst skladu');
  const minutesBefore = parseInt(document.getElementById('md-lineup-before').value) || 60;
  const repeatInterval = parseInt(document.getElementById('md-lineup-repeat').value) || 10;

  if (!await smConfirm(`Wygenerowac komunikat glosowy ze skladu i zaplanowac odtwarzanie co ${repeatInterval} min, ${minutesBefore} min przed meczem?`)) return;

  try {
    await API.post('/schedule/matchdays/lineup', {
      text,
      minutes_before: minutesBefore,
      repeat_interval: repeatInterval,
    });
    await smAlert('Komunikat wygenerowany i zaplanowany!');
  } catch (err) {
    await smAlert('Blad: ' + err.message);
  }
}

async function saveLineupFile() {
  const text = document.getElementById('md-lineup-text').value;
  await API.put('/schedule/matchdays/lineup', { text });
  await smAlert('Tekst zapisany do pliku');
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
    const matchTime = document.getElementById('md-match-time')?.value || '18:00';
    await API.post('/schedule/matchdays/apply', { dates: matchdayDates, match_time: matchTime });
    matchdayDates = [];
    renderMatchdayDates();
    await loadExceptions();
    await loadTimeline();
    await smAlert('Daty meczowe dodane do wyjatkow!');
  } catch (err) {
    await smAlert('Blad: ' + err.message);
  }
}

// ==================== BACKUP ====================

const DAY_LABELS = ['Niedziela','Poniedzialek','Wtorek','Sroda','Czwartek','Piatek','Sobota'];

async function loadBackupSettings() {
  const container = document.getElementById('backup-settings');
  if (!container) return;

  try {
    const s = await API.get('/backup/settings');

    container.innerHTML = `
      <div class="sm-form-row"><label><input type="checkbox" id="bk-enabled" ${s.backup_enabled ? 'checked' : ''}>
        Automatyczna kopia zapasowa</label></div>

      <div id="bk-schedule-opts" style="${s.backup_enabled ? '' : 'display:none;'}">
        <div class="sm-form-row" style="display:flex;gap:8px;">
          <label style="flex:1;">Dzien tygodnia:
            <select id="bk-day" class="sm-input">
              ${DAY_LABELS.map((d,i) => `<option value="${i}" ${Number(s.backup_day) === i ? 'selected' : ''}>${d}</option>`).join('')}
            </select>
          </label>
          <label style="flex:1;">Godzina:
            <input type="time" id="bk-hour" class="sm-input" value="${s.backup_hour || '03:00'}">
          </label>
          <label style="flex:1;">Ile kopii:
            <input type="number" id="bk-keep" class="sm-input" value="${s.backup_keep || 4}" min="1" max="52">
          </label>
        </div>

        <div class="sm-form-row"><label>Cele kopii zapasowej:</label>
          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:4px;">
            <label><input type="checkbox" class="bk-dest-cb" value="local" ${(s.backup_destinations || ['local']).includes('local') ? 'checked' : ''} onchange="backupDestChange()"> Lokalnie</label>
            <label><input type="checkbox" class="bk-dest-cb" value="ftp" ${(s.backup_destinations || []).includes('ftp') ? 'checked' : ''} onchange="backupDestChange()"> FTP</label>
            <label><input type="checkbox" class="bk-dest-cb" value="smb" ${(s.backup_destinations || []).includes('smb') ? 'checked' : ''} onchange="backupDestChange()"> SMB/NFS</label>
            <label><input type="checkbox" class="bk-dest-cb" value="email" ${(s.backup_destinations || []).includes('email') ? 'checked' : ''} onchange="backupDestChange()"> Email</label>
          </div>
        </div>

        <div id="bk-ftp-opts" class="bk-dest-panel" style="display:${(s.backup_destinations || []).includes('ftp') ? 'block' : 'none'}; border:1px solid var(--sm-border); border-radius:8px; padding:12px; margin:8px 0; background:var(--sm-bg-light);">
          <h4 style="margin-bottom:8px; font-size:0.9rem;">FTP</h4>
          <div class="sm-form-row" style="display:flex;gap:8px;">
            <label style="flex:2;">Host: <input type="text" id="bk-ftp-host" class="sm-input" value="${esc(s.backup_ftp_host || '')}" placeholder="ftp.example.com"></label>
            <label style="flex:1;">Port: <input type="number" id="bk-ftp-port" class="sm-input" value="${s.backup_ftp_port || 21}"></label>
          </div>
          <div class="sm-form-row" style="display:flex;gap:8px;">
            <label style="flex:1;">Uzytkownik: <input type="text" id="bk-ftp-user" class="sm-input" value="${esc(s.backup_ftp_user || '')}"></label>
            <label style="flex:1;">Haslo: <input type="password" id="bk-ftp-pass" class="sm-input" value="${esc(s.backup_ftp_pass || '')}"></label>
          </div>
          <div class="sm-form-row"><label>Sciezka: <input type="text" id="bk-ftp-path" class="sm-input" value="${esc(s.backup_ftp_path || '/backups')}" style="max-width:250px;"></label></div>
          <button onclick="testBackupDest('ftp')" class="sm-btn sm-btn--small">Testuj polaczenie</button>
        </div>

        <div id="bk-smb-opts" class="bk-dest-panel" style="display:${(s.backup_destinations || []).includes('smb') ? 'block' : 'none'}; border:1px solid var(--sm-border); border-radius:8px; padding:12px; margin:8px 0; background:var(--sm-bg-light);">
          <h4 style="margin-bottom:8px; font-size:0.9rem;">Zasob sieciowy (SMB/NFS)</h4>
          <div class="sm-form-row"><label>Adres zasobu:
            <input type="text" id="bk-smb-share" class="sm-input" value="${esc(s.backup_smb_share || '')}" placeholder="//192.168.1.100/backup" style="max-width:350px;">
          </label></div>
          <div class="sm-form-row" style="display:flex;gap:8px;">
            <label style="flex:1;">Uzytkownik: <input type="text" id="bk-smb-user" class="sm-input" value="${esc(s.backup_smb_user || '')}" placeholder="user"></label>
            <label style="flex:1;">Haslo: <input type="password" id="bk-smb-pass" class="sm-input" value="${esc(s.backup_smb_pass || '')}"></label>
          </div>
          <div class="sm-form-row"><label>Domena (opcjonalnie):
            <input type="text" id="bk-smb-domain" class="sm-input" value="${esc(s.backup_smb_domain || '')}" placeholder="WORKGROUP" style="max-width:200px;">
          </label></div>
          <div class="sm-form-row"><label>Sciezka docelowa na zasobie:
            <input type="text" id="bk-smb-path" class="sm-input" value="${esc(s.backup_smb_path || '/backups')}" placeholder="/backups" style="max-width:250px;">
          </label></div>
          <p style="font-size:0.78rem; color:var(--sm-text-muted);">Adres w formacie //IP/nazwa_udzialu. Zasob zostanie zamontowany automatycznie.</p>
          <button onclick="testBackupDest('smb')" class="sm-btn sm-btn--small">Testuj polaczenie</button>
        </div>

        <div id="bk-email-opts" class="bk-dest-panel" style="display:${(s.backup_destinations || []).includes('email') ? 'block' : 'none'}; border:1px solid var(--sm-border); border-radius:8px; padding:12px; margin:8px 0; background:var(--sm-bg-light);">
          <h4 style="margin-bottom:8px; font-size:0.9rem;">Email (SMTP)</h4>
          <div class="sm-form-row"><label>Adres odbiorcy:
            <input type="email" id="bk-email-to" class="sm-input" value="${esc(s.backup_email_to || '')}" placeholder="admin@example.com" style="max-width:300px;">
          </label></div>
          <div class="sm-form-row" style="display:flex;gap:8px;">
            <label style="flex:2;">Serwer SMTP: <input type="text" id="bk-smtp-host" class="sm-input" value="${esc(s.backup_email_smtp_host || '')}" placeholder="smtp.gmail.com"></label>
            <label style="flex:1;">Port: <input type="number" id="bk-smtp-port" class="sm-input" value="${s.backup_email_smtp_port || 587}"></label>
          </div>
          <div class="sm-form-row" style="display:flex;gap:8px;">
            <label style="flex:1;">Uzytkownik SMTP: <input type="text" id="bk-smtp-user" class="sm-input" value="${esc(s.backup_email_smtp_user || '')}"></label>
            <label style="flex:1;">Haslo SMTP: <input type="password" id="bk-smtp-pass" class="sm-input" value="${esc(s.backup_email_smtp_pass || '')}"></label>
          </div>
          <div class="sm-form-row"><label><input type="checkbox" id="bk-smtp-secure" ${s.backup_email_smtp_secure ? 'checked' : ''}> SSL/TLS (port 465)</label></div>
          <p style="font-size:0.78rem; color:var(--sm-text-muted);">Backup musi byc mniejszy niz 25MB. Wieksze kopie — uzyj FTP lub zasobu sieciowego.</p>
          <button onclick="testBackupDest('email')" class="sm-btn sm-btn--small">Testuj SMTP</button>
        </div>
      </div>

      <div id="bk-test-result" style="font-size:0.85rem; margin:8px 0;"></div>

      ${s.backup_last_date ? `
        <div style="font-size:0.82rem; color:var(--sm-text-muted); margin:8px 0; padding:8px; border-radius:6px; background:var(--sm-bg-light);">
          Ostatni backup: ${new Date(s.backup_last_date).toLocaleString('pl-PL')}
          ${s.backup_last_status === 'ok' ? ' — <span style="color:#22c55e;">OK</span>' : ` — <span style="color:#dc2626;">${esc(s.backup_last_status || '')}</span>`}
          ${s.backup_last_size ? ` (${(s.backup_last_size / 1024).toFixed(0)} KB)` : ''}
        </div>
      ` : ''}

      <button onclick="saveBackupSettings()" class="sm-btn sm-btn--primary sm-btn--small" style="margin-top:8px;">Zapisz ustawienia</button>
    `;

    document.getElementById('bk-enabled').onchange = () => {
      document.getElementById('bk-schedule-opts').style.display = document.getElementById('bk-enabled').checked ? '' : 'none';
    };

    loadBackupList();
  } catch (err) {
    container.innerHTML = '<div style="color:#dc2626; padding:8px;">' + (err.message || 'Blad') + '</div>';
  }
}

function backupDestChange() {
  const checked = Array.from(document.querySelectorAll('.bk-dest-cb:checked')).map(function(cb) { return cb.value; });
  document.querySelectorAll('.bk-dest-panel').forEach(function(el) { el.style.display = 'none'; });
  checked.forEach(function(dest) {
    var panel = document.getElementById('bk-' + dest + '-opts');
    if (panel) panel.style.display = 'block';
  });
}

async function saveBackupSettings() {
  const data = {
    backup_enabled: document.getElementById('bk-enabled').checked,
    backup_day: parseInt(document.getElementById('bk-day')?.value || 0),
    backup_hour: document.getElementById('bk-hour')?.value || '03:00',
    backup_keep: parseInt(document.getElementById('bk-keep')?.value || 4),
    backup_destinations: Array.from(document.querySelectorAll('.bk-dest-cb:checked')).map(function(cb) { return cb.value; }),
    backup_ftp_host: document.getElementById('bk-ftp-host')?.value || '',
    backup_ftp_port: parseInt(document.getElementById('bk-ftp-port')?.value || 21),
    backup_ftp_user: document.getElementById('bk-ftp-user')?.value || '',
    backup_ftp_pass: document.getElementById('bk-ftp-pass')?.value || '',
    backup_ftp_path: document.getElementById('bk-ftp-path')?.value || '/backups',
    backup_smb_share: document.getElementById('bk-smb-share')?.value || '',
    backup_smb_user: document.getElementById('bk-smb-user')?.value || '',
    backup_smb_pass: document.getElementById('bk-smb-pass')?.value || '',
    backup_smb_domain: document.getElementById('bk-smb-domain')?.value || '',
    backup_smb_path: document.getElementById('bk-smb-path')?.value || '/backups',
    backup_email_to: document.getElementById('bk-email-to')?.value || '',
    backup_email_smtp_host: document.getElementById('bk-smtp-host')?.value || '',
    backup_email_smtp_port: parseInt(document.getElementById('bk-smtp-port')?.value || 587),
    backup_email_smtp_user: document.getElementById('bk-smtp-user')?.value || '',
    backup_email_smtp_pass: document.getElementById('bk-smtp-pass')?.value || '',
    backup_email_smtp_secure: document.getElementById('bk-smtp-secure')?.checked || false,
  };

  try {
    await API.put('/backup/settings', data);
    await smAlert('Zapisano ustawienia kopii zapasowej!');
    loadBackupSettings();
  } catch (err) {
    await smAlert('Blad: ' + err.message);
  }
}

async function testBackupDest(dest) {
  const resultEl = document.getElementById('bk-test-result');
  resultEl.textContent = 'Testowanie...';
  resultEl.style.color = 'var(--sm-text)';

  const body = { destination: dest };
  if (dest === 'ftp') {
    body.ftp_host = document.getElementById('bk-ftp-host').value;
    body.ftp_port = parseInt(document.getElementById('bk-ftp-port').value || 21);
    body.ftp_user = document.getElementById('bk-ftp-user').value;
    body.ftp_pass = document.getElementById('bk-ftp-pass').value;
    body.ftp_path = document.getElementById('bk-ftp-path').value;
  } else if (dest === 'smb') {
    body.smb_share = document.getElementById('bk-smb-share').value;
    body.smb_user = document.getElementById('bk-smb-user').value;
    body.smb_pass = document.getElementById('bk-smb-pass').value;
    body.smb_domain = document.getElementById('bk-smb-domain').value;
    body.smb_path = document.getElementById('bk-smb-path').value;
  } else if (dest === 'email') {
    body.smtp_host = document.getElementById('bk-smtp-host').value;
    body.smtp_port = parseInt(document.getElementById('bk-smtp-port').value || 587);
    body.smtp_user = document.getElementById('bk-smtp-user').value;
    body.smtp_pass = document.getElementById('bk-smtp-pass').value;
    body.smtp_secure = document.getElementById('bk-smtp-secure').checked;
  }

  try {
    const res = await API.post('/backup/test', body);
    resultEl.textContent = res.message;
    resultEl.style.color = '#22c55e';
  } catch (err) {
    resultEl.textContent = 'Blad: ' + err.message;
    resultEl.style.color = '#dc2626';
  }
}

async function runBackupNow() {
  if (!await smConfirm('Wykonac kopie zapasowa teraz?')) return;
  const btn = document.querySelector('[onclick="runBackupNow()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Tworzenie...'; }

  try {
    const res = await API.post('/backup/run');
    await smAlert('Kopia utworzona: ' + res.filename + ' (' + (res.size / 1024).toFixed(0) + ' KB)');
    loadBackupSettings();
  } catch (err) {
    await smAlert('Blad: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Wykonaj teraz'; }
  }
}

async function loadBackupList() {
  const container = document.getElementById('backup-list');
  if (!container) return;

  try {
    const backups = await API.get('/backup/list');
    if (backups.length === 0) {
      container.innerHTML = '<p class="sm-empty" style="padding:4px 0;">Brak kopii zapasowych</p>';
      return;
    }

    let html = '<h4 style="font-size:0.9rem; margin-bottom:8px;">Kopie lokalne</h4>';
    html += '<table class="sm-table"><thead><tr><th>Plik</th><th>Rozmiar</th><th>Data</th><th>Akcje</th></tr></thead><tbody>';
    for (const b of backups) {
      const sizeKb = (b.size / 1024).toFixed(0);
      const date = new Date(b.date).toLocaleString('pl-PL');
      html += '<tr>' +
        '<td style="font-size:0.82rem;">' + esc(b.filename) + '</td>' +
        '<td>' + sizeKb + ' KB</td>' +
        '<td style="font-size:0.82rem;">' + date + '</td>' +
        '<td>' +
          '<a href="/api/backup/download/' + encodeURIComponent(b.filename) + '" class="sm-btn sm-btn--small" download>Pobierz</a> ' +
          '<button onclick="deleteBackup(\'' + esc(b.filename) + '\')" class="sm-btn sm-btn--danger sm-btn--small">Usun</button>' +
        '</td>' +
      '</tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<div style="color:#dc2626; font-size:0.85rem;">' + (err.message || 'Blad') + '</div>';
  }
}

async function deleteBackup(filename) {
  if (!await smConfirm('Usunac kopie ' + filename + '?')) return;
  await API.del('/backup/' + encodeURIComponent(filename));
  loadBackupList();
}
