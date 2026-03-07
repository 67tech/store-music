const express = require('express');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const config = require('../config');
const playlistService = require('../services/PlaylistService');
const { requirePermission } = require('../middleware/auth');

// Active downloads tracking
const activeDownloads = new Map();
let downloadIdCounter = 0;

// Check if yt-dlp is available
function checkYtDlp() {
  return new Promise((resolve) => {
    exec('which yt-dlp', (err, stdout) => {
      resolve(!err && stdout.trim().length > 0);
    });
  });
}

// Get playlist/video info without downloading
router.post('/info', requirePermission('track_upload'), async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const available = await checkYtDlp();
  if (!available) return res.status(500).json({ error: 'yt-dlp nie jest zainstalowany. Zainstaluj: brew install yt-dlp (macOS) lub sudo apt install yt-dlp (Linux)' });

  try {
    const info = await new Promise((resolve, reject) => {
      exec(`yt-dlp --flat-playlist --dump-json "${url}"`, { maxBuffer: 10 * 1024 * 1024, timeout: 30000 }, (err, stdout) => {
        if (err) return reject(new Error('Nie udalo sie pobrac informacji o playliscie'));
        const lines = stdout.trim().split('\n').filter(Boolean);
        const items = lines.map(line => {
          try {
            const data = JSON.parse(line);
            return {
              id: data.id,
              title: data.title || data.fulltitle || 'Unknown',
              duration: data.duration || 0,
              url: data.url || data.webpage_url || `https://www.youtube.com/watch?v=${data.id}`,
            };
          } catch { return null; }
        }).filter(Boolean);
        resolve(items);
      });
    });

    res.json({ tracks: info, count: info.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start downloading tracks from YouTube
router.post('/download', requirePermission('track_upload'), async (req, res) => {
  const { url, trackIds, playlistId } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const available = await checkYtDlp();
  if (!available) return res.status(500).json({ error: 'yt-dlp nie jest zainstalowany' });

  const downloadId = ++downloadIdCounter;
  const downloadDir = path.join(config.audioDir, `yt-${downloadId}`);
  fs.mkdirSync(downloadDir, { recursive: true });

  const progress = {
    id: downloadId,
    status: 'downloading',
    total: 0,
    completed: 0,
    failed: 0,
    tracks: [],
    errors: [],
  };
  activeDownloads.set(downloadId, progress);

  res.json({ downloadId, message: 'Pobieranie rozpoczete' });

  // Download in background
  (async () => {
    try {
      // Build yt-dlp arguments
      const args = [
        '-x', '--audio-format', 'mp3',
        '--audio-quality', '0',
        '-o', path.join(downloadDir, '%(title)s.%(ext)s'),
        '--no-playlist-reverse',
        '--print-json',
      ];

      // If specific track IDs selected, use playlist-items
      if (trackIds && trackIds.length > 0) {
        args.push('--playlist-items', trackIds.join(','));
      }

      args.push(url);

      const proc = spawn('yt-dlp', args, { maxBuffer: 50 * 1024 * 1024 });
      let buffer = '';

      proc.stdout.on('data', (data) => {
        buffer += data.toString();
        // Try to parse complete JSON objects
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const info = JSON.parse(line);
            const filepath = info._filename || info.filepath;
            // The actual mp3 file might have a different extension after conversion
            const mp3Path = filepath ? filepath.replace(/\.[^.]+$/, '.mp3') : null;
            const actualPath = mp3Path && fs.existsSync(mp3Path) ? mp3Path : filepath;

            if (actualPath && fs.existsSync(actualPath)) {
              // Get duration
              const duration = info.duration || 0;
              const title = info.title || info.fulltitle || path.parse(actualPath).name;
              const artist = info.artist || info.uploader || info.channel || '';

              // Move file to audio dir
              const finalFilename = `${Date.now()}-${path.basename(actualPath)}`;
              const finalPath = path.join(config.audioDir, finalFilename);
              fs.renameSync(actualPath, finalPath);

              // Create track in DB
              const track = playlistService.createTrack({
                filename: path.basename(actualPath),
                filepath: finalPath,
                title,
                artist,
                duration: Math.round(duration),
                mimetype: 'audio/mpeg',
                filesize: fs.statSync(finalPath).size,
              });

              // Add to playlist if specified
              if (playlistId && track) {
                try {
                  playlistService.addTrackToPlaylist(parseInt(playlistId), track.id);
                } catch {}
              }

              progress.completed++;
              progress.tracks.push({ id: track.id, title });
            }
          } catch {}
        }
      });

      proc.stderr.on('data', (data) => {
        const msg = data.toString();
        // Parse progress from stderr
        const dlMatch = msg.match(/\[download\]\s+(\d+\.\d+)%/);
        if (dlMatch) {
          progress.currentProgress = parseFloat(dlMatch[1]);
        }
        // Count total items
        const totalMatch = msg.match(/Downloading (\d+) /);
        if (totalMatch) {
          progress.total = parseInt(totalMatch[1]);
        }
      });

      proc.on('close', (code) => {
        // Clean up temp dir
        try { fs.rmdirSync(downloadDir, { recursive: true }); } catch {}

        progress.status = code === 0 ? 'completed' : 'completed_with_errors';
        if (progress.completed === 0 && code !== 0) {
          progress.status = 'failed';
          progress.errors.push('Pobieranie nie powiodlo sie');
        }
      });

    } catch (err) {
      progress.status = 'failed';
      progress.errors.push(err.message);
    }
  })();
});

// Check download progress
router.get('/download/:id', (req, res) => {
  const progress = activeDownloads.get(parseInt(req.params.id));
  if (!progress) return res.status(404).json({ error: 'Download not found' });
  res.json(progress);

  // Clean up completed downloads after reading
  if (progress.status === 'completed' || progress.status === 'failed') {
    setTimeout(() => activeDownloads.delete(progress.id), 60000);
  }
});

module.exports = router;
