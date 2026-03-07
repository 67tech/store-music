const express = require('express');
const router = express.Router();
const path = require('path');
const backupService = require('../services/BackupService');
const { requirePermission } = require('../middleware/auth');

// Get backup settings
router.get('/settings', requirePermission('settings_manage'), (req, res) => {
  res.json(backupService.getSettings());
});

// Save backup settings
router.put('/settings', requirePermission('settings_manage'), (req, res) => {
  const updated = backupService.saveSettings(req.body);
  res.json(updated);
});

// Run backup now
router.post('/run', requirePermission('settings_manage'), async (req, res) => {
  try {
    const result = await backupService.runBackup();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List local backups
router.get('/list', requirePermission('settings_manage'), (req, res) => {
  res.json(backupService.listBackups());
});

// Download backup file
router.get('/download/:filename', requirePermission('settings_manage'), (req, res) => {
  const filename = req.params.filename;
  if (!/^store-music-backup-[\w-]+\.zip$/.test(filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const filepath = path.join(backupService._backupDir, filename);
  res.download(filepath, filename);
});

// Delete backup file
router.delete('/:filename', requirePermission('settings_manage'), (req, res) => {
  const filename = req.params.filename;
  if (!/^store-music-backup-[\w-]+\.zip$/.test(filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const fs = require('fs');
  const filepath = path.join(backupService._backupDir, filename);
  try { fs.unlinkSync(filepath); } catch {}
  res.json({ ok: true });
});

// Test destination (FTP/SMB/Email)
router.post('/test', requirePermission('settings_manage'), async (req, res) => {
  try {
    const dest = req.body.destination;
    if (dest === 'ftp') {
      const ftp = require('basic-ftp');
      const client = new ftp.Client();
      await client.access({
        host: req.body.ftp_host,
        port: req.body.ftp_port || 21,
        user: req.body.ftp_user,
        password: req.body.ftp_pass,
        secure: false,
      });
      await client.ensureDir(req.body.ftp_path || '/backups');
      client.close();
      res.json({ ok: true, message: 'Polaczenie FTP OK' });
    } else if (dest === 'smb') {
      const { execSync } = require('child_process');
      const fs = require('fs');
      const share = req.body.smb_share;
      if (!share) return res.status(400).json({ error: 'Podaj adres zasobu SMB' });

      const mountPoint = path.join(backupService._backupDir, '_smb_mount');
      if (!fs.existsSync(mountPoint)) fs.mkdirSync(mountPoint, { recursive: true });

      try {
        const user = req.body.smb_user || 'guest';
        const pass = req.body.smb_pass || '';
        const domain = req.body.smb_domain || 'WORKGROUP';

        if (process.platform === 'darwin') {
          const authPart = pass ? `${user}:${pass}` : user;
          const smbUrl = `//${authPart}@${share.replace(/^\/\//, '')}`;
          execSync(`mount_smbfs -N "${smbUrl}" "${mountPoint}"`, { timeout: 15000 });
        } else {
          const opts = `username=${user},password=${pass},domain=${domain}`;
          execSync(`mount -t cifs "${share}" "${mountPoint}" -o ${opts}`, { timeout: 15000 });
        }

        // Check write
        const targetDir = path.join(mountPoint, req.body.smb_path || '');
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        const testFile = path.join(targetDir, '.store-music-test');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);

        res.json({ ok: true, message: 'Zasob SMB dostepny i zapisywalny' });
      } finally {
        try { execSync(`umount "${mountPoint}"`, { timeout: 10000 }); } catch {}
      }
    } else if (dest === 'email') {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: req.body.smtp_host,
        port: req.body.smtp_port || 587,
        secure: req.body.smtp_secure || false,
        auth: { user: req.body.smtp_user, pass: req.body.smtp_pass },
      });
      await transporter.verify();
      res.json({ ok: true, message: 'Polaczenie SMTP OK' });
    } else {
      res.json({ ok: true, message: 'Backup lokalny — nie wymaga konfiguracji' });
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
