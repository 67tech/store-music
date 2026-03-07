const { getDb } = require('../db');

class AdPackService {
  // --- Packs CRUD ---

  getAllPacks() {
    const packs = getDb().prepare('SELECT * FROM ad_packs ORDER BY name').all();
    for (const p of packs) {
      p.items = this.getPackItems(p.id);
      p.assignments = this.getPackAssignments(p.id);
    }
    return packs;
  }

  getPack(id) {
    const pack = getDb().prepare('SELECT * FROM ad_packs WHERE id = ?').get(id);
    if (!pack) return null;
    pack.items = this.getPackItems(id);
    pack.assignments = this.getPackAssignments(id);
    return pack;
  }

  createPack(name) {
    const result = getDb().prepare('INSERT INTO ad_packs (name) VALUES (?)').run(name);
    return this.getPack(result.lastInsertRowid);
  }

  updatePack(id, name) {
    getDb().prepare('UPDATE ad_packs SET name = ? WHERE id = ?').run(name, id);
    return this.getPack(id);
  }

  deletePack(id) {
    getDb().prepare('DELETE FROM ad_packs WHERE id = ?').run(id);
  }

  // --- Pack Items ---

  getPackItems(packId) {
    return getDb().prepare(`
      SELECT api.*, a.title, a.client_name, a.filepath, a.duration, a.is_active
      FROM ad_pack_items api
      JOIN ads a ON a.id = api.ad_id
      WHERE api.pack_id = ?
      ORDER BY api.position
    `).all(packId);
  }

  addItem(packId, adId) {
    const maxPos = getDb().prepare('SELECT MAX(position) as m FROM ad_pack_items WHERE pack_id = ?').get(packId);
    const pos = (maxPos?.m || 0) + 1;
    getDb().prepare('INSERT INTO ad_pack_items (pack_id, ad_id, position) VALUES (?, ?, ?)').run(packId, adId, pos);
    return this.getPack(packId);
  }

  removeItem(packId, adId) {
    getDb().prepare('DELETE FROM ad_pack_items WHERE pack_id = ? AND ad_id = ?').run(packId, adId);
    return this.getPack(packId);
  }

  // --- Assignments ---

  getPackAssignments(packId) {
    const rows = getDb().prepare(`
      SELECT apa.*,
        CASE
          WHEN apa.assign_type = 'playlist' THEN (SELECT name FROM playlists WHERE id = apa.target_id)
          ELSE NULL
        END as target_name
      FROM ad_pack_assignments apa
      WHERE apa.pack_id = ?
    `).all(packId);
    return rows;
  }

  addAssignment(packId, assignType, targetId, targetDate) {
    // Prevent duplicate
    const existing = getDb().prepare(
      'SELECT id FROM ad_pack_assignments WHERE pack_id = ? AND assign_type = ? AND COALESCE(target_id, 0) = ? AND COALESCE(target_date, \'\') = ?'
    ).get(packId, assignType, targetId || 0, targetDate || '');
    if (existing) return this.getPack(packId);

    getDb().prepare(
      'INSERT INTO ad_pack_assignments (pack_id, assign_type, target_id, target_date) VALUES (?, ?, ?, ?)'
    ).run(packId, assignType, targetId || null, targetDate || null);
    return this.getPack(packId);
  }

  removeAssignment(assignmentId) {
    getDb().prepare('DELETE FROM ad_pack_assignments WHERE id = ?').run(assignmentId);
  }

  // --- Query: get ads for current context ---

  getAdsForContext(playlistId, date) {
    // Get all packs assigned to: global, this playlist, or this date
    const packs = getDb().prepare(`
      SELECT DISTINCT api.ad_id
      FROM ad_pack_items api
      JOIN ad_pack_assignments apa ON apa.pack_id = api.pack_id
      JOIN ads a ON a.id = api.ad_id AND a.is_active = 1
      WHERE apa.assign_type = 'global'
         OR (apa.assign_type = 'playlist' AND apa.target_id = ?)
         OR (apa.assign_type = 'calendar' AND apa.target_date = ?)
    `).all(playlistId || 0, date || '');
    return packs.map(r => r.ad_id);
  }
}

module.exports = new AdPackService();
