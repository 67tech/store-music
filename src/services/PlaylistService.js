const { getDb } = require('../db');

class PlaylistService {
  // --- Tracks ---
  getAllTracks() {
    const tracks = getDb().prepare("SELECT * FROM tracks WHERE artist NOT IN ('Komunikat', 'Reklama') AND title NOT LIKE '[Komunikat]%' AND title NOT LIKE '[Reklama]%' ORDER BY created_at DESC").all();
    // Attach playlist membership for each track
    const memberships = getDb().prepare(`
      SELECT pt.track_id, p.id as playlist_id, p.name as playlist_name
      FROM playlist_tracks pt
      JOIN playlists p ON p.id = pt.playlist_id
      ORDER BY p.name
    `).all();
    const map = {};
    for (const m of memberships) {
      if (!map[m.track_id]) map[m.track_id] = [];
      map[m.track_id].push({ id: m.playlist_id, name: m.playlist_name });
    }
    return tracks.map(t => ({ ...t, playlists: map[t.id] || [] }));
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
      SELECT t.*, pt.position, pt.id as playlist_track_id, pt.one_shot
      FROM playlist_tracks pt
      JOIN tracks t ON t.id = pt.track_id
      WHERE pt.playlist_id = ?
      ORDER BY pt.position
    `).all(id);
    return playlist;
  }

  createPlaylist({ name, description, shuffle, copyFromPlaylistId }) {
    const result = getDb().prepare(
      'INSERT INTO playlists (name, description, shuffle) VALUES (?, ?, ?)'
    ).run(name, description || '', shuffle ? 1 : 0);
    const newId = result.lastInsertRowid;

    if (copyFromPlaylistId) {
      const tracks = getDb().prepare(
        'SELECT track_id, position FROM playlist_tracks WHERE playlist_id = ? AND one_shot = 0 ORDER BY position'
      ).all(copyFromPlaylistId);
      const insert = getDb().prepare(
        'INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)'
      );
      for (const t of tracks) {
        insert.run(newId, t.track_id, t.position);
      }
    }

    return this.getPlaylist(newId);
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
  addTrackToPlaylist(playlistId, trackId, position, oneShot = false) {
    if (position === undefined || position === null) {
      const max = getDb().prepare('SELECT MAX(position) as maxPos FROM playlist_tracks WHERE playlist_id = ?').get(playlistId);
      position = (max.maxPos ?? -1) + 1;
    }
    getDb().prepare(
      'INSERT INTO playlist_tracks (playlist_id, track_id, position, one_shot) VALUES (?, ?, ?, ?)'
    ).run(playlistId, trackId, position, oneShot ? 1 : 0);
    return this.getPlaylist(playlistId);
  }

  removeOneShotTrack(playlistId, trackId) {
    getDb().prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ? AND one_shot = 1').run(playlistId, trackId);
    this._reorderPositions(playlistId);
  }

  removeTrackFromPlaylist(playlistId, trackId) {
    getDb().prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').run(playlistId, trackId);
    this._reorderPositions(playlistId);
    return this.getPlaylist(playlistId);
  }

  clearPlaylist(playlistId) {
    getDb().prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(playlistId);
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

  // --- Playlist Calendar ---

  getCalendarEntries(startDate, endDate) {
    return getDb().prepare(`
      SELECT pc.*, p.name as playlist_name,
        (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = pc.playlist_id) as track_count
      FROM playlist_calendar pc
      LEFT JOIN playlists p ON p.id = pc.playlist_id
      WHERE pc.date >= ? AND pc.date <= ?
      ORDER BY pc.date
    `).all(startDate, endDate);
  }

  getCalendarEntry(date) {
    return getDb().prepare(`
      SELECT pc.*, p.name as playlist_name
      FROM playlist_calendar pc
      LEFT JOIN playlists p ON p.id = pc.playlist_id
      WHERE pc.date = ?
    `).get(date);
  }

  setCalendarEntry(date, playlistId, label) {
    getDb().prepare(`
      INSERT OR REPLACE INTO playlist_calendar (date, playlist_id, label) VALUES (?, ?, ?)
    `).run(date, playlistId, label || '');
    return this.getCalendarEntry(date);
  }

  setCalendarBulk(dates, playlistId, label) {
    const upsert = getDb().prepare('INSERT OR REPLACE INTO playlist_calendar (date, playlist_id, label) VALUES (?, ?, ?)');
    const bulk = getDb().transaction(() => {
      for (const date of dates) {
        upsert.run(date, playlistId, label || '');
      }
    });
    bulk();
  }

  deleteCalendarEntry(date) {
    getDb().prepare('DELETE FROM playlist_calendar WHERE date = ?').run(date);
  }

  getTodayPlaylist() {
    const today = new Date().toISOString().split('T')[0];
    const entry = getDb().prepare(`
      SELECT pc.playlist_id, p.name as playlist_name
      FROM playlist_calendar pc
      LEFT JOIN playlists p ON p.id = pc.playlist_id
      WHERE pc.date = ?
    `).get(today);
    return entry || null;
  }
}

module.exports = new PlaylistService();
