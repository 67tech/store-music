const express = require('express');
const router = express.Router();

router.use('/tracks', require('./tracks'));
router.use('/playlists', require('./playlists'));
router.use('/player', require('./player'));
router.use('/schedule', require('./schedule'));
router.use('/announcements', require('./announcements'));

module.exports = router;
