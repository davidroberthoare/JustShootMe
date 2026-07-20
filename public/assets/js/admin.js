/**
 * Admin dashboard. Loaded by public/admin/index.html.
 *
 * Talks to the JSON API under /api/admin/* (see src/Controllers/AuthController.php,
 * EventController.php, GalleryController.php). Auth is a PHP session cookie
 * set by POST /api/admin/login — every fetch() below relies on the browser
 * sending that cookie automatically (same-origin), so there's no token to
 * manage client-side.
 *
 * The event detail view is a single form used for both creating and editing
 * an event (see openNewEventForm / openEventDetail / populateDetailView) —
 * "New event" drops straight into it in create mode, and clicking a card's
 * "Manage" opens the same form pre-filled in edit mode, with Delete
 * available. `editingEventId` (null in create mode) is what the shared
 * submit handler uses to decide POST /events vs POST /events/{id}.
 *
 * All visual styling comes from Bulma classes in the HTML (is-hidden,
 * is-active, card, notification, etc.) plus Phosphor icons; this file only
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

  // Same key landing.js/booth.js use to remember the booth this device is
  // provisioned for — lets "Back to Booth" here return to it without the
  // admin having to know/re-enter the code, and without ever getting stuck
  // in the admin UI after an accidental trip here from the kiosk.
  const BOOTH_CODE_KEY = 'jsm_booth_code';

  function boothOrHomeUrl() {
    const code = localStorage.getItem(BOOTH_CODE_KEY);
    return code ? `/booth/?code=${encodeURIComponent(code)}` : '/';
  }

  [$('login-back-to-booth'), $('dashboard-back-to-booth')].forEach((el) => {
    el.href = boothOrHomeUrl();
  });

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
  }

  /** Also reloads the grid — covers arriving here after a create/edit/delete in the detail view. */
  function showEventsList() {
    eventsListView.classList.remove('is-hidden');
    eventDetailView.classList.add('is-hidden');
    loadEvents();
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

  /** Builds a clickable "Link to Live Photo Booth" row + copy button, used on each event card. */
  function boothLinkBlock(url) {
    const wrap = document.createElement('div');
    wrap.className = 'field';

    const label = document.createElement('label');
    label.className = 'label is-size-7 mb-1';
    label.textContent = 'Link to Live Photo Booth';
    wrap.appendChild(label);

    const row = document.createElement('div');
    row.className = 'is-flex is-align-items-center booth-link-row';

    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.className = 'booth-link';
    a.textContent = url;
    row.appendChild(a);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'button is-small copy-btn';
    copyBtn.title = 'Copy booth URL';
    copyBtn.innerHTML = '<span class="icon is-small"><i class="ph ph-clipboard"></i></span>';
    copyBtn.addEventListener('click', () => navigator.clipboard.writeText(url));
    row.appendChild(copyBtn);

    wrap.appendChild(row);
    return wrap;
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
          <div class="booth-link-slot"></div>
          <p class="is-size-7 has-text-grey mt-2">${cap} &middot; ${storageCap}</p>
        </div>
        <footer class="card-footer">
          <a class="card-footer-item manage-btn">
            <span class="icon"><i class="ph ph-pencil-simple"></i></span>&nbsp;Manage
          </a>
        </footer>
      </div>
    `;

    col.querySelector('.booth-link-slot').appendChild(boothLinkBlock(ev.booth_url));
    col.querySelector('.manage-btn').addEventListener('click', () => openEventDetail(ev.id));

    return col;
  }

  async function loadEvents() {
    const { events } = await api('/api/admin/events');
    const grid = $('event-grid');
    grid.innerHTML = '';
    if (events.length === 0) {
      grid.innerHTML = '<p class="has-text-grey">No events yet — create one.</p>';
      return;
    }
    events.forEach((ev) => grid.appendChild(eventCard(ev)));
  }

  // -------------------- Event detail: shared create/edit form --------------------

  let editingEventId = null; // null while creating a not-yet-saved event; an id once it exists

  function resetDetailForm() {
    $('event-form').reset();
    $('detail-bg-color').value = '#111111';
    $('detail-logo').value = '';
    $('detail-logo-name').textContent = 'No file selected';
    $('detail-logo-cta').textContent = 'Choose a logo…';
    $('detail-logo-preview-wrap').classList.add('is-hidden');
    $('detail-logo-preview').src = '';
    $('detail-form-error').classList.add('is-hidden');
    $('detail-form-success').classList.add('is-hidden');
  }

  function openNewEventForm() {
    editingEventId = null;
    resetDetailForm();
    $('detail-heading').textContent = 'New event';
    $('detail-save-label').textContent = 'Create event';
    $('detail-delete-wrap').classList.add('is-hidden');
    $('detail-live-info').classList.add('is-hidden');
    $('detail-photo-grid').innerHTML = '';
    showEventDetail();
  }

  /** Fills the form + the "existing event" sections (booth link, stats, gallery) from a saved event. */
  function populateDetailView(event, photos) {
    editingEventId = event.id;

    $('detail-heading').textContent = event.name;
    $('detail-save-label').textContent = 'Save changes';
    $('detail-delete-wrap').classList.remove('is-hidden');

    $('detail-name').value = event.name;
    $('detail-bg-color').value = event.background_color;

    $('detail-logo').value = '';
    $('detail-logo-name').textContent = 'No file selected';
    $('detail-logo-cta').textContent = event.logo_url ? 'Replace logo…' : 'Choose a logo…';
    if (event.logo_url) {
      $('detail-logo-preview').src = event.logo_url;
      $('detail-logo-preview-wrap').classList.remove('is-hidden');
    } else {
      $('detail-logo-preview-wrap').classList.add('is-hidden');
    }

    $('detail-booth-link').href = event.booth_url;
    $('detail-booth-link').textContent = event.booth_url;
    $('detail-stats').textContent =
      `${event.photo_count} photos captured · ${fmtBytes(event.storage_used_bytes)} used · created ${event.created_at}`;
    $('detail-download-link').setAttribute('href', `/api/admin/events/${event.id}/download`);
    $('detail-live-info').classList.remove('is-hidden');

    const grid = $('detail-photo-grid');
    grid.innerHTML = '';
    (photos || []).forEach((p) => {
      const a = document.createElement('a');
      a.href = p.view_url;
      a.target = '_blank';
      const img = document.createElement('img');
      img.src = p.image_url;
      img.loading = 'lazy';
      a.appendChild(img);
      grid.appendChild(a);
    });

    $('detail-form-error').classList.add('is-hidden');
  }

  async function openEventDetail(id) {
    const { event } = await api(`/api/admin/events/${id}`);
    const { photos } = await api(`/api/admin/events/${id}/photos`);
    populateDetailView(event, photos);
    showEventDetail();
  }

  $('new-event-btn').addEventListener('click', openNewEventForm);
  $('back-to-events').addEventListener('click', showEventsList);

  $('detail-copy-btn').addEventListener('click', () => {
    navigator.clipboard.writeText($('detail-booth-link').href);
  });

  $('detail-logo').addEventListener('change', (e) => {
    const name = e.target.files[0] ? e.target.files[0].name : 'No file selected';
    $('detail-logo-name').textContent = name;
  });

  $('event-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('detail-form-error').classList.add('is-hidden');
    $('detail-form-success').classList.add('is-hidden');

    // multipart/form-data, not JSON, because this request may include a logo file.
    const form = new FormData();
    form.set('name', $('detail-name').value);
    form.set('background_color', $('detail-bg-color').value);
    if ($('detail-logo').files[0]) form.set('logo', $('detail-logo').files[0]);

    try {
      if (editingEventId === null) {
        const { event } = await api('/api/admin/events', { method: 'POST', body: form });
        populateDetailView(event, []);
      } else {
        const { event } = await api(`/api/admin/events/${editingEventId}`, { method: 'POST', body: form });
        const { photos } = await api(`/api/admin/events/${editingEventId}/photos`);
        populateDetailView(event, photos);
        $('detail-form-success').classList.remove('is-hidden');
      }
    } catch (err) {
      $('detail-form-error').textContent = err.message;
      $('detail-form-error').classList.remove('is-hidden');
    }
  });

  $('detail-delete-btn').addEventListener('click', async () => {
    if (editingEventId === null) return;
    if (!confirm('Delete this event and all its photos? This cannot be undone.')) return;
    try {
      await api(`/api/admin/events/${editingEventId}`, { method: 'DELETE' });
      showEventsList();
    } catch (err) {
      $('detail-form-error').textContent = err.message;
      $('detail-form-error').classList.remove('is-hidden');
    }
  });

  // -------------------- Login/logout --------------------

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
