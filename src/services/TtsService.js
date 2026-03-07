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

    if (engine === 'elevenlabs') {
      const apiKey = settings.elevenlabsApiKey;
      if (!apiKey) throw new Error('Brak klucza API ElevenLabs — ustaw go w Ustawienia > TTS');
      const voiceId = voice || settings.elevenlabsVoiceId || 'onwK4e9ZLuTAKqWW03F9'; // Default: Daniel
      await this._generateElevenLabs(text, filepath, apiKey, voiceId);
    } else if (engine === 'piper') {
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

  async _generateElevenLabs(text, outputPath, apiKey, voiceId) {
    const https = require('https');

    const postData = JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    });

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.elevenlabs.io',
        path: `/v1/text-to-speech/${voiceId}`,
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
      }, (res) => {
        if (res.statusCode !== 200) {
          let body = '';
          res.on('data', c => body += c);
          res.on('end', () => reject(new Error(`ElevenLabs API error ${res.statusCode}: ${body}`)));
          return;
        }
        const file = fs.createWriteStream(outputPath);
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
        file.on('error', reject);
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  async getElevenLabsVoices(apiKey) {
    const https = require('https');

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.elevenlabs.io',
        path: '/v1/voices',
        method: 'GET',
        headers: { 'xi-api-key': apiKey },
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`ElevenLabs API error ${res.statusCode}: ${body}`));
            return;
          }
          try {
            const data = JSON.parse(body);
            const voices = (data.voices || []).map(v => ({
              id: v.voice_id,
              name: v.name,
              category: v.category || '',
              labels: v.labels || {},
            }));
            resolve(voices);
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.end();
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
