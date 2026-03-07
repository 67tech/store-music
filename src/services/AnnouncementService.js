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

  updateAnnouncement(id, data) {
    const fields = [];
    const values = [];
    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
    if (data.filepath !== undefined) { fields.push('filepath = ?'); values.push(data.filepath); }
    if (data.tts_text !== undefined) { fields.push('tts_text = ?'); values.push(data.tts_text); }
    if (data.tts_engine !== undefined) { fields.push('tts_engine = ?'); values.push(data.tts_engine); }
    if (data.duration !== undefined) { fields.push('duration = ?'); values.push(data.duration); }
    if (fields.length === 0) return this.getAnnouncement(id);
    values.push(id);
    getDb().prepare(`UPDATE announcements SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getAnnouncement(id);
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

  createScheduledAnnouncement({ announcement_id, trigger_type, trigger_value, days_of_week, is_active, volume_override, play_mode }) {
    const result = getDb().prepare(
      'INSERT INTO scheduled_announcements (announcement_id, trigger_type, trigger_value, days_of_week, is_active, volume_override, play_mode) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      announcement_id,
      trigger_type,
      trigger_value,
      JSON.stringify(days_of_week || [1, 2, 3, 4, 5]),
      is_active !== undefined ? (is_active ? 1 : 0) : 1,
      volume_override || null,
      play_mode || 'interrupt'
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
    if (data.play_mode !== undefined) { fields.push('play_mode = ?'); values.push(data.play_mode); }
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

  // Get upcoming scheduled announcements for today
  getUpcomingAnnouncements() {
    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 5);
    const dayOfWeek = now.getDay();
    const todayStr = now.toISOString().slice(0, 10);

    // Get today's hours
    const { getDb } = require('../db');
    const exception = getDb().prepare('SELECT * FROM store_hours_exceptions WHERE date = ?').get(todayStr);
    const hours = exception || getDb().prepare('SELECT * FROM store_hours WHERE day_of_week = ?').get(dayOfWeek);

    const scheduled = getDb().prepare(`
      SELECT sa.*, a.name as announcement_name, a.duration as ann_duration
      FROM scheduled_announcements sa
      JOIN announcements a ON a.id = sa.announcement_id
      WHERE sa.is_active = 1
    `).all();

    const results = [];

    for (const sa of scheduled) {
      let triggerTime = null;
      let triggerLabel = '';

      if (sa.trigger_type === 'specific_date') {
        const [saDate, saTime] = sa.trigger_value.split(' ');
        if (saDate === todayStr) {
          triggerTime = saTime;
          triggerLabel = 'Jednorazowy';
        } else {
          continue;
        }
      } else {
        let days;
        try { days = JSON.parse(sa.days_of_week); } catch { continue; }
        if (!days.includes(dayOfWeek)) continue;

        if (sa.trigger_type === 'fixed_time') {
          triggerTime = sa.trigger_value;
          triggerLabel = 'Cykliczny';
        } else if (sa.trigger_type === 'before_close' && hours && !hours.is_closed) {
          const mins = parseInt(sa.trigger_value);
          const [h, m] = hours.close_time.split(':').map(Number);
          const total = h * 60 + m - mins;
          if (total >= 0) {
            triggerTime = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
            triggerLabel = `${sa.trigger_value} min przed zamknięciem`;
          }
        } else if (sa.trigger_type === 'after_open' && hours && !hours.is_closed) {
          const mins = parseInt(sa.trigger_value);
          const [h, m] = hours.open_time.split(':').map(Number);
          const total = h * 60 + m + mins;
          if (total < 1440) {
            triggerTime = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
            triggerLabel = `${sa.trigger_value} min po otwarciu`;
          }
        }
      }

      if (!triggerTime) continue;

      results.push({
        id: sa.id,
        announcement_name: sa.announcement_name,
        trigger_time: triggerTime,
        trigger_label: triggerLabel,
        play_mode: sa.play_mode || 'interrupt',
        duration: sa.ann_duration || 0,
        played: triggerTime < currentTime,
      });
    }

    results.sort((a, b) => a.trigger_time.localeCompare(b.trigger_time));
    return results;
  }

  // Play any audio file with interrupt + resume (like playNow but with filepath directly)
  async playFile(filepath) {
    const settings = playlistService.getSettings();
    const fadeDuration = settings.announcementFadeDurationMs || 2000;

    await playerService.saveStateForAnnouncement();
    if (playerService.state.status === 'playing') {
      await playerService.fadeOut(fadeDuration);
    }
    await playerService.playAnnouncementFile(filepath);
    await playerService.restoreAfterAnnouncement(fadeDuration);
  }
}

module.exports = new AnnouncementService();
