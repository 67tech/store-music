// History tab
let _historyDatesCache = null;
let _historyCurrentView = 'full'; // 'full' or 'summary'

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

    const entries = data.entries || [];
    const summaryRows = summary.summary || [];

    // Stats bar
    const totalTracks = entries.length;
    const totalDuration = summary.totalDuration || 0;
    const announcements = entries.filter(e => e.one_shot).length;
    const uniqueTracks = summaryRows.length;
    const hours = Math.floor(totalDuration / 3600);
    const mins = Math.floor((totalDuration % 3600) / 60);
    const durStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

    statsEl.innerHTML = `<div class="sm-history-stats">
      <span><strong>${totalTracks}</strong> odtworzen</span>
      <span><strong>${uniqueTracks}</strong> unikalnych</span>
      <span><strong>${durStr}</strong> laczny czas</span>
      ${announcements > 0 ? `<span><strong>${announcements}</strong> komunikatow</span>` : ''}
      <div style="margin-left:auto; display:flex; gap:6px;">
        <button onclick="toggleHistoryView()" class="sm-btn sm-btn--small" id="history-view-btn">${_historyCurrentView === 'full' ? 'Podsumowanie' : 'Pelna lista'}</button>
        <button onclick="exportHistoryCsv('full')" class="sm-btn sm-btn--small" title="Eksport pelnej listy">CSV</button>
        <button onclick="exportHistoryCsv('summary')" class="sm-btn sm-btn--small" title="Eksport podsumowania">CSV podsumowanie</button>
      </div>
    </div>`;

    if (entries.length === 0) {
      listEl.innerHTML = '<div class="sm-text-muted" style="padding:12px;">Brak historii dla tego dnia.</div>';
      return;
    }

    if (_historyCurrentView === 'summary') {
      renderHistorySummary(listEl, summaryRows);
    } else {
      renderHistoryFull(listEl, entries);
    }
  } catch (err) {
    listEl.innerHTML = `<div style="color:#dc2626;padding:12px;">Blad: ${esc(err.message)}</div>`;
  }
}

function renderHistoryFull(container, entries) {
  const chronological = [...entries].reverse();
  let html = '<table class="sm-table"><thead><tr><th>Czas</th><th>Tytul</th><th>Artysta</th><th>Dlugosc</th><th>Typ</th></tr></thead><tbody>';
  for (const e of chronological) {
    const time = new Date(e.played_at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const typeTag = e.one_shot ? '<span class="sm-tag sm-tag--oneshot">1x</span>' : '';
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
  let html = '<table class="sm-table"><thead><tr><th>Tytul</th><th>Artysta</th><th>Odtworzen</th><th>Laczny czas</th><th>Pierwsze</th><th>Ostatnie</th><th>Typ</th></tr></thead><tbody>';
  for (const r of rows) {
    const typeTag = r.one_shot ? '<span class="sm-tag sm-tag--oneshot">Komunikat</span>' : '';
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
  loadHistory();
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

  let html = '<div class="sm-card"><div class="sm-card-header"><h3>Dostepne daty</h3></div><div class="sm-history-calendar">';
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
