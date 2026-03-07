const { getDb } = require('../db');

class AuditService {
  log(req, action, category, details) {
    const db = getDb();
    const userId = req.session?.userId || null;
    const username = req.session?.username || 'system';
    const ip = req.ip || req.connection?.remoteAddress || '';
    const detailsStr = typeof details === 'object' ? JSON.stringify(details) : (details || '');

    db.prepare(`
      INSERT INTO audit_log (user_id, username, action, category, details, ip)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, username, action, category, detailsStr, ip);
  }

  getAll({ page = 1, limit = 50, category, username, dateFrom, dateTo, search } = {}) {
    const db = getDb();
    const conditions = [];
    const params = [];

    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }
    if (username) {
      conditions.push('username = ?');
      params.push(username);
    }
    if (dateFrom) {
      conditions.push('created_at >= ?');
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push('created_at <= ?');
      params.push(dateTo + ' 23:59:59');
    }
    if (search) {
      conditions.push('(action LIKE ? OR details LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const offset = (page - 1) * limit;

    const total = db.prepare(`SELECT COUNT(*) as cnt FROM audit_log ${where}`).get(...params).cnt;
    const rows = db.prepare(`SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);

    return { rows, total, page, pages: Math.ceil(total / limit) };
  }

  getCategories() {
    const db = getDb();
    return db.prepare('SELECT DISTINCT category FROM audit_log ORDER BY category').all().map(r => r.category);
  }

  getUsers() {
    const db = getDb();
    return db.prepare('SELECT DISTINCT username FROM audit_log ORDER BY username').all().map(r => r.username);
  }
}

module.exports = new AuditService();
