const auditService = require('../services/AuditService');

const CATEGORY_MAP = {
  '/api/auth': 'auth',
  '/api/tracks': 'tracks',
  '/api/playlists': 'playlists',
  '/api/player': 'player',
  '/api/schedule': 'schedule',
  '/api/announcements': 'announcements',
  '/api/users': 'users',
  '/api/youtube': 'youtube',
  '/api/radio': 'radio',
  '/api/ads': 'ads',
  '/api/ad-packs': 'ad-packs',
  '/api/announcement-packs': 'announcement-packs',
  '/api/backup': 'backup',
};

const ACTION_LABELS = {
  POST: 'Utworzenie',
  PUT: 'Aktualizacja',
  DELETE: 'Usuwanie',
};

// Paths to skip logging (read-only, high-frequency, or internal)
const SKIP_PATHS = [
  '/api/player/state',
  '/api/player/queue-timeline',
  '/api/player/history',
  '/api/schedule/timeline',
  '/api/schedule/today',
  '/api/audit',
];

function auditLogMiddleware(req, res, next) {
  // Only log mutating requests
  if (!['POST', 'PUT', 'DELETE'].includes(req.method)) return next();

  // Skip high-frequency or read-only endpoints
  if (SKIP_PATHS.some(p => req.path.startsWith(p))) return next();

  // Capture original end to log after response
  const originalEnd = res.end;
  res.end = function (...args) {
    originalEnd.apply(res, args);

    // Only log successful operations
    if (res.statusCode >= 400) return;

    try {
      const category = Object.entries(CATEGORY_MAP).find(([prefix]) => req.path.startsWith(prefix));
      const cat = category ? category[1] : 'general';
      const actionPrefix = ACTION_LABELS[req.method] || req.method;
      const routePath = req.path.replace(/^\/api\//, '');

      // Build human-readable action
      let action = `${actionPrefix}: ${routePath}`;

      // Build details object (exclude passwords)
      const details = {};
      if (req.body && typeof req.body === 'object') {
        for (const [key, val] of Object.entries(req.body)) {
          if (['password', 'currentPassword', 'newPassword'].includes(key)) continue;
          details[key] = val;
        }
      }
      if (req.params && Object.keys(req.params).length) {
        details._params = req.params;
      }

      auditService.log(req, action, cat, Object.keys(details).length ? details : null);
    } catch (err) {
      // Don't let audit failures break the app
      console.error('Audit log error:', err.message);
    }
  };

  next();
}

module.exports = auditLogMiddleware;
