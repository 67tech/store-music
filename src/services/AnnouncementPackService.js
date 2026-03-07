const { getDb } = require('../db');

class AnnouncementPackService {
  // --- Packs CRUD ---

  getAllPacks() {
    const packs = getDb().prepare('SELECT * FROM announcement_packs ORDER BY name').all();
    for (const p of packs) {
      p.items = this.getPackItems(p.id);
      p.assignments = this.getPackAssignments(p.id);
    }
    return packs;
  }

  getPack(id) {
    const pack = getDb().prepare('SELECT * FROM announcement_packs WHERE id = ?').get(id);
    if (!pack) return null;
    pack.items = this.getPackItems(id);
    pack.assignments = this.getPackAssignments(id);
    return pack;
  }

  createPack(name) {
    const result = getDb().prepare('INSERT INTO announcement_packs (name) VALUES (?)').run(name);
    return this.getPack(result.lastInsertRowid);
  }

  updatePack(id, name) {
    getDb().prepare('UPDATE announcement_packs SET name = ? WHERE id = ?').run(name, id);
    return this.getPack(id);
  }

  deletePack(id) {
    getDb().prepare('DELETE FROM announcement_packs WHERE id = ?').run(id);
  }

  // --- Pack Items ---

  getPackItems(packId) {
    return getDb().prepare(`
      SELECT api.*, a.name as title, a.type, a.filepath, a.duration
      FROM announcement_pack_items api
      JOIN announcements a ON a.id = api.announcement_id
      WHERE api.pack_id = ?
      ORDER BY api.position
    `).all(packId);
  }

  addItem(packId, announcementId) {
    const maxPos = getDb().prepare('SELECT MAX(position) as m FROM announcement_pack_items WHERE pack_id = ?').get(packId);
    const pos = (maxPos?.m || 0) + 1;
    getDb().prepare('INSERT INTO announcement_pack_items (pack_id, announcement_id, position) VALUES (?, ?, ?)').run(packId, announcementId, pos);
    return this.getPack(packId);
  }

  removeItem(packId, announcementId) {
    getDb().prepare('DELETE FROM announcement_pack_items WHERE pack_id = ? AND announcement_id = ?').run(packId, announcementId);
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
      FROM announcement_pack_assignments apa
      WHERE apa.pack_id = ?
    `).all(packId);
    return rows;
  }

  addAssignment(packId, assignType, targetId, targetDate) {
    const existing = getDb().prepare(
      'SELECT id FROM announcement_pack_assignments WHERE pack_id = ? AND assign_type = ? AND COALESCE(target_id, 0) = ? AND COALESCE(target_date, \'\') = ?'
    ).get(packId, assignType, targetId || 0, targetDate || '');
    if (existing) return this.getPack(packId);

    getDb().prepare(
      'INSERT INTO announcement_pack_assignments (pack_id, assign_type, target_id, target_date) VALUES (?, ?, ?, ?)'
    ).run(packId, assignType, targetId || null, targetDate || null);
    return this.getPack(packId);
  }

  removeAssignment(assignmentId) {
    getDb().prepare('DELETE FROM announcement_pack_assignments WHERE id = ?').run(assignmentId);
  }

  // --- Query: get announcements for current context ---

  getAnnouncementsForContext(playlistId, date) {
    const rows = getDb().prepare(`
      SELECT DISTINCT api.announcement_id
      FROM announcement_pack_items api
      JOIN announcement_pack_assignments apa ON apa.pack_id = api.pack_id
      JOIN announcements a ON a.id = api.announcement_id
      WHERE apa.assign_type = 'global'
         OR (apa.assign_type = 'playlist' AND apa.target_id = ?)
         OR (apa.assign_type = 'calendar' AND apa.target_date = ?)
    `).all(playlistId || 0, date || '');
    return rows.map(r => r.announcement_id);
  }
}

module.exports = new AnnouncementPackService();
