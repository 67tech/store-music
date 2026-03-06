const express = require('express');
const router = express.Router();
const playlistService = require('../services/PlaylistService');

// List all playlists
router.get('/', (req, res) => {
  res.json(playlistService.getAllPlaylists());
});

// Create playlist
router.post('/', (req, res) => {
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
router.put('/:id', (req, res) => {
  const playlist = playlistService.updatePlaylist(parseInt(req.params.id), req.body);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
  res.json(playlist);
});

// Delete playlist
router.delete('/:id', (req, res) => {
  playlistService.deletePlaylist(parseInt(req.params.id));
  res.json({ success: true });
});

// Add track to playlist
router.post('/:id/tracks', (req, res) => {
  try {
    const playlist = playlistService.addTrackToPlaylist(
      parseInt(req.params.id),
      parseInt(req.body.trackId),
      req.body.position
    );
    res.json(playlist);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Remove track from playlist
router.delete('/:id/tracks/:trackId', (req, res) => {
  const playlist = playlistService.removeTrackFromPlaylist(
    parseInt(req.params.id),
    parseInt(req.params.trackId)
  );
  res.json(playlist);
});

// Reorder tracks
router.put('/:id/reorder', (req, res) => {
  const playlist = playlistService.reorderPlaylistTracks(
    parseInt(req.params.id),
    req.body.trackIds
  );
  res.json(playlist);
});

module.exports = router;
