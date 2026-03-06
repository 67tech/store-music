const Database = require('better-sqlite3');
const config = require('./config');

let db;

function getDb() {
  if (!db) {
    db = new Database(config.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT DEFAULT '',
      duration INTEGER DEFAULT 0,
      mimetype TEXT NOT NULL,
      filesize INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      is_default INTEGER DEFAULT 0,
      shuffle INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS playlist_tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL,
      track_id INTEGER NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS store_hours (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_of_week INTEGER NOT NULL UNIQUE,
      open_time TEXT DEFAULT '08:00',
      close_time TEXT DEFAULT '20:00',
      is_closed INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS store_hours_exceptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      open_time TEXT,
      close_time TEXT,
      is_closed INTEGER DEFAULT 0,
      label TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'audio',
      filepath TEXT,
      tts_text TEXT,
      tts_engine TEXT,
      duration INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS scheduled_announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      announcement_id INTEGER NOT NULL,
      trigger_type TEXT NOT NULL,
      trigger_value TEXT NOT NULL,
      days_of_week TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
      is_active INTEGER DEFAULT 1,
      volume_override INTEGER,
      FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default store hours (Mon-Sat open, Sun closed)
  const existing = db.prepare('SELECT COUNT(*) as cnt FROM store_hours').get();
  if (existing.cnt === 0) {
    const insert = db.prepare('INSERT INTO store_hours (day_of_week, open_time, close_time, is_closed) VALUES (?, ?, ?, ?)');
    const seedHours = db.transaction(() => {
      insert.run(0, '00:00', '00:00', 1); // Sunday - closed
      insert.run(1, '08:00', '20:00', 0);
      insert.run(2, '08:00', '20:00', 0);
      insert.run(3, '08:00', '20:00', 0);
      insert.run(4, '08:00', '20:00', 0);
      insert.run(5, '08:00', '20:00', 0);
      insert.run(6, '09:00', '18:00', 0); // Saturday shorter
    });
    seedHours();
  }

  // Seed default admin user (admin / admin) — change password on first login!
  const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
  if (userCount.cnt === 0) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('admin', 10);
    db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run('admin', hash);
  }

  // Seed default settings
  const settingsCount = db.prepare('SELECT COUNT(*) as cnt FROM settings').get();
  if (settingsCount.cnt === 0) {
    const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    const seedSettings = db.transaction(() => {
      for (const [key, val] of Object.entries(config.defaults)) {
        insertSetting.run(key, JSON.stringify(val));
      }
    });
    seedSettings();
  }
}

module.exports = { getDb };
