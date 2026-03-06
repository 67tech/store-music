const { getDb } = require('../db');

class PlaylistService {
  // --- Tracks ---
  getAllTracks() {
    return getDb().prepare('SELECT * FROM tracks ORDER BY created_at DESC').all();
  }

  getTrack(id) {
    return getDb().prepare('SELECT * FROM tracks WHERE id = ?').get(id);
  }

  createTrack({ filename, filepath, title, artist, duration, mimetype, filesize }) {
    const result = getDb().prepare(
      'INSERT INTO tracks (filename, filepath, title, artist, duration, mimetype, filesize) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(filename, filepath, title, artist || '', duration || 0, mimetype, filesize || 0);
    return this.getTrack(result.lastInsertRowid);
  }

  updateTrack(id, { title, artist }) {
    const fields = [];
    const values = [];
    if (title !== undefined) { fields.push('title = ?'); values.push(title); }
    if (artist !== undefined) { fields.push('artist = ?'); values.push(artist); }
    if (fields.length === 0) return this.getTrack(id);
    values.push(id);
    getDb().prepare(`UPDATE tracks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getTrack(id);
  }

  deleteTrack(id) {
    getDb().prepare('DELETE FROM playlist_tracks WHERE track_id = ?').run(id);
    return getDb().prepare('DELETE FROM tracks WHERE id = ?').run(id);
  }

  // --- Playlists ---
  getAllPlaylists() {
    const playlists = getDb().prepare('SELECT * FROM playlists ORDER BY name').all();
    const countStmt = getDb().prepare('SELECT COUNT(*) as cnt FROM playlist_tracks WHERE playlist_id = ?');
    return playlists.map(p => ({ ...p, trackCount: countStmt.get(p.id).cnt }));
  }

  getPlaylist(id) {
    const playlist = getDb().prepare('SELECT * FROM playlists WHERE id = ?').get(id);
    if (!playlist) return null;
    playlist.tracks = getDb().prepare(`
      SELECT t.*, pt.position, pt.id as playlist_track_id
      FROM playlist_tracks pt
      JOIN tracks t ON t.id = pt.track_id
      WHERE pt.playlist_id = ?
      ORDER BY pt.position
    `).all(id);
    return playlist;
  }

  createPlaylist({ name, description, shuffle }) {
    const result = getDb().prepare(
      'INSERT INTO playlists (name, description, shuffle) VALUES (?, ?, ?)'
    ).run(name, description || '', shuffle ? 1 : 0);
    return this.getPlaylist(result.lastInsertRowid);
  }

  updatePlaylist(id, { name, description, shuffle, is_default }) {
    const fields = [];
    const values = [];
    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (description !== undefined) { fields.push('description = ?'); values.push(description); }
    if (shuffle !== undefined) { fields.push('shuffle = ?'); values.push(shuffle ? 1 : 0); }
    if (is_default !== undefined) {
      if (is_default) {
        getDb().prepare('UPDATE playlists SET is_default = 0').run();
      }
      fields.push('is_default = ?');
      values.push(is_default ? 1 : 0);
    }
    if (fields.length === 0) return this.getPlaylist(id);
    values.push(id);
    getDb().prepare(`UPDATE playlists SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getPlaylist(id);
  }

  deletePlaylist(id) {
    return getDb().prepare('DELETE FROM playlists WHERE id = ?').run(id);
  }

  getDefaultPlaylist() {
    const playlist = getDb().prepare('SELECT * FROM playlists WHERE is_default = 1').get();
    if (!playlist) return null;
    return this.getPlaylist(playlist.id);
  }

  // --- Playlist Tracks ---
  addTrackToPlaylist(playlistId, trackId, position) {
    if (position === undefined || position === null) {
      const max = getDb().prepare('SELECT MAX(position) as maxPos FROM playlist_tracks WHERE playlist_id = ?').get(playlistId);
      position = (max.maxPos ?? -1) + 1;
    }
    getDb().prepare(
      'INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)'
    ).run(playlistId, trackId, position);
    return this.getPlaylist(playlistId);
  }

  removeTrackFromPlaylist(playlistId, trackId) {
    getDb().prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').run(playlistId, trackId);
    this._reorderPositions(playlistId);
    return this.getPlaylist(playlistId);
  }

  reorderPlaylistTracks(playlistId, trackIds) {
    const update = getDb().prepare('UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?');
    const reorder = getDb().transaction(() => {
      trackIds.forEach((trackId, index) => {
        update.run(index, playlistId, trackId);
      });
    });
    reorder();
    return this.getPlaylist(playlistId);
  }

  _reorderPositions(playlistId) {
    const tracks = getDb().prepare('SELECT id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position').all(playlistId);
    const update = getDb().prepare('UPDATE playlist_tracks SET position = ? WHERE id = ?');
    const reorder = getDb().transaction(() => {
      tracks.forEach((t, i) => update.run(i, t.id));
    });
    reorder();
  }

  // --- Settings ---
  getSettings() {
    const rows = getDb().prepare('SELECT * FROM settings').all();
    const settings = {};
    for (const row of rows) {
      try { settings[row.key] = JSON.parse(row.value); }
      catch { settings[row.key] = row.value; }
    }
    return settings;
  }

  getSetting(key) {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (!row) return null;
    try { return JSON.parse(row.value); }
    catch { return row.value; }
  }

  updateSettings(settings) {
    const upsert = getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    const update = getDb().transaction(() => {
      for (const [key, value] of Object.entries(settings)) {
        upsert.run(key, JSON.stringify(value));
      }
    });
    update();
    return this.getSettings();
  }
}

module.exports = new PlaylistService();
