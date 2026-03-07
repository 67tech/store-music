const express = require('express');
const router = express.Router();

router.use('/tracks', require('./tracks'));
router.use('/playlists', require('./playlists'));
router.use('/player', require('./player'));
router.use('/schedule', require('./schedule'));
router.use('/announcements', require('./announcements'));
router.use('/users', require('./users'));
router.use('/youtube', require('./youtube'));
router.use('/radio', require('./radio'));
router.use('/ads', require('./ads'));
router.use('/ad-packs', require('./adPacks'));
router.use('/announcement-packs', require('./announcementPacks'));
router.use('/backup', require('./backup'));
router.use('/audit', require('./audit'));

module.exports = router;
