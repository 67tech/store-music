const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const playlistService = require('../services/PlaylistService');
const { trackUpload } = require('../middleware/upload');

// Get duration via ffprobe
function getDuration(filepath) {
  return new Promise((resolve) => {
    exec(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filepath}"`, (err, stdout) => {
      if (err) { resolve(0); return; }
      resolve(Math.round(parseFloat(stdout.trim()) || 0));
    });
  });
}

// List all tracks
router.get('/', (req, res) => {
  res.json(playlistService.getAllTracks());
});

// Upload track
router.post('/upload', trackUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const duration = await getDuration(req.file.path);
    const title = req.body.title || path.parse(req.file.originalname).name;

    const track = playlistService.createTrack({
      filename: req.file.originalname,
      filepath: req.file.path,
      title,
      artist: req.body.artist || '',
      duration,
      mimetype: req.file.mimetype,
      filesize: req.file.size,
    });

    res.status(201).json(track);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update track metadata
router.put('/:id', (req, res) => {
  const track = playlistService.updateTrack(parseInt(req.params.id), req.body);
  if (!track) return res.status(404).json({ error: 'Track not found' });
  res.json(track);
});

// Delete track
router.delete('/:id', (req, res) => {
  const track = playlistService.getTrack(parseInt(req.params.id));
  if (!track) return res.status(404).json({ error: 'Track not found' });

  // Delete file from disk
  try { fs.unlinkSync(track.filepath); } catch {}

  playlistService.deleteTrack(track.id);
  res.json({ success: true });
});

module.exports = router;
