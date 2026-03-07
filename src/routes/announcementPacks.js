const express = require('express');
const router = express.Router();
const announcementPackService = require('../services/AnnouncementPackService');
const { requirePermission } = require('../middleware/auth');

// List all packs
router.get('/', requirePermission('announcement_manage'), (req, res) => {
  res.json(announcementPackService.getAllPacks());
});

// Get single pack
router.get('/:id', requirePermission('announcement_manage'), (req, res) => {
  const pack = announcementPackService.getPack(parseInt(req.params.id));
  if (!pack) return res.status(404).json({ error: 'Pack not found' });
  res.json(pack);
});

// Create pack
router.post('/', requirePermission('announcement_manage'), (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  res.json(announcementPackService.createPack(name));
});

// Update pack name
router.put('/:id', requirePermission('announcement_manage'), (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  res.json(announcementPackService.updatePack(parseInt(req.params.id), name));
});

// Delete pack
router.delete('/:id', requirePermission('announcement_manage'), (req, res) => {
  announcementPackService.deletePack(parseInt(req.params.id));
  res.json({ ok: true });
});

// Add announcement to pack
router.post('/:id/items', requirePermission('announcement_manage'), (req, res) => {
  const { announcement_id } = req.body;
  if (!announcement_id) return res.status(400).json({ error: 'announcement_id required' });
  res.json(announcementPackService.addItem(parseInt(req.params.id), parseInt(announcement_id)));
});

// Remove announcement from pack
router.delete('/:id/items/:announcementId', requirePermission('announcement_manage'), (req, res) => {
  res.json(announcementPackService.removeItem(parseInt(req.params.id), parseInt(req.params.announcementId)));
});

// Add assignment
router.post('/:id/assign', requirePermission('announcement_manage'), (req, res) => {
  const { assign_type, target_id, target_date } = req.body;
  if (!assign_type) return res.status(400).json({ error: 'assign_type required' });
  res.json(announcementPackService.addAssignment(parseInt(req.params.id), assign_type, target_id, target_date));
});

// Remove assignment
router.delete('/assignments/:assignId', requirePermission('announcement_manage'), (req, res) => {
  announcementPackService.removeAssignment(parseInt(req.params.assignId));
  res.json({ ok: true });
});

module.exports = router;
