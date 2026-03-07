const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db');
const { requirePermission } = require('../middleware/auth');
const router = express.Router();

// --- Roles ---
router.get('/roles', (req, res) => {
  const roles = getDb().prepare('SELECT * FROM roles ORDER BY id').all();
  res.json(roles.map(r => ({
    ...r,
    permissions: JSON.parse(r.permissions || '{}'),
  })));
});

router.post('/roles', requirePermission('user_manage'), (req, res) => {
  const { name, description, permissions } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  try {
    const result = getDb().prepare(
      'INSERT INTO roles (name, description, permissions) VALUES (?, ?, ?)'
    ).run(name, description || '', JSON.stringify(permissions || {}));
    const role = getDb().prepare('SELECT * FROM roles WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ ...role, permissions: JSON.parse(role.permissions) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/roles/:id', requirePermission('user_manage'), (req, res) => {
  const id = parseInt(req.params.id);
  const { name, description, permissions } = req.body;

  const fields = [];
  const values = [];
  if (name !== undefined) { fields.push('name = ?'); values.push(name); }
  if (description !== undefined) { fields.push('description = ?'); values.push(description); }
  if (permissions !== undefined) { fields.push('permissions = ?'); values.push(JSON.stringify(permissions)); }
  if (fields.length === 0) return res.json({ error: 'nothing to update' });

  values.push(id);
  try {
    getDb().prepare(`UPDATE roles SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    const role = getDb().prepare('SELECT * FROM roles WHERE id = ?').get(id);
    res.json({ ...role, permissions: JSON.parse(role.permissions) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/roles/:id', requirePermission('user_manage'), (req, res) => {
  const id = parseInt(req.params.id);
  const role = getDb().prepare('SELECT * FROM roles WHERE id = ?').get(id);
  if (!role) return res.status(404).json({ error: 'Not found' });
  if (role.is_system) return res.status(400).json({ error: 'Nie mozna usunac roli systemowej' });

  // Move users to no role
  getDb().prepare('UPDATE users SET role_id = NULL WHERE role_id = ?').run(id);
  getDb().prepare('DELETE FROM roles WHERE id = ?').run(id);
  res.json({ success: true });
});

// --- Users ---
router.get('/', (req, res) => {
  const users = getDb().prepare(`
    SELECT u.id, u.username, u.role_id, u.is_active, u.created_at, r.name as role_name
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    ORDER BY u.id
  `).all();
  res.json(users);
});

router.post('/', requirePermission('user_manage'), (req, res) => {
  const { username, password, role_id } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  if (password.length < 4) return res.status(400).json({ error: 'Haslo min. 4 znaki' });

  const hash = bcrypt.hashSync(password, 10);
  try {
    const result = getDb().prepare(
      'INSERT INTO users (username, password, role_id) VALUES (?, ?, ?)'
    ).run(username, hash, role_id || null);

    const user = getDb().prepare(`
      SELECT u.id, u.username, u.role_id, u.is_active, u.created_at, r.name as role_name
      FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?
    `).get(result.lastInsertRowid);
    res.status(201).json(user);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Uzytkownik juz istnieje' });
    }
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', requirePermission('user_manage'), (req, res) => {
  const id = parseInt(req.params.id);
  const { username, password, role_id, is_active } = req.body;

  const fields = [];
  const values = [];
  if (username !== undefined) { fields.push('username = ?'); values.push(username); }
  if (password !== undefined && password.length >= 4) {
    fields.push('password = ?');
    values.push(bcrypt.hashSync(password, 10));
  }
  if (role_id !== undefined) { fields.push('role_id = ?'); values.push(role_id); }
  if (is_active !== undefined) { fields.push('is_active = ?'); values.push(is_active ? 1 : 0); }
  if (fields.length === 0) return res.json({ error: 'nothing to update' });

  values.push(id);
  try {
    getDb().prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    const user = getDb().prepare(`
      SELECT u.id, u.username, u.role_id, u.is_active, u.created_at, r.name as role_name
      FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?
    `).get(id);
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', requirePermission('user_manage'), (req, res) => {
  const id = parseInt(req.params.id);
  // Prevent deleting yourself
  if (req.session.userId === id) {
    return res.status(400).json({ error: 'Nie mozna usunac wlasnego konta' });
  }
  getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ success: true });
});

// --- Permissions list (for UI) ---
router.get('/permissions-list', (req, res) => {
  res.json([
    { key: 'player_control', label: 'Sterowanie playerem', desc: 'Play, pause, stop, next, prev, volume' },
    { key: 'playlist_manage', label: 'Zarzadzanie playlistami', desc: 'Tworzenie, edycja, usuwanie playlist' },
    { key: 'playlist_add_tracks', label: 'Dodawanie do playlist', desc: 'Dodawanie/usuwanie utworow z playlist' },
    { key: 'track_upload', label: 'Wgrywanie utworow', desc: 'Upload plikow audio' },
    { key: 'track_delete', label: 'Usuwanie utworow', desc: 'Usuwanie plikow z biblioteki' },
    { key: 'schedule_manage', label: 'Zarzadzanie harmonogramem', desc: 'Godziny otwarcia, wyjatki, dni meczowe' },
    { key: 'announcement_manage', label: 'Zarzadzanie komunikatami', desc: 'Tworzenie, edycja, planowanie komunikatow' },
    { key: 'announcement_play', label: 'Odtwarzanie komunikatow', desc: 'Odtwarzanie testowe komunikatow' },
    { key: 'settings_manage', label: 'Ustawienia aplikacji', desc: 'Zmiana ustawien globalnych' },
    { key: 'user_manage', label: 'Zarzadzanie uzytkownikami', desc: 'Dodawanie, edycja, usuwanie uzytkownikow i rol' },
    { key: 'server_restart', label: 'Restart serwera', desc: 'Restart playera i serwera' },
  ]);
});

module.exports = router;
