let allPermissions = [];
let allRoles = [];

async function initUsers() {
  try {
    allPermissions = await API.get('/users/permissions-list');
    await loadRoles();
    await loadUsers();
  } catch {}
}

async function loadUsers() {
  const users = await API.get('/users');
  const container = document.getElementById('users-list');
  if (!container) return;
  container.innerHTML = '';

  if (users.length === 0) {
    container.innerHTML = '<p class="sm-empty">Brak uzytkownikow</p>';
    return;
  }

  for (const u of users) {
    const div = document.createElement('div');
    div.className = 'sm-user-card';
    div.innerHTML = `
      <div class="sm-user-info">
        <strong>${esc(u.username)}</strong>
        <span class="sm-badge" style="background: ${u.is_active ? 'var(--sm-primary)' : 'var(--sm-danger)'}">
          ${u.is_active ? 'Aktywny' : 'Nieaktywny'}
        </span>
        <small>Rola: ${esc(u.role_name || 'brak')}</small>
      </div>
      <div class="sm-user-actions">
        <button onclick="editUser(${u.id})" class="sm-btn sm-btn--small">Edytuj</button>
        <button onclick="deleteUser(${u.id})" class="sm-btn sm-btn--danger sm-btn--small">&#10005;</button>
      </div>
    `;
    container.appendChild(div);
  }
}

async function loadRoles() {
  allRoles = await API.get('/users/roles');
  const container = document.getElementById('roles-list');
  if (!container) return;
  container.innerHTML = '';

  if (allRoles.length === 0) {
    container.innerHTML = '<p class="sm-empty">Brak rol</p>';
    return;
  }

  for (const r of allRoles) {
    const permCount = Object.values(r.permissions).filter(v => v).length;
    const div = document.createElement('div');
    div.className = 'sm-role-card';
    div.innerHTML = `
      <div class="sm-role-info">
        <strong>${esc(r.name)}</strong>
        ${r.is_system ? '<span class="sm-badge" style="background: var(--sm-text-muted); font-size: 0.65rem;">system</span>' : ''}
        <small>${esc(r.description)}</small>
        <small>${permCount}/${allPermissions.length} uprawnien</small>
      </div>
      <div class="sm-role-actions">
        <button onclick="editRole(${r.id})" class="sm-btn sm-btn--small">Edytuj</button>
        ${!r.is_system ? `<button onclick="deleteRole(${r.id})" class="sm-btn sm-btn--danger sm-btn--small">&#10005;</button>` : ''}
      </div>
    `;
    container.appendChild(div);
  }
}

async function addUser() {
  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modal-body');

  const roleOptions = allRoles.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('');

  modalBody.innerHTML = `
    <h2>Nowy uzytkownik</h2>
    <div class="sm-form-row"><label>Login: <input type="text" id="nu-username"></label></div>
    <div class="sm-form-row"><label>Haslo: <input type="password" id="nu-password"></label></div>
    <div class="sm-form-row"><label>Rola:
      <select id="nu-role">${roleOptions}</select>
    </label></div>
    <div id="nu-error" style="color: var(--sm-danger); font-size: 0.85rem; margin-bottom: 8px;"></div>
    <button id="nu-save" class="sm-btn sm-btn--primary">Utworz</button>
  `;

  document.getElementById('nu-save').onclick = async () => {
    const username = document.getElementById('nu-username').value.trim();
    const password = document.getElementById('nu-password').value;
    const role_id = parseInt(document.getElementById('nu-role').value);
    const errEl = document.getElementById('nu-error');

    if (!username || !password) { errEl.textContent = 'Wypelnij login i haslo'; return; }
    if (password.length < 4) { errEl.textContent = 'Haslo min. 4 znaki'; return; }

    try {
      await API.post('/users', { username, password, role_id });
      modal.classList.remove('sm-modal--open');
      await loadUsers();
    } catch (err) {
      errEl.textContent = err.message;
    }
  };

  modal.classList.add('sm-modal--open');
}

async function editUser(id) {
  const users = await API.get('/users');
  const u = users.find(x => x.id === id);
  if (!u) return;

  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modal-body');

  const roleOptions = allRoles.map(r =>
    `<option value="${r.id}" ${r.id === u.role_id ? 'selected' : ''}>${esc(r.name)}</option>`
  ).join('');

  modalBody.innerHTML = `
    <h2>Edytuj: ${esc(u.username)}</h2>
    <div class="sm-form-row"><label>Login: <input type="text" id="eu-username" value="${esc(u.username)}"></label></div>
    <div class="sm-form-row"><label>Nowe haslo (puste = bez zmian): <input type="password" id="eu-password"></label></div>
    <div class="sm-form-row"><label>Rola:
      <select id="eu-role">${roleOptions}</select>
    </label></div>
    <div class="sm-form-row"><label><input type="checkbox" id="eu-active" ${u.is_active ? 'checked' : ''}> Aktywny</label></div>
    <div id="eu-error" style="color: var(--sm-danger); font-size: 0.85rem; margin-bottom: 8px;"></div>
    <div style="display: flex; gap: 8px; justify-content: flex-end;">
      <button class="sm-btn" style="background: var(--sm-border); color: var(--sm-text);" onclick="document.getElementById('modal').classList.remove('sm-modal--open')">Anuluj</button>
      <button id="eu-save" class="sm-btn sm-btn--primary">Zapisz</button>
    </div>
  `;

  document.getElementById('eu-save').onclick = async () => {
    const data = {
      username: document.getElementById('eu-username').value.trim(),
      role_id: parseInt(document.getElementById('eu-role').value),
      is_active: document.getElementById('eu-active').checked,
    };
    const pw = document.getElementById('eu-password').value;
    if (pw) data.password = pw;

    try {
      await API.put(`/users/${id}`, data);
      modal.classList.remove('sm-modal--open');
      await loadUsers();
    } catch (err) {
      document.getElementById('eu-error').textContent = err.message;
    }
  };

  modal.classList.add('sm-modal--open');
}

async function deleteUser(id) {
  if (!await smConfirm('Usunac uzytkownika?')) return;
  try {
    await API.del(`/users/${id}`);
    await loadUsers();
  } catch (err) {
    await smAlert(err.message);
  }
}

async function addRole() {
  showRoleEditor(null);
}

async function editRole(id) {
  const role = allRoles.find(r => r.id === id);
  if (!role) return;
  showRoleEditor(role);
}

function showRoleEditor(role) {
  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modal-body');
  const isEdit = !!role;
  const perms = role ? role.permissions : {};

  const permRows = allPermissions.map(p => `
    <label style="display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--sm-border);">
      <input type="checkbox" class="role-perm-cb" data-perm="${p.key}" ${perms[p.key] ? 'checked' : ''}>
      <div>
        <strong style="font-size: 0.85rem;">${esc(p.label)}</strong>
        <small style="display: block; color: var(--sm-text-muted); font-size: 0.78rem;">${esc(p.desc)}</small>
      </div>
    </label>
  `).join('');

  modalBody.innerHTML = `
    <h2>${isEdit ? 'Edytuj role: ' + esc(role.name) : 'Nowa rola'}</h2>
    <div class="sm-form-row"><label>Nazwa: <input type="text" id="re-name" value="${esc(role ? role.name : '')}"></label></div>
    <div class="sm-form-row"><label>Opis: <input type="text" id="re-desc" value="${esc(role ? role.description : '')}"></label></div>
    <div style="margin-bottom: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <strong style="font-size: 0.88rem;">Uprawnienia:</strong>
        <div style="display: flex; gap: 6px;">
          <button class="sm-btn sm-btn--small" onclick="document.querySelectorAll('.role-perm-cb').forEach(c=>c.checked=true)">Zaznacz wszystkie</button>
          <button class="sm-btn sm-btn--small" style="background: var(--sm-border); color: var(--sm-text);" onclick="document.querySelectorAll('.role-perm-cb').forEach(c=>c.checked=false)">Odznacz</button>
        </div>
      </div>
      ${permRows}
    </div>
    <div id="re-error" style="color: var(--sm-danger); font-size: 0.85rem; margin-bottom: 8px;"></div>
    <div style="display: flex; gap: 8px; justify-content: flex-end;">
      <button class="sm-btn" style="background: var(--sm-border); color: var(--sm-text);" onclick="document.getElementById('modal').classList.remove('sm-modal--open')">Anuluj</button>
      <button id="re-save" class="sm-btn sm-btn--primary">Zapisz</button>
    </div>
  `;

  document.getElementById('re-save').onclick = async () => {
    const name = document.getElementById('re-name').value.trim();
    if (!name) { document.getElementById('re-error').textContent = 'Podaj nazwe'; return; }

    const permissions = {};
    document.querySelectorAll('.role-perm-cb').forEach(cb => {
      permissions[cb.dataset.perm] = cb.checked;
    });

    const data = {
      name,
      description: document.getElementById('re-desc').value,
      permissions,
    };

    try {
      if (isEdit) {
        await API.put(`/users/roles/${role.id}`, data);
      } else {
        await API.post('/users/roles', data);
      }
      modal.classList.remove('sm-modal--open');
      await loadRoles();
      await loadUsers();
    } catch (err) {
      document.getElementById('re-error').textContent = err.message;
    }
  };

  modal.classList.add('sm-modal--open');
}

async function deleteRole(id) {
  if (!await smConfirm('Usunac role? Uzytkownicy z ta rola straca uprawnienia.')) return;
  try {
    await API.del(`/users/roles/${id}`);
    await loadRoles();
    await loadUsers();
  } catch (err) {
    await smAlert(err.message);
  }
}
