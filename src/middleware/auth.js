const { getDb } = require('../db');

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

function getUserPermissions(userId) {
  const row = getDb().prepare(`
    SELECT r.permissions FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.id = ?
  `).get(userId);

  if (!row || !row.permissions) return {};
  try { return JSON.parse(row.permissions); } catch { return {}; }
}

function requirePermission(...perms) {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const userPerms = getUserPermissions(req.session.userId);
    for (const p of perms) {
      if (!userPerms[p]) {
        return res.status(403).json({ error: 'Brak uprawnien' });
      }
    }
    next();
  };
}

module.exports = { requireAuth, requirePermission, getUserPermissions };
