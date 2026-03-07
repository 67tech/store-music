async function initAnnouncements() {
  await loadAnnouncements();
  await loadScheduledAnnouncements();
  loadScheduledAnnouncementsPanel();
  setInterval(loadScheduledAnnouncementsPanel, 60000);

  document.getElementById('btn-upload-announcement').onclick = () => document.getElementById('announcement-file-input').click();
  document.getElementById('announcement-file-input').onchange = uploadAnnouncement;
  document.getElementById('btn-create-tts').onclick = createTts;
}

async function loadAnnouncements() {
  const announcements = await API.get('/announcements');
  const container = document.getElementById('announcements-list');
  container.innerHTML = '';

  if (announcements.length === 0) {
    container.innerHTML = '<p class="sm-empty">Brak komunikatów. Wgraj plik audio lub utwórz z tekstu (TTS).</p>';
    return;
  }

  for (const a of announcements) {
    const div = document.createElement('div');
    div.className = 'sm-announcement-card';
    div.innerHTML = `
      <div class="sm-announcement-info">
        <strong>${esc(a.name)}</strong>
        <span class="sm-badge sm-badge--${a.type}">${a.type === 'tts' ? 'TTS' : 'Audio'}</span>
        <span>${formatTime(a.duration)}</span>
        ${a.tts_text ? `<small class="sm-tts-text">"${esc(a.tts_text)}"</small>` : ''}
      </div>
      <div class="sm-announcement-actions">
        <button onclick="editAnnouncement(${a.id})" class="sm-btn sm-btn--small">Edytuj</button>
        <button onclick="previewAnnouncement(${a.id})" class="sm-btn sm-btn--small" title="Odtwórz teraz">&#9654; Test</button>
        <button onclick="scheduleAnnouncementPrompt(${a.id})" class="sm-btn sm-btn--small">&#128339; Zaplanuj</button>
        <button onclick="deleteAnnouncement(${a.id})" class="sm-btn sm-btn--danger sm-btn--small">&#10005;</button>
      </div>
    `;
    container.appendChild(div);
  }
}

async function loadScheduledAnnouncements() {
  const scheduled = await API.get('/announcements/scheduled');
  const container = document.getElementById('scheduled-announcements-list');
  container.innerHTML = '';

  if (scheduled.length === 0) {
    container.innerHTML = '<p class="sm-empty">Brak zaplanowanych komunikatów</p>';
    return;
  }

  const triggerLabels = {
    fixed_time: 'O godzinie',
    before_close: 'Przed zamknięciem',
    after_open: 'Po otwarciu',
    specific_date: 'Konkretna data',
  };

  for (const sa of scheduled) {
    let daysInfo = '';
    if (sa.trigger_type === 'specific_date') {
      daysInfo = sa.trigger_value; // "2026-03-15 14:30"
    } else {
      let days;
      try { days = JSON.parse(sa.days_of_week); } catch { days = []; }
      daysInfo = 'Dni: ' + days.map(d => DAY_NAMES[d].substring(0, 3)).join(', ');
    }

    let triggerDisplay = '';
    if (sa.trigger_type === 'specific_date') {
      triggerDisplay = sa.trigger_value;
    } else if (sa.trigger_type === 'fixed_time') {
      triggerDisplay = sa.trigger_value;
    } else {
      triggerDisplay = sa.trigger_value + ' min';
    }

    const playModeLabel = (sa.play_mode || 'interrupt') === 'queue' ? 'Kolejka' : 'Przerwij';
    const playModeIcon = (sa.play_mode || 'interrupt') === 'queue' ? '&#9654;' : '&#9889;';

    const div = document.createElement('div');
    div.className = `sm-scheduled-card ${sa.is_active ? '' : 'sm-scheduled-card--inactive'}`;
    div.innerHTML = `
      <div class="sm-scheduled-info">
        <strong>${esc(sa.announcement_name)}</strong>
        <span>${triggerLabels[sa.trigger_type] || sa.trigger_type}: ${triggerDisplay}</span>
        <small>${daysInfo} · ${playModeIcon} ${playModeLabel}</small>
        ${sa.volume_override ? `<small>Głośność: ${sa.volume_override}%</small>` : ''}
      </div>
      <div class="sm-scheduled-actions">
        <button onclick="editScheduled(${sa.id})" class="sm-btn sm-btn--small">Edytuj</button>
        <button onclick="toggleScheduledActive(${sa.id}, ${sa.is_active ? 0 : 1})" class="sm-btn sm-btn--small">${sa.is_active ? 'Wyłącz' : 'Włącz'}</button>
        <button onclick="deleteScheduled(${sa.id})" class="sm-btn sm-btn--danger sm-btn--small">&#10005;</button>
      </div>
    `;
    container.appendChild(div);
  }
}

async function uploadAnnouncement() {
  const input = document.getElementById('announcement-file-input');
  if (!input.files.length) return;

  const name = await smPrompt('Nazwa komunikatu:', input.files[0].name.replace(/\.[^.]+$/, ''));
  if (!name) { input.value = ''; return; }

  const formData = new FormData();
  formData.append('file', input.files[0]);
  formData.append('name', name);
  await API.upload('/announcements/upload', formData);
  input.value = '';
  await loadAnnouncements();
}

async function createTts() {
  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modal-body');
  modalBody.innerHTML = `
    <h2>Generuj komunikat TTS</h2>
    <div class="sm-form-row"><label>Nazwa: <input type="text" id="tts-name" placeholder="Komunikat zamknięcia"></label></div>
    <div class="sm-form-row"><label>Tekst do odczytania:</label>
      <textarea id="tts-text" rows="4" placeholder="Szanowni Państwo, informujemy że sklep zostanie zamknięty za 30 minut..."></textarea>
    </div>
    <div class="sm-form-row"><label>Silnik:
      <select id="tts-engine" onchange="onTtsEngineChange()">
        <option value="edge">Edge TTS (najlepsze głosy)</option>
        <option value="google">Google TTS</option>
        <option value="piper">Piper (offline)</option>
      </select>
    </label></div>
    <div class="sm-form-row" id="ins-tts-voice-row">
      <label>Głos:
        <select id="ins-tts-voice">
          <optgroup label="Polski">
            <option value="pl-PL-ZofiaNeural" selected>Zofia (kobieta, PL)</option>
            <option value="pl-PL-MarekNeural">Marek (mężczyzna, PL)</option>
          </optgroup>
          <optgroup label="English">
            <option value="en-US-JennyNeural">Jenny (female, US)</option>
            <option value="en-US-GuyNeural">Guy (male, US)</option>
            <option value="en-GB-SoniaNeural">Sonia (female, UK)</option>
            <option value="en-GB-RyanNeural">Ryan (male, UK)</option>
          </optgroup>
          <optgroup label="Deutsch">
            <option value="de-DE-KatjaNeural">Katja (weiblich, DE)</option>
            <option value="de-DE-ConradNeural">Conrad (männlich, DE)</option>
          </optgroup>
        </select>
      </label>
    </div>
    <div class="sm-form-row" id="ins-tts-lang-row" style="display:none;"><label>Język:
      <select id="tts-lang">
        <option value="pl">Polski</option>
        <option value="en">English</option>
        <option value="de">Deutsch</option>
      </select>
    </label></div>
    <button id="tts-generate" class="sm-btn sm-btn--primary">Generuj</button>
    <div id="tts-status"></div>
  `;

  document.getElementById('tts-generate').onclick = async () => {
    const text = document.getElementById('tts-text').value.trim();
    if (!text) { await smAlert('Wpisz tekst!'); return; }

    document.getElementById('tts-status').textContent = 'Generowanie...';
    const engine = document.getElementById('tts-engine').value;
    try {
      await API.post('/announcements/tts', {
        name: document.getElementById('tts-name').value || text.substring(0, 50),
        text,
        engine,
        language: engine !== 'edge' ? document.getElementById('tts-lang').value : undefined,
        voice: engine === 'edge' ? document.getElementById('ins-tts-voice').value : undefined,
      });
      modal.classList.remove('sm-modal--open');
      await loadAnnouncements();
    } catch (err) {
      document.getElementById('tts-status').textContent = 'Błąd: ' + err.message;
    }
  };

  modal.classList.add('sm-modal--open');
}

async function editAnnouncement(id) {
  const announcements = await API.get('/announcements');
  const a = announcements.find(x => x.id === id);
  if (!a) return;

  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modal-body');

  const isTts = a.type === 'tts';

  modalBody.innerHTML = `
    <h2>Edytuj komunikat</h2>
    <div class="sm-form-row"><label>Nazwa: <input type="text" id="edit-ann-name" value="${esc(a.name)}"></label></div>
    ${isTts ? `
      <div class="sm-form-row"><label>Tekst TTS:</label>
        <textarea id="edit-ann-text" rows="4">${esc(a.tts_text || '')}</textarea>
      </div>
      <div class="sm-form-row"><label>Silnik:
        <select id="edit-ann-engine">
          <option value="google" ${a.tts_engine === 'google' ? 'selected' : ''}>Google TTS</option>
          <option value="piper" ${a.tts_engine === 'piper' ? 'selected' : ''}>Piper (offline)</option>
        </select>
      </label></div>
      <div class="sm-form-row"><label>Język:
        <select id="edit-ann-lang">
          <option value="pl">Polski</option>
          <option value="en">English</option>
          <option value="de">Deutsch</option>
        </select>
      </label></div>
    ` : `
      <p style="font-size: 0.85rem; color: var(--sm-text-muted);">Typ: Audio (${formatTime(a.duration)})</p>
    `}
    <div id="edit-ann-status"></div>
    <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px;">
      <button class="sm-btn" style="background: var(--sm-border); color: var(--sm-text);" onclick="document.getElementById('modal').classList.remove('sm-modal--open')">Anuluj</button>
      <button id="edit-ann-save" class="sm-btn sm-btn--primary">Zapisz</button>
    </div>
  `;

  document.getElementById('edit-ann-save').onclick = async () => {
    const name = document.getElementById('edit-ann-name').value.trim();
    if (!name) { await smAlert('Podaj nazwę!'); return; }

    const data = { name };

    if (isTts) {
      const newText = document.getElementById('edit-ann-text').value.trim();
      if (newText && newText !== a.tts_text) {
        data.tts_text = newText;
        data.tts_engine = document.getElementById('edit-ann-engine').value;
        data.tts_language = document.getElementById('edit-ann-lang').value;
        document.getElementById('edit-ann-status').textContent = 'Regenerowanie audio...';
      }
    }

    try {
      await API.put(`/announcements/${id}`, data);
      modal.classList.remove('sm-modal--open');
      await loadAnnouncements();
    } catch (err) {
      document.getElementById('edit-ann-status').textContent = 'Błąd: ' + err.message;
    }
  };

  modal.classList.add('sm-modal--open');
}

async function previewAnnouncement(id) {
  if (!await smConfirm('Odtworzyć komunikat teraz? (Muzyka zostanie wstrzymana)')) return;
  await API.post(`/announcements/${id}/preview`);
}

async function deleteAnnouncement(id) {
  if (!await smConfirm('Usunąć komunikat?')) return;
  await API.del(`/announcements/${id}`);
  await loadAnnouncements();
  await loadScheduledAnnouncements();
}

async function scheduleAnnouncementPrompt(announcementId) {
  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modal-body');
  const todayStr = new Date().toISOString().slice(0, 10);
  modalBody.innerHTML = `
    <h2>Zaplanuj komunikat</h2>
    <div class="sm-form-row"><label>Typ wyzwalacza:
      <select id="sched-type" onchange="schedTypeChange()">
        <option value="before_close">Przed zamknięciem</option>
        <option value="after_open">Po otwarciu</option>
        <option value="fixed_time">O stałej godzinie (cyklicznie)</option>
        <option value="specific_date">Konkretna data z kalendarza</option>
      </select>
    </label></div>
    <div class="sm-form-row" id="sched-minutes-row">
      <label>Minuty: <input type="number" id="sched-minutes" value="30" min="1" max="480"></label>
    </div>
    <div class="sm-form-row" id="sched-time-row" style="display:none">
      <label>Godzina: <input type="time" id="sched-time" value="14:00"></label>
    </div>
    <div class="sm-form-row" id="sched-date-row" style="display:none">
      <label>Data: <input type="date" id="sched-date" min="${todayStr}"></label>
      <label style="margin-top:8px">Godzina: <input type="time" id="sched-date-time" value="14:00"></label>
    </div>
    <div class="sm-form-row" id="sched-days-row"><label>Dni tygodnia:</label>
      <div class="sm-days-checkboxes">
        ${DAY_NAMES.map((name, i) => `<label><input type="checkbox" value="${i}" ${i >= 1 && i <= 5 ? 'checked' : ''}> ${name.substring(0, 3)}</label>`).join('')}
      </div>
    </div>
    <div class="sm-form-row"><label>Głośność (opcjonalnie): <input type="number" id="sched-volume" placeholder="np. 80" min="0" max="100"></label></div>
    <div class="sm-form-row"><label>Tryb odtwarzania:
      <select id="sched-playmode" class="sm-input">
        <option value="interrupt">Przerwij (natychmiastowe odtworzenie)</option>
        <option value="queue">Kolejka (po biezacym utworze)</option>
      </select>
    </label></div>
    <button id="sched-save" class="sm-btn sm-btn--primary">Zapisz</button>
  `;

  window.schedTypeChange = () => {
    const type = document.getElementById('sched-type').value;
    const isSpecific = type === 'specific_date';
    const isFixed = type === 'fixed_time';
    const isRelative = type === 'before_close' || type === 'after_open';
    document.getElementById('sched-minutes-row').style.display = isRelative ? '' : 'none';
    document.getElementById('sched-time-row').style.display = isFixed ? '' : 'none';
    document.getElementById('sched-date-row').style.display = isSpecific ? '' : 'none';
    document.getElementById('sched-days-row').style.display = isSpecific ? 'none' : '';
  };

  document.getElementById('sched-save').onclick = async () => {
    const type = document.getElementById('sched-type').value;
    let triggerValue;
    let days;

    if (type === 'specific_date') {
      const date = document.getElementById('sched-date').value;
      const time = document.getElementById('sched-date-time').value;
      if (!date || !time) { await smAlert('Wybierz datę i godzinę!'); return; }
      triggerValue = `${date} ${time}`;
      days = [0, 1, 2, 3, 4, 5, 6];
    } else if (type === 'fixed_time') {
      triggerValue = document.getElementById('sched-time').value;
      days = [...document.querySelectorAll('.sm-days-checkboxes input:checked')].map(cb => parseInt(cb.value));
    } else {
      triggerValue = document.getElementById('sched-minutes').value;
      days = [...document.querySelectorAll('.sm-days-checkboxes input:checked')].map(cb => parseInt(cb.value));
    }

    const volume = document.getElementById('sched-volume').value;

    await API.post('/announcements/scheduled', {
      announcement_id: announcementId,
      trigger_type: type,
      trigger_value: triggerValue,
      days_of_week: days,
      is_active: true,
      volume_override: volume ? parseInt(volume) : null,
      play_mode: document.getElementById('sched-playmode').value,
    });

    modal.classList.remove('sm-modal--open');
    await loadScheduledAnnouncements();
  };

  modal.classList.add('sm-modal--open');
}

async function editScheduled(id) {
  const scheduled = await API.get('/announcements/scheduled');
  const sa = scheduled.find(s => s.id === id);
  if (!sa) return;

  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modal-body');
  const todayStr = new Date().toISOString().slice(0, 10);

  const isRelative = sa.trigger_type === 'before_close' || sa.trigger_type === 'after_open';
  const isFixed = sa.trigger_type === 'fixed_time';
  const isSpecific = sa.trigger_type === 'specific_date';

  let days = [];
  try { days = JSON.parse(sa.days_of_week); } catch {}

  let dateVal = '', dateTimeVal = '14:00';
  if (isSpecific && sa.trigger_value) {
    const parts = sa.trigger_value.split(' ');
    dateVal = parts[0] || '';
    dateTimeVal = parts[1] || '14:00';
  }

  modalBody.innerHTML = `
    <h2>Edytuj zaplanowany komunikat</h2>
    <div class="sm-form-row"><label>Typ wyzwalacza:
      <select id="sched-type" onchange="schedTypeChange()">
        <option value="before_close" ${sa.trigger_type === 'before_close' ? 'selected' : ''}>Przed zamknięciem</option>
        <option value="after_open" ${sa.trigger_type === 'after_open' ? 'selected' : ''}>Po otwarciu</option>
        <option value="fixed_time" ${sa.trigger_type === 'fixed_time' ? 'selected' : ''}>O stałej godzinie (cyklicznie)</option>
        <option value="specific_date" ${sa.trigger_type === 'specific_date' ? 'selected' : ''}>Konkretna data z kalendarza</option>
      </select>
    </label></div>
    <div class="sm-form-row" id="sched-minutes-row" style="${isRelative ? '' : 'display:none'}">
      <label>Minuty: <input type="number" id="sched-minutes" value="${isRelative ? sa.trigger_value : '30'}" min="1" max="480"></label>
    </div>
    <div class="sm-form-row" id="sched-time-row" style="${isFixed ? '' : 'display:none'}">
      <label>Godzina: <input type="time" id="sched-time" value="${isFixed ? sa.trigger_value : '14:00'}"></label>
    </div>
    <div class="sm-form-row" id="sched-date-row" style="${isSpecific ? '' : 'display:none'}">
      <label>Data: <input type="date" id="sched-date" value="${dateVal}" min="${todayStr}"></label>
      <label style="margin-top:8px">Godzina: <input type="time" id="sched-date-time" value="${dateTimeVal}"></label>
    </div>
    <div class="sm-form-row" id="sched-days-row" style="${isSpecific ? 'display:none' : ''}"><label>Dni tygodnia:</label>
      <div class="sm-days-checkboxes">
        ${DAY_NAMES.map((name, i) => `<label><input type="checkbox" value="${i}" ${days.includes(i) ? 'checked' : ''}> ${name.substring(0, 3)}</label>`).join('')}
      </div>
    </div>
    <div class="sm-form-row"><label>Głośność (opcjonalnie): <input type="number" id="sched-volume" value="${sa.volume_override || ''}" placeholder="np. 80" min="0" max="100"></label></div>
    <div class="sm-form-row"><label>Tryb odtwarzania:
      <select id="sched-playmode" class="sm-input">
        <option value="interrupt" ${(sa.play_mode || 'interrupt') === 'interrupt' ? 'selected' : ''}>Przerwij (natychmiastowe odtworzenie)</option>
        <option value="queue" ${sa.play_mode === 'queue' ? 'selected' : ''}>Kolejka (po biezacym utworze)</option>
      </select>
    </label></div>
    <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px;">
      <button class="sm-btn" style="background: var(--sm-border); color: var(--sm-text);" onclick="document.getElementById('modal').classList.remove('sm-modal--open')">Anuluj</button>
      <button id="sched-save" class="sm-btn sm-btn--primary">Zapisz</button>
    </div>
  `;

  window.schedTypeChange = () => {
    const type = document.getElementById('sched-type').value;
    const isSp = type === 'specific_date';
    const isFx = type === 'fixed_time';
    const isRl = type === 'before_close' || type === 'after_open';
    document.getElementById('sched-minutes-row').style.display = isRl ? '' : 'none';
    document.getElementById('sched-time-row').style.display = isFx ? '' : 'none';
    document.getElementById('sched-date-row').style.display = isSp ? '' : 'none';
    document.getElementById('sched-days-row').style.display = isSp ? 'none' : '';
  };

  document.getElementById('sched-save').onclick = async () => {
    const type = document.getElementById('sched-type').value;
    let triggerValue;
    let daysOfWeek;

    if (type === 'specific_date') {
      const date = document.getElementById('sched-date').value;
      const time = document.getElementById('sched-date-time').value;
      if (!date || !time) { await smAlert('Wybierz datę i godzinę!'); return; }
      triggerValue = `${date} ${time}`;
      daysOfWeek = [0, 1, 2, 3, 4, 5, 6];
    } else if (type === 'fixed_time') {
      triggerValue = document.getElementById('sched-time').value;
      daysOfWeek = [...document.querySelectorAll('.sm-days-checkboxes input:checked')].map(cb => parseInt(cb.value));
    } else {
      triggerValue = document.getElementById('sched-minutes').value;
      daysOfWeek = [...document.querySelectorAll('.sm-days-checkboxes input:checked')].map(cb => parseInt(cb.value));
    }

    const volume = document.getElementById('sched-volume').value;

    await API.put(`/announcements/scheduled/${id}`, {
      trigger_type: type,
      trigger_value: triggerValue,
      days_of_week: daysOfWeek,
      volume_override: volume ? parseInt(volume) : null,
      play_mode: document.getElementById('sched-playmode').value,
    });

    modal.classList.remove('sm-modal--open');
    await loadScheduledAnnouncements();
  };

  modal.classList.add('sm-modal--open');
}

async function toggleScheduledActive(id, active) {
  await API.put(`/announcements/scheduled/${id}`, { is_active: !!active });
  await loadScheduledAnnouncements();
}

async function deleteScheduled(id) {
  if (!await smConfirm('Usunąć zaplanowany komunikat?')) return;
  await API.del(`/announcements/scheduled/${id}`);
  await loadScheduledAnnouncements();
}

async function loadScheduledAnnouncementsPanel() {
  const container = document.getElementById('scheduled-announcements-panel');
  if (!container) return;

  try {
    const upcoming = await API.get('/announcements/upcoming');
    if (upcoming.length === 0) {
      container.innerHTML = '<p class="sm-empty" style="padding:8px 12px;">Brak zaplanowanych komunikatów na dziś.</p>';
      return;
    }

    let html = '<div style="padding:4px 0;">';
    for (const ann of upcoming) {
      const modeIcon = ann.play_mode === 'interrupt' ? '&#9889;' : '&#9654;';
      const modeTitle = ann.play_mode === 'interrupt' ? 'Przerwij bieżący utwór' : 'Po bieżącym utworze';
      const playedClass = ann.played ? ' sm-scheduled-ad--played' : '';

      html += `<div class="sm-scheduled-ad${playedClass}">
        <div class="sm-scheduled-ad-time">${ann.trigger_time}</div>
        <div class="sm-scheduled-ad-info">
          <div class="sm-scheduled-ad-title">${esc(ann.announcement_name)}</div>
          <div class="sm-scheduled-ad-meta">
            ${ann.trigger_label}
            <span title="${modeTitle}" style="margin-left:4px;">${modeIcon}</span>
          </div>
        </div>
        ${ann.played ? '<div class="sm-scheduled-ad-remaining" style="color:#16a34a;">&#10003;</div>' : ''}
      </div>`;
    }
    html += '</div>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div style="color:#dc2626;padding:8px 12px;font-size:0.85rem;">${esc(err.message)}</div>`;
  }
}
