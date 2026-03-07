const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

module.exports = {
  port: process.env.PORT || 3000,
  dataDir: DATA_DIR,
  dbPath: path.join(DATA_DIR, 'store-music.db'),
  audioDir: path.join(DATA_DIR, 'audio'),
  announcementsDir: path.join(DATA_DIR, 'announcements'),
  uploadsDir: path.join(DATA_DIR, 'uploads'),
  ttsCacheDir: path.join(DATA_DIR, 'tts-cache'),
  maxFileSize: 50 * 1024 * 1024, // 50MB
  allowedMimeTypes: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/x-wav', 'audio/x-flac'],
  allowedExtensions: ['.mp3', '.wav', '.ogg', '.flac'],
  defaults: {
    volume: 50,
    announcementFadeDurationMs: 2000,
    ttsEngine: 'google',
    ttsLanguage: 'pl',
    autoPlayOnOpen: false,
    autoStopOnClose: false,
  },
};
