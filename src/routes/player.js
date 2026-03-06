const express = require('express');
const router = express.Router();
const playerService = require('../services/PlayerService');

router.get('/state', (req, res) => {
  res.json(playerService.getState());
});

router.post('/play', async (req, res) => {
  try {
    if (req.body.playlistId) {
      await playerService.playPlaylist(parseInt(req.body.playlistId));
    } else {
      await playerService.play();
    }
    res.json(playerService.getState());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/pause', async (req, res) => {
  await playerService.pause();
  res.json(playerService.getState());
});

router.post('/stop', async (req, res) => {
  await playerService.stop();
  res.json(playerService.getState());
});

router.post('/next', async (req, res) => {
  await playerService.next();
  res.json(playerService.getState());
});

router.post('/previous', async (req, res) => {
  await playerService.previous();
  res.json(playerService.getState());
});

router.post('/seek', async (req, res) => {
  if (req.body.position === undefined) return res.status(400).json({ error: 'position required' });
  await playerService.seek(parseFloat(req.body.position));
  res.json(playerService.getState());
});

router.post('/volume', async (req, res) => {
  if (req.body.volume === undefined) return res.status(400).json({ error: 'volume required' });
  await playerService.setVolume(parseInt(req.body.volume));
  res.json(playerService.getState());
});

router.post('/restart', async (req, res) => {
  try {
    await playerService.restart();
    res.json({ success: true, state: playerService.getState() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
