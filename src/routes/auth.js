const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db');
const router = express.Router();

// Login page
router.get('/login', (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect('/');
  }
  res.send(loginPage());
});

// Login API
router.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Nieprawidłowy login lub hasło' });
  }
  if (user.is_active === 0) {
    return res.status(403).json({ error: 'Konto jest nieaktywne' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ success: true, username: user.username });
});

// Logout
router.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Change password
router.post('/api/auth/change-password', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Both passwords required' });
  }
  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'Hasło musi mieć min. 4 znaki' });
  }

  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!bcrypt.compareSync(currentPassword, user.password)) {
    return res.status(401).json({ error: 'Aktualne hasło jest nieprawidłowe' });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  getDb().prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, user.id);
  res.json({ success: true });
});

// Current user info (with permissions)
router.get('/api/auth/me', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { getUserPermissions } = require('../middleware/auth');
  const row = getDb().prepare(`
    SELECT u.id, u.username, u.role_id, r.name as role_name
    FROM users u LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.id = ?
  `).get(req.session.userId);

  res.json({
    userId: row.id,
    username: row.username,
    role: row.role_name || 'brak',
    permissions: getUserPermissions(req.session.userId),
  });
});

function loginPage(error = '') {
  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Store Music - Logowanie</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .login-card {
      background: #16213e;
      border: 1px solid #2a2a4a;
      border-radius: 12px;
      padding: 40px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      width: 100%;
      max-width: 380px;
    }
    .login-card h1 {
      text-align: center;
      font-size: 1.4rem;
      margin-bottom: 8px;
      color: #1db954;
    }
    .login-card p {
      text-align: center;
      color: #8888aa;
      font-size: 0.9rem;
      margin-bottom: 24px;
    }
    .form-group {
      margin-bottom: 16px;
    }
    .form-group label {
      display: block;
      font-size: 0.85rem;
      font-weight: 500;
      margin-bottom: 6px;
      color: #e8e8f0;
    }
    .form-group input {
      width: 100%;
      padding: 10px 14px;
      border: 1px solid #2a2a4a;
      border-radius: 8px;
      font-size: 0.95rem;
      outline: none;
      background: #1a1a2e;
      color: #e8e8f0;
      transition: border-color 0.2s;
    }
    .form-group input:focus {
      border-color: #1db954;
      box-shadow: 0 0 0 3px rgba(29,185,84,0.2);
    }
    .login-btn {
      width: 100%;
      padding: 12px;
      background: #1db954;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s;
    }
    .login-btn:hover { background: #1ed760; }
    .login-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .error {
      background: rgba(231,76,60,0.15);
      color: #e74c3c;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 0.85rem;
      margin-bottom: 16px;
      display: none;
    }
    .error.visible { display: block; }
  </style>
</head>
<body>
  <div class="login-card">
    <h1>Store Music Manager</h1>
    <p>Zaloguj się do panelu</p>
    <div class="error" id="error-msg"></div>
    <form id="login-form">
      <div class="form-group">
        <label for="username">Login</label>
        <input type="text" id="username" name="username" autocomplete="username" autofocus required>
      </div>
      <div class="form-group">
        <label for="password">Hasło</label>
        <input type="password" id="password" name="password" autocomplete="current-password" required>
      </div>
      <button type="submit" class="login-btn" id="login-btn">Zaloguj</button>
    </form>
  </div>
  <script>
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('login-btn');
      const err = document.getElementById('error-msg');
      btn.disabled = true;
      err.classList.remove('visible');

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: document.getElementById('username').value,
            password: document.getElementById('password').value,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          window.location.href = '/';
        } else {
          err.textContent = data.error || 'Błąd logowania';
          err.classList.add('visible');
        }
      } catch {
        err.textContent = 'Błąd połączenia z serwerem';
        err.classList.add('visible');
      }
      btn.disabled = false;
    });
  </script>
</body>
</html>`;
}

module.exports = router;
