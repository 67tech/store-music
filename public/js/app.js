document.addEventListener('DOMContentLoaded', () => {
  const socket = io();

  // Load user info
  loadUserInfo();

  // Navigation
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

  // Close modal
  document.getElementById('modal-close').addEventListener('click', () => {
    document.getElementById('modal').classList.remove('sm-modal--open');
  });
  document.getElementById('modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') {
      document.getElementById('modal').classList.remove('sm-modal--open');
    }
  });

  // Init modules
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
  if (!confirm('Wylogować?')) return;
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
    const confirm = document.getElementById('cp-confirm').value;
    const errEl = document.getElementById('cp-error');

    if (!current || !newPw) { errEl.textContent = 'Wypełnij wszystkie pola'; return; }
    if (newPw !== confirm) { errEl.textContent = 'Hasła nie są takie same'; return; }
    if (newPw.length < 4) { errEl.textContent = 'Hasło musi mieć min. 4 znaki'; return; }

    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: current, newPassword: newPw }),
    });
    const data = await res.json();

    if (res.ok) {
      alert('Hasło zmienione!');
      modal.classList.remove('sm-modal--open');
    } else {
      errEl.textContent = data.error || 'Błąd zmiany hasła';
    }
  };

  modal.classList.add('sm-modal--open');
}
