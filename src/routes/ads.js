const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const adService = require('../services/AdService');
const { requirePermission } = require('../middleware/auth');

// Multer for ad file uploads
const storage = multer.diskStorage({
  destination: config.uploadsDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `ad-${uuidv4()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// List all ads
router.get('/', (req, res) => {
  const ads = adService.getAllAds();
  const playCounts = adService.getTodayPlayCounts();
  // Attach today's play count to each ad
  const enriched = ads.map(ad => ({
    ...ad,
    days_of_week: JSON.parse(ad.days_of_week || '[]'),
    today_plays: playCounts[`[Reklama] ${ad.title}`] || 0,
  }));
  res.json(enriched);
});

// Create ad (upload file)
router.post('/', requirePermission('announcement_manage'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  // Get duration via ffprobe
  const { exec } = require('child_process');
  exec(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${req.file.path}"`, (err, stdout) => {
    const duration = err ? 0 : Math.round(parseFloat(stdout.trim()) || 0);

    const ad = adService.createAd({
      title: req.body.title || req.file.originalname.replace(/\.[^.]+$/, ''),
      client_name: req.body.client_name || '',
      filepath: req.file.path,
      filename: req.file.filename,
      duration,
      schedule_mode: req.body.schedule_mode || 'count',
      daily_target: parseInt(req.body.daily_target) || 1,
      interval_minutes: parseInt(req.body.interval_minutes) || 60,
      start_time: req.body.start_time || '08:00',
      end_time: req.body.end_time || '20:00',
      days_of_week: req.body.days_of_week ? JSON.parse(req.body.days_of_week) : [1,2,3,4,5,6],
      priority: parseInt(req.body.priority) || 5,
      play_mode: req.body.play_mode || 'queue',
    });

    res.status(201).json(ad);
  });
});

// Update ad settings
router.put('/:id', requirePermission('announcement_manage'), (req, res) => {
  const ad = adService.updateAd(parseInt(req.params.id), req.body);
  if (!ad) return res.status(404).json({ error: 'Ad not found' });
  res.json(ad);
});

// Delete ad
router.delete('/:id', requirePermission('announcement_manage'), (req, res) => {
  adService.deleteAd(parseInt(req.params.id));
  res.json({ success: true });
});

// Toggle active
router.post('/:id/toggle', requirePermission('announcement_manage'), (req, res) => {
  const ad = adService.getAd(parseInt(req.params.id));
  if (!ad) return res.status(404).json({ error: 'Ad not found' });
  const updated = adService.updateAd(ad.id, { is_active: ad.is_active ? 0 : 1 });
  res.json(updated);
});

// Upcoming ads with estimated play times
router.get('/upcoming', (req, res) => {
  const upcoming = adService.getUpcomingAds();
  res.json(upcoming);
});

// Report: play counts for date range
router.get('/report', (req, res) => {
  const endDate = req.query.end || new Date().toISOString().split('T')[0];
  const startDate = req.query.start || (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  })();
  const rows = adService.getReport(startDate, endDate);
  res.json({ startDate, endDate, entries: rows });
});

// CSV report
router.get('/report/csv', (req, res) => {
  const endDate = req.query.end || new Date().toISOString().split('T')[0];
  const startDate = req.query.start || (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  })();
  const rows = adService.getReport(startDate, endDate);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="reklamy-raport-${startDate}-${endDate}.csv"`);
  res.write('\ufeff');
  res.write('Data;Tytul;Ilosc odtworzen\n');
  for (const r of rows) {
    res.write(`"${r.date}";"${(r.title || '').replace(/"/g, '""')}";${r.play_count}\n`);
  }
  res.end();
});

module.exports = router;
