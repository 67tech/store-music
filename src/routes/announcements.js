const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const announcementService = require('../services/AnnouncementService');
const ttsService = require('../services/TtsService');
const { announcementUpload } = require('../middleware/upload');
const config = require('../config');

// List all announcements
router.get('/', (req, res) => {
  res.json(announcementService.getAllAnnouncements());
});

// Upload audio announcement
router.post('/upload', announcementUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { exec } = require('child_process');
    const duration = await new Promise((resolve) => {
      exec(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${req.file.path}"`, (err, stdout) => {
        resolve(Math.round(parseFloat(stdout?.trim()) || 0));
      });
    });

    const announcement = announcementService.createAnnouncement({
      name: req.body.name || path.parse(req.file.originalname).name,
      type: 'audio',
      filepath: req.file.path,
      duration,
    });

    res.status(201).json(announcement);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate TTS announcement
router.post('/tts', async (req, res) => {
  try {
    const { name, text, engine, language } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });

    const { filepath, duration } = await ttsService.generate(text, engine, language);

    // Copy to announcements dir
    const filename = path.basename(filepath);
    const destPath = path.join(config.announcementsDir, filename);
    fs.copyFileSync(filepath, destPath);

    const announcement = announcementService.createAnnouncement({
      name: name || text.substring(0, 50),
      type: 'tts',
      filepath: destPath,
      tts_text: text,
      tts_engine: engine || 'google',
      duration,
    });

    res.status(201).json(announcement);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update announcement (name, regenerate TTS)
router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const announcement = announcementService.getAnnouncement(id);
    if (!announcement) return res.status(404).json({ error: 'Not found' });

    const updateData = {};
    if (req.body.name !== undefined) updateData.name = req.body.name;

    // Regenerate TTS if text changed
    if (req.body.tts_text !== undefined && announcement.type === 'tts') {
      const engine = req.body.tts_engine || announcement.tts_engine || 'google';
      const language = req.body.tts_language || 'pl';

      // Delete old file
      if (announcement.filepath) {
        try { fs.unlinkSync(announcement.filepath); } catch {}
      }

      const { filepath, duration } = await ttsService.generate(req.body.tts_text, engine, language);
      const filename = path.basename(filepath);
      const destPath = path.join(config.announcementsDir, filename);
      fs.copyFileSync(filepath, destPath);

      updateData.filepath = destPath;
      updateData.tts_text = req.body.tts_text;
      updateData.tts_engine = engine;
      updateData.duration = duration;
    }

    const updated = announcementService.updateAnnouncement(id, updateData);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete announcement
router.delete('/:id', (req, res) => {
  const announcement = announcementService.getAnnouncement(parseInt(req.params.id));
  if (!announcement) return res.status(404).json({ error: 'Not found' });

  if (announcement.filepath) {
    try { fs.unlinkSync(announcement.filepath); } catch {}
  }

  announcementService.deleteAnnouncement(announcement.id);
  res.json({ success: true });
});

// Preview (play now)
router.post('/:id/preview', async (req, res) => {
  try {
    await announcementService.playNow(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- Scheduled announcements ---
router.get('/scheduled', (req, res) => {
  res.json(announcementService.getScheduledAnnouncements());
});

router.post('/scheduled', (req, res) => {
  try {
    const scheduled = announcementService.createScheduledAnnouncement(req.body);
    res.status(201).json(scheduled);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/scheduled/:id', (req, res) => {
  const scheduled = announcementService.updateScheduledAnnouncement(parseInt(req.params.id), req.body);
  if (!scheduled) return res.status(404).json({ error: 'Not found' });
  res.json(scheduled);
});

router.delete('/scheduled/:id', (req, res) => {
  announcementService.deleteScheduledAnnouncement(parseInt(req.params.id));
  res.json({ success: true });
});

module.exports = router;
