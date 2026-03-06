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

    currentDuration = state.duration || 0;

    if (!isSeeking) {
      els.elapsed.textContent = formatTime(state.elapsed);
      els.duration.textContent = formatTime(state.duration);
      els.progress.style.width = state.duration > 0 ? `${(state.elapsed / state.duration) * 100}%` : '0%';
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

  // Seek — click on progress bar
  els.progressBar.addEventListener('click', (e) => {
    if (currentDuration <= 0) return;
    const rect = els.progressBar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const position = ratio * currentDuration;
    isSeeking = true;
    els.progress.style.width = `${ratio * 100}%`;
    els.elapsed.textContent = formatTime(position);
    API.post('/player/seek', { position }).then(() => { isSeeking = false; });
  });

  // Seek — drag on progress bar
  let dragging = false;
  els.progressBar.addEventListener('mousedown', () => {
    if (currentDuration <= 0) return;
    dragging = true;
    isSeeking = true;
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging || currentDuration <= 0) return;
    const rect = els.progressBar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    els.progress.style.width = `${ratio * 100}%`;
    els.elapsed.textContent = formatTime(ratio * currentDuration);
  });

  document.addEventListener('mouseup', (e) => {
    if (!dragging) return;
    dragging = false;
    const rect = els.progressBar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    API.post('/player/seek', { position: ratio * currentDuration }).then(() => { isSeeking = false; });
  });

  // Touch support
  els.progressBar.addEventListener('touchstart', (e) => {
    if (currentDuration <= 0) return;
    isSeeking = true;
    const rect = els.progressBar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width));
    els.progress.style.width = `${ratio * 100}%`;
    els.elapsed.textContent = formatTime(ratio * currentDuration);
  });

  els.progressBar.addEventListener('touchmove', (e) => {
    if (currentDuration <= 0 || !isSeeking) return;
    e.preventDefault();
    const rect = els.progressBar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width));
    els.progress.style.width = `${ratio * 100}%`;
    els.elapsed.textContent = formatTime(ratio * currentDuration);
  });

  els.progressBar.addEventListener('touchend', (e) => {
    if (currentDuration <= 0 || !isSeeking) return;
    const rect = els.progressBar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.changedTouches[0].clientX - rect.left) / rect.width));
    API.post('/player/seek', { position: ratio * currentDuration }).then(() => { isSeeking = false; });
  });
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
