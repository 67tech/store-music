const express = require('express');
const router = express.Router();
const playerService = require('../services/PlayerService');
const { requirePermission } = require('../middleware/auth');

router.get('/state', (req, res) => {
  res.json(playerService.getState());
});

router.post('/play', requirePermission('player_control'), async (req, res) => {
  try {
    if (req.body.playlistId) {
      const startIndex = req.body.startIndex ? parseInt(req.body.startIndex) : 0;
      await playerService.playPlaylist(parseInt(req.body.playlistId), startIndex);
    } else {
      await playerService.play();
    }
    res.json(playerService.getState());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/loop', requirePermission('player_control'), (req, res) => {
  playerService.setLoop(req.body.loop !== false);
  res.json(playerService.getState());
});

router.post('/pause', requirePermission('player_control'), async (req, res) => {
  await playerService.pause();
  res.json(playerService.getState());
});

router.post('/stop', requirePermission('player_control'), async (req, res) => {
  await playerService.stop();
  res.json(playerService.getState());
});

router.post('/next', requirePermission('player_control'), async (req, res) => {
  await playerService.next();
  res.json(playerService.getState());
});

router.post('/previous', requirePermission('player_control'), async (req, res) => {
  await playerService.previous();
  res.json(playerService.getState());
});

router.post('/seek', requirePermission('player_control'), async (req, res) => {
  if (req.body.position === undefined) return res.status(400).json({ error: 'position required' });
  await playerService.seek(parseFloat(req.body.position));
  res.json(playerService.getState());
});

router.post('/volume', requirePermission('player_control'), async (req, res) => {
  if (req.body.volume === undefined) return res.status(400).json({ error: 'volume required' });
  await playerService.setVolume(parseInt(req.body.volume));
  res.json(playerService.getState());
});

// Queue timeline — estimated play times for all tracks in current playlist
router.get('/queue-timeline', (req, res) => {
  const state = playerService.getState();
  if (!state.playlistTracks || state.playlistTracks.length === 0) {
    return res.json({ tracks: [], currentIndex: -1 });
  }

  const now = new Date();
  const tracks = [];
  let timeOffset = now.getTime();

  // For the current track, subtract elapsed time to get its start time
  const realIndex = (idx) => state.shuffle && state.shuffledIndices.length
    ? state.shuffledIndices[idx] : idx;

  for (let i = 0; i < state.playlistTracks.length; i++) {
    const trackIdx = realIndex(i);
    const track = state.playlistTracks[trackIdx];
    if (!track) continue;

    const duration = track.duration || 0;
    let startTime, endTime, status;

    if (i === state.currentIndex && state.status !== 'stopped') {
      // Current track — calculate start based on elapsed
      startTime = now.getTime() - (state.elapsed * 1000);
      endTime = startTime + (duration * 1000);
      status = state.status; // 'playing' or 'paused'
    } else if (i < state.currentIndex && state.status !== 'stopped') {
      // Already played
      status = 'played';
      startTime = null;
      endTime = null;
    } else {
      // Upcoming
      if (state.status === 'stopped') {
        status = 'upcoming';
        startTime = null;
        endTime = null;
      } else {
        // Calculate estimated start: current track remaining + sum of tracks between
        const currentTrackIdx = realIndex(state.currentIndex);
        const currentTrack = state.playlistTracks[currentTrackIdx];
        const currentRemaining = (currentTrack?.duration || 0) - state.elapsed;

        let gap = currentRemaining;
        for (let j = state.currentIndex + 1; j < i; j++) {
          const jIdx = realIndex(j);
          gap += state.playlistTracks[jIdx]?.duration || 0;
        }
        startTime = now.getTime() + (gap * 1000);
        endTime = startTime + (duration * 1000);
        status = 'upcoming';
      }
    }

    tracks.push({
      id: track.id,
      title: track.title || track.name || 'Unknown',
      artist: track.artist || '',
      duration,
      status,
      startTime: startTime ? new Date(startTime).toISOString() : null,
      endTime: endTime ? new Date(endTime).toISOString() : null,
    });
  }

  res.json({
    tracks,
    currentIndex: state.currentIndex,
    playerStatus: state.status,
    elapsed: state.elapsed,
  });
});

// Play a specific track after a delay (seconds)
router.post('/play-delayed', requirePermission('player_control'), (req, res) => {
  const { trackId, delaySec } = req.body;
  if (!trackId) return res.status(400).json({ error: 'trackId required' });
  const delay = Math.max(0, Math.min(3600, parseInt(delaySec) || 0));

  const announcementService = require('../services/AnnouncementService');
  const playlistService = require('../services/PlaylistService');

  // Look up if it's a track with announcement filepath
  const track = playlistService.getTrack(trackId);
  if (!track) return res.status(404).json({ error: 'Track not found' });

  const io = req.app.get('io');
  if (io) io.emit('delayedPlayback', { trackId, title: track.title, delaySec: delay, scheduledAt: Date.now() });

  setTimeout(async () => {
    try {
      // Use announcement playback (interrupt + resume) if it's a kommunikat
      if (track.artist === 'Komunikat' || track.title?.startsWith('[Komunikat]')) {
        await announcementService.playFile(track.filepath);
      } else {
        // For regular tracks, just play the file directly via announcement system (interrupt + resume)
        await announcementService.playFile(track.filepath);
      }
    } catch (err) {
      console.error('Delayed playback failed:', err.message);
    }
  }, delay * 1000);

  res.json({ success: true, message: `Zaplanowano odtworzenie za ${delay}s` });
});

router.post('/restart', requirePermission('server_restart'), async (req, res) => {
  try {
    await playerService.restart();
    res.json({ success: true, state: playerService.getState() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Playback history
router.get('/history', (req, res) => {
  const { getDb } = require('../db');
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const limit = Math.min(parseInt(req.query.limit) || 500, 1000);

  const rows = getDb().prepare(`
    SELECT * FROM playback_history
    WHERE date(played_at) = ?
    ORDER BY played_at DESC
    LIMIT ?
  `).all(date, limit);

  res.json({ date, entries: rows });
});

// History dates (for navigation)
router.get('/history/dates', (req, res) => {
  const { getDb } = require('../db');
  const rows = getDb().prepare(`
    SELECT DISTINCT date(played_at) as date, COUNT(*) as count
    FROM playback_history
    GROUP BY date(played_at)
    ORDER BY date DESC
    LIMIT 365
  `).all();
  res.json(rows);
});

// History summary (play count per track for a date)
router.get('/history/summary', (req, res) => {
  const { getDb } = require('../db');
  const date = req.query.date || new Date().toISOString().split('T')[0];

  const rows = getDb().prepare(`
    SELECT title, artist, one_shot,
           COUNT(*) as play_count,
           SUM(duration) as total_duration,
           MIN(played_at) as first_play,
           MAX(played_at) as last_play
    FROM playback_history
    WHERE date(played_at) = ?
    GROUP BY title, artist
    ORDER BY play_count DESC, title
  `).all(date);

  const totalTracks = rows.reduce((s, r) => s + r.play_count, 0);
  const totalDuration = rows.reduce((s, r) => s + (r.total_duration || 0), 0);

  res.json({ date, summary: rows, totalTracks, totalDuration });
});

// CSV export
router.get('/history/csv', (req, res) => {
  const { getDb } = require('../db');
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const mode = req.query.mode || 'full'; // 'full' or 'summary'

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="historia-${date}.csv"`);
  // BOM for Excel UTF-8
  res.write('\ufeff');

  if (mode === 'summary') {
    const rows = getDb().prepare(`
      SELECT title, artist, one_shot,
             COUNT(*) as play_count,
             SUM(duration) as total_duration,
             MIN(played_at) as first_play,
             MAX(played_at) as last_play
      FROM playback_history
      WHERE date(played_at) = ?
      GROUP BY title, artist
      ORDER BY play_count DESC, title
    `).all(date);

    res.write('Tytul;Artysta;Typ;Ilosc odtworzen;Laczny czas (s);Pierwsze odtworzenie;Ostatnie odtworzenie\n');
    for (const r of rows) {
      const typ = r.one_shot ? 'Komunikat' : 'Utwor';
      res.write(`"${(r.title || '').replace(/"/g, '""')}";"${(r.artist || '').replace(/"/g, '""')}";"${typ}";${r.play_count};${r.total_duration || 0};"${r.first_play}";"${r.last_play}"\n`);
    }
  } else {
    const rows = getDb().prepare(`
      SELECT * FROM playback_history
      WHERE date(played_at) = ?
      ORDER BY played_at ASC
    `).all(date);

    res.write('Czas;Tytul;Artysta;Dlugosc (s);Typ\n');
    for (const r of rows) {
      const typ = r.one_shot ? 'Komunikat' : 'Utwor';
      const time = r.played_at ? new Date(r.played_at).toLocaleTimeString('pl-PL') : '';
      res.write(`"${time}";"${(r.title || '').replace(/"/g, '""')}";"${(r.artist || '').replace(/"/g, '""')}";${r.duration || 0};"${typ}"\n`);
    }
  }

  res.end();
});

module.exports = router;
