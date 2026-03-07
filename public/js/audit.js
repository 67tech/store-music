let _auditPage = 1;
let _auditSearchTimer = null;

const CATEGORY_LABELS = {
  auth: 'Logowanie',
  tracks: 'Utwory',
  playlists: 'Playlisty',
  player: 'Player',
  schedule: 'Harmonogram',
  announcements: 'Komunikaty',
  users: 'Uzytkownicy',
  ads: 'Reklamy',
  'ad-packs': 'Paczki reklam',
  'announcement-packs': 'Paczki komunikatow',
  backup: 'Kopie zapasowe',
  general: 'Ogolne',
};

function initAudit() {
  loadAuditFilters();
  loadAuditLog();
}

async function loadAuditFilters() {
  try {
    const [categories, users] = await Promise.all([
      API.get('/audit/categories'),
      API.get('/audit/users'),
    ]);

    const catSelect = document.getElementById('audit-filter-category');
    categories.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = CATEGORY_LABELS[c] || c;
      catSelect.appendChild(opt);
    });

    const userSelect = document.getElementById('audit-filter-user');
    users.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u;
      opt.textContent = u;
      userSelect.appendChild(opt);
    });
  } catch {}
}

async function loadAuditLog(page) {
  if (page) _auditPage = page;

  const category = document.getElementById('audit-filter-category').value;
  const username = document.getElementById('audit-filter-user').value;
  const dateFrom = document.getElementById('audit-filter-from').value;
  const dateTo = document.getElementById('audit-filter-to').value;
  const search = document.getElementById('audit-filter-search').value;

  const params = new URLSearchParams({ page: _auditPage, limit: 50 });
  if (category) params.set('category', category);
  if (username) params.set('username', username);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  if (search) params.set('search', search);

  try {
    const data = await API.get(`/audit?${params}`);
    renderAuditLog(data);
  } catch {
    document.getElementById('audit-log-list').innerHTML = '<p style="padding:16px;color:var(--sm-muted);">Brak danych</p>';
  }
}

function renderAuditLog(data) {
  const container = document.getElementById('audit-log-list');

  if (!data.rows || data.rows.length === 0) {
    container.innerHTML = '<p style="padding:16px;color:var(--sm-muted);">Brak wpisow w logach</p>';
    document.getElementById('audit-pagination').innerHTML = '';
    return;
  }

  let html = `<table class="sm-table" style="width:100%;font-size:0.85rem;">
    <thead>
      <tr>
        <th style="width:140px;">Data</th>
        <th style="width:100px;">Uzytkownik</th>
        <th style="width:100px;">Kategoria</th>
        <th>Akcja</th>
        <th style="width:100px;">IP</th>
        <th style="width:40px;"></th>
      </tr>
    </thead>
    <tbody>`;

  for (const row of data.rows) {
    const date = row.created_at ? new Date(row.created_at + 'Z').toLocaleString('pl-PL', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }) : '';
    const catLabel = CATEGORY_LABELS[row.category] || row.category;
    const hasDetails = row.details && row.details !== '{}' && row.details !== 'null';

    html += `<tr>
      <td style="white-space:nowrap;font-size:0.8rem;color:var(--sm-muted);">${esc(date)}</td>
      <td><strong>${esc(row.username)}</strong></td>
      <td><span class="audit-cat audit-cat--${esc(row.category)}">${esc(catLabel)}</span></td>
      <td>${esc(row.action)}</td>
      <td style="font-size:0.75rem;color:var(--sm-muted);">${esc(row.ip)}</td>
      <td>${hasDetails ? `<button class="sm-btn sm-btn--small" onclick="showAuditDetails(${row.id})" title="Szczegoly">&#128269;</button>` : ''}</td>
    </tr>`;
  }

  html += '</tbody></table>';
  container.innerHTML = html;

  // Pagination
  const pag = document.getElementById('audit-pagination');
  if (data.pages <= 1) {
    pag.innerHTML = `<span style="color:var(--sm-muted);font-size:0.8rem;">${data.total} wpisow</span>`;
    return;
  }

  let pagHtml = `<span style="color:var(--sm-muted);font-size:0.8rem;margin-right:12px;">${data.total} wpisow, strona ${data.page}/${data.pages}</span>`;
  if (data.page > 1) {
    pagHtml += `<button class="sm-btn sm-btn--small" onclick="loadAuditLog(${data.page - 1})">&#9664; Poprzednia</button> `;
  }
  if (data.page < data.pages) {
    pagHtml += `<button class="sm-btn sm-btn--small" onclick="loadAuditLog(${data.page + 1})">Nastepna &#9654;</button>`;
  }
  pag.innerHTML = pagHtml;
}

function showAuditDetails(id) {
  // Find the row in already-loaded data — re-fetch single entry
  API.get(`/audit?search=&page=1&limit=1`).catch(() => {});

  // Simpler: just find the details from the table's data
  // We'll re-fetch with the id filter... but since we don't have that endpoint,
  // let's just get from DOM. The data was already loaded.
  // Better approach: store data globally
  _showAuditDetailModal(id);
}

let _lastAuditData = [];

// Override renderAuditLog to store data
const _origRenderAuditLog = renderAuditLog;

async function _showAuditDetailModal(id) {
  try {
    // Fetch all recent to find this row (simple approach)
    const data = await API.get(`/audit?limit=200&search=`);
    const row = data.rows.find(r => r.id === id);
    if (!row) return;

    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');

    let detailsHtml = '';
    try {
      const details = JSON.parse(row.details);
      detailsHtml = '<pre style="background:var(--sm-bg-alt);padding:12px;border-radius:8px;overflow-x:auto;font-size:0.8rem;max-height:400px;">' +
        esc(JSON.stringify(details, null, 2)) + '</pre>';
    } catch {
      detailsHtml = `<p>${esc(row.details)}</p>`;
    }

    modalBody.innerHTML = `
      <h3 style="margin-bottom:12px;">Szczegoly operacji</h3>
      <table style="width:100%;font-size:0.85rem;margin-bottom:12px;">
        <tr><td style="padding:4px 8px;color:var(--sm-muted);">Data:</td><td>${esc(row.created_at)}</td></tr>
        <tr><td style="padding:4px 8px;color:var(--sm-muted);">Uzytkownik:</td><td><strong>${esc(row.username)}</strong></td></tr>
        <tr><td style="padding:4px 8px;color:var(--sm-muted);">Kategoria:</td><td>${esc(CATEGORY_LABELS[row.category] || row.category)}</td></tr>
        <tr><td style="padding:4px 8px;color:var(--sm-muted);">Akcja:</td><td>${esc(row.action)}</td></tr>
        <tr><td style="padding:4px 8px;color:var(--sm-muted);">IP:</td><td>${esc(row.ip)}</td></tr>
      </table>
      <h4 style="margin-bottom:8px;">Dane:</h4>
      ${detailsHtml}
    `;
    modal.classList.add('sm-modal--open');
  } catch {}
}

function debounceAuditSearch() {
  clearTimeout(_auditSearchTimer);
  _auditSearchTimer = setTimeout(() => {
    _auditPage = 1;
    loadAuditLog();
  }, 400);
}

function exportAuditCsv() {
  const category = document.getElementById('audit-filter-category').value;
  const username = document.getElementById('audit-filter-user').value;
  const dateFrom = document.getElementById('audit-filter-from').value;
  const dateTo = document.getElementById('audit-filter-to').value;
  const search = document.getElementById('audit-filter-search').value;

  // Fetch all matching entries and generate CSV client-side
  const params = new URLSearchParams({ page: 1, limit: 10000 });
  if (category) params.set('category', category);
  if (username) params.set('username', username);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  if (search) params.set('search', search);

  API.get(`/audit?${params}`).then(data => {
    let csv = '\ufeffData;Uzytkownik;Kategoria;Akcja;IP;Szczegoly\n';
    for (const r of data.rows) {
      const det = (r.details || '').replace(/"/g, '""');
      csv += `"${r.created_at}";"${r.username}";"${r.category}";"${(r.action || '').replace(/"/g, '""')}";"${r.ip}";"${det}"\n`;
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logi-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
}
