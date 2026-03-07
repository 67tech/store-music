const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const schedulerService = require('../services/SchedulerService');
const playlistService = require('../services/PlaylistService');
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
    label: settings.matchday_label || 'Dzien meczowy',
  });
});

router.put('/matchdays/template', requirePermission('schedule_manage'), (req, res) => {
  const { open_time, close_time, label } = req.body;
  playlistService.updateSettings({
    matchday_open_time: open_time || '10:00',
    matchday_close_time: close_time || '22:00',
    matchday_label: label || 'Dzien meczowy',
  });
  res.json({ success: true });
});

router.post('/matchdays/apply', requirePermission('schedule_manage'), (req, res) => {
  const { dates } = req.body;
  if (!Array.isArray(dates) || dates.length === 0) {
    return res.status(400).json({ error: 'dates array required' });
  }

  const settings = playlistService.getSettings();
  const openTime = settings.matchday_open_time || '10:00';
  const closeTime = settings.matchday_close_time || '22:00';
  const label = settings.matchday_label || 'Dzien meczowy';

  const upsert = getDb().prepare(`
    INSERT INTO store_hours_exceptions (date, open_time, close_time, is_closed, label)
    VALUES (?, ?, ?, 0, ?)
    ON CONFLICT(date) DO UPDATE SET open_time = ?, close_time = ?, is_closed = 0, label = ?
  `);

  const applyAll = getDb().transaction(() => {
    for (const date of dates) {
      upsert.run(date, openTime, closeTime, label, openTime, closeTime, label);
    }
  });

  try {
    applyAll();
    res.json({ success: true, count: dates.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Settings
router.get('/settings', (req, res) => {
  res.json(playlistService.getSettings());
});

router.put('/settings', requirePermission('settings_manage'), (req, res) => {
  res.json(playlistService.updateSettings(req.body));
});

module.exports = router;
