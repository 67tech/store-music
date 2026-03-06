async function initPlaylists() {
  await loadPlaylists();
  await loadTracks();

  document.getElementById('btn-create-playlist').onclick = createPlaylist;
  document.getElementById('btn-upload-track').onclick = () => document.getElementById('track-file-input').click();
  document.getElementById('track-file-input').onchange = uploadTrack;
}

async function loadPlaylists() {
  const playlists = await API.get('/playlists');
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

  const table = document.createElement('table');
  table.className = 'sm-table';
  table.innerHTML = `<thead><tr><th>Tytuł</th><th>Artysta</th><th>Czas</th><th>Akcje</th></tr></thead>`;
  const tbody = document.createElement('tbody');

  for (const track of tracks) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(track.title)}</td>
      <td>${esc(track.artist || '-')}</td>
      <td>${formatTime(track.duration)}</td>
      <td>
        <button onclick="addToPlaylistPrompt(${track.id})" class="sm-btn sm-btn--small">+ Playlista</button>
        <button onclick="deleteTrack(${track.id})" class="sm-btn sm-btn--danger sm-btn--small">&#10005;</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);
}

async function createPlaylist() {
  const name = prompt('Nazwa playlisty:');
  if (!name) return;
  await API.post('/playlists', { name });
  await loadPlaylists();
}

async function deletePlaylist(id) {
  if (!confirm('Usunąć playlistę?')) return;
  await API.del(`/playlists/${id}`);
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
}

async function removeFromPlaylist(playlistId, trackId) {
  await API.del(`/playlists/${playlistId}/tracks/${trackId}`);
  viewPlaylist(playlistId);
}

async function addToPlaylistPrompt(trackId) {
  const playlists = await API.get('/playlists');
  if (playlists.length === 0) { alert('Najpierw utwórz playlistę!'); return; }

  const name = playlists.length === 1
    ? playlists[0].name
    : prompt('Nazwa playlisty:\n' + playlists.map(p => p.name).join('\n'));

  const pl = playlists.find(p => p.name === name);
  if (!pl) return;
  await API.post(`/playlists/${pl.id}/tracks`, { trackId });
  alert('Dodano!');
}

async function uploadTrack() {
  const input = document.getElementById('track-file-input');
  if (!input.files.length) return;

  for (const file of input.files) {
    const formData = new FormData();
    formData.append('file', file);
    await API.upload('/tracks/upload', formData);
  }
  input.value = '';
  await loadTracks();
}

async function deleteTrack(id) {
  if (!confirm('Usunąć utwór?')) return;
  await API.del(`/tracks/${id}`);
  await loadTracks();
}

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
