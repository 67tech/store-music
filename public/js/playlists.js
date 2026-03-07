let allPlaylists = [];
let currentPlaylistId = null;
let currentPlaylistData = null;
let dragSrcIndex = null;

async function initPlaylists() {
  await loadPlaylists();
  await loadTracks();

  document.getElementById('btn-create-playlist').onclick = createPlaylist;
  document.getElementById('btn-upload-track').onclick = showUploadModal;
  // Hidden file input is now triggered from within the modal
  document.getElementById('track-file-input').onchange = onUploadFilesSelected;

  // Playlist selector change
  document.getElementById('playlist-selector').onchange = (e) => {
    const id = parseInt(e.target.value);
    if (id) loadCurrentPlaylist(id);
  };
}

async function toggleLoop() {
  const btn = document.getElementById('btn-loop-toggle');
  const isOn = btn.classList.contains('sm-btn--loop-on');
  try {
    await API.post('/player/loop', { loop: !isOn });
    btn.classList.toggle('sm-btn--loop-on', !isOn);
  } catch {}
}

// Called from app.js when Socket.IO playerState arrives
let _lastPlayerStatePlaylistId = null;
let _lastPlayerState = null;
let _lastPlayerStateTrackFingerprint = '';
function onPlayerStateUpdate(state) {
  _lastPlayerState = state;
  const playlistId = state.playlist?.id;
  // Reload when playlist changes
  if (playlistId && playlistId !== _lastPlayerStatePlaylistId) {
    _lastPlayerStatePlaylistId = playlistId;
    if (playlistId !== currentPlaylistId) {
      currentPlaylistId = playlistId;
      updatePlaylistSelector(playlistId);
      loadCurrentPlaylist(playlistId);
    }
  }
  // Also reload when tracks within the current playlist change (add/remove/reorder)
  if (playlistId && playlistId === currentPlaylistId && state.playlistTracks) {
    const fp = state.playlistTracks.map(t => t.id).join(',');
    if (fp !== _lastPlayerStateTrackFingerprint) {
      _lastPlayerStateTrackFingerprint = fp;
      loadCurrentPlaylist(playlistId);
    }
  }
  // Highlight currently playing track
  if (state.currentTrack) {
    highlightCurrentTrack(state.currentTrack.id, state.status);
  }
  // Sync loop button (only if changed)
  const loopBtn = document.getElementById('btn-loop-toggle');
  if (loopBtn && state.loop !== undefined) {
    const isOn = loopBtn.classList.contains('sm-btn--loop-on');
    if (isOn !== state.loop) {
      loopBtn.classList.toggle('sm-btn--loop-on', state.loop);
    }
  }
}

function updatePlaylistSelector(activeId) {
  const sel = document.getElementById('playlist-selector');
  if (!sel) return;
  for (const opt of sel.options) {
    if (parseInt(opt.value) === activeId) {
      sel.value = activeId;
      break;
    }
  }
}

let _highlightedTrackId = null;
let _highlightedStatus = null;
function highlightCurrentTrack(trackId, status) {
  // Skip if nothing changed
  if (trackId === _highlightedTrackId && status === _highlightedStatus) return;
  _highlightedTrackId = trackId;
  _highlightedStatus = status;

  const container = document.getElementById('current-playlist-tracks');
  if (!container) return;
  const cls = status === 'playing' ? 'sm-cpl-track--playing' : 'sm-cpl-track--paused';
  container.querySelectorAll('.sm-cpl-track').forEach(el => {
    el.classList.remove('sm-cpl-track--playing', 'sm-cpl-track--paused');
    if (parseInt(el.dataset.trackId) === trackId) {
      el.classList.add(cls);
    }
  });
}

async function loadCurrentPlaylist(id) {
  currentPlaylistId = id;
  const container = document.getElementById('current-playlist-tracks');
  if (!container) return;

  try {
    const playlist = await API.get(`/playlists/${id}`);
    if (!playlist || !playlist.id) throw new Error('not found');
    currentPlaylistData = playlist;
    renderCurrentPlaylistTracks(container, playlist);
  } catch {
    // Playlist not in DB — try to show tracks from live player state
    if (_lastPlayerState && _lastPlayerState.playlistTracks && _lastPlayerState.playlistTracks.length > 0) {
      const fallback = {
        id: id,
        name: _lastPlayerState.playlist?.name || 'Aktualna',
        tracks: _lastPlayerState.playlistTracks,
      };
      currentPlaylistData = fallback;
      renderCurrentPlaylistTracks(container, fallback);
    } else {
      currentPlaylistData = null;
      container.innerHTML = '<p class="sm-empty">Nie mozna zaladowac playlisty</p>';
    }
  }
}

function renderCurrentPlaylistTracks(container, playlist) {
  if (!playlist.tracks || playlist.tracks.length === 0) {
    container.innerHTML = `<p class="sm-empty">Playlista jest pusta. Dodaj utwory!</p>
      <div class="sm-cpl-insert" onclick="showInsertMenu(0)" title="Dodaj tutaj"><span class="sm-cpl-insert-btn">+</span></div>`;
    return;
  }

  let html = `<div class="sm-cpl-bulk-bar" id="cpl-bulk-bar" style="display:none;">
    <input type="checkbox" id="cpl-select-all" onchange="cplToggleAll(this.checked)" title="Zaznacz wszystkie">
    <span>Zaznaczono: <strong id="cpl-bulk-count">0</strong></span>
    <button onclick="cplBulkRemove()" class="sm-btn sm-btn--danger sm-btn--small">Usuń zaznaczone</button>
  </div>`;

  for (let i = 0; i < playlist.tracks.length; i++) {
    const t = playlist.tracks[i];
    html += `
    <div class="sm-cpl-track" draggable="true" data-track-id="${t.id}" data-index="${i}"
         ondragstart="cplDragStart(event, ${i})"
         ondragover="cplDragOver(event)"
         ondragenter="cplDragEnter(event)"
         ondragleave="cplDragLeave(event)"
         ondrop="cplDrop(event, ${i})"
         ondragend="cplDragEnd(event)">
      <input type="checkbox" class="cpl-track-cb" value="${t.id}" onchange="cplUpdateBulk()" onclick="event.stopPropagation()">
      <span class="sm-cpl-handle">&#9776;</span>
      <span class="sm-cpl-num">${i + 1}.</span>
      <span class="sm-cpl-title">${esc(t.title || t.name || 'Unknown')}${t.one_shot ? ' <span class="sm-tag sm-tag--oneshot">1x</span>' : ''}</span>
      <span class="sm-cpl-artist">${esc(t.artist || '')}</span>
      <span class="sm-cpl-dur">${formatTime(t.duration)}</span>
      <div class="sm-cpl-actions">
        <button onclick="cplPlayTrack(${i})" class="sm-btn sm-btn--small" title="Odtwórz od tego utworu">&#9654;</button>
        <button onclick="removeFromCurrentPlaylist(${t.id})" class="sm-btn sm-btn--danger sm-btn--small" title="Usun">&#10005;</button>
      </div>
    </div>
    <div class="sm-cpl-insert" onclick="showInsertMenu(${i + 1})" title="Dodaj tutaj"><span class="sm-cpl-insert-btn">+</span></div>`;
  }
  container.innerHTML = html;
}

function cplUpdateBulk() {
  const checked = document.querySelectorAll('.cpl-track-cb:checked');
  const all = document.querySelectorAll('.cpl-track-cb');
  const bar = document.getElementById('cpl-bulk-bar');
  const count = document.getElementById('cpl-bulk-count');
  const selectAll = document.getElementById('cpl-select-all');
  if (bar) bar.style.display = checked.length > 0 ? 'flex' : 'none';
  if (count) count.textContent = checked.length;
  if (selectAll && all.length > 0) {
    selectAll.checked = checked.length === all.length;
    selectAll.indeterminate = checked.length > 0 && checked.length < all.length;
  }
}

function cplToggleAll(checked) {
  document.querySelectorAll('.cpl-track-cb').forEach(cb => { cb.checked = checked; });
  cplUpdateBulk();
}

async function cplBulkRemove() {
  const ids = Array.from(document.querySelectorAll('.cpl-track-cb:checked')).map(cb => parseInt(cb.value));
  if (ids.length === 0) return;
  if (!await smConfirm(`Usunąć ${ids.length} utworów z playlisty?`)) return;
  for (const id of ids) {
    try { await API.del(`/playlists/${currentPlaylistId}/tracks/${id}`); } catch {}
  }
  await loadCurrentPlaylist(currentPlaylistId);
  await loadPlaylists();
}

// Drag & Drop reorder
function cplDragStart(e, idx) {
  dragSrcIndex = idx;
  e.target.classList.add('sm-cpl-track--dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function cplDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function cplDragEnter(e) {
  e.preventDefault();
  const track = e.target.closest('.sm-cpl-track');
  if (track) track.classList.add('sm-cpl-track--over');
}

function cplDragLeave(e) {
  const track = e.target.closest('.sm-cpl-track');
  if (track) track.classList.remove('sm-cpl-track--over');
}

function cplDrop(e, targetIdx) {
  e.preventDefault();
  const track = e.target.closest('.sm-cpl-track');
  if (track) track.classList.remove('sm-cpl-track--over');

  if (dragSrcIndex === null || dragSrcIndex === targetIdx) return;
  if (!currentPlaylistData) return;

  // Reorder locally
  const tracks = [...currentPlaylistData.tracks];
  const [moved] = tracks.splice(dragSrcIndex, 1);
  tracks.splice(targetIdx, 0, moved);

  // Update UI immediately
  currentPlaylistData.tracks = tracks;
  renderCurrentPlaylistTracks(document.getElementById('current-playlist-tracks'), currentPlaylistData);

  // Save to server
  const trackIds = tracks.map(t => t.id);
  API.put(`/playlists/${currentPlaylistId}/reorder`, { trackIds }).catch(() => {
    // Revert on error
    loadCurrentPlaylist(currentPlaylistId);
  });
}

function cplDragEnd(e) {
  e.target.classList.remove('sm-cpl-track--dragging');
  dragSrcIndex = null;
}

async function cplPlayTrack(index) {
  if (!currentPlaylistId) return;
  try {
    await API.post('/player/play', { playlistId: currentPlaylistId, startIndex: index });
  } catch (err) {
    await smAlert('Blad: ' + err.message);
  }
}

let _insertMode = 'queue'; // 'queue' or 'delay'
let _insertDelaySec = 30;

function showInsertMenu(position) {
  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modal-body');

  modalBody.innerHTML = `
    <h2>Dodaj do kolejki</h2>
    <div class="sm-insert-mode" style="margin-bottom: 14px;">
      <label class="sm-insert-mode-opt" style="display:flex;align-items:center;gap:6px;margin-bottom:6px;cursor:pointer;">
        <input type="radio" name="ins-mode" value="queue" ${_insertMode === 'queue' ? 'checked' : ''} onchange="setInsertMode('queue')">
        <span>Dodaj na stałe</span>
        <span style="font-size:0.75rem;color:var(--sm-text-muted);">(zostaje w playliście)</span>
      </label>
      <label class="sm-insert-mode-opt" style="display:flex;align-items:center;gap:6px;margin-bottom:6px;cursor:pointer;">
        <input type="radio" name="ins-mode" value="oneshot" ${_insertMode === 'oneshot' ? 'checked' : ''} onchange="setInsertMode('oneshot')">
        <span>Dodaj jednorazowo</span>
        <span style="font-size:0.75rem;color:var(--sm-text-muted);">(znika po odtworzeniu)</span>
      </label>
      <label class="sm-insert-mode-opt" style="display:flex;align-items:center;gap:6px;cursor:pointer;">
        <input type="radio" name="ins-mode" value="delay" ${_insertMode === 'delay' ? 'checked' : ''} onchange="setInsertMode('delay')">
        <span>Odtwórz za</span>
        <input type="number" id="ins-delay-sec" value="${_insertDelaySec}" min="0" max="3600" step="5"
          style="width:60px;text-align:center;padding:3px 6px;border-radius:6px;border:1px solid var(--sm-border);background:var(--sm-bg);color:var(--sm-text);font-size:0.85rem;"
          ${_insertMode !== 'delay' ? 'disabled' : ''}
          onchange="_insertDelaySec=parseInt(this.value)||0">
        <span>sek.</span>
      </label>
    </div>
    <div class="sm-insert-choices sm-insert-choices--grid">
      <button class="sm-insert-choice" onclick="showInsertList('track', ${position})">
        <span class="sm-insert-choice-icon">&#9835;</span>
        <span class="sm-insert-choice-label">Wybierz utwór</span>
        <span class="sm-insert-choice-desc">Z istniejących utworów</span>
      </button>
      <button class="sm-insert-choice sm-insert-choice--upload" onclick="showUploadTrackForm(${position})">
        <span class="sm-insert-choice-icon">&#128228;</span>
        <span class="sm-insert-choice-label">Wgraj nowy utwór</span>
        <span class="sm-insert-choice-desc">Plik audio z dysku</span>
      </button>
      <button class="sm-insert-choice sm-insert-choice--ann" onclick="showInsertList('announcement', ${position})">
        <span class="sm-insert-choice-icon">&#128227;</span>
        <span class="sm-insert-choice-label">Wybierz komunikat</span>
        <span class="sm-insert-choice-desc">Z istniejących komunikatów</span>
      </button>
      <button class="sm-insert-choice sm-insert-choice--tts" onclick="showTtsForm(${position})">
        <span class="sm-insert-choice-icon">&#128488;</span>
        <span class="sm-insert-choice-label">Generuj TTS</span>
        <span class="sm-insert-choice-desc">Nowy komunikat z tekstu</span>
      </button>
    </div>
  `;
  modal.classList.add('sm-modal--open');
}

function setInsertMode(mode) {
  _insertMode = mode;
  const delayInput = document.getElementById('ins-delay-sec');
  if (delayInput) delayInput.disabled = mode !== 'delay';
}

async function showInsertList(type, position) {
  const modalBody = document.getElementById('modal-body');

  if (type === 'track') {
    modalBody.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <button class="sm-btn sm-btn--small" onclick="showInsertMenu(${position})" style="background:var(--sm-border);color:var(--sm-text);">&#8592; Wstecz</button>
        <h2 style="margin:0;">Wybierz utwor</h2>
      </div>
      <div class="sm-insert-list" id="ins-list">Ladowanie...</div>
      <div id="ins-error" style="color: var(--sm-danger); font-size: 0.85rem; margin-top: 8px;"></div>
    `;

    let tracks = [];
    try { tracks = await API.get('/tracks'); } catch {}
    const listEl = document.getElementById('ins-list');

    if (tracks.length === 0) {
      listEl.innerHTML = '<p class="sm-empty">Brak utworow</p>';
    } else {
      listEl.innerHTML = tracks.map(t => `
        <div class="sm-insert-item" onclick="insertTrackAt(${t.id}, ${position})">
          <div class="sm-insert-item-main">
            <span class="sm-insert-item-title">${esc(t.title || t.filename)}</span>
            <span class="sm-insert-item-meta">${esc(t.artist || '')}</span>
          </div>
          <span class="sm-insert-item-dur">${formatTime(t.duration)}</span>
        </div>
      `).join('');
    }
  } else {
    modalBody.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <button class="sm-btn sm-btn--small" onclick="showInsertMenu(${position})" style="background:var(--sm-border);color:var(--sm-text);">&#8592; Wstecz</button>
        <h2 style="margin:0;">Wybierz komunikat</h2>
      </div>
      <div class="sm-insert-list" id="ins-list">Ladowanie...</div>
      <div id="ins-error" style="color: var(--sm-danger); font-size: 0.85rem; margin-top: 8px;"></div>
    `;

    let announcements = [];
    try { announcements = await API.get('/announcements'); } catch {}
    const listEl = document.getElementById('ins-list');

    if (announcements.length === 0) {
      listEl.innerHTML = '<p class="sm-empty">Brak komunikatow</p>';
    } else {
      listEl.innerHTML = announcements.map(a => `
        <div class="sm-insert-item sm-insert-item--ann" onclick="insertAnnouncementAt(${a.id}, ${position})">
          <div class="sm-insert-item-main">
            <span class="sm-insert-item-title">${esc(a.name)}</span>
          </div>
          <span class="sm-insert-item-dur">${formatTime(a.duration)}</span>
        </div>
      `).join('');
    }
  }
}

async function insertTrackAt(trackId, position) {
  const errEl = document.getElementById('ins-error');

  // Delayed playback mode
  if (_insertMode === 'delay') {
    try {
      const result = await API.post('/player/play-delayed', { trackId, delaySec: _insertDelaySec });
      document.getElementById('modal').classList.remove('sm-modal--open');
      await smAlert(result.message || 'Zaplanowano');
    } catch (err) {
      if (errEl) errEl.textContent = err.message;
    }
    return;
  }

  // Queue mode (default) or one-shot mode
  const oneShot = _insertMode === 'oneshot';
  if (!currentPlaylistId) return;
  try {
    // Add track at end first
    await API.post(`/playlists/${currentPlaylistId}/tracks`, { trackId, oneShot });
    // Then reorder to place at desired position
    const playlist = await API.get(`/playlists/${currentPlaylistId}`);
    const ids = playlist.tracks.map(t => t.id);
    // The new track is at the end — move it to `position`
    const addedId = ids.pop();
    const insertAt = Math.min(position, ids.length);
    ids.splice(insertAt, 0, addedId);
    await API.put(`/playlists/${currentPlaylistId}/reorder`, { trackIds: ids });
    document.getElementById('modal').classList.remove('sm-modal--open');
    await loadCurrentPlaylist(currentPlaylistId);
    await loadPlaylists();
  } catch (err) {
    if (errEl) errEl.textContent = err.message;
  }
}

async function insertAnnouncementAt(annId, position) {
  if (!currentPlaylistId) {
    await smAlert('Najpierw wybierz playlistę!');
    return;
  }
  const errEl = document.getElementById('ins-error');
  try {
    // Convert announcement to track, then insert at position
    const track = await API.post(`/announcements/${annId}/to-track`);
    if (track && track.id) {
      await insertTrackAt(track.id, position);
    }
  } catch (err) {
    if (errEl) errEl.textContent = err.message;
  }
}

function showUploadTrackForm(position) {
  const modalBody = document.getElementById('modal-body');
  modalBody.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
      <button class="sm-btn sm-btn--small" onclick="showInsertMenu(${position})" style="background:var(--sm-border);color:var(--sm-text);">&#8592; Wstecz</button>
      <h2 style="margin:0;">Wgraj nowy utwór</h2>
    </div>
    <div class="sm-form-row">
      <label>Plik audio (MP3, WAV, OGG, FLAC):</label>
      <input type="file" id="ins-upload-file" accept="audio/*" style="display:block;margin-top:4px;">
    </div>
    <div id="ins-upload-status" style="font-size:0.85rem;color:var(--sm-text-muted);margin-bottom:8px;"></div>
    <div id="ins-error" style="color:var(--sm-danger);font-size:0.85rem;margin-top:8px;"></div>
    <button id="ins-upload-btn" class="sm-btn sm-btn--primary" disabled>Wgraj i dodaj do playlisty</button>
  `;

  const fileInput = document.getElementById('ins-upload-file');
  const uploadBtn = document.getElementById('ins-upload-btn');

  fileInput.onchange = () => {
    uploadBtn.disabled = !fileInput.files.length;
  };

  uploadBtn.onclick = async () => {
    if (!fileInput.files.length) return;
    const statusEl = document.getElementById('ins-upload-status');
    const errEl = document.getElementById('ins-error');
    statusEl.textContent = 'Wgrywanie...';
    uploadBtn.disabled = true;

    try {
      const formData = new FormData();
      formData.append('file', fileInput.files[0]);
      const track = await API.upload('/tracks/upload', formData);

      if (currentPlaylistId && track && track.id) {
        statusEl.textContent = 'Dodawanie do playlisty...';
        await insertTrackAt(track.id, position);
      } else {
        document.getElementById('modal').classList.remove('sm-modal--open');
      }
      await loadTracks();
    } catch (err) {
      errEl.textContent = err.message;
      uploadBtn.disabled = false;
      statusEl.textContent = '';
    }
  };
}

function showTtsForm(position) {
  const modalBody = document.getElementById('modal-body');
  modalBody.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
      <button class="sm-btn sm-btn--small" onclick="showInsertMenu(${position})" style="background:var(--sm-border);color:var(--sm-text);">&#8592; Wstecz</button>
      <h2 style="margin:0;">Generuj komunikat TTS</h2>
    </div>
    <div class="sm-form-row"><label>Nazwa: <input type="text" id="ins-tts-name" placeholder="Komunikat zamknięcia"></label></div>
    <div class="sm-form-row"><label>Tekst do odczytania:</label>
      <textarea id="ins-tts-text" rows="4" placeholder="Szanowni Państwo, informujemy że sklep zostanie zamknięty za 30 minut..."></textarea>
    </div>
    <div class="sm-form-row"><label>Silnik:
      <select id="ins-tts-engine" onchange="onTtsEngineChange()">
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
      <select id="ins-tts-lang">
        <option value="pl">Polski</option>
        <option value="en">English</option>
        <option value="de">Deutsch</option>
      </select>
    </label></div>
    <div id="ins-tts-status" style="font-size:0.85rem;color:var(--sm-text-muted);margin-bottom:8px;"></div>
    <div id="ins-error" style="color:var(--sm-danger);font-size:0.85rem;margin-top:8px;"></div>
    <button id="ins-tts-btn" class="sm-btn sm-btn--primary">Generuj i dodaj do kolejki</button>
  `;

  document.getElementById('ins-tts-btn').onclick = async () => {
    const text = document.getElementById('ins-tts-text').value.trim();
    if (!text) { document.getElementById('ins-error').textContent = 'Wpisz tekst!'; return; }

    const statusEl = document.getElementById('ins-tts-status');
    const errEl = document.getElementById('ins-error');
    const btn = document.getElementById('ins-tts-btn');
    statusEl.textContent = 'Generowanie...';
    btn.disabled = true;

    const engine = document.getElementById('ins-tts-engine').value;
    try {
      const announcement = await API.post('/announcements/tts', {
        name: document.getElementById('ins-tts-name').value || text.substring(0, 50),
        text,
        engine,
        language: engine !== 'edge' ? document.getElementById('ins-tts-lang').value : undefined,
        voice: engine === 'edge' ? document.getElementById('ins-tts-voice').value : undefined,
      });

      if (announcement && announcement.id) {
        statusEl.textContent = 'Dodawanie do kolejki...';
        await insertAnnouncementAt(announcement.id, position);
      }

      document.getElementById('modal').classList.remove('sm-modal--open');
      if (typeof loadAnnouncements === 'function') loadAnnouncements();
    } catch (err) {
      errEl.textContent = err.message;
      btn.disabled = false;
      statusEl.textContent = '';
    }
  };
}

function onTtsEngineChange() {
  const engine = document.getElementById('ins-tts-engine').value;
  const voiceRow = document.getElementById('ins-tts-voice-row');
  const langRow = document.getElementById('ins-tts-lang-row');
  if (voiceRow) voiceRow.style.display = engine === 'edge' ? '' : 'none';
  if (langRow) langRow.style.display = engine !== 'edge' ? '' : 'none';
}

async function clearCurrentPlaylist() {
  if (!currentPlaylistId) {
    await smAlert('Najpierw wybierz playlistę!');
    return;
  }
  if (!await smConfirm('Usunąć wszystkie utwory z obecnej playlisty?')) return;
  try {
    await API.delete(`/playlists/${currentPlaylistId}/tracks`);
    await loadCurrentPlaylist(currentPlaylistId);
  } catch (err) {
    await smAlert('Błąd: ' + err.message);
  }
}

async function addAllTracksToPlaylist() {
  if (!currentPlaylistId) {
    await smAlert('Najpierw wybierz playlistę!');
    return;
  }

  const allTracks = await API.get('/tracks');
  if (allTracks.length === 0) {
    await smAlert('Brak utworów w bibliotece.');
    return;
  }

  // Get current playlist tracks to skip duplicates
  const playlist = await API.get(`/playlists/${currentPlaylistId}`);
  const existingIds = new Set((playlist.tracks || []).map(t => t.id));
  const toAdd = allTracks.filter(t => !existingIds.has(t.id));

  if (toAdd.length === 0) {
    await smAlert('Wszystkie utwory są już na playliście.');
    return;
  }

  if (!await smConfirm(`Dodać ${toAdd.length} utworów do playlisty?`)) return;

  for (const track of toAdd) {
    try {
      await API.post(`/playlists/${currentPlaylistId}/tracks`, { trackId: track.id });
    } catch {}
  }

  await loadCurrentPlaylist(currentPlaylistId);
  await loadPlaylists();
}

async function removeFromCurrentPlaylist(trackId) {
  if (!currentPlaylistId) return;
  await API.del(`/playlists/${currentPlaylistId}/tracks/${trackId}`);
  await loadCurrentPlaylist(currentPlaylistId);
}

async function loadPlaylists() {
  const playlists = await API.get('/playlists');
  allPlaylists = playlists;

  // Update playlist selector
  const sel = document.getElementById('playlist-selector');
  if (sel) {
    sel.innerHTML = playlists.map(p =>
      `<option value="${p.id}" ${p.is_default ? 'selected' : ''}>${esc(p.name)} (${p.trackCount} utw.)</option>`
    ).join('');

    // Auto-load default or first playlist if none is active
    if (!currentPlaylistId) {
      const def = playlists.find(p => p.is_default) || playlists[0];
      if (def) loadCurrentPlaylist(def.id);
    }
  }

  // Render playlists list below
  const container = document.getElementById('playlists-list');
  container.innerHTML = '';

  if (playlists.length === 0) {
    container.innerHTML = '<p class="sm-empty">Brak playlist. Utwórz pierwszą!</p>';
    return;
  }

  for (const pl of playlists) {
    const div = document.createElement('div');
    div.className = `sm-playlist-card ${pl.is_default ? 'sm-playlist-card--default' : ''}`;
    div.innerHTML = `
      <div class="sm-playlist-header">
        <h3>${esc(pl.name)} ${pl.is_default ? '<span class="sm-badge">Domyślna</span>' : ''}</h3>
        <span class="sm-track-count">${pl.trackCount} utworów</span>
      </div>
      <div class="sm-playlist-actions">
        <button onclick="playPlaylist(${pl.id})" class="sm-btn sm-btn--play" title="Odtwórz">&#9654;</button>
        <button onclick="toggleDefault(${pl.id}, ${pl.is_default ? 0 : 1})" class="sm-btn sm-btn--small" title="Ustaw jako domyślną">&#9733;</button>
        <button onclick="renamePlaylist(${pl.id})" class="sm-btn sm-btn--small" title="Zmień nazwę">&#9998;</button>
        <button onclick="viewPlaylist(${pl.id})" class="sm-btn sm-btn--small">Edytuj</button>
        <button onclick="deletePlaylist(${pl.id})" class="sm-btn sm-btn--danger sm-btn--small">&#10005;</button>
      </div>
    `;
    container.appendChild(div);
  }
}

async function loadTracks() {
  const tracks = await API.get('/tracks');
  const container = document.getElementById('tracks-list');
  container.innerHTML = '';

  if (tracks.length === 0) {
    container.innerHTML = '<p class="sm-empty">Brak utworów. Wgraj pliki audio!</p>';
    return;
  }

  // Bulk actions bar
  const bulkBar = document.createElement('div');
  bulkBar.className = 'sm-bulk-bar';
  bulkBar.id = 'tracks-bulk-bar';
  bulkBar.style.display = 'none';
  bulkBar.innerHTML = `
    <span class="sm-bulk-info">Zaznaczono: <strong id="tracks-bulk-count">0</strong></span>
    <button onclick="bulkAddToPlaylist()" class="sm-btn sm-btn--small sm-btn--primary">+ Do playlisty</button>
    <button onclick="bulkDeleteTracks()" class="sm-btn sm-btn--danger sm-btn--small">Usuń zaznaczone</button>
    <button onclick="bulkDeleteAllTracks()" class="sm-btn sm-btn--danger sm-btn--small" style="margin-left:auto;">Usuń wszystkie</button>
  `;
  container.appendChild(bulkBar);

  const table = document.createElement('table');
  table.className = 'sm-table';
  table.innerHTML = `<thead><tr>
    <th style="width:32px;"><input type="checkbox" id="tracks-select-all" onchange="toggleAllTracks(this.checked)" title="Zaznacz wszystkie"></th>
    <th>Tytuł</th><th>Artysta</th><th>Playlisty</th><th>Czas</th><th>Akcje</th>
  </tr></thead>`;
  const tbody = document.createElement('tbody');

  for (const track of tracks) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" class="track-checkbox" value="${track.id}" onchange="updateBulkBar()"></td>
      <td>${esc(track.title)}</td>
      <td>${esc(track.artist || '-')}</td>
      <td>${(track.playlists || []).map(p => `<span class="sm-tag">${esc(p.name)}</span>`).join(' ') || '<span class="sm-text-muted">-</span>'}</td>
      <td>${formatTime(track.duration)}</td>
      <td>
        <button onclick="previewTrack(${track.id}, this)" class="sm-btn sm-btn--small" title="Odsluchaj">&#9654;</button>
        <button onclick="addToPlaylistPrompt(${track.id})" class="sm-btn sm-btn--small">+ Playlista</button>
        <button onclick="deleteTrack(${track.id})" class="sm-btn sm-btn--danger sm-btn--small">&#10005;</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);
}

function getSelectedTrackIds() {
  return Array.from(document.querySelectorAll('.track-checkbox:checked')).map(cb => parseInt(cb.value));
}

function updateBulkBar() {
  const selected = getSelectedTrackIds();
  const bar = document.getElementById('tracks-bulk-bar');
  const count = document.getElementById('tracks-bulk-count');
  if (bar) bar.style.display = selected.length > 0 ? 'flex' : 'none';
  if (count) count.textContent = selected.length;
  // Sync "select all" checkbox
  const selectAll = document.getElementById('tracks-select-all');
  const allBoxes = document.querySelectorAll('.track-checkbox');
  if (selectAll && allBoxes.length > 0) {
    selectAll.checked = selected.length === allBoxes.length;
    selectAll.indeterminate = selected.length > 0 && selected.length < allBoxes.length;
  }
}

function toggleAllTracks(checked) {
  document.querySelectorAll('.track-checkbox').forEach(cb => { cb.checked = checked; });
  updateBulkBar();
}

async function bulkAddToPlaylist() {
  const ids = getSelectedTrackIds();
  if (ids.length === 0) return;
  if (!currentPlaylistId) {
    await smAlert('Najpierw wybierz playlistę!');
    return;
  }
  if (!await smConfirm(`Dodać ${ids.length} utworów do playlisty?`)) return;
  for (const id of ids) {
    try { await API.post(`/playlists/${currentPlaylistId}/tracks`, { trackId: id }); } catch {}
  }
  await loadCurrentPlaylist(currentPlaylistId);
  await loadPlaylists();
  // Uncheck all
  toggleAllTracks(false);
}

async function bulkDeleteTracks() {
  const ids = getSelectedTrackIds();
  if (ids.length === 0) return;
  if (!await smConfirm(`Usunąć ${ids.length} zaznaczonych utworów?`)) return;
  for (const id of ids) {
    try { await API.del(`/tracks/${id}`); } catch {}
  }
  await loadTracks();
}

async function bulkDeleteAllTracks() {
  const allBoxes = document.querySelectorAll('.track-checkbox');
  if (allBoxes.length === 0) return;
  if (!await smConfirm(`Usunąć WSZYSTKIE ${allBoxes.length} utworów z biblioteki? Tej operacji nie można cofnąć!`)) return;
  const ids = Array.from(allBoxes).map(cb => parseInt(cb.value));
  for (const id of ids) {
    try { await API.del(`/tracks/${id}`); } catch {}
  }
  await loadTracks();
}

async function createPlaylist() {
  const name = await smPrompt('Nazwa playlisty:');
  if (!name) return;
  await API.post('/playlists', { name });
  await loadPlaylists();
}

async function playSelectedPlaylist() {
  const sel = document.getElementById('playlist-selector');
  const id = parseInt(sel.value);
  if (id) {
    await API.post('/player/play', { playlistId: id });
  }
}

async function renamePlaylist(id) {
  const pl = allPlaylists.find(p => p.id === id);
  const newName = await smPrompt('Nowa nazwa playlisty:', pl ? pl.name : '');
  if (!newName) return;
  await API.put(`/playlists/${id}`, { name: newName });
  await loadPlaylists();
}

async function deletePlaylist(id) {
  if (!await smConfirm('Usunąć playlistę?')) return;
  await API.del(`/playlists/${id}`);
  if (currentPlaylistId === id) {
    currentPlaylistId = null;
    currentPlaylistData = null;
  }
  await loadPlaylists();
}

async function playPlaylist(id) {
  await API.post('/player/play', { playlistId: id });
}

async function toggleDefault(id, val) {
  await API.put(`/playlists/${id}`, { is_default: !!val });
  await loadPlaylists();
}

async function viewPlaylist(id) {
  const playlist = await API.get(`/playlists/${id}`);
  const allTracks = await API.get('/tracks');

  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modal-body');

  const trackOptions = allTracks
    .filter(t => !playlist.tracks.find(pt => pt.id === t.id))
    .map(t => `<option value="${t.id}">${esc(t.title)}</option>`)
    .join('');

  modalBody.innerHTML = `
    <h2>Playlista: ${esc(playlist.name)}</h2>
    <div class="sm-form-row">
      <label><input type="checkbox" id="pl-shuffle" ${playlist.shuffle ? 'checked' : ''}> Losowa kolejność</label>
    </div>
    <div class="sm-playlist-tracks" id="modal-playlist-tracks"></div>
    <div class="sm-form-row">
      <select id="add-track-select"><option value="">Dodaj utwór...</option>${trackOptions}</select>
      <button onclick="addTrackToPlaylist(${id})" class="sm-btn">Dodaj</button>
    </div>
  `;

  const tracksContainer = document.getElementById('modal-playlist-tracks');
  renderPlaylistTracks(tracksContainer, playlist);

  document.getElementById('pl-shuffle').onchange = async (e) => {
    await API.put(`/playlists/${id}`, { shuffle: e.target.checked });
  };

  modal.classList.add('sm-modal--open');
}

function renderPlaylistTracks(container, playlist) {
  if (playlist.tracks.length === 0) {
    container.innerHTML = '<p class="sm-empty">Brak utworów na playliście</p>';
    return;
  }
  container.innerHTML = playlist.tracks.map((t, i) => `
    <div class="sm-playlist-track" draggable="true" data-track-id="${t.id}" data-index="${i}">
      <span class="sm-drag-handle">&#9776;</span>
      <span class="sm-track-info">${i + 1}. ${esc(t.title)} <small>${formatTime(t.duration)}</small></span>
      <button onclick="removeFromPlaylist(${playlist.id}, ${t.id})" class="sm-btn sm-btn--danger sm-btn--small">&#10005;</button>
    </div>
  `).join('');
}

async function addTrackToPlaylist(playlistId) {
  const select = document.getElementById('add-track-select');
  const trackId = parseInt(select.value);
  if (!trackId) return;
  await API.post(`/playlists/${playlistId}/tracks`, { trackId });
  viewPlaylist(playlistId);
  // Refresh current playlist if same
  if (playlistId === currentPlaylistId) loadCurrentPlaylist(currentPlaylistId);
}

async function removeFromPlaylist(playlistId, trackId) {
  await API.del(`/playlists/${playlistId}/tracks/${trackId}`);
  viewPlaylist(playlistId);
  if (playlistId === currentPlaylistId) loadCurrentPlaylist(currentPlaylistId);
}

async function addToPlaylistPrompt(trackId) {
  const playlists = await API.get('/playlists');
  if (playlists.length === 0) { await smAlert('Najpierw utwórz playlistę!'); return; }

  if (playlists.length === 1) {
    await API.post(`/playlists/${playlists[0].id}/tracks`, { trackId });
    await smAlert('Dodano!');
    if (playlists[0].id === currentPlaylistId) loadCurrentPlaylist(currentPlaylistId);
    return;
  }

  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modal-body');
  modalBody.innerHTML = `
    <h2>Dodaj do playlisty</h2>
    <div class="sm-form-row">
      <select id="pick-playlist">
        ${playlists.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
      </select>
    </div>
    <div style="display: flex; gap: 8px; justify-content: flex-end;">
      <button class="sm-btn" style="background: var(--sm-border); color: var(--sm-text);" onclick="document.getElementById('modal').classList.remove('sm-modal--open')">Anuluj</button>
      <button class="sm-btn sm-btn--primary" id="pick-playlist-ok">Dodaj</button>
    </div>
  `;
  document.getElementById('pick-playlist-ok').onclick = async () => {
    const plId = parseInt(document.getElementById('pick-playlist').value);
    await API.post(`/playlists/${plId}/tracks`, { trackId });
    modal.classList.remove('sm-modal--open');
    await smAlert('Dodano!');
    if (plId === currentPlaylistId) loadCurrentPlaylist(currentPlaylistId);
  };
  modal.classList.add('sm-modal--open');
}

let _uploadModalFiles = [];

function showUploadModal() {
  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modal-body');
  _uploadModalFiles = [];

  const playlistOptions = allPlaylists.map(p =>
    `<option value="${p.id}" ${p.id === currentPlaylistId ? 'selected' : ''}>${esc(p.name)}</option>`
  ).join('');

  modalBody.innerHTML = `
    <h2>Wgraj pliki audio</h2>
    <div class="sm-upload-dropzone" id="upm-dropzone" onclick="document.getElementById('track-file-input').click();">
      <span style="font-size: 2rem;">&#128228;</span>
      <span>Kliknij lub przeciągnij pliki tutaj</span>
      <span style="font-size: 0.78rem; color: var(--sm-text-muted);">MP3, WAV, OGG, FLAC</span>
    </div>
    <div id="upm-file-list" class="sm-upload-file-list" style="display:none;"></div>
    <div class="sm-upload-options" style="margin-top: 12px;">
      <label style="display: flex; align-items: center; gap: 6px; font-size: 0.88rem; cursor: pointer;">
        <input type="checkbox" id="upm-add-to-playlist" checked>
        Dodaj do playlisty:
        <select id="upm-playlist-select" class="sm-input" style="min-width: 140px; max-width: 220px;">
          <option value="">-- nie dodawaj --</option>
          ${playlistOptions}
        </select>
      </label>
    </div>
    <div id="upm-summary" style="margin-top: 12px; font-size: 0.85rem; color: var(--sm-text-muted); display: none;"></div>
    <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px;">
      <button class="sm-btn" style="background: var(--sm-border); color: var(--sm-text);" onclick="document.getElementById('modal').classList.remove('sm-modal--open')">Anuluj</button>
      <button class="sm-btn sm-btn--primary" id="upm-start-btn" disabled>Wgraj pliki</button>
    </div>
  `;

  // Sync checkbox with select
  const checkbox = document.getElementById('upm-add-to-playlist');
  const select = document.getElementById('upm-playlist-select');
  checkbox.onchange = () => { select.disabled = !checkbox.checked; };

  // Drag & drop
  const dropzone = document.getElementById('upm-dropzone');
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('sm-upload-dropzone--hover'); });
  dropzone.addEventListener('dragleave', () => { dropzone.classList.remove('sm-upload-dropzone--hover'); });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('sm-upload-dropzone--hover');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/'));
    if (files.length > 0) addFilesToUploadModal(files);
  });

  // Start upload button
  document.getElementById('upm-start-btn').onclick = () => startUploadProcess(_uploadModalFiles);

  modal.classList.add('sm-modal--open');
}

function onUploadFilesSelected() {
  const input = document.getElementById('track-file-input');
  if (!input.files.length) return;
  const files = Array.from(input.files);
  input.value = '';

  // If modal is open, add files to it; otherwise open modal
  const modal = document.getElementById('modal');
  if (modal.classList.contains('sm-modal--open') && document.getElementById('upm-dropzone')) {
    addFilesToUploadModal(files);
  } else {
    showUploadModal();
    setTimeout(() => addFilesToUploadModal(files), 50);
  }
}

function addFilesToUploadModal(newFiles) {
  const startIdx = _uploadModalFiles.length;
  _uploadModalFiles.push(...newFiles);

  const listEl = document.getElementById('upm-file-list');
  if (!listEl) return;
  listEl.style.display = 'block';

  for (let i = 0; i < newFiles.length; i++) {
    const idx = startIdx + i;
    const f = newFiles[i];
    const sizeMB = (f.size / 1024 / 1024).toFixed(1);
    const div = document.createElement('div');
    div.className = 'sm-upload-file-item';
    div.id = `upm-file-${idx}`;
    div.innerHTML = `
      <span class="sm-upload-file-name">${esc(f.name)}</span>
      <span class="sm-upload-file-size">${sizeMB} MB</span>
      <span class="sm-upload-file-status" id="upm-status-${idx}">Oczekuje</span>
      <div class="sm-upload-progress-bar">
        <div class="sm-upload-progress-fill" id="upm-progress-${idx}"></div>
      </div>
    `;
    listEl.appendChild(div);
  }

  // Update header and enable start button
  const h2 = document.querySelector('#modal-body h2');
  if (h2) h2.textContent = `Wgraj pliki audio (${_uploadModalFiles.length})`;
  const startBtn = document.getElementById('upm-start-btn');
  if (startBtn) startBtn.disabled = false;
}

async function startUploadProcess(files) {
  const startBtn = document.getElementById('upm-start-btn');
  startBtn.disabled = true;
  startBtn.textContent = 'Wgrywanie...';

  const addToPlaylist = document.getElementById('upm-add-to-playlist')?.checked;
  const playlistId = addToPlaylist ? parseInt(document.getElementById('upm-playlist-select')?.value) : null;

  const uploadedIds = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < files.length; i++) {
    const statusEl = document.getElementById(`upm-status-${i}`);
    const progressEl = document.getElementById(`upm-progress-${i}`);
    const itemEl = document.getElementById(`upm-file-${i}`);

    statusEl.textContent = 'Wgrywanie...';
    statusEl.style.color = 'var(--sm-primary)';
    itemEl.classList.add('sm-upload-file-item--active');

    try {
      const track = await uploadFileWithProgress(files[i], progressEl);
      if (track && track.id) uploadedIds.push(track.id);
      statusEl.textContent = 'OK';
      statusEl.style.color = 'var(--sm-success)';
      itemEl.classList.remove('sm-upload-file-item--active');
      itemEl.classList.add('sm-upload-file-item--done');
      successCount++;
    } catch (err) {
      statusEl.textContent = 'Błąd';
      statusEl.style.color = 'var(--sm-danger)';
      itemEl.classList.remove('sm-upload-file-item--active');
      itemEl.classList.add('sm-upload-file-item--error');
      failCount++;
    }
  }

  // Add to playlist
  if (playlistId && uploadedIds.length > 0) {
    const statusEl = document.getElementById('upm-summary');
    statusEl.style.display = 'block';
    statusEl.textContent = 'Dodawanie do playlisty...';
    for (const trackId of uploadedIds) {
      try { await API.post(`/playlists/${playlistId}/tracks`, { trackId }); } catch {}
    }
    await loadCurrentPlaylist(playlistId);
    await loadPlaylists();
  }

  // Summary
  const summaryEl = document.getElementById('upm-summary');
  summaryEl.style.display = 'block';
  let msg = `Wgrano: ${successCount}/${files.length}`;
  if (failCount > 0) msg += ` (${failCount} błędów)`;
  if (playlistId && uploadedIds.length > 0) msg += ` | Dodano do playlisty`;
  summaryEl.innerHTML = `<strong>${msg}</strong>`;

  startBtn.textContent = 'Zamknij';
  startBtn.disabled = false;
  startBtn.onclick = () => {
    document.getElementById('modal').classList.remove('sm-modal--open');
  };

  await loadTracks();
}

function uploadFileWithProgress(file, progressEl) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && progressEl) {
        const pct = Math.round((e.loaded / e.total) * 100);
        progressEl.style.width = pct + '%';
      }
    };

    xhr.onload = () => {
      if (progressEl) progressEl.style.width = '100%';
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch { resolve(null); }
      } else {
        try { reject(new Error(JSON.parse(xhr.responseText).error)); } catch { reject(new Error(`HTTP ${xhr.status}`)); }
      }
    };

    xhr.onerror = () => reject(new Error('Network error'));
    xhr.open('POST', '/api/tracks/upload');
    xhr.send(formData);
  });
}

async function deleteTrack(id) {
  if (!await smConfirm('Usunąć utwór?')) return;
  await API.del(`/tracks/${id}`);
  await loadTracks();
}

// --- Track preview (in-browser audio playback) ---
let _previewAudio = null;
let _previewTrackId = null;

function previewTrack(trackId, btn) {
  // If same track is playing, stop it
  if (_previewAudio && _previewTrackId === trackId) {
    _previewAudio.pause();
    _previewAudio = null;
    _previewTrackId = null;
    btn.innerHTML = '&#9654;';
    btn.title = 'Odsluchaj';
    return;
  }

  // Stop any previous preview
  if (_previewAudio) {
    _previewAudio.pause();
    _previewAudio = null;
    // Reset previous button
    const prevBtn = document.querySelector('.sm-btn--previewing');
    if (prevBtn) {
      prevBtn.innerHTML = '&#9654;';
      prevBtn.title = 'Odsluchaj';
      prevBtn.classList.remove('sm-btn--previewing');
    }
  }

  _previewAudio = new Audio(`/api/tracks/${trackId}/stream`);
  _previewTrackId = trackId;
  btn.innerHTML = '&#9724;';
  btn.title = 'Zatrzymaj';
  btn.classList.add('sm-btn--previewing');

  _previewAudio.play().catch(() => {
    btn.innerHTML = '&#9654;';
    btn.classList.remove('sm-btn--previewing');
    _previewAudio = null;
    _previewTrackId = null;
  });

  _previewAudio.onended = () => {
    btn.innerHTML = '&#9654;';
    btn.title = 'Odsluchaj';
    btn.classList.remove('sm-btn--previewing');
    _previewAudio = null;
    _previewTrackId = null;
  };
}

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
