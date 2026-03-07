let ytTracks = [];
let ytDownloadId = null;

async function initYoutube() {
  // Populate playlist select
  try {
    const playlists = await API.get('/playlists');
    const sel = document.getElementById('yt-playlist-select');
    if (sel) {
      sel.innerHTML = '<option value="">-- nie dodawaj --</option>' +
        playlists.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    }
  } catch {}
}

async function ytFetchInfo() {
  const url = document.getElementById('yt-url').value.trim();
  if (!url) return;

  const status = document.getElementById('yt-status');
  const tracksDiv = document.getElementById('yt-tracks');
  const btn = document.getElementById('yt-fetch-btn');

  btn.disabled = true;
  status.innerHTML = '<span style="color: var(--sm-primary);">Pobieranie informacji...</span>';
  tracksDiv.innerHTML = '';

  try {
    const data = await API.post('/youtube/info', { url });
    ytTracks = data.tracks || [];

    if (ytTracks.length === 0) {
      status.innerHTML = '<span style="color: var(--sm-danger);">Nie znaleziono utworow</span>';
      return;
    }

    status.innerHTML = `Znaleziono <strong>${ytTracks.length}</strong> utworow. Zaznacz ktore pobrac:`;

    let html = `<div class="sm-yt-actions" style="margin: 8px 0; display: flex; gap: 8px;">
      <button class="sm-btn sm-btn--small" onclick="ytSelectAll(true)">Zaznacz wszystkie</button>
      <button class="sm-btn sm-btn--small" style="background: var(--sm-border); color: var(--sm-text);" onclick="ytSelectAll(false)">Odznacz</button>
      <button class="sm-btn sm-btn--primary sm-btn--small" onclick="ytStartDownload()">Pobierz zaznaczone</button>
    </div>`;

    html += '<div class="sm-yt-list">';
    for (let i = 0; i < ytTracks.length; i++) {
      const t = ytTracks[i];
      const durStr = t.duration ? formatTime(t.duration) : '?:??';
      html += `<label class="sm-yt-track">
        <input type="checkbox" class="yt-track-cb" data-index="${i}" checked>
        <span class="sm-yt-track-num">${i + 1}.</span>
        <span class="sm-yt-track-title">${esc(t.title)}</span>
        <span class="sm-yt-track-dur">${durStr}</span>
      </label>`;
    }
    html += '</div>';

    tracksDiv.innerHTML = html;
  } catch (err) {
    status.innerHTML = `<span style="color: var(--sm-danger);">Blad: ${esc(err.message)}</span>`;
  } finally {
    btn.disabled = false;
  }
}

function ytSelectAll(checked) {
  document.querySelectorAll('.yt-track-cb').forEach(cb => cb.checked = checked);
}

async function ytStartDownload() {
  const url = document.getElementById('yt-url').value.trim();
  if (!url) return;

  const selected = [];
  document.querySelectorAll('.yt-track-cb:checked').forEach(cb => {
    selected.push(parseInt(cb.dataset.index) + 1); // yt-dlp uses 1-based index
  });

  if (selected.length === 0) {
    await smAlert('Zaznacz przynajmniej jeden utwor');
    return;
  }

  const playlistId = document.getElementById('yt-playlist-select').value || undefined;
  const status = document.getElementById('yt-status');

  try {
    const data = await API.post('/youtube/download', {
      url,
      trackIds: selected,
      playlistId: playlistId ? parseInt(playlistId) : undefined,
    });

    ytDownloadId = data.downloadId;
    status.innerHTML = '<span style="color: var(--sm-primary);">Pobieranie rozpoczete...</span>';

    // Poll for progress
    ytPollProgress();
  } catch (err) {
    status.innerHTML = `<span style="color: var(--sm-danger);">Blad: ${esc(err.message)}</span>`;
  }
}

async function ytPollProgress() {
  if (!ytDownloadId) return;

  const status = document.getElementById('yt-status');

  try {
    const data = await API.get(`/youtube/download/${ytDownloadId}`);

    if (data.status === 'downloading') {
      const pct = data.currentProgress ? ` (${Math.round(data.currentProgress)}%)` : '';
      status.innerHTML = `<span style="color: var(--sm-primary);">Pobieranie${pct}... Pobrano: ${data.completed} utworow</span>`;
      setTimeout(ytPollProgress, 2000);
    } else if (data.status === 'completed') {
      status.innerHTML = `<span style="color: var(--sm-primary);">Pobrano ${data.completed} utworow!</span>`;
      ytDownloadId = null;
    } else if (data.status === 'completed_with_errors') {
      status.innerHTML = `<span style="color: var(--sm-warning);">Pobrano ${data.completed} utworow (z bledami)</span>`;
      ytDownloadId = null;
    } else {
      status.innerHTML = `<span style="color: var(--sm-danger);">Pobieranie nie powiodlo sie</span>`;
      ytDownloadId = null;
    }
  } catch {
    setTimeout(ytPollProgress, 3000);
  }
}
