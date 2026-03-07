const { getDb } = require('../db');
const path = require('path');
const config = require('../config');

class AdService {
  getAllAds() {
    return getDb().prepare('SELECT * FROM ads ORDER BY priority DESC, title').all();
  }

  getAd(id) {
    return getDb().prepare('SELECT * FROM ads WHERE id = ?').get(id);
  }

  createAd(data) {
    const { title, client_name, filepath, filename, duration, schedule_mode, daily_target, interval_minutes, start_time, end_time, days_of_week, priority, play_mode } = data;
    const result = getDb().prepare(`
      INSERT INTO ads (title, client_name, filepath, filename, duration, schedule_mode, daily_target, interval_minutes, start_time, end_time, days_of_week, priority, play_mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      title, client_name || '', filepath, filename, duration || 0,
      schedule_mode || 'count', daily_target || 1, interval_minutes || 60,
      start_time || '08:00', end_time || '20:00',
      JSON.stringify(days_of_week || [1,2,3,4,5,6]), priority || 5,
      play_mode || 'queue'
    );
    return this.getAd(result.lastInsertRowid);
  }

  updateAd(id, data) {
    const ad = this.getAd(id);
    if (!ad) return null;

    const fields = ['title', 'client_name', 'schedule_mode', 'daily_target', 'interval_minutes', 'start_time', 'end_time', 'days_of_week', 'priority', 'is_active', 'play_mode'];
    for (const field of fields) {
      if (data[field] !== undefined) {
        const val = field === 'days_of_week' ? JSON.stringify(data[field]) : data[field];
        getDb().prepare(`UPDATE ads SET ${field} = ? WHERE id = ?`).run(val, id);
      }
    }
    return this.getAd(id);
  }

  deleteAd(id) {
    const ad = this.getAd(id);
    if (ad) {
      getDb().prepare('DELETE FROM ads WHERE id = ?').run(id);
      // Delete file
      const fs = require('fs');
      try { if (ad.filepath) fs.unlinkSync(ad.filepath); } catch {}
    }
  }

  // Get today's play count for each ad (from playback_history)
  getTodayPlayCounts() {
    const today = new Date().toISOString().split('T')[0];
    const rows = getDb().prepare(`
      SELECT title, COUNT(*) as count
      FROM playback_history
      WHERE date(played_at) = ? AND one_shot = 1
      GROUP BY title
    `).all(today);
    const map = {};
    for (const r of rows) map[r.title] = r.count;
    return map;
  }

  // Get last play time for each ad title today
  getLastPlayTimes() {
    const today = new Date().toISOString().split('T')[0];
    const rows = getDb().prepare(`
      SELECT title, MAX(played_at) as last_played
      FROM playback_history
      WHERE date(played_at) = ? AND one_shot = 1
      GROUP BY title
    `).all(today);
    const map = {};
    for (const r of rows) map[r.title] = new Date(r.last_played);
    return map;
  }

  // Get ad IDs that are in packs assigned to a given context
  getPackAdIds(playlistId, date) {
    try {
      const adPackService = require('./AdPackService');
      return adPackService.getAdsForContext(playlistId, date);
    } catch { return []; }
  }

  // Determine which ads should play now
  getAdsToPlay(playlistId, date) {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // Get pack-context ad IDs (ads in packs assigned to current playlist/date)
    const packAdIds = new Set(this.getPackAdIds(playlistId, date));

    const activeAds = getDb().prepare('SELECT * FROM ads WHERE is_active = 1 ORDER BY priority DESC').all();
    const playCounts = this.getTodayPlayCounts();
    const lastPlayed = this.getLastPlayTimes();
    const toPlay = [];

    // Get set of all ad IDs that belong to any pack
    let allPackedAdIds = new Set();
    try {
      const rows = getDb().prepare('SELECT DISTINCT ad_id FROM ad_pack_items').all();
      allPackedAdIds = new Set(rows.map(r => r.ad_id));
    } catch {}

    for (const ad of activeAds) {
      // If ad is in a pack, only play it when the pack is assigned to current context
      if (allPackedAdIds.has(ad.id) && !packAdIds.has(ad.id)) continue;

      // Check day of week
      const days = JSON.parse(ad.days_of_week || '[]');
      if (!days.includes(dayOfWeek)) continue;

      // Check time window
      const [sh, sm] = ad.start_time.split(':').map(Number);
      const [eh, em] = ad.end_time.split(':').map(Number);
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;
      if (currentMinutes < startMin || currentMinutes >= endMin) continue;

      const adTitle = `[Reklama] ${ad.title}`;
      const played = playCounts[adTitle] || 0;

      if (ad.schedule_mode === 'count') {
        // Distribute evenly across the time window
        if (played >= ad.daily_target) continue;
        const windowMinutes = endMin - startMin;
        const intervalNeeded = Math.floor(windowMinutes / ad.daily_target);
        const minutesSinceStart = currentMinutes - startMin;
        const expectedPlays = Math.floor(minutesSinceStart / intervalNeeded) + 1;
        if (played < expectedPlays) {
          toPlay.push(ad);
        }
      } else if (ad.schedule_mode === 'interval') {
        // Play every N minutes
        const lastTime = lastPlayed[adTitle];
        if (!lastTime) {
          toPlay.push(ad); // Never played today
        } else {
          const minutesSinceLast = (now - lastTime) / 60000;
          if (minutesSinceLast >= ad.interval_minutes) {
            toPlay.push(ad);
          }
        }
      }
    }

    return toPlay;
  }

  // Get upcoming ads with estimated next play times for today
  getUpcomingAds() {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const activeAds = getDb().prepare('SELECT * FROM ads WHERE is_active = 1 ORDER BY priority DESC').all();
    const playCounts = this.getTodayPlayCounts();
    const lastPlayed = this.getLastPlayTimes();
    const upcoming = [];

    for (const ad of activeAds) {
      const days = JSON.parse(ad.days_of_week || '[]');
      if (!days.includes(dayOfWeek)) continue;

      const [sh, sm] = ad.start_time.split(':').map(Number);
      const [eh, em] = ad.end_time.split(':').map(Number);
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;

      if (currentMinutes >= endMin) continue; // Window already passed

      const adTitle = `[Reklama] ${ad.title}`;
      const played = playCounts[adTitle] || 0;
      let nextPlayMin = null;

      if (ad.schedule_mode === 'count') {
        if (played >= ad.daily_target) continue; // Already done for today
        const windowMinutes = endMin - startMin;
        const intervalNeeded = Math.floor(windowMinutes / ad.daily_target);
        // Calculate next expected play time
        const nextSlot = played; // 0-based slot index
        nextPlayMin = startMin + nextSlot * intervalNeeded;
        if (nextPlayMin < currentMinutes) nextPlayMin = currentMinutes; // Already past, play soon
        if (nextPlayMin >= endMin) continue;
      } else if (ad.schedule_mode === 'interval') {
        const lastTime = lastPlayed[adTitle];
        if (!lastTime) {
          nextPlayMin = Math.max(startMin, currentMinutes);
        } else {
          const lastMinutes = lastTime.getHours() * 60 + lastTime.getMinutes();
          nextPlayMin = lastMinutes + ad.interval_minutes;
          if (nextPlayMin < currentMinutes) nextPlayMin = currentMinutes;
        }
        if (nextPlayMin >= endMin) continue;
      }

      if (nextPlayMin !== null) {
        const h = Math.floor(nextPlayMin / 60);
        const m = nextPlayMin % 60;
        const nextPlayTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

        // Calculate remaining plays today
        let remainingPlays = 0;
        if (ad.schedule_mode === 'count') {
          remainingPlays = ad.daily_target - played;
        } else {
          // Estimate remaining interval plays
          const remainingMinutes = endMin - Math.max(currentMinutes, startMin);
          remainingPlays = Math.max(1, Math.floor(remainingMinutes / ad.interval_minutes));
        }

        upcoming.push({
          id: ad.id,
          title: ad.title,
          client_name: ad.client_name,
          duration: ad.duration,
          play_mode: ad.play_mode || 'queue',
          schedule_mode: ad.schedule_mode,
          next_play_time: nextPlayTime,
          today_plays: played,
          remaining_plays: remainingPlays,
          daily_target: ad.daily_target,
          interval_minutes: ad.interval_minutes,
          start_time: ad.start_time,
          end_time: ad.end_time,
          priority: ad.priority,
        });
      }
    }

    // Sort by next play time
    upcoming.sort((a, b) => a.next_play_time.localeCompare(b.next_play_time));
    return upcoming;
  }

  // Get report: play counts for a date range
  getReport(startDate, endDate) {
    const rows = getDb().prepare(`
      SELECT date(played_at) as date, title, COUNT(*) as play_count
      FROM playback_history
      WHERE date(played_at) BETWEEN ? AND ?
        AND title LIKE '[Reklama]%'
      GROUP BY date(played_at), title
      ORDER BY date DESC, play_count DESC
    `).all(startDate, endDate);
    return rows;
  }
}

module.exports = new AdService();
