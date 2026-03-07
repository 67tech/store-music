// Playlist Calendar — assign playlists to specific dates

let _calendarMonth = new Date(); // current viewing month
let _calendarEntries = {}; // { 'YYYY-MM-DD': { playlist_id, playlist_name, label } }
let _calendarPlaylists = []; // cached playlists for selector
let _calendarSelectedDate = null;

async function initCalendar() {
  await loadCalendarPlaylists();
  renderCalendar();
  loadCalendarEntries();
}

async function loadCalendarPlaylists() {
  _calendarPlaylists = await API.get('/playlists');
}

async function loadCalendarEntries() {
  const y = _calendarMonth.getFullYear();
  const m = _calendarMonth.getMonth();
  // Load 3 months range
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const endD = new Date(y, m + 2, 0);
  const end = endD.toISOString().split('T')[0];

  const entries = await API.get(`/schedule/calendar?start=${start}&end=${end}`);
  _calendarEntries = {};
  for (const e of entries) {
    _calendarEntries[e.date] = e;
  }
  renderCalendar();
}

function renderCalendar() {
  const container = document.getElementById('calendar-grid');
  if (!container) return;

  const y = _calendarMonth.getFullYear();
  const m = _calendarMonth.getMonth();
  const today = new Date().toISOString().split('T')[0];

  const monthName = new Date(y, m).toLocaleDateString('pl-PL', { year: 'numeric', month: 'long' });

  const firstDay = new Date(y, m, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  // Adjust: week starts on Monday
  const startOffset = (firstDay + 6) % 7;

  let html = `
    <div class="sm-cal-nav">
      <button onclick="calendarPrevMonth()" class="sm-btn sm-btn--small">&laquo;</button>
      <strong class="sm-cal-month-label">${monthName}</strong>
      <button onclick="calendarNextMonth()" class="sm-btn sm-btn--small">&raquo;</button>
    </div>
    <div class="sm-cal-weekdays">
      <span>Pn</span><span>Wt</span><span>Sr</span><span>Cz</span><span>Pt</span><span>Sb</span><span>Nd</span>
    </div>
    <div class="sm-cal-days">`;

  // Empty cells before first day
  for (let i = 0; i < startOffset; i++) {
    html += '<div class="sm-cal-day sm-cal-day--empty"></div>';
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const entry = _calendarEntries[dateStr];
    const isToday = dateStr === today;
    const isSelected = dateStr === _calendarSelectedDate;
    const isPast = dateStr < today;

    let classes = 'sm-cal-day';
    if (isToday) classes += ' sm-cal-day--today';
    if (isSelected) classes += ' sm-cal-day--selected';
    if (entry) classes += ' sm-cal-day--assigned';
    if (isPast) classes += ' sm-cal-day--past';

    html += `<div class="${classes}" onclick="selectCalendarDate('${dateStr}')">
      <span class="sm-cal-day-num">${d}</span>
      ${entry ? `<span class="sm-cal-day-playlist" title="${esc(entry.playlist_name)}">${esc(entry.playlist_name)}</span>` : ''}
      ${entry && entry.label ? `<span class="sm-cal-day-label">${esc(entry.label)}</span>` : ''}
    </div>`;
  }

  html += '</div>';
  container.innerHTML = html;
}

function calendarPrevMonth() {
  _calendarMonth.setMonth(_calendarMonth.getMonth() - 1);
  loadCalendarEntries();
}

function calendarNextMonth() {
  _calendarMonth.setMonth(_calendarMonth.getMonth() + 1);
  loadCalendarEntries();
}

function selectCalendarDate(dateStr) {
  _calendarSelectedDate = dateStr;
  renderCalendar();
  renderDatePanel(dateStr);
}

function renderDatePanel(dateStr) {
  const panel = document.getElementById('calendar-date-panel');
  if (!panel) return;

  const entry = _calendarEntries[dateStr];
  const dayName = new Date(dateStr + 'T12:00:00').toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const playlistOptions = _calendarPlaylists.map(p =>
    `<option value="${p.id}" ${entry && entry.playlist_id === p.id ? 'selected' : ''}>${esc(p.name)} (${p.trackCount} utw.)</option>`
  ).join('');

  html = `
    <div class="sm-card">
      <div class="sm-card-header"><h3>${dayName}</h3></div>
      <div style="padding: 12px;">
        ${entry ? `<div class="sm-cal-current-info">
          <span class="sm-badge sm-badge--tts">Przypisana</span>
          <strong>${esc(entry.playlist_name)}</strong>
          ${entry.label ? `<span class="sm-text-muted"> — ${esc(entry.label)}</span>` : ''}
          <span class="sm-text-muted">(${entry.track_count || 0} utworow)</span>
        </div>` : '<p class="sm-text-muted" style="margin:0 0 12px;">Brak przypisanej playlisty — gra domyslna.</p>'}

        <div class="sm-form-row">
          <label>Playlista na ten dzien:</label>
          <div style="display:flex;gap:8px;align-items:center;">
            <select id="cal-playlist-select" class="sm-input" style="flex:1;" onchange="calPlaylistSelectChanged()">
              <option value="">-- domyslna --</option>
              ${playlistOptions}
            </select>
            <button id="cal-edit-playlist-btn" onclick="editCalendarPlaylist()" class="sm-btn sm-btn--small" style="${entry ? '' : 'display:none;'}">Edytuj</button>
            <button onclick="showCalendarNewPlaylist('${dateStr}')" class="sm-btn sm-btn--small">+ Nowa</button>
          </div>
        </div>
        <div class="sm-form-row">
          <label>Etykieta (opcjonalnie):
            <input type="text" id="cal-label" class="sm-input" value="${entry ? esc(entry.label || '') : ''}" placeholder="np. Promocja, Wydarzenie...">
          </label>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button onclick="saveCalendarDate('${dateStr}')" class="sm-btn sm-btn--primary sm-btn--small">Zapisz</button>
          ${entry ? `<button onclick="removeCalendarDate('${dateStr}')" class="sm-btn sm-btn--danger sm-btn--small">Usun przypisanie</button>` : ''}
          <button onclick="showBulkAssign('${dateStr}')" class="sm-btn sm-btn--small">Zastosuj na wiecej dni</button>
        </div>
      </div>
    </div>

    <div class="sm-card" style="margin-top:12px;">
      <div class="sm-card-header"><h3>Komunikaty na ten dzien</h3></div>
      <div id="cal-date-announcements" style="padding:8px 12px;"></div>
      <div style="padding:4px 12px 12px;">
        <button onclick="addDateAnnouncement('${dateStr}')" class="sm-btn sm-btn--small">+ Dodaj komunikat</button>
      </div>
    </div>

    <div class="sm-card" style="margin-top:12px;">
      <div class="sm-card-header"><h3>Paczki reklam</h3></div>
      <div id="cal-date-ad-packs" style="padding:8px 12px;"></div>
    </div>

    <div class="sm-card" style="margin-top:12px;">
      <div class="sm-card-header"><h3>Paczki komunikatow</h3></div>
      <div id="cal-date-ann-packs" style="padding:8px 12px;"></div>
    </div>
  `;

  panel.innerHTML = html;
  loadDateAnnouncements(dateStr);
  loadDatePacks(dateStr);
}

async function saveCalendarDate(dateStr) {
  const playlistId = document.getElementById('cal-playlist-select').value;
  const label = document.getElementById('cal-label').value.trim();

  if (!playlistId) {
    // Remove assignment
    await API.del(`/schedule/calendar/${dateStr}`);
    delete _calendarEntries[dateStr];
  } else {
    const entry = await API.post('/schedule/calendar', {
      date: dateStr,
      playlist_id: parseInt(playlistId),
      label,
    });
    _calendarEntries[dateStr] = entry;
  }
  renderCalendar();
  renderDatePanel(dateStr);
}

async function removeCalendarDate(dateStr) {
  if (!await smConfirm('Usunac przypisanie playlisty z tego dnia?')) return;
  await API.del(`/schedule/calendar/${dateStr}`);
  delete _calendarEntries[dateStr];
  renderCalendar();
  renderDatePanel(dateStr);
}

function calPlaylistSelectChanged() {
  const sel = document.getElementById('cal-playlist-select');
  const btn = document.getElementById('cal-edit-playlist-btn');
  if (btn) btn.style.display = sel.value ? '' : 'none';
}

function editCalendarPlaylist() {
  const sel = document.getElementById('cal-playlist-select');
  const id = parseInt(sel.value);
  if (id && typeof viewPlaylist === 'function') viewPlaylist(id);
}

function showBulkAssign(fromDate) {
  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modal-body');

  const playlistOptions = _calendarPlaylists.map(p =>
    `<option value="${p.id}">${esc(p.name)} (${p.trackCount} utw.)</option>`
  ).join('');

  const currentEntry = _calendarEntries[fromDate];
  const preselectedPlaylist = currentEntry ? currentEntry.playlist_id : '';
  const preselectedLabel = currentEntry ? (currentEntry.label || '') : '';

  modalBody.innerHTML = `
    <h2>Zastosuj playlistę na wiele dni</h2>
    <div class="sm-form-row">
      <label>Playlista:
        <select id="bulk-playlist" class="sm-input">
          ${playlistOptions}
        </select>
      </label>
    </div>
    <div class="sm-form-row">
      <label>Etykieta:
        <input type="text" id="bulk-label" class="sm-input" value="${esc(preselectedLabel)}" placeholder="np. Tydzien promocyjny">
      </label>
    </div>
    <div class="sm-form-row">
      <label>Wybierz daty:</label>
      <div id="bulk-dates-picker" style="margin-top:8px;">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
          <input type="date" id="bulk-date-from" class="sm-input" value="${fromDate}">
          <span>do</span>
          <input type="date" id="bulk-date-to" class="sm-input" value="${fromDate}">
        </div>
        <div class="sm-form-row">
          <label>Dni tygodnia:</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">
            <label><input type="checkbox" class="bulk-day-cb" value="1" checked> Pn</label>
            <label><input type="checkbox" class="bulk-day-cb" value="2" checked> Wt</label>
            <label><input type="checkbox" class="bulk-day-cb" value="3" checked> Sr</label>
            <label><input type="checkbox" class="bulk-day-cb" value="4" checked> Cz</label>
            <label><input type="checkbox" class="bulk-day-cb" value="5" checked> Pt</label>
            <label><input type="checkbox" class="bulk-day-cb" value="6" checked> Sb</label>
            <label><input type="checkbox" class="bulk-day-cb" value="0"> Nd</label>
          </div>
        </div>
      </div>
    </div>
    <div id="bulk-assign-status" style="color:#dc2626;font-size:0.85rem;margin:8px 0;"></div>
    <button onclick="submitBulkAssign()" class="sm-btn sm-btn--primary">Zastosuj</button>
  `;

  if (preselectedPlaylist) {
    document.getElementById('bulk-playlist').value = preselectedPlaylist;
  }

  modal.classList.add('sm-modal--open');
}

async function submitBulkAssign() {
  const playlistId = document.getElementById('bulk-playlist').value;
  const label = document.getElementById('bulk-label').value.trim();
  const from = document.getElementById('bulk-date-from').value;
  const to = document.getElementById('bulk-date-to').value;
  const statusEl = document.getElementById('bulk-assign-status');

  if (!playlistId || !from || !to) {
    statusEl.textContent = 'Wybierz playlistę i zakres dat';
    return;
  }

  const selectedDays = Array.from(document.querySelectorAll('.bulk-day-cb:checked')).map(cb => parseInt(cb.value));
  if (selectedDays.length === 0) {
    statusEl.textContent = 'Wybierz przynajmniej jeden dzień tygodnia';
    return;
  }

  // Generate date list
  const dates = [];
  const d = new Date(from + 'T12:00:00');
  const endD = new Date(to + 'T12:00:00');
  while (d <= endD) {
    const dow = d.getDay();
    if (selectedDays.includes(dow)) {
      dates.push(d.toISOString().split('T')[0]);
    }
    d.setDate(d.getDate() + 1);
  }

  if (dates.length === 0) {
    statusEl.textContent = 'Brak dat pasujących do wybranych dni tygodnia';
    return;
  }

  statusEl.textContent = `Zapisywanie ${dates.length} dni...`;

  try {
    await API.post('/schedule/calendar/bulk', {
      dates,
      playlist_id: parseInt(playlistId),
      label,
    });
    document.getElementById('modal').classList.remove('sm-modal--open');
    await loadCalendarEntries();
    if (_calendarSelectedDate) renderDatePanel(_calendarSelectedDate);
  } catch (err) {
    statusEl.textContent = err.message;
  }
}

// Date-specific announcements (uses existing specific_date trigger)
async function loadDateAnnouncements(dateStr) {
  const container = document.getElementById('cal-date-announcements');
  if (!container) return;

  try {
    const scheduled = await API.get('/announcements/scheduled');
    const forDate = scheduled.filter(sa => {
      if (sa.trigger_type !== 'specific_date') return false;
      const [date] = sa.trigger_value.split(' ');
      return date === dateStr;
    });

    if (forDate.length === 0) {
      container.innerHTML = '<p class="sm-text-muted" style="margin:0;">Brak komunikatow na ten dzien.</p>';
      return;
    }

    let html = '';
    for (const sa of forDate) {
      const time = sa.trigger_value.split(' ')[1] || '';
      const playModeIcon = (sa.play_mode || 'interrupt') === 'queue' ? '&#9654;' : '&#9889;';
      html += `<div class="sm-scheduled-ad" style="padding:6px 0;">
        <div class="sm-scheduled-ad-time">${time}</div>
        <div class="sm-scheduled-ad-info">
          <div class="sm-scheduled-ad-title">${esc(sa.announcement_name)}</div>
          <div class="sm-scheduled-ad-meta">${playModeIcon} ${(sa.play_mode || 'interrupt') === 'queue' ? 'Kolejka' : 'Przerwij'}</div>
        </div>
        <button onclick="deleteScheduledFromCalendar(${sa.id}, '${dateStr}')" class="sm-btn sm-btn--danger sm-btn--small" title="Usun">&#10005;</button>
      </div>`;
    }
    container.innerHTML = html;
  } catch {
    container.innerHTML = '<p class="sm-text-muted" style="margin:0;">Blad ladowania.</p>';
  }
}

async function addDateAnnouncement(dateStr) {
  // Get available announcements
  const announcements = await API.get('/announcements');
  if (announcements.length === 0) {
    await smAlert('Najpierw dodaj komunikaty w zakladce Komunikaty');
    return;
  }

  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modal-body');

  const annOptions = announcements.map(a =>
    `<option value="${a.id}">${esc(a.name)} (${formatTime(a.duration)})</option>`
  ).join('');

  modalBody.innerHTML = `
    <h2>Dodaj komunikat na ${dateStr}</h2>
    <div class="sm-form-row">
      <label>Komunikat:
        <select id="cal-ann-select" class="sm-input">${annOptions}</select>
      </label>
    </div>
    <div class="sm-form-row">
      <label>Godzina: <input type="time" id="cal-ann-time" class="sm-input" value="14:00"></label>
    </div>
    <div class="sm-form-row">
      <label>Tryb odtwarzania:
        <select id="cal-ann-playmode" class="sm-input">
          <option value="interrupt">Przerwij (natychmiastowe)</option>
          <option value="queue">Kolejka (po biezacym utworze)</option>
        </select>
      </label>
    </div>
    <div class="sm-form-row">
      <label>Glosnosc (opcjonalnie): <input type="number" id="cal-ann-volume" class="sm-input" placeholder="np. 80" min="0" max="100"></label>
    </div>
    <button onclick="submitDateAnnouncement('${dateStr}')" class="sm-btn sm-btn--primary">Dodaj</button>
  `;

  modal.classList.add('sm-modal--open');
}

async function submitDateAnnouncement(dateStr) {
  const annId = parseInt(document.getElementById('cal-ann-select').value);
  const time = document.getElementById('cal-ann-time').value;
  const volume = document.getElementById('cal-ann-volume').value;

  if (!time) { await smAlert('Wybierz godzine!'); return; }

  await API.post('/announcements/scheduled', {
    announcement_id: annId,
    trigger_type: 'specific_date',
    trigger_value: `${dateStr} ${time}`,
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    is_active: true,
    volume_override: volume ? parseInt(volume) : null,
    play_mode: document.getElementById('cal-ann-playmode').value,
  });

  document.getElementById('modal').classList.remove('sm-modal--open');
  loadDateAnnouncements(dateStr);
}

async function deleteScheduledFromCalendar(scheduledId, dateStr) {
  if (!await smConfirm('Usunac zaplanowany komunikat?')) return;
  await API.del(`/announcements/scheduled/${scheduledId}`);
  loadDateAnnouncements(dateStr);
}

// --- Create new playlist from calendar ---

let _calNewPlTracks = []; // selected track IDs for new playlist
let _calAllTracks = []; // cached all tracks

async function showCalendarNewPlaylist(dateStr) {
  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modal-body');

  // Load tracks and playlists
  _calAllTracks = await API.get('/tracks');
  _calNewPlTracks = [];

  const playlistOptions = _calendarPlaylists.map(p =>
    `<option value="${p.id}">${esc(p.name)} (${p.trackCount} utw.)</option>`
  ).join('');

  modalBody.innerHTML = `
    <h2>Nowa playlista na ${dateStr}</h2>
    <div class="sm-form-row"><label>Nazwa playlisty:
      <input type="text" id="cal-newpl-name" class="sm-input" placeholder="np. Piątkowa wieczorna">
    </label></div>

    <div class="sm-form-row"><label>Zrodlo utworow:</label>
      <div style="margin-top:4px;">
        <label style="display:block;margin-bottom:6px;"><input type="radio" name="cal-newpl-src" value="empty" checked onchange="calNewPlSrcChange()"> Pusta playlista</label>
        <label style="display:block;margin-bottom:6px;"><input type="radio" name="cal-newpl-src" value="copy" onchange="calNewPlSrcChange()"> Kopiuj z istniejącej playlisty</label>
        <label style="display:block;"><input type="radio" name="cal-newpl-src" value="pick" onchange="calNewPlSrcChange()"> Wybierz utwory</label>
      </div>
    </div>

    <div id="cal-newpl-copy-row" style="display:none;">
      <div class="sm-form-row"><label>Kopiuj utwory z:
        <select id="cal-newpl-copy-from" class="sm-input">${playlistOptions}</select>
      </label></div>
    </div>

    <div id="cal-newpl-pick-row" style="display:none;">
      <div class="sm-form-row">
        <label>Szukaj:</label>
        <input type="text" id="cal-newpl-search" class="sm-input" placeholder="Wpisz tytul lub artystę..." oninput="calNewPlFilterTracks()" style="margin-bottom:8px;">
      </div>
      <div id="cal-newpl-track-list" style="max-height:250px;overflow-y:auto;border:1px solid var(--sm-border);border-radius:6px;padding:4px;"></div>
      <div id="cal-newpl-selected-count" style="font-size:0.82rem;color:var(--sm-text-muted);margin-top:4px;">Wybrano: 0 utworow</div>
    </div>

    <div id="cal-newpl-status" style="color:#dc2626;font-size:0.85rem;margin:8px 0;"></div>
    <div style="display:flex;gap:8px;margin-top:12px;">
      <button class="sm-btn" style="background:var(--sm-border);color:var(--sm-text);" onclick="document.getElementById('modal').classList.remove('sm-modal--open')">Anuluj</button>
      <button onclick="submitCalendarNewPlaylist('${dateStr}')" class="sm-btn sm-btn--primary">Utworz i przypisz</button>
    </div>
  `;

  calNewPlRenderTracks();
  modal.classList.add('sm-modal--open');
}

function calNewPlSrcChange() {
  const src = document.querySelector('input[name="cal-newpl-src"]:checked')?.value || 'empty';
  document.getElementById('cal-newpl-copy-row').style.display = src === 'copy' ? '' : 'none';
  document.getElementById('cal-newpl-pick-row').style.display = src === 'pick' ? '' : 'none';
}

function calNewPlRenderTracks() {
  const container = document.getElementById('cal-newpl-track-list');
  if (!container) return;

  const query = (document.getElementById('cal-newpl-search')?.value || '').toLowerCase();
  const filtered = _calAllTracks.filter(function(t) {
    if (!query) return true;
    return (t.title || '').toLowerCase().includes(query) || (t.artist || '').toLowerCase().includes(query);
  }).slice(0, 100);

  if (filtered.length === 0) {
    container.innerHTML = '<p class="sm-text-muted" style="padding:8px;">Brak utworow pasujacych do wyszukiwania.</p>';
    return;
  }

  let html = '';
  for (const t of filtered) {
    const checked = _calNewPlTracks.includes(t.id) ? 'checked' : '';
    html += '<label style="display:flex;align-items:center;gap:6px;padding:3px 6px;border-bottom:1px solid var(--sm-border);font-size:0.85rem;cursor:pointer;">' +
      '<input type="checkbox" ' + checked + ' onchange="calNewPlToggleTrack(' + t.id + ', this.checked)">' +
      '<span style="flex:1;">' + esc(t.title || 'Bez tytulu') + '</span>' +
      '<span style="color:var(--sm-text-muted);font-size:0.78rem;">' + esc(t.artist || '') + '</span>' +
      '<span style="color:var(--sm-text-muted);font-size:0.78rem;">' + formatTime(t.duration) + '</span>' +
    '</label>';
  }
  container.innerHTML = html;
}

function calNewPlFilterTracks() {
  calNewPlRenderTracks();
}

function calNewPlToggleTrack(trackId, checked) {
  if (checked && !_calNewPlTracks.includes(trackId)) {
    _calNewPlTracks.push(trackId);
  } else if (!checked) {
    _calNewPlTracks = _calNewPlTracks.filter(function(id) { return id !== trackId; });
  }
  var countEl = document.getElementById('cal-newpl-selected-count');
  if (countEl) countEl.textContent = 'Wybrano: ' + _calNewPlTracks.length + ' utworow';
}

async function submitCalendarNewPlaylist(dateStr) {
  const name = document.getElementById('cal-newpl-name')?.value?.trim();
  const statusEl = document.getElementById('cal-newpl-status');
  if (!name) { statusEl.textContent = 'Podaj nazwe playlisty'; return; }

  const src = document.querySelector('input[name="cal-newpl-src"]:checked')?.value || 'empty';

  statusEl.textContent = 'Tworzenie...';
  statusEl.style.color = 'var(--sm-text)';

  try {
    // Create playlist
    const body = { name };
    if (src === 'copy') {
      body.copyFromPlaylistId = parseInt(document.getElementById('cal-newpl-copy-from').value);
    }
    const newPlaylist = await API.post('/playlists', body);

    // If picking tracks, add them one by one
    if (src === 'pick' && _calNewPlTracks.length > 0) {
      for (const tid of _calNewPlTracks) {
        await API.post('/playlists/' + newPlaylist.id + '/tracks', { trackId: tid });
      }
    }

    // Assign to calendar date
    const label = document.getElementById('cal-label')?.value?.trim() || '';
    const entry = await API.post('/schedule/calendar', {
      date: dateStr,
      playlist_id: newPlaylist.id,
      label: label,
    });
    _calendarEntries[dateStr] = entry;

    // Refresh playlists cache (calendar + main view)
    await loadCalendarPlaylists();
    if (typeof loadPlaylists === 'function') await loadPlaylists();

    document.getElementById('modal').classList.remove('sm-modal--open');
    renderCalendar();
    renderDatePanel(dateStr);
  } catch (err) {
    statusEl.textContent = 'Blad: ' + err.message;
    statusEl.style.color = '#dc2626';
  }
}

// --- Date packs (ad + announcement) ---

async function loadDatePacks(dateStr) {
  // Ad packs
  const adContainer = document.getElementById('cal-date-ad-packs');
  const annContainer = document.getElementById('cal-date-ann-packs');
  if (!adContainer || !annContainer) return;

  try {
    const adPacks = await API.get('/ad-packs');
    const annPacks = await API.get('/announcement-packs');

    // Find packs assigned to this date
    const assignedAd = adPacks.filter(p =>
      (p.assignments || []).some(a => a.assign_type === 'calendar' && a.target_date === dateStr)
    );
    const unassignedAd = adPacks.filter(p =>
      !(p.assignments || []).some(a => a.assign_type === 'calendar' && a.target_date === dateStr)
    );

    let adHtml = '';
    if (assignedAd.length > 0) {
      adHtml += assignedAd.map(p => {
        const assignId = p.assignments.find(a => a.assign_type === 'calendar' && a.target_date === dateStr).id;
        return '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:0.85rem;">' +
          '<span style="flex:1;"><strong>' + esc(p.name) + '</strong> <span class="sm-text-muted">(' + p.items.length + ' reklam)</span></span>' +
          '<button onclick="unassignDateAdPack(' + assignId + ',\'' + dateStr + '\')" class="sm-btn sm-btn--danger sm-btn--small">&#10005;</button>' +
        '</div>';
      }).join('');
    } else {
      adHtml += '<p class="sm-text-muted" style="margin:0 0 8px;">Brak paczek reklam na ten dzien.</p>';
    }
    if (unassignedAd.length > 0) {
      adHtml += '<div style="display:flex;gap:6px;align-items:center;margin-top:6px;">' +
        '<select id="cal-add-ad-pack" class="sm-input" style="flex:1;font-size:0.85rem;">' +
        unassignedAd.map(p => '<option value="' + p.id + '">' + esc(p.name) + ' (' + p.items.length + ' reklam)</option>').join('') +
        '</select>' +
        '<button onclick="assignDateAdPack(\'' + dateStr + '\')" class="sm-btn sm-btn--small">Dodaj</button>' +
      '</div>';
    }
    adContainer.innerHTML = adHtml;

    // Announcement packs
    const assignedAnn = annPacks.filter(p =>
      (p.assignments || []).some(a => a.assign_type === 'calendar' && a.target_date === dateStr)
    );
    const unassignedAnn = annPacks.filter(p =>
      !(p.assignments || []).some(a => a.assign_type === 'calendar' && a.target_date === dateStr)
    );

    let annHtml = '';
    if (assignedAnn.length > 0) {
      annHtml += assignedAnn.map(p => {
        const assignId = p.assignments.find(a => a.assign_type === 'calendar' && a.target_date === dateStr).id;
        return '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:0.85rem;">' +
          '<span style="flex:1;"><strong>' + esc(p.name) + '</strong> <span class="sm-text-muted">(' + p.items.length + ' komunikatow)</span></span>' +
          '<button onclick="unassignDateAnnPack(' + assignId + ',\'' + dateStr + '\')" class="sm-btn sm-btn--danger sm-btn--small">&#10005;</button>' +
        '</div>';
      }).join('');
    } else {
      annHtml += '<p class="sm-text-muted" style="margin:0 0 8px;">Brak paczek komunikatow na ten dzien.</p>';
    }
    if (unassignedAnn.length > 0) {
      annHtml += '<div style="display:flex;gap:6px;align-items:center;margin-top:6px;">' +
        '<select id="cal-add-ann-pack" class="sm-input" style="flex:1;font-size:0.85rem;">' +
        unassignedAnn.map(p => '<option value="' + p.id + '">' + esc(p.name) + ' (' + p.items.length + ' komunikatow)</option>').join('') +
        '</select>' +
        '<button onclick="assignDateAnnPack(\'' + dateStr + '\')" class="sm-btn sm-btn--small">Dodaj</button>' +
      '</div>';
    }
    annContainer.innerHTML = annHtml;
  } catch (err) {
    adContainer.innerHTML = '<div style="color:#dc2626;font-size:0.85rem;">' + esc(err.message) + '</div>';
  }
}

async function assignDateAdPack(dateStr) {
  const packId = parseInt(document.getElementById('cal-add-ad-pack').value);
  if (!packId) return;
  await API.post('/ad-packs/' + packId + '/assign', { assign_type: 'calendar', target_date: dateStr });
  loadDatePacks(dateStr);
}

async function unassignDateAdPack(assignId, dateStr) {
  await API.del('/ad-packs/assignments/' + assignId);
  loadDatePacks(dateStr);
}

async function assignDateAnnPack(dateStr) {
  const packId = parseInt(document.getElementById('cal-add-ann-pack').value);
  if (!packId) return;
  await API.post('/announcement-packs/' + packId + '/assign', { assign_type: 'calendar', target_date: dateStr });
  loadDatePacks(dateStr);
}

async function unassignDateAnnPack(assignId, dateStr) {
  await API.del('/announcement-packs/assignments/' + assignId);
  loadDatePacks(dateStr);
}
