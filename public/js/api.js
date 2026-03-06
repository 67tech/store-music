const API = {
  async _handleResponse(res) {
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  },
  async get(url) {
    const res = await fetch(`/api${url}`);
    return this._handleResponse(res);
  },
  async post(url, data) {
    const res = await fetch(`/api${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return this._handleResponse(res);
  },
  async put(url, data) {
    const res = await fetch(`/api${url}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return this._handleResponse(res);
  },
  async del(url) {
    const res = await fetch(`/api${url}`, { method: 'DELETE' });
    return this._handleResponse(res);
  },
  async upload(url, formData) {
    const res = await fetch(`/api${url}`, {
      method: 'POST',
      body: formData,
    });
    return this._handleResponse(res);
  },
};
