// --- Modal-based alert/confirm/prompt ---
function smAlert(message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = `
      <p style="margin-bottom: 16px; font-size: 0.95rem;">${esc(message)}</p>
      <div style="text-align: right;">
        <button class="sm-btn sm-btn--primary" id="sm-alert-ok">OK</button>
      </div>
    `;
    document.getElementById('sm-alert-ok').onclick = () => {
      modal.classList.remove('sm-modal--open');
      resolve();
    };
    modal.classList.add('sm-modal--open');
  });
}

function smConfirm(message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = `
      <p style="margin-bottom: 16px; font-size: 0.95rem;">${esc(message)}</p>
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button class="sm-btn" style="background: var(--sm-border); color: var(--sm-text);" id="sm-confirm-no">Anuluj</button>
        <button class="sm-btn sm-btn--primary" id="sm-confirm-yes">Tak</button>
      </div>
    `;
    document.getElementById('sm-confirm-yes').onclick = () => {
      modal.classList.remove('sm-modal--open');
      resolve(true);
    };
    document.getElementById('sm-confirm-no').onclick = () => {
      modal.classList.remove('sm-modal--open');
      resolve(false);
    };
    modal.classList.add('sm-modal--open');
  });
}

function smPrompt(message, defaultValue = '') {
  return new Promise((resolve) => {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = `
      <p style="margin-bottom: 12px; font-size: 0.95rem;">${esc(message)}</p>
      <div class="sm-form-row"><input type="text" id="sm-prompt-input" value="${esc(defaultValue)}"></div>
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button class="sm-btn" style="background: var(--sm-border); color: var(--sm-text);" id="sm-prompt-cancel">Anuluj</button>
        <button class="sm-btn sm-btn--primary" id="sm-prompt-ok">OK</button>
      </div>
    `;
    const input = document.getElementById('sm-prompt-input');
    input.focus();
    input.select();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { modal.classList.remove('sm-modal--open'); resolve(input.value); }
    });
    document.getElementById('sm-prompt-ok').onclick = () => {
      modal.classList.remove('sm-modal--open');
      resolve(input.value);
    };
    document.getElementById('sm-prompt-cancel').onclick = () => {
      modal.classList.remove('sm-modal--open');
      resolve(null);
    };
    modal.classList.add('sm-modal--open');
  });
}

// --- App init ---
document.addEventListener('DOMContentLoaded', () => {
  const socket = io();

  loadUserInfo();

  const tabs = document.querySelectorAll('.sm-nav-tab');
  const sections = document.querySelectorAll('.sm-section');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(t => t.classList.remove('sm-nav-tab--active'));
      sections.forEach(s => s.classList.remove('sm-section--active'));
      tab.classList.add('sm-nav-tab--active');
      document.getElementById(`section-${target}`).classList.add('sm-section--active');
    });
  });

  document.getElementById('modal-close').addEventListener('click', () => {
    document.getElementById('modal').classList.remove('sm-modal--open');
  });
  document.getElementById('modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') {
      document.getElementById('modal').classList.remove('sm-modal--open');
    }
  });

  initPlayer(socket);
  initPlaylists();
  initSchedule();
  initAnnouncements();
  initUsers();
  initRadio();
  initYoutube();
  initAds();
  initCalendar();
  initHistory();
  loadSettings(); // Settings tab — loads playback + TTS config

  // First-run setup wizard
  checkFirstRun();

  // Horizontal timeline + current playlist: update from Socket.IO player state (real-time)
  // Use RAF throttle to prevent multiple updates per frame (reduces blinking)
  let _pendingPlayerState = null;
  let _playerStateRafId = null;

  socket.on('playerState', (state) => {
    _pendingPlayerState = state;
    if (!_playerStateRafId) {
      _playerStateRafId = requestAnimationFrame(() => {
        _playerStateRafId = null;
        if (!_pendingPlayerState) return;
        const s = _pendingPlayerState;
        _pendingPlayerState = null;
        // All UI updates batched in single RAF frame
        if (typeof window._updatePlayerUI === 'function') {
          window._updatePlayerUI(s);
        }
        updateHorizontalTimeline(s);
        if (typeof onPlayerStateUpdate === 'function') {
          onPlayerStateUpdate(s);
        }
      });
    }
  });

  // Auto-refresh when track metadata is updated (e.g. YouTube auto-tag)
  socket.on('trackUpdated', (data) => {
    if (typeof currentPlaylistId !== 'undefined' && currentPlaylistId) {
      loadCurrentPlaylist(currentPlaylistId);
    }
    if (typeof loadTracks === 'function') loadTracks();
  });
  // Initial load (schedule fallback)
  loadHorizontalTimeline();
  // Refresh schedule timeline every 60s (only used when nothing is playing)
  setInterval(loadHorizontalTimeline, 60000);
});

// Toggle collapsible cards
function toggleCard(cardId) {
  document.getElementById(cardId).classList.toggle('sm-card--collapsed');
}

// --- Current user permissions ---
let currentUserPerms = {};

async function loadUserInfo() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      document.getElementById('user-info').textContent = `${data.username} (${data.role})`;
      currentUserPerms = data.permissions || {};
      applyPermissions();
    }
  } catch {}
}

function applyPermissions() {
  const usersTab = document.getElementById('nav-users');
  if (usersTab && !currentUserPerms.user_manage) {
    usersTab.style.display = 'none';
  }
  const settingsTab = document.getElementById('nav-settings');
  if (settingsTab && !currentUserPerms.settings_manage) {
    settingsTab.style.display = 'none';
  }
}

function hasPerm(perm) {
  return !!currentUserPerms[perm];
}

// --- Horizontal Timeline (combined: track queue from socket + schedule) ---
let lastTimelinePlayerStatus = 'stopped';
let _cachedScheduleEvents = null;
let _cachedScheduleTime = 0;

let _lastTimelineTrackId = null;
let _lastTimelineIndex = null;
let _lastTimelineFingerprint = '';
let _lastTimelineRebuild = 0;

function updateHorizontalTimeline(state) {
  const bar = document.getElementById('htimeline-bar');
  if (!bar) return;

  lastTimelinePlayerStatus = state.status;

  // If we have tracks loaded, show track queue timeline
  if (state.playlistTracks && state.playlistTracks.length > 0 && state.status !== 'stopped') {
    const trackId = state.currentTrack ? state.currentTrack.id : null;
    const now = Date.now();

    const fingerprint = state.playlistTracks ? state.playlistTracks.map(t => t.id).join(',') : '';
    // Rebuild timeline when track, index, or playlist content changes, or every 15s
    if (trackId !== _lastTimelineTrackId || state.currentIndex !== _lastTimelineIndex || fingerprint !== _lastTimelineFingerprint || now - _lastTimelineRebuild > 15000) {
      _lastTimelineTrackId = trackId;
      _lastTimelineIndex = state.currentIndex;
      _lastTimelineFingerprint = fingerprint;
      _lastTimelineRebuild = now;
      renderTrackTimeline(bar, state);
    } else {
      // Just update the "now playing" elapsed time without rebuilding DOM
      const nowDur = bar.querySelector('.sm-htl-track--now .sm-htl-track-dur');
      if (nowDur && state.currentTrack) {
        const durStr = state.currentTrack.duration ? formatTime(state.currentTrack.duration) : '';
        const elapsedStr = state.elapsed ? formatTime(state.elapsed) : '0:00';
        nowDur.textContent = `${elapsedStr} / ${durStr}`;
      }
    }
    return;
  }

  // Otherwise schedule timeline is already loaded or will be loaded by interval
}

async function loadHorizontalTimeline() {
  const bar = document.getElementById('htimeline-bar');
  if (!bar) return;

  // If player is active, socket updates handle it — skip schedule load
  if (lastTimelinePlayerStatus === 'playing' || lastTimelinePlayerStatus === 'paused') return;

  await loadScheduleTimeline(bar);
}

// Fetch scheduled announcements (cached for 30s to avoid hammering API on every socket tick)
async function getScheduledAnnouncements() {
  const now = Date.now();
  if (_cachedScheduleEvents && now - _cachedScheduleTime < 30000) {
    return _cachedScheduleEvents;
  }
  try {
    const timeline = await API.get('/schedule/timeline');
    _cachedScheduleEvents = (timeline.events || []).filter(e => e.type === 'announcement');
    _cachedScheduleTime = now;
    return _cachedScheduleEvents;
  } catch {
    return _cachedScheduleEvents || [];
  }
}

function renderTrackTimeline(bar, state) {
  const played = [];
  const upcoming = [];
  let currentTrack = null;

  const realIndex = (idx) => state.shuffle && state.shuffledIndices && state.shuffledIndices.length
    ? state.shuffledIndices[idx] : idx;

  const now = new Date();

  for (let i = 0; i < state.playlistTracks.length; i++) {
    const trackIdx = realIndex(i);
    const track = state.playlistTracks[trackIdx];
    if (!track) continue;

    if (i === state.currentIndex) {
      currentTrack = { ...track, _i: i };
    } else if (i < state.currentIndex) {
      played.push({ ...track, _i: i });
    } else {
      upcoming.push({ ...track, _i: i });
    }
  }

  function calcEstimatedTime(trackListIndex) {
    const curTrackIdx = realIndex(state.currentIndex);
    const curTrack = state.playlistTracks[curTrackIdx];
    const curRemaining = (curTrack?.duration || 0) - (state.elapsed || 0);
    let gap = curRemaining;
    for (let j = state.currentIndex + 1; j < trackListIndex; j++) {
      const jIdx = realIndex(j);
      gap += state.playlistTracks[jIdx]?.duration || 0;
    }
    return new Date(now.getTime() + gap * 1000);
  }

  function fmtTime(date) {
    return date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function renderTrackItem(t, timeStr) {
    const durStr = t.duration ? formatTime(t.duration) : '';
    return `<div class="sm-htl-track" title="${esc(t.title || t.name || '')} (${durStr})">
      <span class="sm-htl-track-time">${timeStr || ''}</span>
      <span class="sm-htl-track-title">${esc(t.title || t.name || 'Unknown')}</span>
      <span class="sm-htl-track-dur">${durStr}</span>
    </div>`;
  }

  function renderAnnouncementItem(ann) {
    const durStr = ann.duration ? formatTime(ann.duration) : '';
    return `<div class="sm-htl-track sm-htl-track--announcement" title="${esc(ann.label)} (komunikat)">
      <span class="sm-htl-track-time">${ann.time || ''}</span>
      <span class="sm-htl-track-title">&#128227; ${esc(ann.label)}</span>
      <span class="sm-htl-track-dur">${durStr}</span>
    </div>`;
  }

  let html = '';

  // Section: Bylo grane (from recentlyPlayed — persists one-shot tracks)
  {
    const recent = (state.recentlyPlayed || []).slice(-3);
    // Exclude current track from "było grane"
    const currentId = state.currentTrack ? state.currentTrack.id : null;
    const filtered = recent.filter(t => t.id !== currentId || t.playedAt !== recent[recent.length - 1]?.playedAt);
    const lastPlayed = filtered.length > 0 ? filtered.slice(-3) : played.slice(-3);
    const tracksHtml = lastPlayed.length > 0
      ? lastPlayed.map(t => renderTrackItem(t, t.playedAt ? new Date(t.playedAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '')).join('')
      : '<div class="sm-htl-track"><span class="sm-htl-track-title" style="color:var(--sm-text-muted);font-style:italic;">—</span></div>';
    html += `<div class="sm-htl-section sm-htl-section--played">
      <div class="sm-htl-section-label">Bylo grane</div>
      <div class="sm-htl-section-tracks">${tracksHtml}</div>
    </div>`;
  }

  // Section: Teraz grane (current track or announcement playing now)
  if (currentTrack) {
    const startTime = new Date(now.getTime() - (state.elapsed || 0) * 1000);
    const durStr = currentTrack.duration ? formatTime(currentTrack.duration) : '';
    const elapsedStr = state.elapsed ? formatTime(state.elapsed) : '0:00';
    html += `<div class="sm-htl-section sm-htl-section--current">
      <div class="sm-htl-section-label">Teraz grane</div>
      <div class="sm-htl-section-tracks">
        <div class="sm-htl-track sm-htl-track--now">
          <span class="sm-htl-track-time">${fmtTime(startTime)}</span>
          <span class="sm-htl-track-title">${esc(currentTrack.title || currentTrack.name || 'Unknown')}</span>
          <span class="sm-htl-track-dur">${elapsedStr} / ${durStr}</span>
        </div>
      </div>
    </div>`;
  }

  // Section: Bedzie grane (next tracks + upcoming announcements interleaved, with + buttons)
  {
    // First insert position: right after current track
    const firstInsertPos = state.currentIndex + 1;

    // Add button after current track
    html += `<div class="sm-htl-add" onclick="showInsertMenu(${firstInsertPos})" title="Dodaj utwor lub komunikat">
      <span class="sm-htl-add-btn">+</span>
    </div>`;

    // Build upcoming items: tracks with estimated times
    const upcomingItems = [];
    const nextUp = upcoming.slice(0, 5);
    for (const t of nextUp) {
      const est = calcEstimatedTime(t._i);
      upcomingItems.push({ type: 'track', track: t, time: est });
    }

    // Merge scheduled announcements from cache (non-blocking)
    const annEvents = _cachedScheduleEvents || [];
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    for (const ann of annEvents) {
      const [h, m] = ann.time.split(':').map(Number);
      const annMinutes = h * 60 + m;
      if (annMinutes > currentMinutes) {
        const annTime = new Date(now);
        annTime.setHours(h, m, 0, 0);
        upcomingItems.push({ type: 'announcement', ann, time: annTime });
      }
    }

    upcomingItems.sort((a, b) => a.time.getTime() - b.time.getTime());

    const itemsToShow = upcomingItems.slice(0, 4);
    let tracksHtml = '';
    if (itemsToShow.length > 0) {
      for (let k = 0; k < itemsToShow.length; k++) {
        const item = itemsToShow[k];
        if (item.type === 'announcement') {
          tracksHtml += renderAnnouncementItem(item.ann);
        } else {
          tracksHtml += renderTrackItem(item.track, fmtTime(item.time));
        }
        // Add "+" after each item (insert position = track's playlist index + 1)
        const insertPos = item.type === 'track' ? item.track._i + 1 : firstInsertPos;
        tracksHtml += `<div class="sm-htl-add-inline" onclick="showInsertMenu(${insertPos})" title="Dodaj tutaj">
          <span class="sm-htl-add-btn-sm">+</span>
        </div>`;
      }
    } else {
      tracksHtml = '<div class="sm-htl-track"><span class="sm-htl-track-title" style="color:var(--sm-text-muted);font-style:italic;">Brak kolejnych</span></div>';
    }
    html += `<div class="sm-htl-section sm-htl-section--upcoming">
      <div class="sm-htl-section-label">Bedzie grane</div>
      <div class="sm-htl-section-tracks">${tracksHtml}</div>
    </div>`;
  }

  bar.innerHTML = html;

  // Async: refresh scheduled announcements cache in background
  getScheduledAnnouncements();
}

async function loadScheduleTimeline(bar) {
  try {
    const timeline = await API.get('/schedule/timeline');

    if (timeline.closed || !timeline.events || timeline.events.length === 0) {
      bar.innerHTML = '<span class="sm-htl-empty">Brak wydarzen na dzisiaj</span>';
      return;
    }

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // Build event list with timestamps
    const events = timeline.events.map(event => {
      const [h, m] = event.time.split(':').map(Number);
      return { ...event, minutes: h * 60 + m };
    });

    // Find the "current" event: last event that already started (minutes <= now)
    let currentIdx = -1;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].minutes <= currentMinutes) {
        currentIdx = i;
        break;
      }
    }

    function renderEvent(ev) {
      return `<div class="sm-htl-event sm-htl-event--${ev.type}" title="${esc(ev.label)}">
        <span class="sm-htl-time">${ev.time}</span>
        <span class="sm-htl-dot"></span>
        <span class="sm-htl-label">${esc(ev.label)}</span>
      </div>`;
    }

    const pastEvents = currentIdx > 0 ? events.slice(0, currentIdx).map(renderEvent) : [];
    const currentEvent = currentIdx >= 0 ? [renderEvent(events[currentIdx])] : [];
    const futureEvents = events.slice(currentIdx + 1).map(renderEvent);

    let html = '';

    if (pastEvents.length > 0) {
      html += `<div class="sm-htl-section sm-htl-section--played">
        <div class="sm-htl-section-label">Bylo</div>
        <div class="sm-htl-section-tracks">${pastEvents.join('')}</div>
      </div>`;
    }

    if (currentEvent.length > 0) {
      html += `<div class="sm-htl-section sm-htl-section--current">
        <div class="sm-htl-section-label">Teraz</div>
        <div class="sm-htl-section-tracks">${currentEvent.join('')}</div>
      </div>`;
    }

    if (futureEvents.length > 0) {
      html += `<div class="sm-htl-section sm-htl-section--upcoming">
        <div class="sm-htl-section-label">Nadchodzi</div>
        <div class="sm-htl-section-tracks">${futureEvents.join('')}</div>
      </div>`;
    }

    bar.innerHTML = html;

    // Scroll to current position
    const currentSection = bar.querySelector('.sm-htl-section--current') || bar.querySelector('.sm-htl-section--upcoming');
    if (currentSection) {
      currentSection.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  } catch {
    bar.innerHTML = '<span class="sm-htl-empty">Plan dnia niedostepny</span>';
  }
}

async function logout() {
  if (!await smConfirm('Wylogować?')) return;
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}

function changePassword() {
  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modal-body');
  modalBody.innerHTML = `
    <h2>Zmiana hasła</h2>
    <div class="sm-form-row"><label>Aktualne hasło: <input type="password" id="cp-current"></label></div>
    <div class="sm-form-row"><label>Nowe hasło: <input type="password" id="cp-new"></label></div>
    <div class="sm-form-row"><label>Powtórz nowe hasło: <input type="password" id="cp-confirm"></label></div>
    <div id="cp-error" style="color: #dc2626; font-size: 0.85rem; margin-bottom: 8px;"></div>
    <button id="cp-save" class="sm-btn sm-btn--primary">Zmień hasło</button>
  `;

  document.getElementById('cp-save').onclick = async () => {
    const current = document.getElementById('cp-current').value;
    const newPw = document.getElementById('cp-new').value;
    const confirmPw = document.getElementById('cp-confirm').value;
    const errEl = document.getElementById('cp-error');

    if (!current || !newPw) { errEl.textContent = 'Wypełnij wszystkie pola'; return; }
    if (newPw !== confirmPw) { errEl.textContent = 'Hasła nie są takie same'; return; }
    if (newPw.length < 4) { errEl.textContent = 'Hasło musi mieć min. 4 znaki'; return; }

    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: current, newPassword: newPw }),
    });
    const data = await res.json();

    if (res.ok) {
      modal.classList.remove('sm-modal--open');
      await smAlert('Hasło zmienione!');
    } else {
      errEl.textContent = data.error || 'Błąd zmiany hasła';
    }
  };

  modal.classList.add('sm-modal--open');
}

async function restartPlayer() {
  if (!await smConfirm('Restartować silnik audio (mpv)?')) return;
  try {
    await API.post('/player/restart');
    await smAlert('Player zrestartowany.');
  } catch (err) {
    await smAlert('Błąd: ' + err.message);
  }
}

async function restartServer() {
  if (!await smConfirm('Restartować serwer? Odtwarzanie zostanie przerwane.')) return;
  try {
    await API.post('/server/restart');
    await smAlert('Serwer się restartuje. Strona odświeży się za chwilę...');
    setTimeout(() => window.location.reload(), 3000);
  } catch {
    setTimeout(() => window.location.reload(), 3000);
  }
}

// --- First-run setup wizard ---

async function checkFirstRun() {
  try {
    const settings = await API.get('/schedule/settings');
    if (settings.setup_completed) return;
    showSetupWizard();
  } catch {}
}

async function showSetupWizard() {
  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modal-body');

  modalBody.innerHTML = `
    <div id="setup-wizard">
      <h2 style="margin-bottom:4px;">Witaj w Store Music Manager!</h2>
      <p class="sm-text-muted" style="margin-bottom:16px;">Skonfiguruj podstawowe ustawienia, aby zaczac.</p>

      <div id="setup-steps">
        <div id="setup-step-1" class="setup-step">
          <h3>1. Nazwa sklepu / lokalu</h3>
          <div class="sm-form-row">
            <input type="text" id="setup-store-name" class="sm-input" placeholder="np. Sklep Sportowy Arena">
          </div>
        </div>

        <div id="setup-step-2" class="setup-step" style="margin-top:16px;">
          <h3>2. Godziny pracy</h3>
          <div style="display:flex;gap:12px;">
            <div class="sm-form-row" style="flex:1;">
              <label>Otwarcie</label>
              <input type="time" id="setup-open-time" class="sm-input" value="09:00">
            </div>
            <div class="sm-form-row" style="flex:1;">
              <label>Zamkniecie</label>
              <input type="time" id="setup-close-time" class="sm-input" value="20:00">
            </div>
          </div>
          <div class="sm-form-row" style="margin-top:8px;">
            <label>Dni pracy</label>
            <div style="display:flex;gap:6px;flex-wrap:wrap;" id="setup-days">
              <label style="font-weight:normal;cursor:pointer;"><input type="checkbox" value="1" checked> Pon</label>
              <label style="font-weight:normal;cursor:pointer;"><input type="checkbox" value="2" checked> Wt</label>
              <label style="font-weight:normal;cursor:pointer;"><input type="checkbox" value="3" checked> Sr</label>
              <label style="font-weight:normal;cursor:pointer;"><input type="checkbox" value="4" checked> Czw</label>
              <label style="font-weight:normal;cursor:pointer;"><input type="checkbox" value="5" checked> Pt</label>
              <label style="font-weight:normal;cursor:pointer;"><input type="checkbox" value="6" checked> Sob</label>
              <label style="font-weight:normal;cursor:pointer;"><input type="checkbox" value="0"> Ndz</label>
            </div>
          </div>
        </div>

        <div id="setup-step-3" class="setup-step" style="margin-top:16px;">
          <h3>3. Glosnosc i odtwarzanie</h3>
          <div class="sm-form-row">
            <label>Glosnosc domyslna: <span id="setup-vol-val">50</span>%</label>
            <input type="range" id="setup-volume" min="0" max="100" value="50" class="sm-input"
              oninput="document.getElementById('setup-vol-val').textContent=this.value">
          </div>
          <div class="sm-form-row" style="margin-top:8px;">
            <label style="font-weight:normal;cursor:pointer;">
              <input type="checkbox" id="setup-auto-play" checked> Automatycznie rozpocznij odtwarzanie po otwarciu
            </label>
          </div>
          <div class="sm-form-row">
            <label style="font-weight:normal;cursor:pointer;">
              <input type="checkbox" id="setup-auto-stop" checked> Automatycznie zatrzymaj po zamknieciu
            </label>
          </div>
        </div>

        <div id="setup-step-4" class="setup-step" style="margin-top:16px;">
          <h3>4. Uzytkownicy</h3>
          <p class="sm-text-muted" style="font-size:0.85rem;margin-bottom:8px;">Konto admin juz istnieje. Dodaj dodatkowych uzytkownikow (opcjonalnie).</p>
          <div id="setup-users-list"></div>
          <div style="display:flex;gap:6px;align-items:center;margin-top:8px;">
            <input type="text" id="setup-new-user" class="sm-input" placeholder="Login" style="flex:1;">
            <input type="password" id="setup-new-pass" class="sm-input" placeholder="Haslo" style="flex:1;">
            <select id="setup-new-role" class="sm-input" style="flex:1;">
              <option value="operator">Operator</option>
              <option value="admin">Administrator</option>
            </select>
            <button onclick="setupAddUser()" class="sm-btn sm-btn--small">Dodaj</button>
          </div>
        </div>

        <div id="setup-step-5" class="setup-step" style="margin-top:16px;">
          <h3>5. Silnik TTS (opcjonalnie)</h3>
          <div class="sm-form-row">
            <select id="setup-tts" class="sm-input">
              <option value="google">Google TTS (online, darmowy)</option>
              <option value="edge">Edge TTS (online, lepsza jakosc)</option>
              <option value="elevenlabs">ElevenLabs (online, premium)</option>
              <option value="">Bez TTS</option>
            </select>
          </div>
        </div>
      </div>

      <div id="setup-status" style="margin-top:8px;color:#dc2626;font-size:0.85rem;"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
        <button onclick="skipSetupWizard()" class="sm-btn" style="background:var(--sm-border);color:var(--sm-text);">Pomin</button>
        <button onclick="submitSetupWizard()" class="sm-btn sm-btn--primary">Zapisz i rozpocznij</button>
      </div>
    </div>
  `;

  modal.classList.add('sm-modal--open');
}

async function submitSetupWizard() {
  const storeName = document.getElementById('setup-store-name')?.value?.trim() || '';
  const openTime = document.getElementById('setup-open-time')?.value || '09:00';
  const closeTime = document.getElementById('setup-close-time')?.value || '20:00';
  const volume = parseInt(document.getElementById('setup-volume')?.value || '50');
  const autoPlay = document.getElementById('setup-auto-play')?.checked || false;
  const autoStop = document.getElementById('setup-auto-stop')?.checked || false;
  const ttsEngine = document.getElementById('setup-tts')?.value || 'google';

  // Collect working days
  const dayCheckboxes = document.querySelectorAll('#setup-days input[type="checkbox"]');
  const workDays = [];
  dayCheckboxes.forEach(cb => { if (cb.checked) workDays.push(parseInt(cb.value)); });

  const statusEl = document.getElementById('setup-status');
  statusEl.textContent = 'Zapisywanie...';
  statusEl.style.color = 'var(--sm-text)';

  try {
    // Save settings
    await API.put('/schedule/settings', {
      volume: volume,
      autoPlayOnOpen: autoPlay,
      autoStopOnClose: autoStop,
      ttsEngine: ttsEngine,
      storeName: storeName,
      setup_completed: true,
    });

    // Save store hours for working days
    const dayNames = { 0: 'sunday', 1: 'monday', 2: 'tuesday', 3: 'wednesday', 4: 'thursday', 5: 'friday', 6: 'saturday' };
    const hours = {};
    for (let d = 0; d < 7; d++) {
      if (workDays.includes(d)) {
        hours[dayNames[d]] = { open: openTime, close: closeTime, closed: false };
      } else {
        hours[dayNames[d]] = { open: '00:00', close: '00:00', closed: true };
      }
    }
    await API.put('/schedule/hours', hours);

    // Create additional users
    for (const u of _setupUsers) {
      try {
        // Get role id - try to find existing or use null
        const roles = await API.get('/users/roles');
        let roleId = null;
        if (u.role === 'admin') {
          const adminRole = roles.find(r => r.name === 'admin' || r.name === 'Administrator');
          if (adminRole) roleId = adminRole.id;
        } else {
          const opRole = roles.find(r => r.name === 'operator' || r.name === 'Operator');
          if (opRole) roleId = opRole.id;
        }
        await API.post('/users', { username: u.username, password: u.password, role_id: roleId });
      } catch (e) { console.warn('User create failed:', u.username, e.message); }
    }

    document.getElementById('modal').classList.remove('sm-modal--open');

    // Reload settings
    if (typeof loadSettings === 'function') loadSettings();
    if (typeof loadStoreHours === 'function') loadStoreHours();
    if (typeof loadTimeline === 'function') loadTimeline();

    await smAlert('Konfiguracja zapisana! Mozesz teraz dodac muzke i utworzyc pierwsza playliste.');
  } catch (err) {
    statusEl.textContent = 'Blad: ' + err.message;
    statusEl.style.color = '#dc2626';
  }
}

let _setupUsers = [];

function setupAddUser() {
  const login = document.getElementById('setup-new-user')?.value?.trim();
  const pass = document.getElementById('setup-new-pass')?.value?.trim();
  const role = document.getElementById('setup-new-role')?.value || 'operator';
  if (!login || !pass) return;

  _setupUsers.push({ username: login, password: pass, role });
  document.getElementById('setup-new-user').value = '';
  document.getElementById('setup-new-pass').value = '';

  const list = document.getElementById('setup-users-list');
  if (list) {
    list.innerHTML = _setupUsers.map((u, i) =>
      '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:0.85rem;">' +
        '<span style="flex:1;"><strong>' + esc(u.username) + '</strong> — ' + u.role + '</span>' +
        '<button onclick="_setupUsers.splice(' + i + ',1);setupAddUser.renderList()" class="sm-btn sm-btn--danger sm-btn--small">&#10005;</button>' +
      '</div>'
    ).join('');
  }
}
setupAddUser.renderList = function() {
  const list = document.getElementById('setup-users-list');
  if (!list) return;
  list.innerHTML = _setupUsers.map((u, i) =>
    '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:0.85rem;">' +
      '<span style="flex:1;"><strong>' + esc(u.username) + '</strong> — ' + u.role + '</span>' +
      '<button onclick="_setupUsers.splice(' + i + ',1);setupAddUser.renderList()" class="sm-btn sm-btn--danger sm-btn--small">&#10005;</button>' +
    '</div>'
  ).join('');
};

async function skipSetupWizard() {
  try {
    await API.put('/schedule/settings', { setup_completed: true });
  } catch {}
  document.getElementById('modal').classList.remove('sm-modal--open');
}
