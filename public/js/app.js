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
  initHistory();

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
  // Hide users tab if no user_manage permission
  const usersTab = document.getElementById('nav-users');
  if (usersTab && !currentUserPerms.user_manage) {
    usersTab.style.display = 'none';
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
