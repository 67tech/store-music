const { getDb } = require('../db');
const playerService = require('./PlayerService');
const playlistService = require('./PlaylistService');

class AnnouncementService {
  getAllAnnouncements() {
    return getDb().prepare('SELECT * FROM announcements ORDER BY created_at DESC').all();
  }

  getAnnouncement(id) {
    return getDb().prepare('SELECT * FROM announcements WHERE id = ?').get(id);
  }

  createAnnouncement({ name, type, filepath, tts_text, tts_engine, duration }) {
    const result = getDb().prepare(
      'INSERT INTO announcements (name, type, filepath, tts_text, tts_engine, duration) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(name, type, filepath || null, tts_text || null, tts_engine || null, duration || 0);
    return this.getAnnouncement(result.lastInsertRowid);
  }

  deleteAnnouncement(id) {
    getDb().prepare('DELETE FROM scheduled_announcements WHERE announcement_id = ?').run(id);
    return getDb().prepare('DELETE FROM announcements WHERE id = ?').run(id);
  }

  // --- Scheduled announcements ---
  getScheduledAnnouncements() {
    return getDb().prepare(`
      SELECT sa.*, a.name as announcement_name, a.type, a.filepath, a.duration
      FROM scheduled_announcements sa
      JOIN announcements a ON a.id = sa.announcement_id
      ORDER BY sa.trigger_type, sa.trigger_value
    `).all();
  }

  createScheduledAnnouncement({ announcement_id, trigger_type, trigger_value, days_of_week, is_active, volume_override }) {
    const result = getDb().prepare(
      'INSERT INTO scheduled_announcements (announcement_id, trigger_type, trigger_value, days_of_week, is_active, volume_override) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      announcement_id,
      trigger_type,
      trigger_value,
      JSON.stringify(days_of_week || [1, 2, 3, 4, 5]),
      is_active !== undefined ? (is_active ? 1 : 0) : 1,
      volume_override || null
    );
    return getDb().prepare('SELECT * FROM scheduled_announcements WHERE id = ?').get(result.lastInsertRowid);
  }

  updateScheduledAnnouncement(id, data) {
    const fields = [];
    const values = [];
    if (data.trigger_type !== undefined) { fields.push('trigger_type = ?'); values.push(data.trigger_type); }
    if (data.trigger_value !== undefined) { fields.push('trigger_value = ?'); values.push(data.trigger_value); }
    if (data.days_of_week !== undefined) { fields.push('days_of_week = ?'); values.push(JSON.stringify(data.days_of_week)); }
    if (data.is_active !== undefined) { fields.push('is_active = ?'); values.push(data.is_active ? 1 : 0); }
    if (data.volume_override !== undefined) { fields.push('volume_override = ?'); values.push(data.volume_override); }
    if (fields.length === 0) return;
    values.push(id);
    getDb().prepare(`UPDATE scheduled_announcements SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return getDb().prepare('SELECT * FROM scheduled_announcements WHERE id = ?').get(id);
  }

  deleteScheduledAnnouncement(id) {
    return getDb().prepare('DELETE FROM scheduled_announcements WHERE id = ?').run(id);
  }

  // --- Play announcement (interrupt + resume) ---
  async playNow(announcementId) {
    const announcement = this.getAnnouncement(announcementId);
    if (!announcement || !announcement.filepath) {
      throw new Error('Announcement not found or has no audio file');
    }

    const settings = playlistService.getSettings();
    const fadeDuration = settings.announcementFadeDurationMs || 2000;

    // Save current state
    await playerService.saveStateForAnnouncement();

    // Fade out music
    if (playerService.state.status === 'playing') {
      await playerService.fadeOut(fadeDuration);
    }

    // Play announcement
    await playerService.playAnnouncementFile(announcement.filepath, announcement.volume_override || undefined);

    // Restore music
    await playerService.restoreAfterAnnouncement(fadeDuration);
  }
}

module.exports = new AnnouncementService();
