const cron = require('node-cron');
const { getDb } = require('../db');
const playerService = require('./PlayerService');
const playlistService = require('./PlaylistService');
const announcementService = require('./AnnouncementService');

class SchedulerService {
  constructor() {
    this._cronJob = null;
    this._playedAnnouncements = new Set(); // Track what's been played today to avoid repeats
    this._lastDateReset = '';
  }

  start() {
    // Check every minute
    this._cronJob = cron.schedule('* * * * *', () => this._tick());
    console.log('Scheduler started — checking every minute');
  }

  stop() {
    if (this._cronJob) {
      this._cronJob.stop();
      this._cronJob = null;
    }
  }

  _tick() {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    // Reset played announcements at midnight
    if (this._lastDateReset !== todayStr) {
      this._playedAnnouncements.clear();
      this._lastDateReset = todayStr;
    }

    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const dayOfWeek = now.getDay(); // 0=Sun

    const todayHours = this._getTodayHours(todayStr, dayOfWeek);
    const settings = playlistService.getSettings();

    // Auto play at opening
    if (settings.autoPlayOnOpen && todayHours && !todayHours.is_closed) {
      if (currentTime === todayHours.open_time && playerService.state.status === 'stopped') {
        this._autoPlay();
      }
    }

    // Auto stop at closing
    if (settings.autoStopOnClose && todayHours && !todayHours.is_closed) {
      if (currentTime === todayHours.close_time && playerService.state.status !== 'stopped') {
        playerService.stop();
        console.log(`Auto-stopped at closing time ${todayHours.close_time}`);
      }
    }

    // Check scheduled announcements
    this._checkScheduledAnnouncements(currentTime, dayOfWeek, todayHours);
  }

  _getTodayHours(dateStr, dayOfWeek) {
    // Check exceptions first
    const exception = getDb().prepare('SELECT * FROM store_hours_exceptions WHERE date = ?').get(dateStr);
    if (exception) {
      return exception;
    }
    // Fall back to weekly schedule
    return getDb().prepare('SELECT * FROM store_hours WHERE day_of_week = ?').get(dayOfWeek);
  }

  getTodayHours() {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    return this._getTodayHours(todayStr, now.getDay());
  }

  _checkScheduledAnnouncements(currentTime, dayOfWeek, todayHours) {
    const scheduled = getDb().prepare(`
      SELECT sa.*, a.filepath, a.name as announcement_name
      FROM scheduled_announcements sa
      JOIN announcements a ON a.id = sa.announcement_id
      WHERE sa.is_active = 1
    `).all();

    for (const sa of scheduled) {
      // Check day of week
      let days;
      try { days = JSON.parse(sa.days_of_week); } catch { continue; }
      if (!days.includes(dayOfWeek)) continue;

      let triggerTime = null;

      if (sa.trigger_type === 'fixed_time') {
        triggerTime = sa.trigger_value;
      } else if (sa.trigger_type === 'before_close' && todayHours && !todayHours.is_closed) {
        triggerTime = this._subtractMinutes(todayHours.close_time, parseInt(sa.trigger_value));
      } else if (sa.trigger_type === 'after_open' && todayHours && !todayHours.is_closed) {
        triggerTime = this._addMinutes(todayHours.open_time, parseInt(sa.trigger_value));
      }

      if (!triggerTime) continue;

      const key = `${sa.id}:${triggerTime}`;
      if (currentTime === triggerTime && !this._playedAnnouncements.has(key)) {
        this._playedAnnouncements.add(key);
        console.log(`Playing scheduled announcement: ${sa.announcement_name} at ${triggerTime}`);
        announcementService.playNow(sa.announcement_id).catch(err => {
          console.error('Failed to play scheduled announcement:', err.message);
        });
      }
    }
  }

  async _autoPlay() {
    const defaultPlaylist = playlistService.getDefaultPlaylist();
    if (defaultPlaylist && defaultPlaylist.tracks.length > 0) {
      try {
        await playerService.playPlaylist(defaultPlaylist.id);
        console.log(`Auto-started playlist "${defaultPlaylist.name}" at opening`);
      } catch (err) {
        console.error('Auto-play failed:', err.message);
      }
    }
  }

  _subtractMinutes(timeStr, minutes) {
    const [h, m] = timeStr.split(':').map(Number);
    const totalMin = h * 60 + m - minutes;
    if (totalMin < 0) return null;
    return `${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`;
  }

  _addMinutes(timeStr, minutes) {
    const [h, m] = timeStr.split(':').map(Number);
    const totalMin = h * 60 + m + minutes;
    if (totalMin >= 1440) return null;
    return `${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`;
  }
}

module.exports = new SchedulerService();
