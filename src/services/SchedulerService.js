const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db');
const config = require('../config');
const playerService = require('./PlayerService');
const playlistService = require('./PlaylistService');
const announcementService = require('./AnnouncementService');
const adService = require('./AdService');

class SchedulerService {
  constructor() {
    this._cronJob = null;
    this._playedAnnouncements = new Set(); // Track what's been played today to avoid repeats
    this._lastDateReset = '';
    this._lastLineupHash = '';
    this._lineupWatcher = null;
  }

  start() {
    // Check every minute
    this._cronJob = cron.schedule('* * * * *', () => this._tick());
    console.log('Scheduler started — checking every minute');

    // Watch lineup file for changes
    this._startLineupWatcher();
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
      let repeatEndTime = null;

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
        } else if (sa.trigger_type === 'before_match' && todayHours && !todayHours.is_closed && todayHours.match_time) {
          triggerTime = this._subtractMinutes(todayHours.match_time, parseInt(sa.trigger_value));
          repeatEndTime = todayHours.match_time;
        }
      }

      if (!shouldCheck || !triggerTime) continue;

      // Handle repeat_interval: generate all trigger times in the window
      const repeatInterval = sa.repeat_interval || 0;
      const triggerTimes = [triggerTime];

      if (repeatInterval > 0) {
        const endTime = sa.repeat_until || repeatEndTime || (todayHours ? todayHours.close_time : null);
        if (endTime) {
          let nextTime = this._addMinutes(triggerTime, repeatInterval);
          while (nextTime && nextTime < endTime) {
            triggerTimes.push(nextTime);
            nextTime = this._addMinutes(nextTime, repeatInterval);
          }
        }
      }

      for (const tt of triggerTimes) {
        const key = `${sa.id}:${tt}`;
        if (currentTime === tt && !this._playedAnnouncements.has(key)) {
          this._playedAnnouncements.add(key);
          const playMode = sa.play_mode || 'interrupt';
          console.log(`Scheduled announcement: ${sa.announcement_name} at ${tt} (${playMode})${repeatInterval ? ` [repeat every ${repeatInterval}m]` : ''}`);

          if (playMode === 'queue') {
            this._queueAnnouncement(sa).catch(err => {
              console.error('Failed to queue scheduled announcement:', err.message);
            });
          } else {
            announcementService.playNow(sa.announcement_id).catch(err => {
              console.error('Failed to play scheduled announcement:', err.message);
            });
          }

          // Auto-deactivate one-time specific_date announcements after last trigger
          if (sa.trigger_type === 'specific_date' && tt === triggerTimes[triggerTimes.length - 1]) {
            getDb().prepare('UPDATE scheduled_announcements SET is_active = 0 WHERE id = ?').run(sa.id);
          }
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

    // Check calendar playlist for this date
    const calendarEntry = playlistService.getCalendarEntry(todayStr);

    events.push({
      time: hours.open_time,
      type: 'open',
      label: 'Otwarcie sklepu',
      detail: settings.autoPlayOnOpen
        ? (calendarEntry ? `Auto-start: ${calendarEntry.playlist_name}` : 'Auto-start playlisty')
        : (calendarEntry ? `Playlista: ${calendarEntry.playlist_name}` : null),
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
        } else if (sa.trigger_type === 'before_match' && hours.match_time) {
          triggerTime = this._subtractMinutes(hours.match_time, parseInt(sa.trigger_value));
        }
      }

      if (triggerTime) {
        const repeatInterval = sa.repeat_interval || 0;
        let detail = sa.trigger_type === 'before_close' ? `${sa.trigger_value} min przed zamknięciem` :
                     sa.trigger_type === 'after_open' ? `${sa.trigger_value} min po otwarciu` :
                     sa.trigger_type === 'before_match' ? `${sa.trigger_value} min przed meczem` :
                     sa.trigger_type === 'specific_date' ? 'Jednorazowy' : 'Cykliczny';
        if (repeatInterval > 0) detail += ` (co ${repeatInterval} min)`;

        events.push({
          time: triggerTime,
          type: 'announcement',
          label: sa.announcement_name,
          detail,
          duration: sa.duration || 0,
          volume: sa.volume_override,
          repeat_interval: repeatInterval || undefined,
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
      const currentPlaylistId = playerService.state.playlist ? playerService.state.playlist.id : null;
      const todayDate = new Date().toISOString().split('T')[0];
      const adsToPlay = adService.getAdsToPlay(currentPlaylistId, todayDate);
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
    // Check calendar for today's playlist override
    const calendarEntry = playlistService.getTodayPlaylist();
    let playlist;
    if (calendarEntry) {
      playlist = playlistService.getPlaylist(calendarEntry.playlist_id);
      if (playlist) console.log(`Calendar override: using playlist "${playlist.name}" for today`);
    }
    if (!playlist) {
      playlist = playlistService.getDefaultPlaylist();
    }
    if (playlist && playlist.tracks.length > 0) {
      try {
        await playerService.playPlaylist(playlist.id);
        console.log(`Auto-started playlist "${playlist.name}" at opening`);
      } catch (err) {
        console.error('Auto-play failed:', err.message);
      }
    }
  }

  _startLineupWatcher() {
    const lineupPath = path.join(config.dataDir, 'matchday', 'lineup.txt');
    const lineupDir = path.dirname(lineupPath);
    fs.mkdirSync(lineupDir, { recursive: true });

    // Read initial hash
    try {
      const content = fs.readFileSync(lineupPath, 'utf-8');
      this._lastLineupHash = this._simpleHash(content);
    } catch { /* file doesn't exist yet */ }

    // Poll every 30 seconds (fs.watch is unreliable on some platforms)
    this._lineupWatcher = setInterval(() => {
      try {
        const content = fs.readFileSync(lineupPath, 'utf-8').trim();
        if (!content) return;
        const hash = this._simpleHash(content);
        if (hash !== this._lastLineupHash && this._lastLineupHash !== '') {
          this._lastLineupHash = hash;
          console.log('Lineup file changed — generating TTS and scheduling...');
          this._processLineupChange(content).catch(err => {
            console.error('Lineup processing error:', err.message);
          });
        }
        this._lastLineupHash = hash;
      } catch { /* file doesn't exist */ }
    }, 30000);
  }

  _simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return String(hash);
  }

  async _processLineupChange(text) {
    const ttsService = require('./TtsService');

    // Generate TTS
    const { filepath, duration } = await ttsService.generate(text);
    const filename = path.basename(filepath);
    const destPath = path.join(config.announcementsDir, filename);
    fs.copyFileSync(filepath, destPath);

    // Find or update existing lineup announcement
    const existing = getDb().prepare("SELECT * FROM announcements WHERE name LIKE 'Sklad meczowy%' ORDER BY id DESC LIMIT 1").get();
    let announcementId;

    if (existing) {
      // Update existing
      getDb().prepare('UPDATE announcements SET filepath = ?, tts_text = ?, duration = ? WHERE id = ?')
        .run(destPath, text, duration, existing.id);
      announcementId = existing.id;
      console.log(`Updated lineup announcement #${announcementId}`);
    } else {
      // Create new
      const announcement = announcementService.createAnnouncement({
        name: 'Sklad meczowy',
        type: 'tts',
        filepath: destPath,
        tts_text: text,
        tts_engine: 'google',
        duration,
      });
      announcementId = announcement.id;

      // Auto-schedule: before_match 60 min, repeat every 10 min
      announcementService.createScheduledAnnouncement({
        announcement_id: announcementId,
        trigger_type: 'before_match',
        trigger_value: '60',
        days_of_week: [0, 1, 2, 3, 4, 5, 6],
        is_active: true,
        play_mode: 'interrupt',
        repeat_interval: 10,
      });
      console.log(`Created lineup announcement #${announcementId} with before_match schedule`);
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
