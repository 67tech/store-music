const express = require('express');
const router = express.Router();
const adPackService = require('../services/AdPackService');
const { requirePermission } = require('../middleware/auth');

// List all packs
router.get('/', requirePermission('announcement_manage'), (req, res) => {
  res.json(adPackService.getAllPacks());
});

// Get single pack
router.get('/:id', requirePermission('announcement_manage'), (req, res) => {
  const pack = adPackService.getPack(parseInt(req.params.id));
  if (!pack) return res.status(404).json({ error: 'Pack not found' });
  res.json(pack);
});

// Create pack
router.post('/', requirePermission('announcement_manage'), (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  res.json(adPackService.createPack(name));
});

// Update pack name
router.put('/:id', requirePermission('announcement_manage'), (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  res.json(adPackService.updatePack(parseInt(req.params.id), name));
});

// Delete pack
router.delete('/:id', requirePermission('announcement_manage'), (req, res) => {
  adPackService.deletePack(parseInt(req.params.id));
  res.json({ ok: true });
});

// Add ad to pack
router.post('/:id/items', requirePermission('announcement_manage'), (req, res) => {
  const { ad_id } = req.body;
  if (!ad_id) return res.status(400).json({ error: 'ad_id required' });
  res.json(adPackService.addItem(parseInt(req.params.id), parseInt(ad_id)));
});

// Remove ad from pack
router.delete('/:id/items/:adId', requirePermission('announcement_manage'), (req, res) => {
  res.json(adPackService.removeItem(parseInt(req.params.id), parseInt(req.params.adId)));
});

// Add assignment
router.post('/:id/assign', requirePermission('announcement_manage'), (req, res) => {
  const { assign_type, target_id, target_date } = req.body;
  if (!assign_type) return res.status(400).json({ error: 'assign_type required' });
  res.json(adPackService.addAssignment(parseInt(req.params.id), assign_type, target_id, target_date));
});

// Remove assignment
router.delete('/assignments/:assignId', requirePermission('announcement_manage'), (req, res) => {
  adPackService.removeAssignment(parseInt(req.params.assignId));
  res.json({ ok: true });
});

module.exports = router;
