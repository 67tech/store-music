const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db');
const schedulerService = require('../services/SchedulerService');
const playlistService = require('../services/PlaylistService');
const announcementService = require('../services/AnnouncementService');
const ttsService = require('../services/TtsService');
const config = require('../config');
const { requirePermission } = require('../middleware/auth');

// Get weekly hours
router.get('/hours', (req, res) => {
  const hours = getDb().prepare('SELECT * FROM store_hours ORDER BY day_of_week').all();
  res.json(hours);
});

// Update weekly hours
router.put('/hours', requirePermission('schedule_manage'), (req, res) => {
  const { hours } = req.body; // Array of { day_of_week, open_time, close_time, is_closed }
  if (!Array.isArray(hours)) return res.status(400).json({ error: 'hours array required' });

  const update = getDb().prepare(
    'UPDATE store_hours SET open_time = ?, close_time = ?, is_closed = ? WHERE day_of_week = ?'
  );
  const updateAll = getDb().transaction(() => {
    for (const h of hours) {
      update.run(h.open_time, h.close_time, h.is_closed ? 1 : 0, h.day_of_week);
    }
  });
  updateAll();

  res.json(getDb().prepare('SELECT * FROM store_hours ORDER BY day_of_week').all());
});

// Get exceptions
router.get('/exceptions', (req, res) => {
  res.json(getDb().prepare('SELECT * FROM store_hours_exceptions ORDER BY date').all());
});

// Create exception
router.post('/exceptions', requirePermission('schedule_manage'), (req, res) => {
  const { date, open_time, close_time, is_closed, label } = req.body;
  if (!date) return res.status(400).json({ error: 'date required' });

  try {
    const result = getDb().prepare(
      'INSERT INTO store_hours_exceptions (date, open_time, close_time, is_closed, label) VALUES (?, ?, ?, ?, ?)'
    ).run(date, open_time || null, close_time || null, is_closed ? 1 : 0, label || '');
    res.status(201).json(getDb().prepare('SELECT * FROM store_hours_exceptions WHERE id = ?').get(result.lastInsertRowid));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update exception
router.put('/exceptions/:id', requirePermission('schedule_manage'), (req, res) => {
  const { date, open_time, close_time, is_closed, label } = req.body;
  getDb().prepare(
    'UPDATE store_hours_exceptions SET date = ?, open_time = ?, close_time = ?, is_closed = ?, label = ? WHERE id = ?'
  ).run(date, open_time || null, close_time || null, is_closed ? 1 : 0, label || '', parseInt(req.params.id));
  res.json(getDb().prepare('SELECT * FROM store_hours_exceptions WHERE id = ?').get(parseInt(req.params.id)));
});

// Delete exception
router.delete('/exceptions/:id', requirePermission('schedule_manage'), (req, res) => {
  getDb().prepare('DELETE FROM store_hours_exceptions WHERE id = ?').run(parseInt(req.params.id));
  res.json({ success: true });
});

// Get today's resolved hours
router.get('/today', (req, res) => {
  res.json(schedulerService.getTodayHours());
});

// Timeline for a given date (or today)
router.get('/timeline', (req, res) => {
  res.json(schedulerService.getTimeline(req.query.date || null));
});

// --- Match Days ---
router.get('/matchdays/template', (req, res) => {
  const settings = playlistService.getSettings();
  res.json({
    open_time: settings.matchday_open_time || '10:00',
    close_time: settings.matchday_close_time || '22:00',
    match_time: settings.matchday_match_time || '18:00',
    label: settings.matchday_label || 'Dzien meczowy',
  });
});

router.put('/matchdays/template', requirePermission('schedule_manage'), (req, res) => {
  const { open_time, close_time, match_time, label } = req.body;
  playlistService.updateSettings({
    matchday_open_time: open_time || '10:00',
    matchday_close_time: close_time || '22:00',
    matchday_match_time: match_time || '18:00',
    matchday_label: label || 'Dzien meczowy',
  });
  res.json({ success: true });
});

router.post('/matchdays/apply', requirePermission('schedule_manage'), (req, res) => {
  const { dates, match_time } = req.body;
  if (!Array.isArray(dates) || dates.length === 0) {
    return res.status(400).json({ error: 'dates array required' });
  }

  const settings = playlistService.getSettings();
  const openTime = settings.matchday_open_time || '10:00';
  const closeTime = settings.matchday_close_time || '22:00';
  const matchTime = match_time || settings.matchday_match_time || '18:00';
  const label = settings.matchday_label || 'Dzien meczowy';

  const upsert = getDb().prepare(`
    INSERT INTO store_hours_exceptions (date, open_time, close_time, is_closed, label, match_time)
    VALUES (?, ?, ?, 0, ?, ?)
    ON CONFLICT(date) DO UPDATE SET open_time = ?, close_time = ?, is_closed = 0, label = ?, match_time = ?
  `);

  const applyAll = getDb().transaction(() => {
    for (const date of dates) {
      upsert.run(date, openTime, closeTime, label, matchTime, openTime, closeTime, label, matchTime);
    }
  });

  try {
    applyAll();
    res.json({ success: true, count: dates.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- Playlist Calendar ---

// Get calendar entries for date range
router.get('/calendar', (req, res) => {
  const startDate = req.query.start || new Date().toISOString().split('T')[0];
  const endDate = req.query.end || (() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 2);
    return d.toISOString().split('T')[0];
  })();
  const entries = playlistService.getCalendarEntries(startDate, endDate);
  res.json(entries);
});

// Get today's playlist override
router.get('/calendar/today', (req, res) => {
  const entry = playlistService.getTodayPlaylist();
  res.json(entry);
});

// Set playlist for a date
router.post('/calendar', requirePermission('schedule_manage'), (req, res) => {
  const { date, playlist_id, label } = req.body;
  if (!date || !playlist_id) return res.status(400).json({ error: 'date and playlist_id required' });
  const entry = playlistService.setCalendarEntry(date, parseInt(playlist_id), label);
  res.status(201).json(entry);
});

// Set playlist for multiple dates
router.post('/calendar/bulk', requirePermission('schedule_manage'), (req, res) => {
  const { dates, playlist_id, label } = req.body;
  if (!Array.isArray(dates) || !playlist_id) return res.status(400).json({ error: 'dates array and playlist_id required' });
  playlistService.setCalendarBulk(dates, parseInt(playlist_id), label);
  res.json({ success: true, count: dates.length });
});

// Delete calendar entry
router.delete('/calendar/:date', requirePermission('schedule_manage'), (req, res) => {
  playlistService.deleteCalendarEntry(req.params.date);
  res.json({ success: true });
});

// Settings
router.get('/settings', (req, res) => {
  res.json(playlistService.getSettings());
});

router.put('/settings', requirePermission('settings_manage'), (req, res) => {
  res.json(playlistService.updateSettings(req.body));
});

// --- Matchday Lineup ---
// POST lineup text -> generates TTS announcement + schedules it before_match with repeat
router.post('/matchdays/lineup', requirePermission('schedule_manage'), async (req, res) => {
  try {
    const { text, date, minutes_before, repeat_interval, engine, language, voice } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });

    // Generate TTS from lineup text
    const { filepath, duration } = await ttsService.generate(text, engine, language, voice);

    // Copy to announcements dir
    const filename = path.basename(filepath);
    const destPath = path.join(config.announcementsDir, filename);
    fs.copyFileSync(filepath, destPath);

    // Create announcement
    const announcement = announcementService.createAnnouncement({
      name: `Sklad meczowy ${date || 'dzis'}`,
      type: 'tts',
      filepath: destPath,
      tts_text: text,
      tts_engine: engine || 'google',
      duration,
    });

    // Schedule it
    const scheduleData = {
      announcement_id: announcement.id,
      trigger_type: date ? 'specific_date' : 'before_match',
      trigger_value: date ? `${date} ${_calcTriggerTime(date, minutes_before || 60)}` : String(minutes_before || 60),
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      is_active: true,
      play_mode: 'interrupt',
      repeat_interval: repeat_interval || 10,
      repeat_until: null, // until match time
    };

    const scheduled = announcementService.createScheduledAnnouncement(scheduleData);

    res.status(201).json({ announcement, scheduled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: calc absolute trigger time for specific_date from match_time
function _calcTriggerTime(dateStr, minutesBefore) {
  const exception = getDb().prepare('SELECT * FROM store_hours_exceptions WHERE date = ?').get(dateStr);
  if (exception && exception.match_time) {
    const [h, m] = exception.match_time.split(':').map(Number);
    const totalMin = h * 60 + m - minutesBefore;
    if (totalMin >= 0) {
      return `${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`;
    }
  }
  // Fallback: just use a fixed time
  return '17:00';
}

// GET current lineup text (from file)
router.get('/matchdays/lineup', (req, res) => {
  const lineupPath = path.join(config.dataDir, 'matchday', 'lineup.txt');
  try {
    const text = fs.readFileSync(lineupPath, 'utf-8');
    res.json({ text });
  } catch {
    res.json({ text: '' });
  }
});

// PUT save lineup text to file (for external integrations / file watcher)
router.put('/matchdays/lineup', requirePermission('schedule_manage'), (req, res) => {
  const { text } = req.body;
  const lineupDir = path.join(config.dataDir, 'matchday');
  fs.mkdirSync(lineupDir, { recursive: true });
  fs.writeFileSync(path.join(lineupDir, 'lineup.txt'), text || '', 'utf-8');
  res.json({ success: true });
});

module.exports = router;
