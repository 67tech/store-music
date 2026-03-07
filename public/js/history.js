// History tab
let _historyDatesCache = null;
let _historyCurrentView = 'full'; // 'full' or 'summary'
let _historyFilter = 'all'; // 'all', 'music', 'ads', 'announcements'
let _historyData = null;
let _historySummary = null;

function initHistory() {
  const dateInput = document.getElementById('history-date');
  dateInput.value = new Date().toISOString().split('T')[0];
  dateInput.addEventListener('change', loadHistory);
}

async function loadHistory() {
  const date = document.getElementById('history-date').value;
  if (!date) return;

  const listEl = document.getElementById('history-list');
  const statsEl = document.getElementById('history-stats');
  listEl.innerHTML = '<div class="sm-text-muted" style="padding:12px;">Ladowanie...</div>';

  try {
    const [data, summary, dates] = await Promise.all([
      API.get(`/player/history?date=${date}`),
      API.get(`/player/history/summary?date=${date}`),
      _historyDatesCache ? Promise.resolve(null) : API.get('/player/history/dates'),
    ]);

    if (dates) {
      _historyDatesCache = dates;
      renderHistoryDates(dates, date);
    } else {
      renderHistoryDates(_historyDatesCache, date);
    }

    _historyData = data.entries || [];
    _historySummary = summary.summary || [];

    renderHistoryStats(statsEl);
    renderHistoryContent(listEl);
  } catch (err) {
    listEl.innerHTML = `<div style="color:#dc2626;padding:12px;">Blad: ${esc(err.message)}</div>`;
  }
}

function classifyEntry(e) {
  if (e.title && e.title.startsWith('[Reklama]')) return 'ad';
  if (e.one_shot || (e.artist === 'Komunikat') || (e.title && e.title.startsWith('[Komunikat]'))) return 'announcement';
  return 'music';
}

function filterEntries(entries) {
  if (_historyFilter === 'all') return entries;
  return entries.filter(e => classifyEntry(e) === _historyFilter);
}

function renderHistoryStats(statsEl) {
  const entries = _historyData || [];
  const summaryRows = _historySummary || [];

  const totalTracks = entries.length;
  const musicCount = entries.filter(e => classifyEntry(e) === 'music').length;
  const adCount = entries.filter(e => classifyEntry(e) === 'ad').length;
  const annCount = entries.filter(e => classifyEntry(e) === 'announcement').length;

  const totalDuration = entries.reduce((s, e) => s + (e.duration || 0), 0);
  const hours = Math.floor(totalDuration / 3600);
  const mins = Math.floor((totalDuration % 3600) / 60);
  const durStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  const filterBtn = (label, value, count) => {
    const active = _historyFilter === value ? ' sm-btn--primary' : '';
    return `<button onclick="setHistoryFilter('${value}')" class="sm-btn sm-btn--small${active}">${label} (${count})</button>`;
  };

  statsEl.innerHTML = `<div class="sm-history-stats">
    <div style="display:flex;gap:4px;flex-wrap:wrap;">
      ${filterBtn('Wszystko', 'all', totalTracks)}
      ${filterBtn('Muzyka', 'music', musicCount)}
      ${adCount > 0 ? filterBtn('Reklamy', 'ads', adCount) : ''}
      ${annCount > 0 ? filterBtn('Komunikaty', 'announcements', annCount) : ''}
    </div>
    <div style="display:flex;gap:8px;align-items:center;">
      <span class="sm-text-muted">${durStr}</span>
      <button onclick="toggleHistoryView()" class="sm-btn sm-btn--small" id="history-view-btn">${_historyCurrentView === 'full' ? 'Podsumowanie' : 'Pelna lista'}</button>
      <button onclick="exportHistoryCsv('full')" class="sm-btn sm-btn--small" title="Eksport pelnej listy">CSV</button>
    </div>
  </div>`;
}

function setHistoryFilter(filter) {
  _historyFilter = filter;
  const listEl = document.getElementById('history-list');
  const statsEl = document.getElementById('history-stats');
  renderHistoryStats(statsEl);
  renderHistoryContent(listEl);
}

function renderHistoryContent(listEl) {
  const entries = _historyData || [];
  if (entries.length === 0) {
    listEl.innerHTML = '<div class="sm-text-muted" style="padding:12px;">Brak historii dla tego dnia.</div>';
    return;
  }

  if (_historyCurrentView === 'summary') {
    renderHistorySummary(listEl, filterSummaryRows(_historySummary || []));
  } else {
    renderHistoryFull(listEl, filterEntries(entries));
  }
}

function filterSummaryRows(rows) {
  if (_historyFilter === 'all') return rows;
  return rows.filter(r => {
    if (_historyFilter === 'ads') return r.title && r.title.startsWith('[Reklama]');
    if (_historyFilter === 'announcements') return r.one_shot || (r.artist === 'Komunikat') || (r.title && r.title.startsWith('[Komunikat]'));
    return !(r.title && (r.title.startsWith('[Reklama]') || r.title.startsWith('[Komunikat]'))) && !r.one_shot;
  });
}

function renderHistoryFull(container, entries) {
  const chronological = [...entries].reverse();
  if (chronological.length === 0) {
    container.innerHTML = '<div class="sm-text-muted" style="padding:12px;">Brak wpisow dla tego filtra.</div>';
    return;
  }

  let html = '<table class="sm-table"><thead><tr><th>Czas</th><th>Tytul</th><th>Artysta</th><th>Dlugosc</th><th>Typ</th></tr></thead><tbody>';
  for (const e of chronological) {
    const time = new Date(e.played_at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const type = classifyEntry(e);
    let typeTag = '';
    if (type === 'ad') typeTag = '<span class="sm-tag sm-tag--ad">Reklama</span>';
    else if (type === 'announcement') typeTag = '<span class="sm-tag sm-tag--oneshot">Komunikat</span>';

    html += `<tr>
      <td>${time}</td>
      <td>${esc(e.title)}</td>
      <td>${esc(e.artist || '')}</td>
      <td>${e.duration ? formatTime(e.duration) : '-'}</td>
      <td>${typeTag}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

function renderHistorySummary(container, rows) {
  if (rows.length === 0) {
    container.innerHTML = '<div class="sm-text-muted" style="padding:12px;">Brak wpisow dla tego filtra.</div>';
    return;
  }

  let html = '<table class="sm-table"><thead><tr><th>Tytul</th><th>Artysta</th><th>Odtworzen</th><th>Laczny czas</th><th>Pierwsze</th><th>Ostatnie</th><th>Typ</th></tr></thead><tbody>';
  for (const r of rows) {
    const type = classifyEntry(r);
    let typeTag = '';
    if (type === 'ad') typeTag = '<span class="sm-tag sm-tag--ad">Reklama</span>';
    else if (type === 'announcement') typeTag = '<span class="sm-tag sm-tag--oneshot">Komunikat</span>';

    const first = r.first_play ? new Date(r.first_play).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '-';
    const last = r.last_play ? new Date(r.last_play).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '-';
    html += `<tr>
      <td>${esc(r.title)}</td>
      <td>${esc(r.artist || '')}</td>
      <td><strong>${r.play_count}</strong></td>
      <td>${formatTime(r.total_duration || 0)}</td>
      <td>${first}</td>
      <td>${last}</td>
      <td>${typeTag}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

function toggleHistoryView() {
  _historyCurrentView = _historyCurrentView === 'full' ? 'summary' : 'full';
  const listEl = document.getElementById('history-list');
  const statsEl = document.getElementById('history-stats');
  renderHistoryStats(statsEl);
  renderHistoryContent(listEl);
}

function exportHistoryCsv(mode) {
  const date = document.getElementById('history-date').value;
  window.open(`/api/player/history/csv?date=${date}&mode=${mode}`, '_blank');
}

function renderHistoryDates(dates, selectedDate) {
  const container = document.getElementById('history-dates');
  if (!dates || dates.length === 0) {
    container.innerHTML = '';
    return;
  }

  const months = {};
  for (const d of dates) {
    const month = d.date.substring(0, 7);
    if (!months[month]) months[month] = [];
    months[month].push(d);
  }

  let html = '<div class="sm-card sm-card--sticky"><div class="sm-card-header"><h3>Kalendarz</h3></div><div class="sm-history-calendar">';
  for (const [month, days] of Object.entries(months)) {
    const [y, m] = month.split('-');
    const monthName = new Date(y, m - 1).toLocaleDateString('pl-PL', { year: 'numeric', month: 'long' });
    html += `<div class="sm-history-month"><strong>${monthName}</strong><div class="sm-history-days">`;
    for (const d of days) {
      const dayNum = parseInt(d.date.split('-')[2]);
      const isSelected = d.date === selectedDate;
      html += `<button class="sm-history-day${isSelected ? ' sm-history-day--active' : ''}" onclick="selectHistoryDate('${d.date}')" title="${d.count} odtworzen">${dayNum}</button>`;
    }
    html += '</div></div>';
  }
  html += '</div></div>';
  container.innerHTML = html;
}

function selectHistoryDate(date) {
  document.getElementById('history-date').value = date;
  loadHistory();
}
