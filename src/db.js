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
      one_shot INTEGER NOT NULL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      permissions TEXT NOT NULL DEFAULT '{}',
      is_system INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role_id INTEGER DEFAULT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE SET NULL
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

  // Seed default roles
  const roleCount = db.prepare('SELECT COUNT(*) as cnt FROM roles').get();
  if (roleCount.cnt === 0) {
    const insertRole = db.prepare('INSERT INTO roles (name, description, permissions, is_system) VALUES (?, ?, ?, ?)');
    const seedRoles = db.transaction(() => {
      insertRole.run('admin', 'Administrator - pelny dostep', JSON.stringify({
        player_control: true,
        playlist_manage: true,
        playlist_add_tracks: true,
        track_upload: true,
        track_delete: true,
        schedule_manage: true,
        announcement_manage: true,
        announcement_play: true,
        settings_manage: true,
        user_manage: true,
        server_restart: true,
      }), 1);
      insertRole.run('manager', 'Manager - zarzadzanie muzyka i komunikatami', JSON.stringify({
        player_control: true,
        playlist_manage: true,
        playlist_add_tracks: true,
        track_upload: true,
        track_delete: true,
        schedule_manage: true,
        announcement_manage: true,
        announcement_play: true,
        settings_manage: false,
        user_manage: false,
        server_restart: false,
      }), 1);
      insertRole.run('dj', 'DJ - odtwarzanie i playlisty', JSON.stringify({
        player_control: true,
        playlist_manage: true,
        playlist_add_tracks: true,
        track_upload: true,
        track_delete: false,
        schedule_manage: false,
        announcement_manage: false,
        announcement_play: true,
        settings_manage: false,
        user_manage: false,
        server_restart: false,
      }), 1);
      insertRole.run('viewer', 'Podglad - tylko odsluch i podglad', JSON.stringify({
        player_control: false,
        playlist_manage: false,
        playlist_add_tracks: false,
        track_upload: false,
        track_delete: false,
        schedule_manage: false,
        announcement_manage: false,
        announcement_play: false,
        settings_manage: false,
        user_manage: false,
        server_restart: false,
      }), 1);
    });
    seedRoles();
  }

  // Seed default admin user (admin / admin) — change password on first login!
  const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
  if (userCount.cnt === 0) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('admin', 10);
    const adminRole = db.prepare('SELECT id FROM roles WHERE name = ?').get('admin');
    db.prepare('INSERT INTO users (username, password, role_id) VALUES (?, ?, ?)').run('admin', hash, adminRole ? adminRole.id : null);
  }

  // Migration: add role_id to existing users without it
  try {
    db.prepare('SELECT role_id FROM users LIMIT 1').get();
  } catch {
    db.exec('ALTER TABLE users ADD COLUMN role_id INTEGER DEFAULT NULL REFERENCES roles(id) ON DELETE SET NULL');
    db.exec('ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1');
    const adminRole = db.prepare('SELECT id FROM roles WHERE name = ?').get('admin');
    if (adminRole) {
      db.prepare('UPDATE users SET role_id = ? WHERE role_id IS NULL').run(adminRole.id);
    }
  }

  // Playlist calendar — assign playlists to specific dates
  db.exec(`
    CREATE TABLE IF NOT EXISTS playlist_calendar (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      playlist_id INTEGER NOT NULL,
      label TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
    )
  `);

  // Playback history table
  db.exec(`
    CREATE TABLE IF NOT EXISTS playback_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id INTEGER,
      title TEXT NOT NULL,
      artist TEXT,
      duration REAL DEFAULT 0,
      played_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      one_shot INTEGER DEFAULT 0,
      FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE SET NULL
    )
  `);

  // Ads (Reklamy) tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS ads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      client_name TEXT DEFAULT '',
      filepath TEXT NOT NULL,
      filename TEXT NOT NULL,
      duration REAL DEFAULT 0,
      schedule_mode TEXT NOT NULL DEFAULT 'count',
      daily_target INTEGER DEFAULT 1,
      interval_minutes INTEGER DEFAULT 60,
      start_time TEXT DEFAULT '08:00',
      end_time TEXT DEFAULT '20:00',
      days_of_week TEXT NOT NULL DEFAULT '[1,2,3,4,5,6]',
      priority INTEGER DEFAULT 5,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migration: add play_mode column to ads
  try {
    getDb().prepare('SELECT play_mode FROM ads LIMIT 1').get();
  } catch {
    getDb().exec("ALTER TABLE ads ADD COLUMN play_mode TEXT NOT NULL DEFAULT 'queue'");
  }

  // Migration: add play_mode column to scheduled_announcements
  try {
    getDb().prepare('SELECT play_mode FROM scheduled_announcements LIMIT 1').get();
  } catch {
    getDb().exec("ALTER TABLE scheduled_announcements ADD COLUMN play_mode TEXT NOT NULL DEFAULT 'interrupt'");
  }

  // Migration: add match_time to store_hours_exceptions
  try {
    db.prepare('SELECT match_time FROM store_hours_exceptions LIMIT 1').get();
  } catch {
    db.exec("ALTER TABLE store_hours_exceptions ADD COLUMN match_time TEXT DEFAULT NULL");
  }

  // Migration: add repeat_interval to scheduled_announcements
  try {
    db.prepare('SELECT repeat_interval FROM scheduled_announcements LIMIT 1').get();
  } catch {
    db.exec("ALTER TABLE scheduled_announcements ADD COLUMN repeat_interval INTEGER DEFAULT 0");
  }

  // Migration: add repeat_until to scheduled_announcements (absolute time like "18:00" or empty = until match/close)
  try {
    db.prepare('SELECT repeat_until FROM scheduled_announcements LIMIT 1').get();
  } catch {
    db.exec("ALTER TABLE scheduled_announcements ADD COLUMN repeat_until TEXT DEFAULT NULL");
  }

  // Migration: add one_shot column to playlist_tracks
  try {
    db.prepare('SELECT one_shot FROM playlist_tracks LIMIT 1').get();
  } catch {
    db.exec('ALTER TABLE playlist_tracks ADD COLUMN one_shot INTEGER NOT NULL DEFAULT 0');
  }

  // Ad packs
  db.exec(`
    CREATE TABLE IF NOT EXISTS ad_packs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS ad_pack_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pack_id INTEGER NOT NULL,
      ad_id INTEGER NOT NULL,
      position INTEGER DEFAULT 0,
      FOREIGN KEY (pack_id) REFERENCES ad_packs(id) ON DELETE CASCADE,
      FOREIGN KEY (ad_id) REFERENCES ads(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS ad_pack_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pack_id INTEGER NOT NULL,
      assign_type TEXT NOT NULL DEFAULT 'global',
      target_id INTEGER,
      target_date TEXT,
      FOREIGN KEY (pack_id) REFERENCES ad_packs(id) ON DELETE CASCADE
    );
  `);

  // Announcement packs
  db.exec(`
    CREATE TABLE IF NOT EXISTS announcement_packs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS announcement_pack_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pack_id INTEGER NOT NULL,
      announcement_id INTEGER NOT NULL,
      position INTEGER DEFAULT 0,
      FOREIGN KEY (pack_id) REFERENCES announcement_packs(id) ON DELETE CASCADE,
      FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS announcement_pack_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pack_id INTEGER NOT NULL,
      assign_type TEXT NOT NULL DEFAULT 'global',
      target_id INTEGER,
      target_date TEXT,
      FOREIGN KEY (pack_id) REFERENCES announcement_packs(id) ON DELETE CASCADE
    );
  `);

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
