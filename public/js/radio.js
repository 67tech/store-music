let radioStations = [];
let radioStationsData = [];

async function initRadio() {
  await loadPolishStations();
}

async function loadPolishStations() {
  try {
    radioStations = await API.get('/radio/polish');
    radioStationsData = radioStations;
    renderRadioStations(radioStations);
  } catch {
    renderRadioStations([]);
  }
}

async function searchRadio() {
  const query = document.getElementById('radio-search-input').value.trim();
  const container = document.getElementById('radio-stations');

  if (!query) {
    await loadPolishStations();
    return;
  }

  container.innerHTML = '<p class="sm-empty">Szukam...</p>';

  try {
    const stations = await API.get(`/radio/search?name=${encodeURIComponent(query)}`);
    radioStationsData = stations;
    renderRadioStations(stations);
  } catch {
    // Fallback: filter curated list locally
    const filtered = radioStations.filter(s =>
      s.name.toLowerCase().includes(query.toLowerCase()) ||
      (s.tags && s.tags.toLowerCase().includes(query.toLowerCase()))
    );
    if (filtered.length > 0) {
      renderRadioStations(filtered);
    } else {
      container.innerHTML = '<p class="sm-empty">Nie znaleziono stacji</p>';
    }
  }
}

function renderRadioStations(stations) {
  const container = document.getElementById('radio-stations');
  if (!container) return;

  if (stations.length === 0) {
    container.innerHTML = '<p class="sm-empty">Brak stacji</p>';
    return;
  }

  // Store data for click handlers
  radioStationsData = stations;

  container.innerHTML = stations.map((s, idx) => {
    const tagsStr = s.tags ? s.tags.split(',').slice(0, 3).join(', ') : '';
    const bitrateStr = s.bitrate ? `${s.bitrate}kbps` : '';
    return `<div class="sm-radio-card" onclick="playRadioByIndex(${idx})">
      <div class="sm-radio-info">
        <strong>${esc(s.name)}</strong>
        <small>${[tagsStr, bitrateStr].filter(Boolean).join(' &middot; ')}</small>
      </div>
      <button class="sm-btn sm-btn--small sm-btn--primary" onclick="event.stopPropagation(); playRadioByIndex(${idx})">&#9654; Graj</button>
    </div>`;
  }).join('');
}

async function playRadioByIndex(idx) {
  const s = radioStationsData[idx];
  if (!s) return;
  try {
    await API.post('/radio/play', { url: s.url, name: s.name });
  } catch (err) {
    await smAlert('Blad: ' + err.message);
  }
}

// Handle Enter key in search
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('radio-search-input');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') searchRadio();
    });
  }
});
