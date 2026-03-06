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
    this.mpv = new mpvAPI({
      audio_only: true,
      auto_restart: true,
      binary: '/usr/bin/mpv',
    }, [
      '--no-video',
      '--no-terminal',
      '--really-quiet',
    ]);

    try {
      await this.mpv.start();
    } catch (err) {
      console.error('Failed to start mpv:', err.message);
      console.error('Make sure mpv is installed: sudo apt install mpv');
      return;
    }

    const settings = playlistService.getSettings();
    this.state.volume = settings.volume ?? 50;
    try { await this.mpv.volume(this.state.volume); } catch {}

    this.mpv.on('stopped', () => {
      if (this._announcementMode) return;
      this._onTrackEnd();
    });

    this.mpv.on('paused', () => {
      this.state.status = 'paused';
      this._emitState();
    });

    this.mpv.on('resumed', () => {
      this.state.status = 'playing';
      this._emitState();
    });
  }

  _startPositionTracking() {
    this._stopPositionTracking();
    this._positionInterval = setInterval(async () => {
      if (this.state.status !== 'playing') return;
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
    if (this.state.status === 'playing') {
      await this.mpv.pause();
      this.state.status = 'paused';
      this._stopPositionTracking();
      this._emitState();
    }
  }

  async stop() {
    try { await this.mpv.stop(); } catch {}
    this.state.status = 'stopped';
    this.state.elapsed = 0;
    this.state.currentTrack = null;
    this._stopPositionTracking();
    this._emitState();
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
    try { await this.mpv.volume(volume); } catch {}
    playlistService.updateSettings({ volume });
    this._emitState();
  }

  async _playCurrentTrack() {
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
    this._savedState = {
      status: this.state.status,
      currentIndex: this.state.currentIndex,
      elapsed: this.state.elapsed,
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
    try {
      await this.mpv.load(filepath);
      await this.mpv.volume(volume ?? this.state.volume);
    } catch (err) {
      console.error('Failed to play announcement:', err.message);
    }

    // Wait for announcement to finish
    return new Promise((resolve) => {
      const checkInterval = setInterval(async () => {
        try {
          const idle = await this.mpv.getProperty('idle-active');
          if (idle) {
            clearInterval(checkInterval);
            resolve();
          }
        } catch {
          clearInterval(checkInterval);
          resolve();
        }
      }, 500);
      // Safety timeout: 5 minutes max
      setTimeout(() => { clearInterval(checkInterval); resolve(); }, 300000);
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
      await this._playCurrentTrack();

      // Seek to saved position
      if (saved.elapsed > 0) {
        try { await this.mpv.seek(saved.elapsed, 'absolute'); } catch {}
      }

      // Fade in
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
