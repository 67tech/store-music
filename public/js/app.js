// --- Modal-based alert/confirm/prompt ---
function smAlert(message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = `
      <p style="margin-bottom: 16px; font-size: 0.95rem;">${esc(message)}</p>
      <div style="text-align: right;">
        <button class="sm-btn sm-btn--primary" id="sm-alert-ok">OK</button>
      </div>
    `;
    document.getElementById('sm-alert-ok').onclick = () => {
      modal.classList.remove('sm-modal--open');
      resolve();
    };
    modal.classList.add('sm-modal--open');
  });
}

function smConfirm(message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = `
      <p style="margin-bottom: 16px; font-size: 0.95rem;">${esc(message)}</p>
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button class="sm-btn" style="background: var(--sm-border); color: var(--sm-text);" id="sm-confirm-no">Anuluj</button>
        <button class="sm-btn sm-btn--primary" id="sm-confirm-yes">Tak</button>
      </div>
    `;
    document.getElementById('sm-confirm-yes').onclick = () => {
      modal.classList.remove('sm-modal--open');
      resolve(true);
    };
    document.getElementById('sm-confirm-no').onclick = () => {
      modal.classList.remove('sm-modal--open');
      resolve(false);
    };
    modal.classList.add('sm-modal--open');
  });
}

function smPrompt(message, defaultValue = '') {
  return new Promise((resolve) => {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = `
      <p style="margin-bottom: 12px; font-size: 0.95rem;">${esc(message)}</p>
      <div class="sm-form-row"><input type="text" id="sm-prompt-input" value="${esc(defaultValue)}"></div>
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button class="sm-btn" style="background: var(--sm-border); color: var(--sm-text);" id="sm-prompt-cancel">Anuluj</button>
        <button class="sm-btn sm-btn--primary" id="sm-prompt-ok">OK</button>
      </div>
    `;
    const input = document.getElementById('sm-prompt-input');
    input.focus();
    input.select();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { modal.classList.remove('sm-modal--open'); resolve(input.value); }
    });
    document.getElementById('sm-prompt-ok').onclick = () => {
      modal.classList.remove('sm-modal--open');
      resolve(input.value);
    };
    document.getElementById('sm-prompt-cancel').onclick = () => {
      modal.classList.remove('sm-modal--open');
      resolve(null);
    };
    modal.classList.add('sm-modal--open');
  });
}

// --- App init ---
document.addEventListener('DOMContentLoaded', () => {
  const socket = io();

  loadUserInfo();

  const tabs = document.querySelectorAll('.sm-nav-tab');
  const sections = document.querySelectorAll('.sm-section');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(t => t.classList.remove('sm-nav-tab--active'));
      sections.forEach(s => s.classList.remove('sm-section--active'));
      tab.classList.add('sm-nav-tab--active');
      document.getElementById(`section-${target}`).classList.add('sm-section--active');
    });
  });

  document.getElementById('modal-close').addEventListener('click', () => {
    document.getElementById('modal').classList.remove('sm-modal--open');
  });
  document.getElementById('modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') {
      document.getElementById('modal').classList.remove('sm-modal--open');
    }
  });

  initPlayer(socket);
  initPlaylists();
  initSchedule();
  initAnnouncements();
});

async function loadUserInfo() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      document.getElementById('user-info').textContent = `Zalogowany: ${data.username}`;
    }
  } catch {}
}

async function logout() {
  if (!await smConfirm('Wylogować?')) return;
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}

function changePassword() {
  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modal-body');
  modalBody.innerHTML = `
    <h2>Zmiana hasła</h2>
    <div class="sm-form-row"><label>Aktualne hasło: <input type="password" id="cp-current"></label></div>
    <div class="sm-form-row"><label>Nowe hasło: <input type="password" id="cp-new"></label></div>
    <div class="sm-form-row"><label>Powtórz nowe hasło: <input type="password" id="cp-confirm"></label></div>
    <div id="cp-error" style="color: #dc2626; font-size: 0.85rem; margin-bottom: 8px;"></div>
    <button id="cp-save" class="sm-btn sm-btn--primary">Zmień hasło</button>
  `;

  document.getElementById('cp-save').onclick = async () => {
    const current = document.getElementById('cp-current').value;
    const newPw = document.getElementById('cp-new').value;
    const confirmPw = document.getElementById('cp-confirm').value;
    const errEl = document.getElementById('cp-error');

    if (!current || !newPw) { errEl.textContent = 'Wypełnij wszystkie pola'; return; }
    if (newPw !== confirmPw) { errEl.textContent = 'Hasła nie są takie same'; return; }
    if (newPw.length < 4) { errEl.textContent = 'Hasło musi mieć min. 4 znaki'; return; }

    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: current, newPassword: newPw }),
    });
    const data = await res.json();

    if (res.ok) {
      modal.classList.remove('sm-modal--open');
      await smAlert('Hasło zmienione!');
    } else {
      errEl.textContent = data.error || 'Błąd zmiany hasła';
    }
  };

  modal.classList.add('sm-modal--open');
}

async function restartPlayer() {
  if (!await smConfirm('Restartować silnik audio (mpv)?')) return;
  try {
    await API.post('/player/restart');
    await smAlert('Player zrestartowany.');
  } catch (err) {
    await smAlert('Błąd: ' + err.message);
  }
}

async function restartServer() {
  if (!await smConfirm('Restartować serwer? Odtwarzanie zostanie przerwane.')) return;
  try {
    await API.post('/server/restart');
    await smAlert('Serwer się restartuje. Strona odświeży się za chwilę...');
    setTimeout(() => window.location.reload(), 3000);
  } catch {
    setTimeout(() => window.location.reload(), 3000);
  }
}
