const express = require('express');
const router = express.Router();
const playerService = require('../services/PlayerService');
const { requirePermission } = require('../middleware/auth');

const RADIO_API = 'https://de1.api.radio-browser.info/json';

// Curated Polish radio stations as fallback
const POLISH_STATIONS = [
  { id: 'rmf-fm', name: 'RMF FM', url: 'https://rs6-krk2.rmfstream.pl/RMFFM48', tags: 'pop,hits', bitrate: 128 },
  { id: 'radio-zet', name: 'Radio ZET', url: 'https://zt01.cdn.eurozet.pl/zet-net.mp3', tags: 'pop,hits', bitrate: 128 },
  { id: 'trojka', name: 'Trojka - Polskie Radio', url: 'https://stream3.polskieradio.pl:8904/;', tags: 'rock,alternative', bitrate: 128 },
  { id: 'jedynka', name: 'Jedynka - Polskie Radio', url: 'https://stream3.polskieradio.pl:8900/;', tags: 'news,music', bitrate: 128 },
  { id: 'dwojka', name: 'Dwojka - Polskie Radio', url: 'https://stream3.polskieradio.pl:8902/;', tags: 'classical,jazz', bitrate: 128 },
  { id: 'czworka', name: 'Czworka - Polskie Radio', url: 'https://stream3.polskieradio.pl:8906/;', tags: 'alternative,indie', bitrate: 128 },
  { id: 'rmf-maxx', name: 'RMF MAXX', url: 'https://rs6-krk2.rmfstream.pl/RMFMAXXX48', tags: 'dance,hits', bitrate: 128 },
  { id: 'eska', name: 'Radio ESKA', url: 'https://ml1.ic.smcdn.pl/1110-1.mp3', tags: 'pop,dance', bitrate: 128 },
  { id: 'eska-rock', name: 'ESKA ROCK', url: 'https://ml1.ic.smcdn.pl/1560-1.mp3', tags: 'rock', bitrate: 128 },
  { id: 'rmf-classic', name: 'RMF Classic', url: 'https://rs6-krk2.rmfstream.pl/RMFCLASSIC48', tags: 'classical', bitrate: 128 },
  { id: 'chillizet', name: 'ChilliZET', url: 'https://ch01.cdn.eurozet.pl/chillizet-net.mp3', tags: 'chillout,lounge', bitrate: 128 },
  { id: 'antyradio', name: 'Antyradio', url: 'https://an01.cdn.eurozet.pl/ant-net.mp3', tags: 'rock', bitrate: 128 },
  { id: 'radio-nowy-swiat', name: 'Radio Nowy Swiat', url: 'https://stream.rfrn.pl/rns.mp3', tags: 'alternative,culture', bitrate: 128 },
  { id: 'radio-357', name: 'Radio 357', url: 'https://stream.radio357.pl/radio357_mp3', tags: 'alternative,culture', bitrate: 128 },
  { id: 'rmf-gold', name: 'RMF Gold', url: 'https://rs201-krk.rmfstream.pl/RMFGOLD48', tags: 'oldies,gold', bitrate: 128 },
  { id: 'vox-fm', name: 'VOX FM', url: 'https://ml1.ic.smcdn.pl/1130-1.mp3', tags: 'pop,hits', bitrate: 128 },
  { id: 'tok-fm', name: 'TOK FM', url: 'https://radio.stream.smcdn.pl/icradio-t01/1020-1.mp3', tags: 'news,talk', bitrate: 128 },
  { id: 'polskie-radio-24', name: 'Polskie Radio 24', url: 'https://stream3.polskieradio.pl:8914/;', tags: 'news', bitrate: 128 },
  { id: 'radio-pogoda', name: 'Radio Pogoda', url: 'https://n11.radiostream.pl/8020/;', tags: 'oldies,relaxing', bitrate: 128 },
  { id: 'radio-zlote-przeboje', name: 'Radio Zlote Przeboje', url: 'https://n21.radiostream.pl/8090/;', tags: 'oldies,gold', bitrate: 128 },
];

async function radioFetch(endpoint, params = {}) {
  const url = new URL(`${RADIO_API}${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'StoreMusicManager/1.0' },
  });
  if (!res.ok) throw new Error('Radio API error');
  return res.json();
}

// Get curated Polish stations
router.get('/polish', (req, res) => {
  res.json(POLISH_STATIONS);
});

// Search stations (defaults to Poland)
router.get('/search', async (req, res) => {
  try {
    const { name, tag, country, limit, offset, order } = req.query;
    const stations = await radioFetch('/stations/search', {
      name: name || undefined,
      tag: tag || undefined,
      country: country || 'Poland',
      limit: limit || 30,
      offset: offset || 0,
      order: order || 'clickcount',
      reverse: 'true',
      hidebroken: 'true',
    });

    res.json(stations.map(s => ({
      id: s.stationuuid,
      name: s.name,
      url: s.url_resolved || s.url,
      favicon: s.favicon,
      country: s.country,
      tags: s.tags,
      codec: s.codec,
      bitrate: s.bitrate,
      votes: s.votes,
      clickcount: s.clickcount,
    })));
  } catch (err) {
    // Fallback to curated list on API error
    if (!req.query.name && !req.query.tag) {
      return res.json(POLISH_STATIONS);
    }
    res.status(500).json({ error: 'Blad wyszukiwania stacji: ' + err.message });
  }
});

// Play radio station
router.post('/play', requirePermission('player_control'), async (req, res) => {
  const { url, name } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    // Stop current playback and play radio stream
    if (playerService.mpv) {
      await playerService.mpv.load(url);
      await playerService.mpv.volume(playerService.state.volume);
    }

    playerService.state.status = 'playing';
    playerService.state.currentTrack = {
      title: name || 'Radio',
      artist: 'Radio internetowe',
      isRadio: true,
      radioUrl: url,
    };
    playerService.state.duration = 0;
    playerService.state.elapsed = 0;
    playerService.state.playlist = { id: null, name: 'Radio' };
    playerService.state.playlistTracks = [];
    playerService._startPositionTracking();
    playerService._emitState();

    res.json({ success: true, state: playerService.getState() });
  } catch (err) {
    res.status(500).json({ error: 'Nie udalo sie odtworzyc stacji: ' + err.message });
  }
});

module.exports = router;
