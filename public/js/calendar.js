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
          <label>Playlista na ten dzien:
            <select id="cal-playlist-select" class="sm-input">
              <option value="">-- domyslna --</option>
              ${playlistOptions}
            </select>
          </label>
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
  `;

  panel.innerHTML = html;
  loadDateAnnouncements(dateStr);
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
  await API.del(`/schedule/calendar/${dateStr}`);
  delete _calendarEntries[dateStr];
  renderCalendar();
  renderDatePanel(dateStr);
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
