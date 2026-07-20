/**
 * Landing page. Loaded by public/index.html — the base-domain entry point
 * for a tablet/kiosk. Two ways in for a guest device:
 *
 *  1. A booth code is already remembered from a previous visit (see
 *     BOOTH_CODE_KEY, also written by booth.js once a code is confirmed
 *     valid) — skip straight to that booth, no typing required.
 *  2. Nothing remembered yet — show a form to type/scan a code in, or an
 *     "Admin login" link for the event host.
 *
 * A `?code=` query param (e.g. from a setup QR code) is treated the same as
 * an already-remembered code, so pointing a fresh tablet at
 * "example.com/?code=XXXX-XXXX" is enough to provision it.
 */
(function () {
  'use strict';

  const BOOTH_CODE_KEY = 'jsm_booth_code';

  function goToBooth(code) {
    window.location.replace(`/booth/?code=${encodeURIComponent(code)}`);
  }

  const params = new URLSearchParams(window.location.search);
  const codeFromUrl = params.get('code');
  if (codeFromUrl) {
    localStorage.setItem(BOOTH_CODE_KEY, codeFromUrl);
    goToBooth(codeFromUrl);
    return;
  }

  const remembered = localStorage.getItem(BOOTH_CODE_KEY);
  if (remembered) {
    goToBooth(remembered);
    return;
  }

  document.getElementById('code-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = document.getElementById('code-input').value.trim();
    if (!code) return;
    goToBooth(code);
  });
})();
