const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const playlistService = require('./PlaylistService');

class TtsService {
  async generate(text, engine, language, voice) {
    const settings = playlistService.getSettings();
    engine = engine || settings.ttsEngine || 'google';
    language = language || settings.ttsLanguage || 'pl';

    const filename = `${uuidv4()}.mp3`;
    const filepath = path.join(config.ttsCacheDir, filename);

    if (engine === 'piper') {
      await this._generatePiper(text, filepath, language);
    } else if (engine === 'edge') {
      await this._generateEdge(text, filepath, voice || 'pl-PL-ZofiaNeural');
    } else {
      await this._generateGoogle(text, filepath, language);
    }

    // Get duration via ffprobe
    const duration = await this._getDuration(filepath);

    return { filepath, filename, duration };
  }

  _generateGoogle(text, outputPath, language) {
    return new Promise((resolve, reject) => {
      const gtts = require('gtts');
      const tts = new gtts(text, language);
      tts.save(outputPath, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  _generatePiper(text, outputPath, language) {
    return new Promise((resolve, reject) => {
      // Map language code to Piper model name
      const modelMap = {
        pl: 'pl_PL-darkman-medium',
        en: 'en_US-lessac-medium',
        de: 'de_DE-thorsten-medium',
      };
      const model = modelMap[language] || modelMap.pl;

      // Convert to WAV first, then to MP3
      const wavPath = outputPath.replace('.mp3', '.wav');
      const escapedText = text.replace(/"/g, '\\"');
      const cmd = `echo "${escapedText}" | piper --model ${model} --output_file ${wavPath} && ffmpeg -y -i ${wavPath} ${outputPath} && rm -f ${wavPath}`;

      exec(cmd, { timeout: 30000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(`Piper TTS failed: ${stderr || err.message}`));
        else resolve();
      });
    });
  }

  _generateEdge(text, outputPath, voice) {
    return new Promise((resolve, reject) => {
      const escapedText = text.replace(/"/g, '\\"');
      const cmd = `edge-tts --voice "${voice}" --text "${escapedText}" --write-media "${outputPath}"`;
      exec(cmd, { timeout: 30000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(`Edge TTS failed: ${stderr || err.message}`));
        else resolve();
      });
    });
  }

  getEdgeVoices() {
    return new Promise((resolve) => {
      exec('edge-tts --list-voices', { timeout: 10000 }, (err, stdout) => {
        if (err || !stdout) { resolve([]); return; }
        const voices = [];
        for (const line of stdout.trim().split('\n')) {
          const parts = line.split(/\s{2,}/);
          if (parts.length >= 2 && parts[0].includes('-')) {
            voices.push({ id: parts[0], gender: parts[1] || '', style: parts[2] || '' });
          }
        }
        resolve(voices);
      });
    });
  }

  _getDuration(filepath) {
    return new Promise((resolve) => {
      exec(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filepath}"`, (err, stdout) => {
        if (err) { resolve(0); return; }
        resolve(Math.round(parseFloat(stdout.trim()) || 0));
      });
    });
  }
}

module.exports = new TtsService();
