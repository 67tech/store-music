let ytTracks = [];
let ytDownloadId = null;

async function initYoutube() {
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
    selected.push(parseInt(cb.dataset.index) + 1);
  });

  if (selected.length === 0) {
    await smAlert('Zaznacz przynajmniej jeden utwor');
    return;
  }

  const playlistId = document.getElementById('yt-playlist-select').value || undefined;
  const status = document.getElementById('yt-status');
  const tracksDiv = document.getElementById('yt-tracks');

  try {
    const data = await API.post('/youtube/download', {
      url,
      trackIds: selected,
      playlistId: playlistId ? parseInt(playlistId) : undefined,
    });

    ytDownloadId = data.downloadId;

    // Show progress bar UI
    status.innerHTML = '';
    tracksDiv.innerHTML = `
      <div class="sm-yt-progress">
        <div class="sm-yt-progress-header">
          <span id="yt-dl-phase">Rozpoczynanie pobierania...</span>
          <span id="yt-dl-counter">${selected.length} utwor(ow)</span>
        </div>
        <div class="sm-yt-progress-bar-wrap">
          <div class="sm-yt-progress-bar" id="yt-dl-bar" style="width: 0%"></div>
        </div>
        <div id="yt-dl-title" class="sm-yt-progress-title"></div>
        <div id="yt-dl-tracks" class="sm-yt-progress-done"></div>
      </div>
    `;

    ytPollProgress();
  } catch (err) {
    status.innerHTML = `<span style="color: var(--sm-danger);">Blad: ${esc(err.message)}</span>`;
  }
}

async function ytPollProgress() {
  if (!ytDownloadId) return;

  try {
    const d = await API.get(`/youtube/download/${ytDownloadId}`);

    const bar = document.getElementById('yt-dl-bar');
    const phase = document.getElementById('yt-dl-phase');
    const counter = document.getElementById('yt-dl-counter');
    const title = document.getElementById('yt-dl-title');
    const doneList = document.getElementById('yt-dl-tracks');

    if (!bar) { setTimeout(ytPollProgress, 2000); return; }

    if (d.status === 'downloading') {
      // Calculate overall progress
      const itemsDone = d.completed || 0;
      const totalItems = d.total || 1;
      const filePct = d.currentProgress || 0;
      // Overall = (completed items + current file progress) / total
      const overallPct = Math.min(99, ((itemsDone + filePct / 100) / totalItems) * 100);

      bar.style.width = overallPct + '%';

      // Phase label
      if (d.phase === 'converting') {
        phase.textContent = 'Konwersja na MP3...';
        bar.classList.add('sm-yt-progress-bar--converting');
      } else {
        phase.textContent = 'Pobieranie...';
        bar.classList.remove('sm-yt-progress-bar--converting');
      }

      // Counter
      if (totalItems > 1) {
        const current = d.currentItem || (itemsDone + 1);
        counter.textContent = `${current} / ${totalItems}`;
      } else {
        counter.textContent = filePct > 0 ? `${Math.round(filePct)}%` : '';
      }

      // Current title
      if (d.currentTitle) {
        title.textContent = d.currentTitle;
      }

      // Done tracks list
      if (d.tracks && d.tracks.length > 0) {
        doneList.innerHTML = d.tracks.map(t =>
          `<div class="sm-yt-progress-track-done">&#10003; ${esc(t.title)}</div>`
        ).join('');
      }

      setTimeout(ytPollProgress, 1500);
    } else {
      // Finished
      bar.style.width = '100%';

      if (d.status === 'completed' && d.completed > 0) {
        bar.classList.add('sm-yt-progress-bar--done');
        phase.textContent = 'Gotowe!';
        counter.textContent = `${d.completed} utwor(ow)`;
        title.textContent = '';
      } else if (d.status === 'completed_with_errors') {
        bar.classList.add('sm-yt-progress-bar--warning');
        phase.textContent = `Pobrano ${d.completed} (z bledami)`;
        counter.textContent = '';
        title.textContent = d.errors.length ? d.errors[0] : '';
      } else {
        bar.classList.add('sm-yt-progress-bar--error');
        phase.textContent = 'Pobieranie nie powiodlo sie';
        counter.textContent = '';
        title.textContent = d.errors.length ? d.errors[0] : '';
      }

      if (d.tracks && d.tracks.length > 0) {
        doneList.innerHTML = d.tracks.map(t =>
          `<div class="sm-yt-progress-track-done">&#10003; ${esc(t.title)}</div>`
        ).join('');
      }

      ytDownloadId = null;

      // Refresh tracks list
      if (typeof loadTracks === 'function') loadTracks();
    }
  } catch {
    setTimeout(ytPollProgress, 3000);
  }
}
