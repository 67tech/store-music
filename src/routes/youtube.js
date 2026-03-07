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
      const args = [
        '-x', '--audio-format', 'mp3',
        '--audio-quality', '0',
        '-o', path.join(downloadDir, '%(title)s.%(ext)s'),
        '--no-playlist-reverse',
      ];

      // If specific track IDs selected, use playlist-items
      if (trackIds && trackIds.length > 0) {
        args.push('--playlist-items', trackIds.join(','));
        progress.total = trackIds.length;
      }

      args.push(url);

      console.log('[YT] Starting download:', args.join(' '));

      const proc = spawn('yt-dlp', args);

      proc.stderr.on('data', (data) => {
        const msg = data.toString();
        // Parse download % progress
        const dlMatch = msg.match(/\[download\]\s+(\d+\.?\d*)%/);
        if (dlMatch) {
          progress.currentProgress = parseFloat(dlMatch[1]);
        }
        // Count total items from playlist
        const totalMatch = msg.match(/Downloading (\d+) /);
        if (totalMatch) {
          progress.total = parseInt(totalMatch[1]);
        }
        // Track which item is being downloaded (e.g. "Downloading item 2 of 5")
        const itemMatch = msg.match(/Downloading item (\d+) of (\d+)/);
        if (itemMatch) {
          progress.currentItem = parseInt(itemMatch[1]);
          progress.total = parseInt(itemMatch[2]);
        }
        // Detect current title
        const destMatch = msg.match(/\[download\] Destination:\s*(.+)/);
        if (destMatch) {
          progress.currentTitle = path.parse(destMatch[1].trim()).name;
        }
        // Detect phase: extract/convert
        if (msg.includes('[ExtractAudio]') || msg.includes('Post-process')) {
          progress.phase = 'converting';
        } else if (msg.includes('[download]') && dlMatch) {
          progress.phase = 'downloading';
        }
        // Log errors
        if (msg.includes('ERROR')) {
          console.log('[YT stderr]', msg.trim());
          progress.errors.push(msg.trim());
        }
      });

      proc.on('close', (code) => {
        console.log('[YT] Process closed, code:', code);

        // Scan download dir for mp3 files (created by yt-dlp after conversion)
        try {
          const files = fs.readdirSync(downloadDir).filter(f => f.endsWith('.mp3'));
          console.log('[YT] Found mp3 files:', files.length);

          for (const file of files) {
            const sourcePath = path.join(downloadDir, file);
            const title = path.parse(file).name;

            // Get duration via ffprobe
            let duration = 0;
            try {
              const durationStr = require('child_process').execSync(
                `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${sourcePath}"`,
                { timeout: 10000 }
              ).toString().trim();
              duration = Math.round(parseFloat(durationStr) || 0);
            } catch {}

            // Move to audio dir
            const finalFilename = `${Date.now()}-${file}`;
            const finalPath = path.join(config.audioDir, finalFilename);
            fs.renameSync(sourcePath, finalPath);

            // Create track in DB
            const track = playlistService.createTrack({
              filename: file,
              filepath: finalPath,
              title,
              artist: '',
              duration,
              mimetype: 'audio/mpeg',
              filesize: fs.statSync(finalPath).size,
            });

            if (playlistId && track) {
              try { playlistService.addTrackToPlaylist(parseInt(playlistId), track.id); } catch {}
            }

            progress.completed++;
            progress.tracks.push({ id: track.id, title });
            console.log('[YT] Track created:', title, `(${duration}s)`);
          }
        } catch (err) {
          console.error('[YT] Error scanning download dir:', err.message);
          progress.errors.push(err.message);
        }

        // Clean up temp dir
        try { fs.rmSync(downloadDir, { recursive: true, force: true }); } catch {}

        progress.status = progress.completed > 0
          ? (progress.errors.length > 0 ? 'completed_with_errors' : 'completed')
          : (code === 0 ? 'completed' : 'failed');

        if (progress.completed === 0 && code !== 0) {
          progress.errors.push('Pobieranie nie powiodlo sie');
        }

        console.log('[YT] Download finished:', progress.completed, 'tracks');
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
  if (progress.status === 'completed' || progress.status === 'failed' || progress.status === 'completed_with_errors') {
    setTimeout(() => activeDownloads.delete(progress.id), 60000);
  }
});

module.exports = router;
