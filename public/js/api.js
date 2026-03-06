const API = {
  async get(url) {
    const res = await fetch(`/api${url}`);
    return res.json();
  },
  async post(url, data) {
    const res = await fetch(`/api${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },
  async put(url, data) {
    const res = await fetch(`/api${url}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },
  async del(url) {
    const res = await fetch(`/api${url}`, { method: 'DELETE' });
    return res.json();
  },
  async upload(url, formData) {
    const res = await fetch(`/api${url}`, {
      method: 'POST',
      body: formData,
    });
    return res.json();
  },
};
