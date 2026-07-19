(function () {
  'use strict';

  const api = async (path, options = {}) => {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  };

  const $ = (id) => document.getElementById(id);

  const loginView = $('login-view');
  const dashboardView = $('dashboard-view');
  const eventsListView = $('events-list-view');
  const eventDetailView = $('event-detail-view');

  function showLogin() {
    loginView.classList.remove('hidden');
    dashboardView.classList.add('hidden');
  }

  function showDashboard(email) {
    loginView.classList.add('hidden');
    dashboardView.classList.remove('hidden');
    $('admin-email').textContent = email || '';
    showEventsList();
    loadEvents();
  }

  function showEventsList() {
    eventsListView.classList.remove('hidden');
    eventDetailView.classList.add('hidden');
  }

  function showEventDetail() {
    eventsListView.classList.add('hidden');
    eventDetailView.classList.remove('hidden');
  }

  function fmtBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  }

  function eventCard(ev) {
    const el = document.createElement('div');
    el.className = 'card event-card';
    const cap = ev.photo_cap > 0 ? `${ev.photo_count} / ${ev.photo_cap} photos` : `${ev.photo_count} photos`;
    const storageCap = ev.storage_cap_bytes > 0
      ? `${fmtBytes(ev.storage_used_bytes)} / ${fmtBytes(ev.storage_cap_bytes)}`
      : fmtBytes(ev.storage_used_bytes);

    el.innerHTML = `
      <span class="badge ${ev.status === 'active' ? 'active' : ''}">${ev.status}</span>
      <h3><span class="color-swatch" style="background:${ev.background_color}"></span>${escapeHtml(ev.name)}</h3>
      <div class="booth-url-box">
        <input type="text" readonly value="${ev.booth_url}">
        <button class="secondary copy-btn">Copy</button>
      </div>
      <div class="progress-row">${cap} &middot; ${storageCap}</div>
      <div class="actions">
        <button class="view-gallery-btn">Gallery</button>
      </div>
    `;

    el.querySelector('.copy-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(ev.booth_url);
    });
    el.querySelector('.view-gallery-btn').addEventListener('click', () => openEventDetail(ev.id));

    return el;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  async function loadEvents() {
    const { events } = await api('/api/admin/events');
    const grid = $('event-grid');
    grid.innerHTML = '';
    if (events.length === 0) {
      grid.innerHTML = '<p class="muted">No events yet — create one above.</p>';
      return;
    }
    events.forEach((ev) => grid.appendChild(eventCard(ev)));
  }

  async function openEventDetail(id) {
    const { event } = await api(`/api/admin/events/${id}`);
    const { photos } = await api(`/api/admin/events/${id}/photos`);

    $('detail-event-name').textContent = event.name;
    $('detail-booth-url').innerHTML = `<input type="text" readonly value="${event.booth_url}">`;
    $('detail-stats').textContent =
      `${event.photo_count} photos captured · ${fmtBytes(event.storage_used_bytes)} used · created ${event.created_at}`;
    $('detail-download-link').setAttribute('href', `/api/admin/events/${id}/download`);

    const grid = $('detail-photo-grid');
    grid.innerHTML = '';
    photos.forEach((p) => {
      const a = document.createElement('a');
      a.href = p.view_url;
      a.target = '_blank';
      const img = document.createElement('img');
      img.src = p.image_url;
      img.loading = 'lazy';
      a.appendChild(img);
      grid.appendChild(a);
    });

    showEventDetail();
  }

  $('back-to-events').addEventListener('click', showEventsList);

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('login-error').classList.add('hidden');
    try {
      const data = await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({
          email: $('login-email').value,
          password: $('login-password').value,
        }),
      });
      showDashboard(data.email);
    } catch (err) {
      $('login-error').textContent = err.message;
      $('login-error').classList.remove('hidden');
    }
  });

  $('logout-btn').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST' });
    showLogin();
  });

  $('create-event-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('create-event-error').classList.add('hidden');

    const form = new FormData();
    form.set('name', $('event-name').value);
    form.set('background_color', $('event-bg-color').value);
    if ($('event-photo-cap').value) form.set('photo_cap', $('event-photo-cap').value);
    if ($('event-storage-cap').value) form.set('storage_cap_mb', $('event-storage-cap').value);
    if ($('event-logo').files[0]) form.set('logo', $('event-logo').files[0]);

    try {
      await api('/api/admin/events', { method: 'POST', body: form });
      e.target.reset();
      $('event-bg-color').value = '#111111';
      loadEvents();
    } catch (err) {
      $('create-event-error').textContent = err.message;
      $('create-event-error').classList.remove('hidden');
    }
  });

  (async function init() {
    try {
      const data = await api('/api/admin/me');
      showDashboard(data.email);
    } catch (err) {
      showLogin();
    }
  })();
})();
