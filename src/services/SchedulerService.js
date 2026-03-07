const cron = require('node-cron');
const { getDb } = require('../db');
const playerService = require('./PlayerService');
const playlistService = require('./PlaylistService');
const announcementService = require('./AnnouncementService');
const adService = require('./AdService');

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

    // Check ads that need to play
    this._checkAds();
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

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    for (const sa of scheduled) {
      let triggerTime = null;
      let shouldCheck = false;

      if (sa.trigger_type === 'specific_date') {
        // trigger_value format: "2026-03-15 14:30"
        const [date, time] = sa.trigger_value.split(' ');
        if (date === todayStr) {
          triggerTime = time;
          shouldCheck = true;
        }
      } else {
        // Day-of-week based triggers
        let days;
        try { days = JSON.parse(sa.days_of_week); } catch { continue; }
        if (!days.includes(dayOfWeek)) continue;
        shouldCheck = true;

        if (sa.trigger_type === 'fixed_time') {
          triggerTime = sa.trigger_value;
        } else if (sa.trigger_type === 'before_close' && todayHours && !todayHours.is_closed) {
          triggerTime = this._subtractMinutes(todayHours.close_time, parseInt(sa.trigger_value));
        } else if (sa.trigger_type === 'after_open' && todayHours && !todayHours.is_closed) {
          triggerTime = this._addMinutes(todayHours.open_time, parseInt(sa.trigger_value));
        }
      }

      if (!shouldCheck || !triggerTime) continue;

      const key = `${sa.id}:${triggerTime}`;
      if (currentTime === triggerTime && !this._playedAnnouncements.has(key)) {
        this._playedAnnouncements.add(key);
        const playMode = sa.play_mode || 'interrupt';
        console.log(`Scheduled announcement: ${sa.announcement_name} at ${triggerTime} (${playMode})`);

        if (playMode === 'queue') {
          // Queue mode: insert as one-shot track to play next
          this._queueAnnouncement(sa).catch(err => {
            console.error('Failed to queue scheduled announcement:', err.message);
          });
        } else {
          // Interrupt mode (default): fade out, play, fade in
          announcementService.playNow(sa.announcement_id).catch(err => {
            console.error('Failed to play scheduled announcement:', err.message);
          });
        }

        // Auto-deactivate one-time specific_date announcements after playing
        if (sa.trigger_type === 'specific_date') {
          getDb().prepare('UPDATE scheduled_announcements SET is_active = 0 WHERE id = ?').run(sa.id);
        }
      }
    }
  }

  // Build timeline for a given date
  getTimeline(dateStr) {
    const date = dateStr ? new Date(dateStr + 'T12:00:00') : new Date();
    const dayOfWeek = date.getDay();
    const todayStr = dateStr || date.toISOString().slice(0, 10);

    const hours = this._getTodayHours(todayStr, dayOfWeek);
    const settings = playlistService.getSettings();
    const events = [];

    if (!hours || hours.is_closed) {
      return { date: todayStr, closed: true, hours: null, events: [] };
    }

    events.push({
      time: hours.open_time,
      type: 'open',
      label: 'Otwarcie sklepu',
      detail: settings.autoPlayOnOpen ? 'Auto-start playlisty' : null,
    });

    const scheduled = getDb().prepare(`
      SELECT sa.*, a.name as announcement_name, a.duration
      FROM scheduled_announcements sa
      JOIN announcements a ON a.id = sa.announcement_id
      WHERE sa.is_active = 1
    `).all();

    for (const sa of scheduled) {
      let triggerTime = null;

      if (sa.trigger_type === 'specific_date') {
        const [saDate, saTime] = sa.trigger_value.split(' ');
        if (saDate === todayStr) triggerTime = saTime;
      } else {
        let days;
        try { days = JSON.parse(sa.days_of_week); } catch { continue; }
        if (!days.includes(dayOfWeek)) continue;

        if (sa.trigger_type === 'fixed_time') {
          triggerTime = sa.trigger_value;
        } else if (sa.trigger_type === 'before_close') {
          triggerTime = this._subtractMinutes(hours.close_time, parseInt(sa.trigger_value));
        } else if (sa.trigger_type === 'after_open') {
          triggerTime = this._addMinutes(hours.open_time, parseInt(sa.trigger_value));
        }
      }

      if (triggerTime) {
        events.push({
          time: triggerTime,
          type: 'announcement',
          label: sa.announcement_name,
          detail: sa.trigger_type === 'before_close' ? `${sa.trigger_value} min przed zamknięciem` :
                  sa.trigger_type === 'after_open' ? `${sa.trigger_value} min po otwarciu` :
                  sa.trigger_type === 'specific_date' ? 'Jednorazowy' : 'Cykliczny',
          duration: sa.duration || 0,
          volume: sa.volume_override,
        });
      }
    }

    events.push({
      time: hours.close_time,
      type: 'close',
      label: 'Zamknięcie sklepu',
      detail: settings.autoStopOnClose ? 'Auto-stop playlisty' : null,
    });

    events.sort((a, b) => a.time.localeCompare(b.time));

    return {
      date: todayStr,
      closed: false,
      hours: { open: hours.open_time, close: hours.close_time },
      events,
    };
  }

  async _checkAds() {
    // Only play ads if player is active
    if (playerService.state.status !== 'playing') return;
    if (!playerService.state.playlist) return;

    try {
      const adsToPlay = adService.getAdsToPlay();
      if (adsToPlay.length === 0) return;

      // Play the highest priority ad
      const ad = adsToPlay[0];
      const adTitle = `[Reklama] ${ad.title}`;
      const playMode = ad.play_mode || 'queue';

      if (playMode === 'interrupt') {
        // Interrupt mode: use announcement mechanism (fade out, play ad, fade in, resume)
        console.log(`Ad interrupt: "${ad.title}" (${ad.client_name || 'no client'})`);
        await announcementService.playFile(ad.filepath);
        // Log to playback history
        const { getDb } = require('../db');
        getDb().prepare(
          "INSERT INTO playback_history (title, artist, duration, one_shot, played_at) VALUES (?, ?, ?, 1, datetime('now', 'localtime'))"
        ).run(adTitle, ad.client_name || '', ad.duration || 0);
      } else {
        // Queue mode: insert as one-shot track to play next
        const { getDb } = require('../db');
        let track = getDb().prepare('SELECT * FROM tracks WHERE filepath = ?').get(ad.filepath);
        if (!track) {
          const result = getDb().prepare(
            'INSERT INTO tracks (filename, filepath, title, artist, duration, mimetype, filesize) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).run(ad.filename, ad.filepath, adTitle, ad.client_name || '', ad.duration, 'audio/mpeg', 0);
          track = getDb().prepare('SELECT * FROM tracks WHERE id = ?').get(result.lastInsertRowid);
        }

        if (track) {
          const playlistId = playerService.state.playlist.id;
          const insertPos = playerService.state.currentIndex + 1;

          playlistService.addTrackToPlaylist(playlistId, track.id, undefined, true);

          const playlist = playlistService.getPlaylist(playlistId);
          const ids = playlist.tracks.map(t => t.id);
          const addedIdx = ids.lastIndexOf(track.id);
          if (addedIdx >= 0 && addedIdx !== insertPos) {
            ids.splice(addedIdx, 1);
            ids.splice(Math.min(insertPos, ids.length), 0, track.id);
            playlistService.reorderPlaylistTracks(playlistId, ids);
          }

          playerService.refreshPlaylist();
          console.log(`Ad queued: "${ad.title}" (${ad.client_name || 'no client'}) — position ${insertPos}`);
        }
      }
    } catch (err) {
      console.error('Ad scheduling error:', err.message);
    }
  }

  async _queueAnnouncement(sa) {
    if (playerService.state.status !== 'playing' || !playerService.state.playlist) {
      // Not playing — fall back to interrupt mode
      await announcementService.playNow(sa.announcement_id);
      return;
    }

    const announcement = announcementService.getAnnouncement(sa.announcement_id);
    if (!announcement || !announcement.filepath) return;

    const annTitle = `[Komunikat] ${announcement.name}`;
    let track = getDb().prepare('SELECT * FROM tracks WHERE filepath = ?').get(announcement.filepath);
    if (!track) {
      const result = getDb().prepare(
        'INSERT INTO tracks (filename, filepath, title, artist, duration, mimetype, filesize) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(`ann_${announcement.id}`, announcement.filepath, annTitle, 'Komunikat', announcement.duration || 0, 'audio/mpeg', 0);
      track = getDb().prepare('SELECT * FROM tracks WHERE id = ?').get(result.lastInsertRowid);
    }

    if (track) {
      const playlistId = playerService.state.playlist.id;
      const insertPos = playerService.state.currentIndex + 1;

      playlistService.addTrackToPlaylist(playlistId, track.id, undefined, true);

      const playlist = playlistService.getPlaylist(playlistId);
      const ids = playlist.tracks.map(t => t.id);
      const addedIdx = ids.lastIndexOf(track.id);
      if (addedIdx >= 0 && addedIdx !== insertPos) {
        ids.splice(addedIdx, 1);
        ids.splice(Math.min(insertPos, ids.length), 0, track.id);
        playlistService.reorderPlaylistTracks(playlistId, ids);
      }

      playerService.refreshPlaylist();
      console.log(`Announcement queued: "${announcement.name}" — position ${insertPos}`);
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
