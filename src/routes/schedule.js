const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const schedulerService = require('../services/SchedulerService');
const playlistService = require('../services/PlaylistService');

// Get weekly hours
router.get('/hours', (req, res) => {
  const hours = getDb().prepare('SELECT * FROM store_hours ORDER BY day_of_week').all();
  res.json(hours);
});

// Update weekly hours
router.put('/hours', (req, res) => {
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
router.post('/exceptions', (req, res) => {
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
router.put('/exceptions/:id', (req, res) => {
  const { date, open_time, close_time, is_closed, label } = req.body;
  getDb().prepare(
    'UPDATE store_hours_exceptions SET date = ?, open_time = ?, close_time = ?, is_closed = ?, label = ? WHERE id = ?'
  ).run(date, open_time || null, close_time || null, is_closed ? 1 : 0, label || '', parseInt(req.params.id));
  res.json(getDb().prepare('SELECT * FROM store_hours_exceptions WHERE id = ?').get(parseInt(req.params.id)));
});

// Delete exception
router.delete('/exceptions/:id', (req, res) => {
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

// Settings
router.get('/settings', (req, res) => {
  res.json(playlistService.getSettings());
});

router.put('/settings', (req, res) => {
  res.json(playlistService.updateSettings(req.body));
});

module.exports = router;
