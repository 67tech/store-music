const mpvAPI = require('node-mpv');
const EventEmitter = require('events');
const playlistService = require('./PlaylistService');
const { getDb } = require('../db');

class PlayerService extends EventEmitter {
  constructor() {
    super();
    // Dual-deck architecture for true crossfade (like Apple Music automix)
    this._deckA = null;
    this._deckB = null;
    this._activeDeck = 'A';
    this.mpv = null; // alias for active deck
    this.state = {
      status: 'stopped',
      currentTrack: null,
      currentIndex: -1,
      volume: 50,
      duration: 0,
      elapsed: 0,
      playlist: null,
      playlistTracks: [],
      shuffle: false,
      shuffledIndices: [],
      loop: true,
    };
    this._positionInterval = null;
    this._announcementMode = false;
    this._savedState = null;
    this._crossfading = false;
    this._crossfadeTrackEnded = false;
    this._recentlyPlayed = [];
  }

  get _activeMpv() { return this._activeDeck === 'A' ? this._deckA : this._deckB; }
  get _inactiveMpv() { return this._activeDeck === 'A' ? this._deckB : this._deckA; }

  async init() {
    const { execSync } = require('child_process');
    let mpvBinary = '/usr/bin/mpv';
    try {
      mpvBinary = execSync('which mpv').toString().trim();
    } catch {}

    try {
      try {
        execSync(`"${mpvBinary}" --version`, { stdio: 'pipe' });
      } catch {
        throw new Error(`mpv not found at ${mpvBinary}`);
      }

      const fs = require('fs');
      try { fs.unlinkSync('/tmp/node-mpv-a.sock'); } catch {}
      try { fs.unlinkSync('/tmp/node-mpv-b.sock'); } catch {}

      const mpvArgs = ['--no-video', '--no-terminal', '--really-quiet'];

      this._deckA = new mpvAPI({
        audio_only: true,
        binary: mpvBinary,
        ipc_command: '--input-ipc-server',
        socket: '/tmp/node-mpv-a.sock',
      }, mpvArgs);

      this._deckB = new mpvAPI({
        audio_only: true,
        binary: mpvBinary,
        ipc_command: '--input-ipc-server',
        socket: '/tmp/node-mpv-b.sock',
      }, mpvArgs);

      this.mpv = this._deckA;

      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.error('mpv not available:', err.message);
      console.error('Install mpv: brew install mpv (macOS) or sudo apt install mpv (Linux)');
      console.warn('Server will run without audio playback capability');
      this._deckA = null;
      this._deckB = null;
      this.mpv = null;
      return;
    }

    const settings = playlistService.getSettings();
    this.state.volume = settings.volume ?? 50;
    try { await this._deckA.volume(this.state.volume); } catch {}
    try { await this._deckB.volume(this.state.volume); } catch {}

    // Track end events — only react from the currently active deck
    this._deckA.on('stopped', () => {
      if (this._announcementMode) return;
      if (this._crossfading) { this._crossfadeTrackEnded = true; return; }
      if (this._activeDeck === 'A') this._onTrackEnd();
    });

    this._deckB.on('stopped', () => {
      if (this._announcementMode) return;
      if (this._crossfading) { this._crossfadeTrackEnded = true; return; }
      if (this._activeDeck === 'B') this._onTrackEnd();
    });

    // Pause/unpause status — only from active deck
    const handleStatus = (deck) => (status) => {
      if (this._announcementMode) return;
      if (this._activeDeck !== deck) return;
      if (status && status.property === 'pause') {
        this.state.status = status.value ? 'paused' : 'playing';
        this._emitState();
      }
    };
    this._deckA.on('statuschange', handleStatus('A'));
    this._deckB.on('statuschange', handleStatus('B'));

    console.log('Dual-deck player initialized (crossfade ready)');
  }

  _startPositionTracking() {
    this._stopPositionTracking();
    this._positionInterval = setInterval(async () => {
      if (this.state.status !== 'playing' || !this._activeMpv) return;
      try {
        this.state.elapsed = await this._activeMpv.getProperty('time-pos') || 0;
        this.state.duration = await this._activeMpv.getProperty('duration') || 0;
      } catch {}
      this._emitState();

      // Crossfade trigger: when near end of track
      if (!this._crossfading && !this._announcementMode && this.state.duration > 0) {
        const settings = playlistService.getSettings();
        const crossfadeSec = (settings.crossfadeDurationMs || 0) / 1000;
        const currentTrack = this.state.currentTrack;
        // Don't crossfade one-shot tracks (announcements/ads in queue)
        if (crossfadeSec > 0 && !currentTrack?.one_shot && this.state.elapsed > 0
            && this.state.duration - this.state.elapsed <= crossfadeSec
            && this.state.duration - this.state.elapsed > crossfadeSec - 1.5) {
          this._triggerCrossfade(crossfadeSec);
        }
      }
    }, 1000);
  }

  _stopPositionTracking() {
    if (this._positionInterval) {
      clearInterval(this._positionInterval);
      this._positionInterval = null;
    }
  }

  _emitState() {
    this.emit('stateChange', this.getState());
  }

  getState() {
    return { ...this.state, recentlyPlayed: this._recentlyPlayed };
  }

  _addToRecentlyPlayed(track) {
    this._recentlyPlayed.push({
      id: track.id,
      title: track.title || track.name || 'Unknown',
      artist: track.artist || '',
      duration: track.duration || 0,
      one_shot: track.one_shot || 0,
      playedAt: new Date().toISOString(),
    });
    if (this._recentlyPlayed.length > 10) {
      this._recentlyPlayed = this._recentlyPlayed.slice(-10);
    }
  }

  async playPlaylist(playlistId, startIndex = 0) {
    const playlist = playlistService.getPlaylist(playlistId);
    if (!playlist || !playlist.tracks.length) {
      throw new Error('Playlist is empty or not found');
    }

    this.state.playlist = { id: playlist.id, name: playlist.name };
    this.state.playlistTracks = playlist.tracks;
    this.state.shuffle = !!playlist.shuffle;

    if (this.state.shuffle) {
      this._generateShuffleOrder();
      this.state.currentIndex = startIndex;
    } else {
      this.state.currentIndex = startIndex;
      this.state.shuffledIndices = [];
    }

    await this._playCurrentTrack();
  }

  setLoop(enabled) {
    this.state.loop = !!enabled;
    this._emitState();
  }

  refreshPlaylist() {
    if (!this.state.playlist) return;
    const playlist = playlistService.getPlaylist(this.state.playlist.id);
    if (!playlist) return;

    const currentTrackId = this.state.currentTrack ? this.state.currentTrack.id : null;
    const oldTrackIds = this.state.playlistTracks.map(t => t.id);

    this.state.playlistTracks = playlist.tracks;

    if (currentTrackId) {
      if (this.state.shuffle) {
        const newTrackIds = playlist.tracks.map(t => t.id);
        const addedIds = newTrackIds.filter(id => !oldTrackIds.includes(id));

        const newShuffled = [];
        for (const oldIdx of this.state.shuffledIndices) {
          const trackId = oldTrackIds[oldIdx];
          const newIdx = playlist.tracks.findIndex(t => t.id === trackId);
          if (newIdx >= 0) newShuffled.push(newIdx);
        }

        for (const addedId of addedIds) {
          const newIdx = playlist.tracks.findIndex(t => t.id === addedId);
          if (newIdx >= 0) {
            const insertAfter = Math.min(this.state.currentIndex + 1, newShuffled.length);
            newShuffled.splice(insertAfter, 0, newIdx);
          }
        }

        this.state.shuffledIndices = newShuffled;
        const currentInShuffle = newShuffled.indexOf(
          playlist.tracks.findIndex(t => t.id === currentTrackId)
        );
        if (currentInShuffle >= 0) this.state.currentIndex = currentInShuffle;
      } else {
        const newIdx = playlist.tracks.findIndex(t => t.id === currentTrackId);
        if (newIdx >= 0) this.state.currentIndex = newIdx;
      }
    }

    this._emitState();
  }

  async play() {
    if (!this._activeMpv) { console.warn('mpv not available'); return; }
    if (this.state.status === 'paused') {
      await this._activeMpv.resume();
      this.state.status = 'playing';
      this._startPositionTracking();
      this._emitState();
    } else if (this.state.status === 'stopped' && this.state.playlistTracks.length > 0) {
      await this._playCurrentTrack();
    }
  }

  async pause() {
    if (!this._activeMpv) return;
    if (this.state.status === 'playing') {
      await this._activeMpv.pause();
      this.state.status = 'paused';
      this._stopPositionTracking();
      this._emitState();
    }
  }

  async stop() {
    this._stopPositionTracking();
    this._crossfading = false;
    this.state.status = 'stopped';
    this.state.elapsed = 0;
    this.state.currentTrack = null;
    this._emitState();
    // Stop both decks
    if (this._deckA) { try { await this._deckA.stop(); } catch {} }
    if (this._deckB) { try { await this._deckB.stop(); } catch {} }
  }

  async seek(position) {
    if (!this._activeMpv) return;
    try {
      await this._activeMpv.goToPosition(position);
      this.state.elapsed = position;
      this._emitState();
    } catch (err) {
      console.error('Seek failed:', err.message);
    }
  }

  async next() {
    if (this.state.playlistTracks.length === 0) return;
    // Cancel any in-progress crossfade
    if (this._crossfading) {
      this._crossfading = false;
      try { await this._inactiveMpv.stop(); } catch {}
    }
    this.state.currentIndex++;
    if (this.state.currentIndex >= this.state.playlistTracks.length) {
      this.state.currentIndex = 0;
      if (this.state.shuffle) this._generateShuffleOrder();
    }
    await this._playCurrentTrack();
  }

  async previous() {
    if (this.state.playlistTracks.length === 0) return;
    if (this._crossfading) {
      this._crossfading = false;
      try { await this._inactiveMpv.stop(); } catch {}
    }
    this.state.currentIndex--;
    if (this.state.currentIndex < 0) {
      this.state.currentIndex = this.state.playlistTracks.length - 1;
    }
    await this._playCurrentTrack();
  }

  async setVolume(volume) {
    volume = Math.max(0, Math.min(100, volume));
    this.state.volume = volume;
    if (this._activeMpv) { try { await this._activeMpv.volume(volume); } catch {} }
    playlistService.updateSettings({ volume });
    this._emitState();
  }

  async _playCurrentTrack() {
    if (!this._activeMpv) { console.warn('mpv not available'); return; }

    const idx = this.state.shuffle
      ? this.state.shuffledIndices[this.state.currentIndex]
      : this.state.currentIndex;

    const track = this.state.playlistTracks[idx];
    if (!track) return;

    this.state.currentTrack = track;
    this.state.status = 'playing';
    this.state.elapsed = 0;

    try {
      await this._activeMpv.load(track.filepath);
      await this._activeMpv.volume(this.state.volume);
      this._startPositionTracking();

      this._addToRecentlyPlayed(track);

      try {
        getDb().prepare(
          'INSERT INTO playback_history (track_id, title, artist, duration, one_shot) VALUES (?, ?, ?, ?, ?)'
        ).run(track.id || null, track.title || track.name || 'Unknown', track.artist || '', track.duration || 0, track.one_shot ? 1 : 0);
      } catch {}
    } catch (err) {
      console.error('Failed to play track:', err.message);
      setTimeout(() => this.next(), 1000);
    }
    this._emitState();
  }

  _onTrackEnd() {
    if (this.state.status === 'stopped') return;
    if (this._crossfading) {
      this._crossfadeTrackEnded = true;
      return;
    }

    this._removeOneShotIfNeeded();

    this.state.currentIndex++;
    if (this.state.currentIndex >= this.state.playlistTracks.length) {
      if (!this.state.loop) {
        this.state.currentIndex = 0;
        this.state.status = 'stopped';
        this.state.elapsed = 0;
        this.state.currentTrack = null;
        this._stopPositionTracking();
        this._emitState();
        return;
      }
      this.state.currentIndex = 0;
      if (this.state.shuffle) this._generateShuffleOrder();
    }
    this._playCurrentTrack();
  }

  _removeOneShotIfNeeded() {
    const idx = this.state.shuffle
      ? this.state.shuffledIndices[this.state.currentIndex]
      : this.state.currentIndex;
    const track = this.state.playlistTracks[idx];
    if (track && track.one_shot && this.state.playlist) {
      playlistService.removeOneShotTrack(this.state.playlist.id, track.id);
      this.state.playlistTracks.splice(idx, 1);
      if (this.state.shuffle) {
        this.state.shuffledIndices = this.state.shuffledIndices
          .filter(i => i !== idx)
          .map(i => i > idx ? i - 1 : i);
      }
      this.state.currentIndex--;
    }
  }

  // ======= TRUE CROSSFADE (Apple Music style — both tracks play simultaneously) =======
  async _triggerCrossfade(durationSec) {
    if (this._crossfading || this.state.playlistTracks.length === 0) return;
    if (!this._inactiveMpv) return;
    this._crossfading = true;
    this._crossfadeTrackEnded = false;

    this._removeOneShotIfNeeded();

    // Determine next track
    let nextIndex = this.state.currentIndex + 1;
    if (nextIndex >= this.state.playlistTracks.length) {
      if (!this.state.loop) {
        this._crossfading = false;
        return;
      }
      nextIndex = 0;
      if (this.state.shuffle) this._generateShuffleOrder();
    }

    const nextIdx = this.state.shuffle
      ? this.state.shuffledIndices[nextIndex]
      : nextIndex;
    const nextTrack = this.state.playlistTracks[nextIdx];
    if (!nextTrack) { this._crossfading = false; return; }

    // Don't crossfade into or out of one-shot tracks (ads/announcements)
    if (nextTrack.one_shot) {
      this._crossfading = false;
      return;
    }

    // Don't crossfade into very short tracks
    if (nextTrack.duration > 0 && nextTrack.duration <= durationSec + 1) {
      this._crossfading = false;
      return;
    }

    const fadeMs = durationSec * 1000;
    const steps = Math.max(10, Math.round(fadeMs / 100)); // ~100ms per step for smooth fade
    const stepMs = fadeMs / steps;
    const targetVol = this.state.volume;

    // Load next track on the INACTIVE deck at volume 0
    try {
      await this._inactiveMpv.volume(0);
      await this._inactiveMpv.load(nextTrack.filepath);
    } catch (err) {
      console.error('Crossfade load failed:', err.message);
      this._crossfading = false;
      return;
    }

    console.log(`Crossfade: "${this.state.currentTrack?.title}" -> "${nextTrack.title}" (${durationSec}s)`);

    // SIMULTANEOUS FADE: active deck fades out, inactive deck fades in
    // Both tracks play at the same time — true Apple Music automix
    for (let i = 1; i <= steps; i++) {
      if (this._crossfadeTrackEnded) break;
      // Equal-power crossfade curve for smooth perceived volume
      const progress = i / steps;
      const fadeOutVol = Math.round(targetVol * Math.cos(progress * Math.PI / 2));
      const fadeInVol = Math.round(targetVol * Math.sin(progress * Math.PI / 2));
      try { await this._activeMpv.volume(fadeOutVol); } catch {}
      try { await this._inactiveMpv.volume(fadeInVol); } catch {}
      await new Promise(r => setTimeout(r, stepMs));
    }

    // Stop the outgoing deck
    try { await this._activeMpv.stop(); } catch {}

    // Swap decks — the inactive deck (with new track) becomes active
    this._activeDeck = this._activeDeck === 'A' ? 'B' : 'A';
    this.mpv = this._activeMpv;

    // Ensure volume is at target
    try { await this._activeMpv.volume(targetVol); } catch {}

    // Update state
    this.state.currentIndex = nextIndex;
    this.state.currentTrack = nextTrack;
    this.state.elapsed = 0;
    this.state.status = 'playing';

    this._addToRecentlyPlayed(nextTrack);
    try {
      getDb().prepare(
        'INSERT INTO playback_history (track_id, title, artist, duration, one_shot) VALUES (?, ?, ?, ?, ?)'
      ).run(nextTrack.id || null, nextTrack.title || nextTrack.name || 'Unknown', nextTrack.artist || '', nextTrack.duration || 0, nextTrack.one_shot ? 1 : 0);
    } catch {}

    this._crossfading = false;
    this._emitState();
  }

  _generateShuffleOrder() {
    const indices = Array.from({ length: this.state.playlistTracks.length }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    this.state.shuffledIndices = indices;
  }

  // --- Restart player (kill both mpv instances, reinit) ---
  async restart() {
    this._stopPositionTracking();
    if (this._deckA) {
      try { await this._deckA.stop(); } catch {}
      try { await this._deckA.quit(); } catch {}
    }
    if (this._deckB) {
      try { await this._deckB.stop(); } catch {}
      try { await this._deckB.quit(); } catch {}
    }
    this._deckA = null;
    this._deckB = null;
    this.mpv = null;
    this._activeDeck = 'A';
    this.state.status = 'stopped';
    this.state.currentTrack = null;
    this.state.elapsed = 0;
    this.state.duration = 0;
    this._emitState();

    const { execSync } = require('child_process');
    try { execSync('pkill -f "node-mpv"', { stdio: 'pipe' }); } catch {}
    const fs = require('fs');
    try { fs.unlinkSync('/tmp/node-mpv-a.sock'); } catch {}
    try { fs.unlinkSync('/tmp/node-mpv-b.sock'); } catch {}

    await new Promise(r => setTimeout(r, 1000));
    await this.init();
  }

  // --- Announcement support (uses inactive deck for announcement audio) ---
  async saveStateForAnnouncement() {
    let elapsed = this.state.elapsed;
    if (this._activeMpv && this.state.status === 'playing') {
      try { elapsed = await this._activeMpv.getProperty('time-pos') || elapsed; } catch {}
    }

    this._savedState = {
      status: this.state.status,
      volume: this.state.volume,
      elapsed,
    };
    this._announcementMode = true;
  }

  async fadeOut(durationMs = 2000) {
    const steps = 20;
    const stepMs = durationMs / steps;
    const startVol = this.state.volume;
    for (let i = 1; i <= steps; i++) {
      const vol = Math.round(startVol * (1 - i / steps));
      try { await this._activeMpv.volume(vol); } catch {}
      await new Promise(r => setTimeout(r, stepMs));
    }
    // Pause active deck — track stays loaded at current position
    try { await this._activeMpv.pause(); } catch {}
  }

  async playAnnouncementFile(filepath, volume) {
    // Play announcement on the INACTIVE deck (active deck keeps music paused)
    const announceMpv = this._inactiveMpv;
    if (!announceMpv) { console.warn('mpv not available for announcement'); return; }

    try {
      await announceMpv.load(filepath);
      await announceMpv.volume(volume ?? this.state.volume);
      try { await announceMpv.resume(); } catch {}
    } catch (err) {
      console.error('Failed to play announcement:', err.message);
      return;
    }

    // Wait for announcement to finish
    return new Promise((resolve) => {
      let resolved = false;
      const done = () => {
        if (resolved) return;
        resolved = true;
        announceMpv.removeListener('stopped', onStopped);
        resolve();
      };

      const onStopped = () => done();
      announceMpv.on('stopped', onStopped);

      // Fallback: poll time-pos to detect end
      const checkInterval = setInterval(async () => {
        if (resolved) { clearInterval(checkInterval); return; }
        try {
          const pos = await announceMpv.getProperty('time-pos');
          const dur = await announceMpv.getProperty('duration');
          if (pos && dur && pos >= dur - 0.5) {
            clearInterval(checkInterval);
            done();
          }
        } catch {
          clearInterval(checkInterval);
          done();
        }
      }, 500);

      // Safety timeout: 5 minutes max
      setTimeout(() => { clearInterval(checkInterval); done(); }, 300000);
    });
  }

  async restoreAfterAnnouncement(fadeDurationMs = 2000) {
    if (!this._savedState) {
      this._announcementMode = false;
      return;
    }

    const saved = this._savedState;

    if (saved.status === 'playing' || saved.status === 'paused') {
      // Active deck still has the music track loaded and paused at the right position
      // Simply resume and fade in — no need to reload or seek!
      try { await this._activeMpv.volume(0); } catch {}
      try { await this._activeMpv.resume(); } catch {}

      this.state.status = 'playing';
      this.state.elapsed = saved.elapsed || 0;
      this._startPositionTracking();

      // Fade in
      const steps = 20;
      const stepMs = fadeDurationMs / steps;
      for (let i = 1; i <= steps; i++) {
        const vol = Math.round(saved.volume * (i / steps));
        try { await this._activeMpv.volume(vol); } catch {}
        await new Promise(r => setTimeout(r, stepMs));
      }

      if (saved.status === 'paused') {
        try { await this._activeMpv.pause(); } catch {}
        this.state.status = 'paused';
        this._stopPositionTracking();
      }
    }

    this.state.volume = saved.volume;
    this._savedState = null;
    this._announcementMode = false;
    this._emitState();
  }
}

module.exports = new PlayerService();
