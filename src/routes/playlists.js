const express = require('express');
const router = express.Router();
const playlistService = require('../services/PlaylistService');
const playerService = require('../services/PlayerService');
const { requirePermission } = require('../middleware/auth');

// List all playlists
router.get('/', (req, res) => {
  res.json(playlistService.getAllPlaylists());
});

// Create playlist
router.post('/', requirePermission('playlist_manage'), (req, res) => {
  try {
    const playlist = playlistService.createPlaylist(req.body);
    res.status(201).json(playlist);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get playlist with tracks
router.get('/:id', (req, res) => {
  const playlist = playlistService.getPlaylist(parseInt(req.params.id));
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
  res.json(playlist);
});

// Update playlist
router.put('/:id', requirePermission('playlist_manage'), (req, res) => {
  const playlist = playlistService.updatePlaylist(parseInt(req.params.id), req.body);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
  res.json(playlist);
});

// Delete playlist
router.delete('/:id', requirePermission('playlist_manage'), (req, res) => {
  playlistService.deletePlaylist(parseInt(req.params.id));
  res.json({ success: true });
});

// Add track to playlist
router.post('/:id/tracks', requirePermission('playlist_add_tracks'), (req, res) => {
  try {
    const playlist = playlistService.addTrackToPlaylist(
      parseInt(req.params.id),
      parseInt(req.body.trackId),
      req.body.position,
      !!req.body.oneShot
    );
    // Refresh player's in-memory playlist (handles shuffle override)
    playerService.refreshPlaylist();
    res.json(playlist);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Remove track from playlist
router.delete('/:id/tracks/:trackId', requirePermission('playlist_add_tracks'), (req, res) => {
  const playlist = playlistService.removeTrackFromPlaylist(
    parseInt(req.params.id),
    parseInt(req.params.trackId)
  );
  playerService.refreshPlaylist();
  res.json(playlist);
});

// Clear all tracks from playlist
router.delete('/:id/tracks', requirePermission('playlist_manage'), (req, res) => {
  const playlist = playlistService.clearPlaylist(parseInt(req.params.id));
  playerService.refreshPlaylist();
  res.json(playlist);
});

// Reorder tracks
router.put('/:id/reorder', requirePermission('playlist_add_tracks'), (req, res) => {
  const playlist = playlistService.reorderPlaylistTracks(
    parseInt(req.params.id),
    req.body.trackIds
  );
  playerService.refreshPlaylist();
  res.json(playlist);
});

module.exports = router;
