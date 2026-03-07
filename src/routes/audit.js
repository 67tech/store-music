const express = require('express');
const router = express.Router();
const auditService = require('../services/AuditService');
const { requirePermission } = require('../middleware/auth');

router.get('/', requirePermission('settings_manage'), (req, res) => {
  const { page, limit, category, username, dateFrom, dateTo, search } = req.query;
  res.json(auditService.getAll({
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 50,
    category,
    username,
    dateFrom,
    dateTo,
    search,
  }));
});

router.get('/categories', requirePermission('settings_manage'), (req, res) => {
  res.json(auditService.getCategories());
});

router.get('/users', requirePermission('settings_manage'), (req, res) => {
  res.json(auditService.getUsers());
});

module.exports = router;
