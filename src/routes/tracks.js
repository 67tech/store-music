const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const playlistService = require('../services/PlaylistService');
const { trackUpload } = require('../middleware/upload');
const { requirePermission } = require('../middleware/auth');

// Get duration via ffprobe
function getDuration(filepath) {
  return new Promise((resolve) => {
    exec(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filepath}"`, (err, stdout) => {
      if (err) { resolve(0); return; }
      resolve(Math.round(parseFloat(stdout.trim()) || 0));
    });
  });
}

// Search YouTube for metadata by query string
function ytSearch(query) {
  return new Promise((resolve) => {
    const safeQuery = query.replace(/"/g, '\\"');
    exec(`yt-dlp --default-search "ytsearch" --dump-json --no-download "ytsearch:${safeQuery}"`, { timeout: 15000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout.trim()) return resolve(null);
      try {
        const info = JSON.parse(stdout.trim().split('\n')[0]);
        return resolve({
          title: info.title || info.fulltitle || null,
          artist: info.artist || info.uploader || info.channel || null,
          duration: info.duration ? Math.round(info.duration) : null,
        });
      } catch { resolve(null); }
    });
  });
}

// Auto-tag track in background (non-blocking)
function autoTagTrack(trackId, searchQuery, io) {
  ytSearch(searchQuery).then(meta => {
    if (!meta || !meta.title) return;
    const track = playlistService.getTrack(trackId);
    if (!track) return;

    const update = {};
    if (meta.title) update.title = meta.title;
    if (meta.artist) update.artist = meta.artist;

    playlistService.updateTrack(trackId, update);
    if (io) io.emit('trackUpdated', { id: trackId, ...update });
  }).catch(() => {});
}

// List all tracks
router.get('/', (req, res) => {
  res.json(playlistService.getAllTracks());
});

// Upload track
router.post('/upload', requirePermission('track_upload'), trackUpload.single('file'), async (req, res) => {
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

    // Auto-tag from YouTube in background (only if no explicit artist given)
    if (!req.body.artist && track) {
      const io = req.app.get('io');
      autoTagTrack(track.id, title, io);
    }

    res.status(201).json(track);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auto-tag track from YouTube
router.post('/:id/autotag', requirePermission('track_upload'), async (req, res) => {
  const track = playlistService.getTrack(parseInt(req.params.id));
  if (!track) return res.status(404).json({ error: 'Track not found' });

  const query = req.body.query || track.title || track.filename;
  const meta = await ytSearch(query);
  if (!meta || !meta.title) return res.json({ updated: false, message: 'Nie znaleziono na YouTube' });

  const update = {};
  if (meta.title) update.title = meta.title;
  if (meta.artist) update.artist = meta.artist;

  const updated = playlistService.updateTrack(track.id, update);
  const io = req.app.get('io');
  if (io) io.emit('trackUpdated', { id: track.id, ...update });

  res.json({ updated: true, track: updated });
});

// Stream track audio (for browser preview)
router.get('/:id/stream', (req, res) => {
  const track = playlistService.getTrack(parseInt(req.params.id));
  if (!track || !track.filepath) return res.status(404).json({ error: 'Track not found' });
  if (!fs.existsSync(track.filepath)) return res.status(404).json({ error: 'File not found' });

  const stat = fs.statSync(track.filepath);
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': track.mimetype || 'audio/mpeg',
    });
    fs.createReadStream(track.filepath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': track.mimetype || 'audio/mpeg',
    });
    fs.createReadStream(track.filepath).pipe(res);
  }
});

// Update track metadata
router.put('/:id', (req, res) => {
  const track = playlistService.updateTrack(parseInt(req.params.id), req.body);
  if (!track) return res.status(404).json({ error: 'Track not found' });
  res.json(track);
});

// Delete track
router.delete('/:id', requirePermission('track_delete'), (req, res) => {
  const track = playlistService.getTrack(parseInt(req.params.id));
  if (!track) return res.status(404).json({ error: 'Track not found' });

  // Delete file from disk
  try { fs.unlinkSync(track.filepath); } catch {}

  playlistService.deleteTrack(track.id);
  res.json({ success: true });
});

module.exports = router;
