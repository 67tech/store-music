// Ads (Reklamy) tab

function initAds() {
  loadAds();
  loadScheduledAdsPanel();
  // Refresh scheduled ads panel every 60s
  setInterval(loadScheduledAdsPanel, 60000);
  // Set default report dates (last 30 days)
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  document.getElementById('ad-report-start').value = start.toISOString().split('T')[0];
  document.getElementById('ad-report-end').value = end.toISOString().split('T')[0];
}

async function loadAds() {
  const container = document.getElementById('ads-list');
  try {
    const ads = await API.get('/ads');
    if (ads.length === 0) {
      container.innerHTML = '<p class="sm-empty">Brak reklam. Dodaj pierwsza reklame!</p>';
      return;
    }

    let html = '<table class="sm-table"><thead><tr><th>Tytul</th><th>Klient</th><th>Dlugosc</th><th>Tryb</th><th>Cel/Interwal</th><th>Okno</th><th>Odtwarzanie</th><th>Dzis</th><th>Status</th><th>Akcje</th></tr></thead><tbody>';
    for (const ad of ads) {
      const modeLabel = ad.schedule_mode === 'count' ? 'Ilosc/dzien' : 'Co N minut';
      const targetLabel = ad.schedule_mode === 'count'
        ? `${ad.today_plays}/${ad.daily_target}`
        : `co ${ad.interval_minutes} min`;
      const statusClass = ad.is_active ? 'sm-status--playing' : 'sm-status--stopped';
      const statusLabel = ad.is_active ? 'Aktywna' : 'Wylaczona';
      const daysStr = (ad.days_of_week || []).map(d => ['Nd','Pn','Wt','Sr','Cz','Pt','Sb'][d]).join(',');

      const playModeLabel = ad.play_mode === 'interrupt' ? 'Przerwij' : 'Kolejka';

      html += `<tr>
        <td><strong>${esc(ad.title)}</strong></td>
        <td>${esc(ad.client_name || '-')}</td>
        <td>${formatTime(ad.duration)}</td>
        <td>${modeLabel}</td>
        <td>${targetLabel}</td>
        <td>${ad.start_time}-${ad.end_time}<br><small>${daysStr}</small></td>
        <td>${playModeLabel}</td>
        <td><strong>${ad.today_plays}</strong></td>
        <td><span class="sm-status ${statusClass}" style="cursor:pointer;" onclick="toggleAd(${ad.id})">${statusLabel}</span></td>
        <td>
          <button onclick="editAd(${ad.id})" class="sm-btn sm-btn--small" title="Edytuj">&#9998;</button>
          <button onclick="deleteAd(${ad.id})" class="sm-btn sm-btn--danger sm-btn--small" title="Usun">&#10005;</button>
        </td>
      </tr>`;
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div style="color:#dc2626;padding:12px;">Blad: ${esc(err.message)}</div>`;
  }
}

function showAdUpload() {
  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modal-body');
  modalBody.innerHTML = `
    <h2>Dodaj reklame</h2>
    <div class="sm-form-row"><label>Plik audio: <input type="file" id="ad-upload-file" accept=".mp3,.wav,.ogg,.flac"></label></div>
    <div class="sm-form-row"><label>Tytul: <input type="text" id="ad-upload-title" class="sm-input" placeholder="Nazwa reklamy"></label></div>
    <div class="sm-form-row"><label>Klient: <input type="text" id="ad-upload-client" class="sm-input" placeholder="Nazwa firmy"></label></div>
    <hr style="border-color:var(--sm-border);margin:12px 0;">
    <h3>Harmonogram</h3>
    <div class="sm-form-row">
      <label>Tryb:
        <select id="ad-upload-mode" class="sm-input" onchange="adModeChange()">
          <option value="count">Ilosc odtworzen dziennie</option>
          <option value="interval">Co N minut</option>
        </select>
      </label>
    </div>
    <div class="sm-form-row" id="ad-count-row"><label>Ile razy dziennie: <input type="number" id="ad-upload-daily" class="sm-input" value="3" min="1" max="100"></label></div>
    <div class="sm-form-row" id="ad-interval-row" style="display:none;"><label>Co ile minut: <input type="number" id="ad-upload-interval" class="sm-input" value="60" min="5" max="480"></label></div>
    <div class="sm-form-row" style="display:flex;gap:8px;">
      <label style="flex:1;">Od godziny: <input type="time" id="ad-upload-start" class="sm-input" value="08:00"></label>
      <label style="flex:1;">Do godziny: <input type="time" id="ad-upload-end" class="sm-input" value="20:00"></label>
    </div>
    <div class="sm-form-row"><label>Priorytet (1-10): <input type="number" id="ad-upload-priority" class="sm-input" value="5" min="1" max="10"></label></div>
    <div class="sm-form-row">
      <label>Tryb odtwarzania:
        <select id="ad-upload-playmode" class="sm-input">
          <option value="queue">Kolejka (po biezacym utworze)</option>
          <option value="interrupt">Przerwij (natychmiastowe odtworzenie)</option>
        </select>
      </label>
    </div>
    <div class="sm-form-row">
      <label>Dni tygodnia:</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">
        <label><input type="checkbox" class="ad-day-cb" value="1" checked> Pn</label>
        <label><input type="checkbox" class="ad-day-cb" value="2" checked> Wt</label>
        <label><input type="checkbox" class="ad-day-cb" value="3" checked> Sr</label>
        <label><input type="checkbox" class="ad-day-cb" value="4" checked> Cz</label>
        <label><input type="checkbox" class="ad-day-cb" value="5" checked> Pt</label>
        <label><input type="checkbox" class="ad-day-cb" value="6" checked> Sb</label>
        <label><input type="checkbox" class="ad-day-cb" value="0"> Nd</label>
      </div>
    </div>
    <div id="ad-upload-error" style="color:#dc2626;font-size:0.85rem;margin:8px 0;"></div>
    <button onclick="submitAdUpload()" class="sm-btn sm-btn--primary">Dodaj reklame</button>
  `;
  modal.classList.add('sm-modal--open');
}

function showAdTts() {
  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modal-body');
  modalBody.innerHTML = `
    <h2>Generuj reklame TTS</h2>
    <div class="sm-form-row"><label>Tytul reklamy: <input type="text" id="ad-tts-title" class="sm-input" placeholder="Nazwa reklamy"></label></div>
    <div class="sm-form-row"><label>Klient: <input type="text" id="ad-tts-client" class="sm-input" placeholder="Nazwa firmy"></label></div>
    <div class="sm-form-row"><label>Tekst do odczytania:</label>
      <textarea id="ad-tts-text" class="sm-input" rows="3" placeholder="Uwaga! Promocja dnia..."></textarea>
    </div>
    <div class="sm-form-row" style="display:flex;gap:8px;">
      <label style="flex:1;">Silnik TTS:
        <select id="ad-tts-engine" class="sm-input" onchange="adTtsEngineChange()">
          <option value="elevenlabs">ElevenLabs (premium)</option>
          <option value="google">Google TTS</option>
          <option value="edge">Microsoft Edge TTS</option>
        </select>
      </label>
      <label style="flex:1;">Jezyk:
        <select id="ad-tts-lang" class="sm-input">
          <option value="pl">Polski</option>
          <option value="en">English</option>
          <option value="de">Deutsch</option>
        </select>
      </label>
    </div>
    <div class="sm-form-row" id="ad-tts-voice-row" style="display:none;">
      <label>Glos Edge: <select id="ad-tts-voice" class="sm-input"><option>Ladowanie...</option></select></label>
    </div>
    <hr style="border-color:var(--sm-border);margin:12px 0;">
    <h3>Harmonogram</h3>
    <div class="sm-form-row">
      <label>Tryb:
        <select id="ad-tts-mode" class="sm-input" onchange="adTtsModeChange()">
          <option value="count">Ilosc odtworzen dziennie</option>
          <option value="interval">Co N minut</option>
        </select>
      </label>
    </div>
    <div class="sm-form-row" id="ad-tts-count-row"><label>Ile razy dziennie: <input type="number" id="ad-tts-daily" class="sm-input" value="3" min="1" max="100"></label></div>
    <div class="sm-form-row" id="ad-tts-interval-row" style="display:none;"><label>Co ile minut: <input type="number" id="ad-tts-interval" class="sm-input" value="60" min="5" max="480"></label></div>
    <div class="sm-form-row" style="display:flex;gap:8px;">
      <label style="flex:1;">Od godziny: <input type="time" id="ad-tts-start" class="sm-input" value="08:00"></label>
      <label style="flex:1;">Do godziny: <input type="time" id="ad-tts-end" class="sm-input" value="20:00"></label>
    </div>
    <div class="sm-form-row"><label>Priorytet (1-10): <input type="number" id="ad-tts-priority" class="sm-input" value="5" min="1" max="10"></label></div>
    <div class="sm-form-row">
      <label>Tryb odtwarzania:
        <select id="ad-tts-playmode" class="sm-input">
          <option value="queue">Kolejka (po biezacym utworze)</option>
          <option value="interrupt">Przerwij (natychmiastowe odtworzenie)</option>
        </select>
      </label>
    </div>
    <div class="sm-form-row">
      <label>Dni tygodnia:</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">
        <label><input type="checkbox" class="ad-tts-day" value="1" checked> Pn</label>
        <label><input type="checkbox" class="ad-tts-day" value="2" checked> Wt</label>
        <label><input type="checkbox" class="ad-tts-day" value="3" checked> Sr</label>
        <label><input type="checkbox" class="ad-tts-day" value="4" checked> Cz</label>
        <label><input type="checkbox" class="ad-tts-day" value="5" checked> Pt</label>
        <label><input type="checkbox" class="ad-tts-day" value="6" checked> Sb</label>
        <label><input type="checkbox" class="ad-tts-day" value="0"> Nd</label>
      </div>
    </div>
    <div id="ad-tts-error" style="color:#dc2626;font-size:0.85rem;margin:8px 0;"></div>
    <div style="display:flex;gap:8px;align-items:center;">
      <button id="ad-tts-preview" class="sm-btn" onclick="previewTtsFromForm('ad')">&#128266; Podsluchaj</button>
      <button onclick="submitAdTts()" class="sm-btn sm-btn--primary">Generuj i dodaj reklame</button>
    </div>
  `;
  modal.classList.add('sm-modal--open');
  adTtsEngineChange();
}

function adTtsEngineChange() {
  const engine = document.getElementById('ad-tts-engine').value;
  const voiceRow = document.getElementById('ad-tts-voice-row');
  const langRow = document.getElementById('ad-tts-lang')?.closest('.sm-form-row') || document.getElementById('ad-tts-lang')?.parentElement?.parentElement;
  const elRow = document.getElementById('ad-tts-el-voice-row');

  voiceRow.style.display = engine === 'edge' ? '' : 'none';

  if (engine === 'elevenlabs') {
    if (!elRow) {
      const div = document.createElement('div');
      div.className = 'sm-form-row';
      div.id = 'ad-tts-el-voice-row';
      div.innerHTML = `<label>Glos ElevenLabs: <select id="ad-tts-el-voice" class="sm-input" style="max-width:250px;"><option value="">Ladowanie glosow...</option></select></label>`;
      voiceRow.parentNode.insertBefore(div, voiceRow.nextSibling);
      _loadAdElVoices();
    } else {
      elRow.style.display = '';
    }
  } else if (elRow) {
    elRow.style.display = 'none';
  }

  if (engine === 'edge') {
    API.get('/announcements/tts/voices').then(voices => {
      const sel = document.getElementById('ad-tts-voice');
      sel.innerHTML = voices.filter(v => v.id.startsWith('pl')).concat(voices.filter(v => !v.id.startsWith('pl'))).map(v =>
        `<option value="${v.id}">${v.id} (${v.gender})</option>`
      ).join('');
    }).catch(() => {});
  }
}

async function _loadAdElVoices() {
  const select = document.getElementById('ad-tts-el-voice');
  if (!select) return;
  try {
    const voices = await API.get('/announcements/tts/elevenlabs/voices');
    if (voices.length === 0) {
      select.innerHTML = '<option value="">Brak glosow — sprawdz klucz API</option>';
      return;
    }
    const premade = voices.filter(v => v.category === 'premade' || v.category === 'cloned');
    const library = voices.filter(v => v.category !== 'premade' && v.category !== 'cloned');
    let html = '';
    if (premade.length > 0) {
      html += '<optgroup label="Dostepne (wbudowane + sklonowane)">';
      html += premade.map(v => {
        const lang = v.labels?.language || '';
        const accent = v.labels?.accent || '';
        const tag = [lang, accent].filter(Boolean).join(', ');
        return `<option value="${v.id}">${esc(v.name)}${tag ? ` (${tag})` : ''}</option>`;
      }).join('');
      html += '</optgroup>';
    }
    if (library.length > 0) {
      html += '<optgroup label="Biblioteka (wymaga platnego planu)">';
      html += library.map(v => {
        const lang = v.labels?.language || '';
        return `<option value="${v.id}">${esc(v.name)}${lang ? ` (${lang})` : ''} [platny]</option>`;
      }).join('');
      html += '</optgroup>';
    }
    select.innerHTML = html || '<option value="">Brak glosow</option>';
  } catch {
    select.innerHTML = '<option value="">Blad — sprawdz klucz API w Ustawieniach</option>';
  }
}

function adTtsModeChange() {
  const mode = document.getElementById('ad-tts-mode').value;
  document.getElementById('ad-tts-count-row').style.display = mode === 'count' ? '' : 'none';
  document.getElementById('ad-tts-interval-row').style.display = mode === 'interval' ? '' : 'none';
}

async function submitAdTts() {
  const text = document.getElementById('ad-tts-text').value.trim();
  const errEl = document.getElementById('ad-tts-error');
  if (!text) { errEl.textContent = 'Wpisz tekst do odczytania'; return; }

  const days = Array.from(document.querySelectorAll('.ad-tts-day:checked')).map(cb => parseInt(cb.value));
  if (days.length === 0) { errEl.textContent = 'Wybierz przynajmniej jeden dzien'; return; }

  errEl.textContent = 'Generowanie...';

  try {
    await API.post('/ads/tts', {
      title: document.getElementById('ad-tts-title').value || text.substring(0, 50),
      client_name: document.getElementById('ad-tts-client').value,
      text,
      engine: document.getElementById('ad-tts-engine').value,
      language: document.getElementById('ad-tts-lang').value,
      voice: document.getElementById('ad-tts-engine').value === 'elevenlabs'
        ? document.getElementById('ad-tts-el-voice')?.value
        : document.getElementById('ad-tts-voice')?.value,
      schedule_mode: document.getElementById('ad-tts-mode').value,
      daily_target: parseInt(document.getElementById('ad-tts-daily').value),
      interval_minutes: parseInt(document.getElementById('ad-tts-interval').value),
      start_time: document.getElementById('ad-tts-start').value,
      end_time: document.getElementById('ad-tts-end').value,
      priority: parseInt(document.getElementById('ad-tts-priority').value),
      play_mode: document.getElementById('ad-tts-playmode').value,
      days_of_week: days,
    });
    document.getElementById('modal').classList.remove('sm-modal--open');
    await loadAds();
  } catch (err) {
    errEl.textContent = err.message;
  }
}

function adModeChange() {
  const mode = document.getElementById('ad-upload-mode').value;
  document.getElementById('ad-count-row').style.display = mode === 'count' ? '' : 'none';
  document.getElementById('ad-interval-row').style.display = mode === 'interval' ? '' : 'none';
}

async function submitAdUpload() {
  const fileInput = document.getElementById('ad-upload-file');
  const errEl = document.getElementById('ad-upload-error');
  if (!fileInput.files.length) { errEl.textContent = 'Wybierz plik audio'; return; }

  const days = Array.from(document.querySelectorAll('.ad-day-cb:checked')).map(cb => parseInt(cb.value));
  if (days.length === 0) { errEl.textContent = 'Wybierz przynajmniej jeden dzien'; return; }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('title', document.getElementById('ad-upload-title').value || fileInput.files[0].name.replace(/\.[^.]+$/, ''));
  formData.append('client_name', document.getElementById('ad-upload-client').value);
  formData.append('schedule_mode', document.getElementById('ad-upload-mode').value);
  formData.append('daily_target', document.getElementById('ad-upload-daily').value);
  formData.append('interval_minutes', document.getElementById('ad-upload-interval').value);
  formData.append('start_time', document.getElementById('ad-upload-start').value);
  formData.append('end_time', document.getElementById('ad-upload-end').value);
  formData.append('days_of_week', JSON.stringify(days));
  formData.append('priority', document.getElementById('ad-upload-priority').value);
  formData.append('play_mode', document.getElementById('ad-upload-playmode').value);

  try {
    const res = await fetch('/api/ads', { method: 'POST', body: formData });
    if (!res.ok) throw new Error((await res.json()).error || 'Upload failed');
    document.getElementById('modal').classList.remove('sm-modal--open');
    await loadAds();
  } catch (err) {
    errEl.textContent = err.message;
  }
}

async function toggleAd(id) {
  await API.post(`/ads/${id}/toggle`);
  await loadAds();
}

async function deleteAd(id) {
  if (!await smConfirm('Usunac reklame?')) return;
  await API.delete(`/ads/${id}`);
  await loadAds();
}

async function editAd(id) {
  const ad = (await API.get('/ads')).find(a => a.id === id);
  if (!ad) return;

  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modal-body');
  const days = ad.days_of_week || [];
  const dayChecks = [0,1,2,3,4,5,6].map(d => {
    const name = ['Nd','Pn','Wt','Sr','Cz','Pt','Sb'][d];
    return `<label><input type="checkbox" class="ad-edit-day" value="${d}" ${days.includes(d) ? 'checked' : ''}> ${name}</label>`;
  }).join('\n');

  modalBody.innerHTML = `
    <h2>Edytuj reklame</h2>
    <div class="sm-form-row"><label>Tytul: <input type="text" id="ad-edit-title" class="sm-input" value="${esc(ad.title)}"></label></div>
    <div class="sm-form-row"><label>Klient: <input type="text" id="ad-edit-client" class="sm-input" value="${esc(ad.client_name || '')}"></label></div>
    <div class="sm-form-row">
      <label>Tryb:
        <select id="ad-edit-mode" class="sm-input" onchange="adEditModeChange()">
          <option value="count" ${ad.schedule_mode === 'count' ? 'selected' : ''}>Ilosc odtworzen dziennie</option>
          <option value="interval" ${ad.schedule_mode === 'interval' ? 'selected' : ''}>Co N minut</option>
        </select>
      </label>
    </div>
    <div class="sm-form-row" id="ad-edit-count-row" style="${ad.schedule_mode !== 'count' ? 'display:none' : ''}"><label>Ile razy dziennie: <input type="number" id="ad-edit-daily" class="sm-input" value="${ad.daily_target}" min="1" max="100"></label></div>
    <div class="sm-form-row" id="ad-edit-interval-row" style="${ad.schedule_mode !== 'interval' ? 'display:none' : ''}"><label>Co ile minut: <input type="number" id="ad-edit-interval" class="sm-input" value="${ad.interval_minutes}" min="5" max="480"></label></div>
    <div class="sm-form-row" style="display:flex;gap:8px;">
      <label style="flex:1;">Od godziny: <input type="time" id="ad-edit-start" class="sm-input" value="${ad.start_time}"></label>
      <label style="flex:1;">Do godziny: <input type="time" id="ad-edit-end" class="sm-input" value="${ad.end_time}"></label>
    </div>
    <div class="sm-form-row"><label>Priorytet (1-10): <input type="number" id="ad-edit-priority" class="sm-input" value="${ad.priority}" min="1" max="10"></label></div>
    <div class="sm-form-row">
      <label>Tryb odtwarzania:
        <select id="ad-edit-playmode" class="sm-input">
          <option value="queue" ${(ad.play_mode || 'queue') === 'queue' ? 'selected' : ''}>Kolejka (po biezacym utworze)</option>
          <option value="interrupt" ${ad.play_mode === 'interrupt' ? 'selected' : ''}>Przerwij (natychmiastowe odtworzenie)</option>
        </select>
      </label>
    </div>
    <div class="sm-form-row">
      <label>Dni tygodnia:</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">${dayChecks}</div>
    </div>
    <button onclick="saveAdEdit(${id})" class="sm-btn sm-btn--primary">Zapisz</button>
  `;
  modal.classList.add('sm-modal--open');
}

function adEditModeChange() {
  const mode = document.getElementById('ad-edit-mode').value;
  document.getElementById('ad-edit-count-row').style.display = mode === 'count' ? '' : 'none';
  document.getElementById('ad-edit-interval-row').style.display = mode === 'interval' ? '' : 'none';
}

async function saveAdEdit(id) {
  const days = Array.from(document.querySelectorAll('.ad-edit-day:checked')).map(cb => parseInt(cb.value));
  await API.put(`/ads/${id}`, {
    title: document.getElementById('ad-edit-title').value,
    client_name: document.getElementById('ad-edit-client').value,
    schedule_mode: document.getElementById('ad-edit-mode').value,
    daily_target: parseInt(document.getElementById('ad-edit-daily').value),
    interval_minutes: parseInt(document.getElementById('ad-edit-interval').value),
    start_time: document.getElementById('ad-edit-start').value,
    end_time: document.getElementById('ad-edit-end').value,
    priority: parseInt(document.getElementById('ad-edit-priority').value),
    play_mode: document.getElementById('ad-edit-playmode').value,
    days_of_week: days,
  });
  document.getElementById('modal').classList.remove('sm-modal--open');
  await loadAds();
}

async function loadAdReport() {
  const start = document.getElementById('ad-report-start').value;
  const end = document.getElementById('ad-report-end').value;
  const container = document.getElementById('ad-report');

  try {
    const data = await API.get(`/ads/report?start=${start}&end=${end}`);
    if (!data.entries || data.entries.length === 0) {
      container.innerHTML = '<p class="sm-empty" style="padding:8px 12px;">Brak danych.</p>';
      return;
    }

    // Group by title
    const byTitle = {};
    let grandTotal = 0;
    for (const e of data.entries) {
      const title = e.title.replace('[Reklama] ', '');
      if (!byTitle[title]) byTitle[title] = { total: 0, dates: [], daysActive: 0 };
      byTitle[title].total += e.play_count;
      byTitle[title].daysActive++;
      byTitle[title].dates.push({ date: e.date, count: e.play_count });
      grandTotal += e.play_count;
    }

    const dayCount = Object.keys(
      data.entries.reduce((acc, e) => { acc[e.date] = 1; return acc; }, {})
    ).length;

    let html = `<div style="padding:8px 12px;">
      <div class="sm-ad-report-summary">
        <div class="sm-ad-report-stat">
          <span class="sm-ad-report-stat-num">${grandTotal}</span>
          <span class="sm-ad-report-stat-label">odtworzen lacznie</span>
        </div>
        <div class="sm-ad-report-stat">
          <span class="sm-ad-report-stat-num">${Object.keys(byTitle).length}</span>
          <span class="sm-ad-report-stat-label">reklam</span>
        </div>
        <div class="sm-ad-report-stat">
          <span class="sm-ad-report-stat-num">${dayCount}</span>
          <span class="sm-ad-report-stat-label">dni</span>
        </div>
      </div>`;

    for (const [title, info] of Object.entries(byTitle)) {
      const avgPerDay = info.daysActive > 0 ? (info.total / info.daysActive).toFixed(1) : 0;
      html += `<div class="sm-ad-report-item">
        <div class="sm-ad-report-item-header">
          <strong>${esc(title)}</strong>
          <span class="sm-ad-report-item-total">${info.total}x</span>
        </div>
        <div class="sm-ad-report-item-meta">
          ${info.daysActive} dni aktywnych &middot; sr. ${avgPerDay}/dzien
        </div>
        <div class="sm-ad-report-item-dates">`;
      for (const d of info.dates.slice(-14)) {
        const barW = Math.min(100, (d.count / Math.max(...info.dates.map(x => x.count))) * 100);
        html += `<div class="sm-ad-report-day">
          <span class="sm-ad-report-day-date">${d.date.slice(5)}</span>
          <div class="sm-ad-report-day-bar" style="width:${barW}%"></div>
          <span class="sm-ad-report-day-count">${d.count}</span>
        </div>`;
      }
      html += '</div></div>';
    }
    html += '</div>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div style="color:#dc2626;padding:8px 12px;">${esc(err.message)}</div>`;
  }
}

function exportAdReportCsv() {
  const start = document.getElementById('ad-report-start').value;
  const end = document.getElementById('ad-report-end').value;
  window.open(`/api/ads/report/csv?start=${start}&end=${end}`, '_blank');
}

async function loadScheduledAdsPanel() {
  const container = document.getElementById('scheduled-ads-panel');
  if (!container) return;

  try {
    const upcoming = await API.get('/ads/upcoming');
    if (upcoming.length === 0) {
      container.innerHTML = '<p class="sm-empty" style="padding:8px 12px;">Brak zaplanowanych reklam na dzis.</p>';
      return;
    }

    let html = '<div style="padding:4px 0;">';
    for (const ad of upcoming) {
      const modeIcon = ad.play_mode === 'interrupt' ? '&#9889;' : '&#9654;';
      const modeTitle = ad.play_mode === 'interrupt' ? 'Przerwij biezacy utwór' : 'Po biezacym utworze';
      const schedInfo = ad.schedule_mode === 'count'
        ? `${ad.today_plays}/${ad.daily_target} odtworzen`
        : `co ${ad.interval_minutes} min`;

      html += `<div class="sm-scheduled-ad">
        <div class="sm-scheduled-ad-time">${ad.next_play_time}</div>
        <div class="sm-scheduled-ad-info">
          <div class="sm-scheduled-ad-title">${esc(ad.title)}</div>
          <div class="sm-scheduled-ad-meta">
            ${ad.client_name ? esc(ad.client_name) + ' · ' : ''}${schedInfo}
            <span title="${modeTitle}" style="margin-left:4px;">${modeIcon}</span>
          </div>
        </div>
        <div class="sm-scheduled-ad-remaining">${ad.remaining_plays > 1 ? `+${ad.remaining_plays - 1}` : ''}</div>
      </div>`;
    }
    html += '</div>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div style="color:#dc2626;padding:8px 12px;font-size:0.85rem;">${esc(err.message)}</div>`;
  }
}
