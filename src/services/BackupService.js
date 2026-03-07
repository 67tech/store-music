const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const config = require('../config');
const playlistService = require('./PlaylistService');

class BackupService {
  constructor() {
    this._backupDir = path.join(config.dataDir, 'backups');
    if (!fs.existsSync(this._backupDir)) fs.mkdirSync(this._backupDir, { recursive: true });
    this._timer = null;
  }

  // --- Settings ---

  getSettings() {
    const s = playlistService.getSettings();
    return {
      backup_enabled: s.backup_enabled || false,
      backup_day: s.backup_day || 0, // 0=Sunday
      backup_hour: s.backup_hour || '03:00',
      backup_destination: s.backup_destination || 'local', // local, ftp, smb, email
      backup_keep: s.backup_keep || 4,
      // FTP
      backup_ftp_host: s.backup_ftp_host || '',
      backup_ftp_port: s.backup_ftp_port || 21,
      backup_ftp_user: s.backup_ftp_user || '',
      backup_ftp_pass: s.backup_ftp_pass || '',
      backup_ftp_path: s.backup_ftp_path || '/backups',
      // SMB
      backup_smb_share: s.backup_smb_share || '',
      backup_smb_user: s.backup_smb_user || '',
      backup_smb_pass: s.backup_smb_pass || '',
      backup_smb_domain: s.backup_smb_domain || '',
      backup_smb_path: s.backup_smb_path || '/backups',
      // Email
      backup_email_to: s.backup_email_to || '',
      backup_email_smtp_host: s.backup_email_smtp_host || '',
      backup_email_smtp_port: s.backup_email_smtp_port || 587,
      backup_email_smtp_user: s.backup_email_smtp_user || '',
      backup_email_smtp_pass: s.backup_email_smtp_pass || '',
      backup_email_smtp_secure: s.backup_email_smtp_secure || false,
      // Last backup info
      backup_last_date: s.backup_last_date || null,
      backup_last_status: s.backup_last_status || null,
      backup_last_size: s.backup_last_size || null,
    };
  }

  saveSettings(data) {
    const allowed = [
      'backup_enabled', 'backup_day', 'backup_hour', 'backup_destination', 'backup_keep',
      'backup_ftp_host', 'backup_ftp_port', 'backup_ftp_user', 'backup_ftp_pass', 'backup_ftp_path',
      'backup_smb_share', 'backup_smb_user', 'backup_smb_pass', 'backup_smb_domain', 'backup_smb_path',
      'backup_email_to', 'backup_email_smtp_host', 'backup_email_smtp_port',
      'backup_email_smtp_user', 'backup_email_smtp_pass', 'backup_email_smtp_secure',
    ];
    const settings = {};
    for (const key of allowed) {
      if (data[key] !== undefined) settings[key] = data[key];
    }
    playlistService.updateSettings(settings);
    this._scheduleBackup();
    return this.getSettings();
  }

  // --- Create backup archive ---

  async createBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `store-music-backup-${timestamp}.zip`;
    const filepath = path.join(this._backupDir, filename);

    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(filepath);
      const archive = archiver('zip', { zlib: { level: 7 } });

      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);

      // Database
      const dbPath = config.dbPath;
      if (fs.existsSync(dbPath)) archive.file(dbPath, { name: 'store-music.db' });

      // Announcements (TTS + uploaded audio)
      const annDir = config.announcementsDir;
      if (fs.existsSync(annDir)) archive.directory(annDir, 'announcements');

      // TTS cache
      const ttsDir = config.ttsCacheDir;
      if (fs.existsSync(ttsDir)) archive.directory(ttsDir, 'tts-cache');

      // Uploads (ads audio etc)
      const uploadsDir = config.uploadsDir;
      if (fs.existsSync(uploadsDir)) archive.directory(uploadsDir, 'uploads');

      // Matchday data
      const matchdayDir = path.join(config.dataDir, 'matchday');
      if (fs.existsSync(matchdayDir)) archive.directory(matchdayDir, 'matchday');

      // App config files
      const serverJs = path.join(config.dataDir, '..', 'server.js');
      if (fs.existsSync(serverJs)) archive.file(serverJs, { name: 'server.js' });
      const configJs = path.join(config.dataDir, '..', 'src', 'config.js');
      if (fs.existsSync(configJs)) archive.file(configJs, { name: 'src/config.js' });

      archive.finalize();
    });

    const stat = fs.statSync(filepath);
    return { filepath, filename, size: stat.size };
  }

  // --- Send to destination ---

  async sendBackup(filepath, filename) {
    const settings = this.getSettings();
    const dest = settings.backup_destination;

    if (dest === 'ftp') {
      await this._sendFtp(filepath, filename, settings);
    } else if (dest === 'smb') {
      await this._sendSmb(filepath, filename, settings);
    } else if (dest === 'email') {
      await this._sendEmail(filepath, filename, settings);
    }
    // 'local' — file already in backups dir
  }

  async _sendFtp(filepath, filename, s) {
    const ftp = require('basic-ftp');
    const client = new ftp.Client();
    try {
      await client.access({
        host: s.backup_ftp_host,
        port: s.backup_ftp_port || 21,
        user: s.backup_ftp_user,
        password: s.backup_ftp_pass,
        secure: false,
      });
      await client.ensureDir(s.backup_ftp_path || '/backups');
      await client.uploadFrom(filepath, filename);
    } finally {
      client.close();
    }
  }

  async _sendSmb(filepath, filename, s) {
    const { execSync } = require('child_process');
    const share = s.backup_smb_share;
    if (!share) throw new Error('Adres zasobu SMB nie jest skonfigurowany');

    const mountPoint = path.join(this._backupDir, '_smb_mount');
    if (!fs.existsSync(mountPoint)) fs.mkdirSync(mountPoint, { recursive: true });

    try {
      // Build mount command based on OS
      const platform = process.platform;
      const user = s.backup_smb_user || 'guest';
      const pass = s.backup_smb_pass || '';
      const domain = s.backup_smb_domain || 'WORKGROUP';

      if (platform === 'darwin') {
        // macOS: mount_smbfs
        const authPart = pass ? `${user}:${pass}` : user;
        const smbUrl = `//${authPart}@${share.replace(/^\/\//, '')}`;
        execSync(`mount_smbfs -N "${smbUrl}" "${mountPoint}"`, { timeout: 15000 });
      } else {
        // Linux: mount -t cifs
        const opts = `username=${user},password=${pass},domain=${domain}`;
        execSync(`mount -t cifs "${share}" "${mountPoint}" -o ${opts}`, { timeout: 15000 });
      }

      // Copy file to target path within the share
      const targetDir = path.join(mountPoint, s.backup_smb_path || '');
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      fs.copyFileSync(filepath, path.join(targetDir, filename));
    } finally {
      // Always unmount
      try {
        if (process.platform === 'darwin') {
          execSync(`umount "${mountPoint}"`, { timeout: 10000 });
        } else {
          execSync(`umount "${mountPoint}"`, { timeout: 10000 });
        }
      } catch {}
    }
  }

  async _sendEmail(filepath, filename, s) {
    const nodemailer = require('nodemailer');
    const stat = fs.statSync(filepath);
    if (stat.size > 25 * 1024 * 1024) {
      throw new Error('Backup jest za duzy na email (>25MB). Uzyj FTP lub SMB.');
    }

    const transporter = nodemailer.createTransport({
      host: s.backup_email_smtp_host,
      port: s.backup_email_smtp_port || 587,
      secure: s.backup_email_smtp_secure || false,
      auth: {
        user: s.backup_email_smtp_user,
        pass: s.backup_email_smtp_pass,
      },
    });

    await transporter.sendMail({
      from: s.backup_email_smtp_user,
      to: s.backup_email_to,
      subject: `Store Music Backup - ${new Date().toLocaleDateString('pl-PL')}`,
      text: `Kopia zapasowa Store Music Manager.\nPlik: ${filename}\nRozmiar: ${(stat.size / 1024).toFixed(0)} KB\nData: ${new Date().toLocaleString('pl-PL')}`,
      attachments: [{ filename, path: filepath }],
    });
  }

  // --- Run full backup ---

  async runBackup() {
    try {
      const { filepath, filename, size } = await this.createBackup();
      await this.sendBackup(filepath, filename);

      // Clean old local backups
      this._cleanOldBackups();

      // Save status
      playlistService.updateSettings({
        backup_last_date: new Date().toISOString(),
        backup_last_status: 'ok',
        backup_last_size: size,
      });

      return { success: true, filename, size };
    } catch (err) {
      playlistService.updateSettings({
        backup_last_date: new Date().toISOString(),
        backup_last_status: `error: ${err.message}`,
        backup_last_size: null,
      });
      throw err;
    }
  }

  _cleanOldBackups() {
    const settings = this.getSettings();
    const keep = settings.backup_keep || 4;
    const files = fs.readdirSync(this._backupDir)
      .filter(f => f.startsWith('store-music-backup-') && f.endsWith('.zip'))
      .sort()
      .reverse();

    for (let i = keep; i < files.length; i++) {
      try { fs.unlinkSync(path.join(this._backupDir, files[i])); } catch {}
    }
  }

  // --- List local backups ---

  listBackups() {
    if (!fs.existsSync(this._backupDir)) return [];
    return fs.readdirSync(this._backupDir)
      .filter(f => f.startsWith('store-music-backup-') && f.endsWith('.zip'))
      .sort()
      .reverse()
      .map(f => {
        const stat = fs.statSync(path.join(this._backupDir, f));
        return { filename: f, size: stat.size, date: stat.mtime.toISOString() };
      });
  }

  // --- Scheduled backup ---

  _scheduleBackup() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }

    const settings = this.getSettings();
    if (!settings.backup_enabled) return;

    // Check every hour if it's time to backup
    this._timer = setInterval(() => {
      const now = new Date();
      const [hh, mm] = (settings.backup_hour || '03:00').split(':').map(Number);
      if (now.getDay() === Number(settings.backup_day) && now.getHours() === hh && now.getMinutes() < 5) {
        // Prevent double-run: check last backup date
        const last = settings.backup_last_date ? new Date(settings.backup_last_date) : null;
        if (last && (now - last) < 6 * 3600 * 1000) return; // ran less than 6h ago
        console.log('[Backup] Starting scheduled backup...');
        this.runBackup()
          .then(r => console.log(`[Backup] OK: ${r.filename} (${(r.size / 1024).toFixed(0)} KB)`))
          .catch(e => console.error(`[Backup] Error: ${e.message}`));
      }
    }, 60000); // check every minute
  }

  start() {
    this._scheduleBackup();
  }
}

module.exports = new BackupService();
