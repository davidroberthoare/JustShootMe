/**
 * Admin dashboard. Loaded by public/admin/index.html.
 *
 * Talks to the JSON API under /api/admin/* (see src/Controllers/AuthController.php,
 * EventController.php, GalleryController.php). Auth is a PHP session cookie
 * set by POST /api/admin/login — every fetch() below relies on the browser
 * sending that cookie automatically (same-origin), so there's no token to
 * manage client-side.
 *
 * All visual styling comes from Bulma classes in the HTML (is-hidden,
 * is-active, card, notification, etc.) plus Bootstrap Icons; this file only
 * toggles those classes and fills in text/attributes — it does not set
 * inline styles except for the one genuinely dynamic value (an event's
 * admin-chosen background colour swatch).
 */
(function () {
  'use strict';

  /** Thin fetch() wrapper: JSON in/out, throws on non-2xx with the server's error message. */
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
    loginView.classList.remove('is-hidden');
    dashboardView.classList.add('is-hidden');
  }

  function showDashboard(email) {
    loginView.classList.add('is-hidden');
    dashboardView.classList.remove('is-hidden');
    $('admin-email').textContent = email || '';
    showEventsList();
    loadEvents();
  }

  function showEventsList() {
    eventsListView.classList.remove('is-hidden');
    eventDetailView.classList.add('is-hidden');
  }

  function showEventDetail() {
    eventsListView.classList.add('is-hidden');
    eventDetailView.classList.remove('is-hidden');
  }

  /** Formats a byte count as a human-readable size (KB/MB/GB), matching the caps shown in .env. */
  function fmtBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  }

  /** Never insert user-provided text (event names) as raw HTML — always through textContent. */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /** Builds one Bulma <div class="card"> for the events grid. */
  function eventCard(ev) {
    const col = document.createElement('div');
    col.className = 'column is-4';

    const cap = ev.photo_cap > 0 ? `${ev.photo_count} / ${ev.photo_cap} photos` : `${ev.photo_count} photos`;
    const storageCap = ev.storage_cap_bytes > 0
      ? `${fmtBytes(ev.storage_used_bytes)} / ${fmtBytes(ev.storage_cap_bytes)}`
      : fmtBytes(ev.storage_used_bytes);
    const statusTag = ev.status === 'active' ? 'is-success' : 'is-light';

    col.innerHTML = `
      <div class="card">
        <div class="card-content">
          <span class="tag ${statusTag}">${ev.status}</span>
          <p class="title is-5 mt-2">
            <span class="color-swatch" style="background-color:${ev.background_color}"></span>${escapeHtml(ev.name)}
          </p>
          <div class="field has-addons">
            <div class="control is-expanded">
              <input class="input is-small" type="text" readonly value="${ev.booth_url}">
            </div>
            <div class="control">
              <button class="button is-small copy-btn" title="Copy booth URL">
                <span class="icon"><i class="ph ph-clipboard"></i></span>
              </button>
            </div>
          </div>
          <p class="is-size-7 has-text-grey">${cap} &middot; ${storageCap}</p>
        </div>
        <footer class="card-footer">
          <a class="card-footer-item view-gallery-btn">
            <span class="icon"><i class="ph ph-images"></i></span>&nbsp;Gallery
          </a>
        </footer>
      </div>
    `;

    col.querySelector('.copy-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(ev.booth_url);
    });
    col.querySelector('.view-gallery-btn').addEventListener('click', () => openEventDetail(ev.id));

    return col;
  }

  async function loadEvents() {
    const { events } = await api('/api/admin/events');
    const grid = $('event-grid');
    grid.innerHTML = '';
    if (events.length === 0) {
      grid.innerHTML = '<p class="has-text-grey">No events yet — create one above.</p>';
      return;
    }
    events.forEach((ev) => grid.appendChild(eventCard(ev)));
  }

  async function openEventDetail(id) {
    const { event } = await api(`/api/admin/events/${id}`);
    const { photos } = await api(`/api/admin/events/${id}/photos`);

    $('detail-event-name').textContent = event.name;
    $('detail-booth-url').innerHTML = `
      <div class="control is-expanded">
        <input class="input" type="text" readonly value="${event.booth_url}">
      </div>
    `;
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
    $('login-error').classList.add('is-hidden');
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
      $('login-error').classList.remove('is-hidden');
    }
  });

  $('logout-btn').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST' });
    showLogin();
  });

  // Bulma's file input doesn't update its own filename label automatically.
  $('event-logo').addEventListener('change', (e) => {
    const name = e.target.files[0] ? e.target.files[0].name : 'No file selected';
    $('event-logo-name').textContent = name;
  });

  $('create-event-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('create-event-error').classList.add('is-hidden');

    // multipart/form-data, not JSON, because this request may include a logo file.
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
      $('event-logo-name').textContent = 'No file selected';
      loadEvents();
    } catch (err) {
      $('create-event-error').textContent = err.message;
      $('create-event-error').classList.remove('is-hidden');
    }
  });

  // On load: ask the server if we already have a valid session (GET /api/admin/me)
  // rather than always showing the login form first.
  (async function init() {
    try {
      const data = await api('/api/admin/me');
      showDashboard(data.email);
    } catch (err) {
      showLogin();
    }
  })();
})();
