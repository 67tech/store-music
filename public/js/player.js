function initPlayer(socket) {
  const els = {
    status: document.getElementById('player-status'),
    trackTitle: document.getElementById('player-track-title'),
    trackArtist: document.getElementById('player-track-artist'),
    elapsed: document.getElementById('player-elapsed'),
    duration: document.getElementById('player-duration'),
    progress: document.getElementById('player-progress'),
    progressBar: document.getElementById('player-progress-bar'),
    volume: document.getElementById('player-volume'),
    volumeVal: document.getElementById('player-volume-val'),
    btnPlay: document.getElementById('btn-play'),
    btnPause: document.getElementById('btn-pause'),
    btnStop: document.getElementById('btn-stop'),
    btnPrev: document.getElementById('btn-prev'),
    btnNext: document.getElementById('btn-next'),
    playlistName: document.getElementById('player-playlist-name'),
  };

  let currentDuration = 0;
  let isSeeking = false;
  let dragging = false;

  function updateUI(state) {
    els.status.textContent = state.status;
    els.status.className = `sm-status sm-status--${state.status}`;

    if (state.currentTrack) {
      els.trackTitle.textContent = state.currentTrack.title || 'Unknown';
      els.trackArtist.textContent = state.currentTrack.artist || '';
    } else {
      els.trackTitle.textContent = 'Brak utworu';
      els.trackArtist.textContent = '';
    }

    // Use mpv duration if available, fallback to track's DB duration
    if (state.duration > 0) {
      currentDuration = state.duration;
    } else if (state.currentTrack && state.currentTrack.duration > 0) {
      currentDuration = state.currentTrack.duration;
    }

    if (!isSeeking) {
      els.elapsed.textContent = formatTime(state.elapsed);
      els.duration.textContent = formatTime(currentDuration);
      els.progress.style.width = currentDuration > 0 ? `${(state.elapsed / currentDuration) * 100}%` : '0%';
    }

    els.volume.value = state.volume;
    els.volumeVal.textContent = state.volume;
    els.playlistName.textContent = state.playlist ? state.playlist.name : '-';
  }

  socket.on('playerState', updateUI);

  els.btnPlay.onclick = () => API.post('/player/play');
  els.btnPause.onclick = () => API.post('/player/pause');
  els.btnStop.onclick = () => API.post('/player/stop');
  els.btnPrev.onclick = () => API.post('/player/previous');
  els.btnNext.onclick = () => API.post('/player/next');

  els.volume.oninput = (e) => {
    els.volumeVal.textContent = e.target.value;
  };
  els.volume.onchange = (e) => {
    API.post('/player/volume', { volume: parseInt(e.target.value) });
  };

  function getRatio(clientX) {
    const rect = els.progressBar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }

  function updateSeekPreview(ratio) {
    els.progress.style.width = `${ratio * 100}%`;
    els.elapsed.textContent = formatTime(ratio * currentDuration);
  }

  function doSeek(ratio) {
    const position = ratio * currentDuration;
    API.post('/player/seek', { position }).then(() => { isSeeking = false; });
  }

  // Mouse seek (drag or click)
  els.progressBar.addEventListener('mousedown', (e) => {
    if (currentDuration <= 0) return;
    e.preventDefault();
    dragging = true;
    isSeeking = true;
    updateSeekPreview(getRatio(e.clientX));
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    updateSeekPreview(getRatio(e.clientX));
  });

  document.addEventListener('mouseup', (e) => {
    if (!dragging) return;
    dragging = false;
    doSeek(getRatio(e.clientX));
  });

  // Touch seek
  els.progressBar.addEventListener('touchstart', (e) => {
    if (currentDuration <= 0) return;
    isSeeking = true;
    dragging = true;
    updateSeekPreview(getRatio(e.touches[0].clientX));
  });

  els.progressBar.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    e.preventDefault();
    updateSeekPreview(getRatio(e.touches[0].clientX));
  });

  els.progressBar.addEventListener('touchend', (e) => {
    if (!dragging) return;
    dragging = false;
    doSeek(getRatio(e.changedTouches[0].clientX));
  });
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
