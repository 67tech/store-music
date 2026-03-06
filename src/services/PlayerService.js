const mpvAPI = require('node-mpv');
const EventEmitter = require('events');
const playlistService = require('./PlaylistService');

class PlayerService extends EventEmitter {
  constructor() {
    super();
    this.mpv = null;
    this.state = {
      status: 'stopped', // playing, paused, stopped
      currentTrack: null,
      currentIndex: -1,
      volume: 50,
      duration: 0,
      elapsed: 0,
      playlist: null,
      playlistTracks: [],
      shuffle: false,
      shuffledIndices: [],
    };
    this._positionInterval = null;
    this._announcementMode = false;
    this._savedState = null;
  }

  async init() {
    // Detect mpv binary path
    const { execSync } = require('child_process');
    let mpvBinary = '/usr/bin/mpv';
    try {
      mpvBinary = execSync('which mpv').toString().trim();
    } catch {}

    try {
      // Test if mpv binary exists before spawning
      try {
        execSync(`"${mpvBinary}" --version`, { stdio: 'pipe' });
      } catch {
        throw new Error(`mpv not found at ${mpvBinary}`);
      }

      this.mpv = new mpvAPI({
        audio_only: true,
        binary: mpvBinary,
        ipc_command: '--input-ipc-server',
      }, [
        '--no-video',
        '--no-terminal',
        '--really-quiet',
      ]);

      // node-mpv 1.x starts automatically via constructor
      // Wait a moment for mpv to initialize
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error('mpv not available:', err.message);
      console.error('Install mpv: brew install mpv (macOS) or sudo apt install mpv (Linux)');
      console.warn('Server will run without audio playback capability');
      this.mpv = null;
      return;
    }

    const settings = playlistService.getSettings();
    this.state.volume = settings.volume ?? 50;
    try { await this.mpv.volume(this.state.volume); } catch {}

    this.mpv.on('stopped', () => {
      if (this._announcementMode) return;
      this._onTrackEnd();
    });

    this.mpv.on('statuschange', (status) => {
      if (status && status.property === 'pause') {
        if (status.value) {
          this.state.status = 'paused';
        } else {
          this.state.status = 'playing';
        }
        this._emitState();
      }
    });
  }

  _startPositionTracking() {
    this._stopPositionTracking();
    this._positionInterval = setInterval(async () => {
      if (this.state.status !== 'playing' || !this.mpv) return;
      try {
        this.state.elapsed = await this.mpv.getProperty('time-pos') || 0;
        this.state.duration = await this.mpv.getProperty('duration') || 0;
      } catch {}
      this._emitState();
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
    return { ...this.state };
  }

  async playPlaylist(playlistId) {
    const playlist = playlistService.getPlaylist(playlistId);
    if (!playlist || !playlist.tracks.length) {
      throw new Error('Playlist is empty or not found');
    }

    this.state.playlist = { id: playlist.id, name: playlist.name };
    this.state.playlistTracks = playlist.tracks;
    this.state.shuffle = !!playlist.shuffle;

    if (this.state.shuffle) {
      this._generateShuffleOrder();
      this.state.currentIndex = 0;
    } else {
      this.state.currentIndex = 0;
      this.state.shuffledIndices = [];
    }

    await this._playCurrentTrack();
  }

  async play() {
    if (!this.mpv) { console.warn('mpv not available'); return; }
    if (this.state.status === 'paused') {
      await this.mpv.resume();
      this.state.status = 'playing';
      this._startPositionTracking();
      this._emitState();
    } else if (this.state.status === 'stopped' && this.state.playlistTracks.length > 0) {
      await this._playCurrentTrack();
    }
  }

  async pause() {
    if (!this.mpv) return;
    if (this.state.status === 'playing') {
      await this.mpv.pause();
      this.state.status = 'paused';
      this._stopPositionTracking();
      this._emitState();
    }
  }

  async stop() {
    if (this.mpv) { try { await this.mpv.stop(); } catch {} }
    this.state.status = 'stopped';
    this.state.elapsed = 0;
    this.state.currentTrack = null;
    this._stopPositionTracking();
    this._emitState();
  }

  async seek(position) {
    if (!this.mpv) return;
    try {
      await this.mpv.seek(position, 'absolute');
      this.state.elapsed = position;
      this._emitState();
    } catch (err) {
      console.error('Seek failed:', err.message);
    }
  }

  async next() {
    if (this.state.playlistTracks.length === 0) return;
    this.state.currentIndex++;
    if (this.state.currentIndex >= this.state.playlistTracks.length) {
      this.state.currentIndex = 0;
      if (this.state.shuffle) this._generateShuffleOrder();
    }
    await this._playCurrentTrack();
  }

  async previous() {
    if (this.state.playlistTracks.length === 0) return;
    this.state.currentIndex--;
    if (this.state.currentIndex < 0) {
      this.state.currentIndex = this.state.playlistTracks.length - 1;
    }
    await this._playCurrentTrack();
  }

  async setVolume(volume) {
    volume = Math.max(0, Math.min(100, volume));
    this.state.volume = volume;
    if (this.mpv) { try { await this.mpv.volume(volume); } catch {} }
    playlistService.updateSettings({ volume });
    this._emitState();
  }

  async _playCurrentTrack() {
    if (!this.mpv) { console.warn('mpv not available'); return; }

    const idx = this.state.shuffle
      ? this.state.shuffledIndices[this.state.currentIndex]
      : this.state.currentIndex;

    const track = this.state.playlistTracks[idx];
    if (!track) return;

    this.state.currentTrack = track;
    this.state.status = 'playing';
    this.state.elapsed = 0;

    try {
      await this.mpv.load(track.filepath);
      await this.mpv.volume(this.state.volume);
      this._startPositionTracking();
    } catch (err) {
      console.error('Failed to play track:', err.message);
      // Skip to next on error
      setTimeout(() => this.next(), 1000);
    }
    this._emitState();
  }

  _onTrackEnd() {
    this.state.currentIndex++;
    if (this.state.currentIndex >= this.state.playlistTracks.length) {
      this.state.currentIndex = 0;
      if (this.state.shuffle) this._generateShuffleOrder();
    }
    this._playCurrentTrack();
  }

  _generateShuffleOrder() {
    const indices = Array.from({ length: this.state.playlistTracks.length }, (_, i) => i);
    // Fisher-Yates shuffle
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    this.state.shuffledIndices = indices;
  }

  // --- Announcement support ---
  async saveStateForAnnouncement() {
    // Get fresh position from mpv before saving
    let elapsed = this.state.elapsed;
    if (this.mpv && this.state.status === 'playing') {
      try { elapsed = await this.mpv.getProperty('time-pos') || elapsed; } catch {}
    }

    this._savedState = {
      status: this.state.status,
      currentIndex: this.state.currentIndex,
      elapsed,
      volume: this.state.volume,
      playlist: this.state.playlist,
      playlistTracks: [...this.state.playlistTracks],
      shuffle: this.state.shuffle,
      shuffledIndices: [...this.state.shuffledIndices],
    };
    this._announcementMode = true;
  }

  async fadeOut(durationMs = 2000) {
    const steps = 20;
    const stepMs = durationMs / steps;
    const startVol = this.state.volume;
    for (let i = 1; i <= steps; i++) {
      const vol = Math.round(startVol * (1 - i / steps));
      try { await this.mpv.volume(vol); } catch {}
      await new Promise(r => setTimeout(r, stepMs));
    }
    try { await this.mpv.pause(); } catch {}
  }

  async playAnnouncementFile(filepath, volume) {
    if (!this.mpv) { console.warn('mpv not available for announcement'); return; }

    try {
      await this.mpv.load(filepath);
      await this.mpv.volume(volume ?? this.state.volume);
      // Ensure playback starts (mpv might be paused from fadeOut)
      try { await this.mpv.resume(); } catch {}
    } catch (err) {
      console.error('Failed to play announcement:', err.message);
      return;
    }

    // Wait for announcement to finish using 'stopped' event
    return new Promise((resolve) => {
      let resolved = false;
      const done = () => {
        if (resolved) return;
        resolved = true;
        this.mpv.removeListener('stopped', onStopped);
        resolve();
      };

      const onStopped = () => done();
      this.mpv.on('stopped', onStopped);

      // Fallback: poll time-pos to detect end
      const checkInterval = setInterval(async () => {
        if (resolved) { clearInterval(checkInterval); return; }
        try {
          const pos = await this.mpv.getProperty('time-pos');
          const dur = await this.mpv.getProperty('duration');
          if (pos && dur && pos >= dur - 0.5) {
            clearInterval(checkInterval);
            done();
          }
        } catch {
          // mpv might have stopped already
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
    this.state.playlist = saved.playlist;
    this.state.playlistTracks = saved.playlistTracks;
    this.state.shuffle = saved.shuffle;
    this.state.shuffledIndices = saved.shuffledIndices;
    this.state.currentIndex = saved.currentIndex;

    if (saved.status === 'playing' || saved.status === 'paused') {
      // Mute before loading so user doesn't hear the beginning
      try { await this.mpv.volume(0); } catch {}

      await this._playCurrentTrack();

      // Wait for mpv to fully load the file before seeking
      await new Promise(r => setTimeout(r, 500));

      // Seek to saved position
      if (saved.elapsed > 0) {
        try {
          await this.mpv.seek(saved.elapsed, 'absolute');
          this.state.elapsed = saved.elapsed;
        } catch (err) {
          console.error('Seek after announcement failed:', err.message);
        }
        // Wait for seek to complete
        await new Promise(r => setTimeout(r, 300));
      }

      // Fade in from 0 to saved volume
      const steps = 20;
      const stepMs = fadeDurationMs / steps;
      for (let i = 1; i <= steps; i++) {
        const vol = Math.round(saved.volume * (i / steps));
        try { await this.mpv.volume(vol); } catch {}
        await new Promise(r => setTimeout(r, stepMs));
      }

      if (saved.status === 'paused') {
        await this.mpv.pause();
      }
    }

    this.state.volume = saved.volume;
    this._savedState = null;
    this._announcementMode = false;
    this._emitState();
  }
}

module.exports = new PlayerService();
