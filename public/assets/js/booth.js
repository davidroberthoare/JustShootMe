/**
 * Guest-facing booth flow. Loaded by public/booth/index.html with a
 * `?code=XXXX-XXXX` query string identifying the event (see
 * EventController::publicConfig / PhotoController::upload on the backend).
 *
 * This is a plain state machine over a handful of full-screen ".screen"
 * divs (see the HTML): loading -> start -> camera -> preview -> uploading
 * -> delivery, with an error/full-event screen either can short-circuit to.
 * Only CSS classes come from Bulma/Bootstrap Icons (loaded in the HTML
 * <head>) plus the small kiosk-specific rules in booth.css — there is no
 * hand-rolled layout CSS here.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const screens = Array.from(document.querySelectorAll('.screen'));

  /** Shows exactly one .screen at a time via Bulma's "is-active" convention. */
  function showScreen(id) {
    screens.forEach((s) => s.classList.toggle('is-active', s.id === id));
  }

  const params = new URLSearchParams(window.location.search);
  const boothCode = params.get('code');

  // Output canvas dimensions. Portrait, print-friendly proportions; tweak
  // freely, they don't need to match the camera's native resolution.
  const CAPTURE_WIDTH = 1080;
  const SINGLE_HEIGHT = 1440;
  const STRIP_SHOT_HEIGHT = 900;
  const STRIP_SHOTS = 3;
  const BRAND_FOOTER_HEIGHT = 160; // reserved strip at the bottom for the branding colour + logo

  let event = null; // { uuid, name, logo_url, background_color, is_full } — from /booth/config/{code}
  let logoImage = null; // preloaded <img> for the event logo, reused across captures
  let stream = null; // active getUserMedia MediaStream, or null when the camera is off
  let lastPhotoUuid = null; // server-assigned id of the most recently uploaded photo
  let lastResultDataUrl = null; // the composited JPEG data URL shown in preview/delivery/print

  /** Fetches this event's branding + status and shows the right first screen. */
  async function loadConfig() {
    if (!boothCode) {
      showError('No booth code was provided in the URL. Ask your event host for the correct link.');
      return;
    }
    try {
      const res = await fetch(`/booth/config/${encodeURIComponent(boothCode)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load this event.');
      event = data.event;

      // Branding is baked in by the admin at event setup, not editable by guests (spec).
      document.getElementById('booth-shell').style.backgroundColor = event.background_color;

      if (event.logo_url) {
        logoImage = await loadImage(event.logo_url);
        $('start-logo').src = event.logo_url;
        $('start-logo').classList.remove('is-hidden');
        $('full-logo').src = event.logo_url;
        $('full-logo').classList.remove('is-hidden');
      }

      if (event.is_full) {
        // Per spec: a friendly "this event is full" screen, not a raw error,
        // once the admin's configured photo/storage cap is hit.
        showScreen('screen-full');
        return;
      }

      $('event-name').textContent = event.name;
      showScreen('screen-start');
    } catch (err) {
      showError(err.message);
    }
  }

  function showError(message) {
    $('error-message').textContent = message;
    showScreen('screen-error');
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function startCamera() {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1707 } },
      audio: false,
    });
    $('video').srcObject = stream;
  }

  /** Always call this once capture is done — an idle open camera drains battery/keeps the light on. */
  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
  }

  /** Resolves after counting down from `seconds` to 0, updating the on-screen overlay each tick. */
  function countdown(seconds) {
    return new Promise((resolve) => {
      const el = $('countdown');
      el.classList.remove('is-hidden');
      let remaining = seconds;
      el.textContent = String(remaining);
      const timer = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(timer);
          el.classList.add('is-hidden');
          resolve();
        } else {
          el.textContent = String(remaining);
        }
      }, 1000);
    });
  }

  /** Grabs one still frame from the live <video> element into a same-size canvas. */
  function grabFrame() {
    const video = $('video');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    // The live preview is mirrored via CSS (booth.css #video), so mirror
    // the capture too — otherwise the saved photo looks "backwards"
    // compared to what the guest saw on screen.
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  /** Paints the branding footer (background colour + centred logo) onto a composited canvas. */
  function drawBranding(ctx, canvasWidth, canvasHeight) {
    ctx.fillStyle = event.background_color;
    ctx.fillRect(0, canvasHeight - BRAND_FOOTER_HEIGHT, canvasWidth, BRAND_FOOTER_HEIGHT);
    if (logoImage) {
      const maxLogoW = canvasWidth * 0.6;
      const maxLogoH = BRAND_FOOTER_HEIGHT * 0.7;
      const scale = Math.min(maxLogoW / logoImage.width, maxLogoH / logoImage.height, 1);
      const w = logoImage.width * scale;
      const h = logoImage.height * scale;
      ctx.drawImage(
        logoImage,
        (canvasWidth - w) / 2,
        canvasHeight - BRAND_FOOTER_HEIGHT + (BRAND_FOOTER_HEIGHT - h) / 2,
        w,
        h
      );
    }
  }

  /** Draws `sourceCanvas` into the (x, y, w, h) box using CSS "object-fit: cover" semantics (crop, don't squash). */
  function drawCover(ctx, sourceCanvas, x, y, w, h) {
    const srcRatio = sourceCanvas.width / sourceCanvas.height;
    const dstRatio = w / h;
    let sx, sy, sw, sh;
    if (srcRatio > dstRatio) {
      sh = sourceCanvas.height;
      sw = sh * dstRatio;
      sx = (sourceCanvas.width - sw) / 2;
      sy = 0;
    } else {
      sw = sourceCanvas.width;
      sh = sw / dstRatio;
      sx = 0;
      sy = (sourceCanvas.height - sh) / 2;
    }
    ctx.drawImage(sourceCanvas, sx, sy, sw, sh, x, y, w, h);
  }

  /** Composites a single capture + branding footer into the final output canvas. */
  function compositeSingle(frame) {
    const canvas = document.createElement('canvas');
    canvas.width = CAPTURE_WIDTH;
    canvas.height = SINGLE_HEIGHT;
    const ctx = canvas.getContext('2d');
    drawCover(ctx, frame, 0, 0, CAPTURE_WIDTH, SINGLE_HEIGHT - BRAND_FOOTER_HEIGHT);
    drawBranding(ctx, CAPTURE_WIDTH, SINGLE_HEIGHT);
    return canvas;
  }

  /** Composites multiple captures stacked into a vertical strip + branding footer. */
  function compositeStrip(frames) {
    const gap = 16;
    const totalHeight = frames.length * STRIP_SHOT_HEIGHT + (frames.length + 1) * gap + BRAND_FOOTER_HEIGHT;
    const canvas = document.createElement('canvas');
    canvas.width = CAPTURE_WIDTH;
    canvas.height = totalHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = event.background_color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    frames.forEach((frame, i) => {
      const y = gap + i * (STRIP_SHOT_HEIGHT + gap);
      drawCover(ctx, frame, gap, y, CAPTURE_WIDTH - gap * 2, STRIP_SHOT_HEIGHT);
    });

    drawBranding(ctx, CAPTURE_WIDTH, totalHeight);
    return canvas;
  }

  /** Runs camera -> countdown(s) -> capture(s) -> composite, then shows the preview screen. */
  async function runCaptureFlow(type) {
    showScreen('screen-camera');
    await startCamera();
    // Let the camera auto-exposure/focus settle for a beat before the first countdown.
    await new Promise((r) => setTimeout(r, 400));

    const shotCount = type === 'strip' ? STRIP_SHOTS : 1;
    const frames = [];

    for (let i = 0; i < shotCount; i++) {
      $('shot-progress').textContent = shotCount > 1 ? `Shot ${i + 1} of ${shotCount}` : '';
      await countdown(3);
      frames.push(grabFrame());
      if (i < shotCount - 1) await new Promise((r) => setTimeout(r, 600));
    }

    stopCamera();

    const finalCanvas = type === 'strip' ? compositeStrip(frames) : compositeSingle(frames[0]);
    lastResultDataUrl = finalCanvas.toDataURL('image/jpeg', 0.92);

    $('result-image').src = lastResultDataUrl;
    showScreen('screen-preview');

    $('continue-btn').onclick = () => uploadPhoto(type, lastResultDataUrl);
  }

  /** Uploads the finished (already-branded) photo to the server for this event. */
  async function uploadPhoto(type, dataUrl) {
    showScreen('screen-uploading');
    try {
      const res = await fetch(`/booth/config/${encodeURIComponent(boothCode)}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, image_data_url: dataUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed.');

      lastPhotoUuid = data.photo.uuid;
      $('delivery-image').src = lastResultDataUrl;
      $('email-input').value = '';
      $('email-status').textContent = '';
      showScreen('screen-delivery');
      loadQr(lastPhotoUuid);
    } catch (err) {
      showError(err.message);
    }
  }

  /** Fetches a QR code pointing at this guest's own photo page (not the full event gallery). */
  async function loadQr(photoUuid) {
    try {
      const res = await fetch(`/api/photos/${photoUuid}/qr`);
      const data = await res.json();
      $('qr-image').src = data.qr_data_uri;
    } catch (err) {
      // Non-fatal — the guest can still use email or print.
    }
  }

  /** Returns to the welcome screen for the next guest. */
  function resetToStart() {
    lastPhotoUuid = null;
    lastResultDataUrl = null;
    stopCamera();
    showScreen(event && event.is_full ? 'screen-full' : 'screen-start');
  }

  $('choose-single').addEventListener('click', () => runCaptureFlow('single'));
  $('choose-strip').addEventListener('click', () => runCaptureFlow('strip'));
  $('retake-btn').addEventListener('click', () => showScreen('screen-start'));
  $('new-session-btn').addEventListener('click', resetToStart);

  // No native OS share sheet (spec) — printing goes through the browser's own
  // print dialog, which works with AirPrint on iOS with zero extra integration.
  $('print-btn').addEventListener('click', () => {
    const printImg = $('print-image');
    printImg.src = lastResultDataUrl;
    // Must actually remove is-hidden (display:none) rather than rely on the
    // @media print visibility rules in booth.css — a display:none element
    // has no box for "visibility: visible" to reveal.
    printImg.classList.remove('is-hidden');
    window.print();
    printImg.classList.add('is-hidden');
  });

  $('email-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('email-input').value;
    $('email-status').textContent = 'Sending…';
    try {
      const res = await fetch(`/api/photos/${lastPhotoUuid}/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send email.');
      $('email-status').textContent = data.sent ? 'Sent! Check your inbox.' : 'Could not send — please try again.';
    } catch (err) {
      $('email-status').textContent = err.message;
    }
  });

  loadConfig();
})();
