/**
 * Guest-facing booth flow. Loaded by public/booth/index.html with a
 * `?code=XXXX-XXXX` query string identifying the event (see
 * EventController::publicConfig / PhotoController::upload on the backend).
 *
 * This is a plain state machine over a handful of full-screen ".screen"
 * divs (see the HTML): loading -> start -> camera -> preview -> uploading
 * -> delivery, with an error/full-event screen either can short-circuit to.
 * Camera/preview/delivery screens are edge-to-edge (see booth.css
 * #camera-wrap / .media-frame) so capture and composite math below always
 * derives its crop from the actual on-screen box rather than a guessed
 * fixed aspect ratio — see compositeSingle().
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

  // Single-photo output: sized to match whatever the live preview box
  // actually looks like on this device (see compositeSingle) — WYSIWYG,
  // rather than a guessed fixed aspect ratio — capped to this long edge
  // for consistent file size/quality regardless of screen resolution.
  const OUTPUT_LONG_EDGE = 1600;

  // Strip cells intentionally do NOT use the full-bleed preview aspect —
  // three shots stacked at a phone screen's aspect would be absurdly tall.
  // This is a compact, classic photo-strip cell shape instead.
  const STRIP_CANVAS_WIDTH = 1080;
  const STRIP_CELL_ASPECT = 6 / 5; // width / height
  const STRIP_SHOTS = 3;

  // Branding footer height as a fraction of canvas width (matches the
  // proportions of the original fixed 160px-at-1080-wide design), so it
  // scales sensibly across the range of output sizes above.
  const FOOTER_HEIGHT_RATIO = 0.148;

  // iOS Safari has a well-known quirk where a getUserMedia frame is
  // occasionally delivered rotated 90° from how the live <video> is
  // actually displayed — most likely mid-session (e.g. partway through a
  // 3-shot strip). grabFrame() detects this by comparing the frame's own
  // orientation to the on-screen preview box's orientation, and corrects
  // it. If a "fixed" shot ever comes out sideways in the OTHER direction,
  // flip this one flag — nothing else needs to change.
  const ROTATE_LANDSCAPE_FRAMES_CLOCKWISE = true;

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
      const shell = $('booth-shell');
      shell.style.backgroundColor = event.background_color;
      // The admin can pick ANY colour, light or dark, so text on top of it
      // (see booth.css .screen--centered) needs to adapt to stay legible.
      shell.classList.toggle('is-light-bg', isLightColor(event.background_color));

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

  /** Rough perceived-brightness check so booth text stays legible against
      whatever background colour the admin picked — could be light or dark. */
  function isLightColor(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return false;
    const r = parseInt(m[1].slice(0, 2), 16);
    const g = parseInt(m[1].slice(2, 4), 16);
    const b = parseInt(m[1].slice(4, 6), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000; // ITU-R BT.601
    return brightness > 150;
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
    // Ask for a stream shaped like this device's actual screen (portrait on
    // a phone, landscape on a laptop webcam) rather than a guessed fixed
    // aspect — reduces how much cropping compositeSingle() has to do later.
    const idealAspect = window.innerWidth / window.innerHeight;
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        aspectRatio: { ideal: idealAspect },
        width: { ideal: 1080 },
        height: { ideal: 1440 },
      },
      audio: false,
    });
    const video = $('video');
    video.srcObject = stream;
    // Wait for real dimensions rather than guessing a settle time — videoWidth
    // is 0 until the browser has actually negotiated the stream's shape.
    await new Promise((resolve) => {
      if (video.videoWidth) return resolve();
      video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    });
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

  /** True if `el`'s on-screen box is taller than it is wide. */
  function isPortraitBox(el) {
    const box = el.getBoundingClientRect();
    return box.height >= box.width;
  }

  /**
   * Grabs one still frame from the live <video> element, correcting for the
   * iOS Safari rotation quirk described above ROTATE_LANDSCAPE_FRAMES_CLOCKWISE.
   * We detect it by comparing this frame's own shape (landscape vs portrait)
   * to the shape of the on-screen preview box the guest was actually looking
   * at — a mismatch means this particular frame came back rotated 90°.
   */
  function grabFrame() {
    const video = $('video');
    const raw = document.createElement('canvas');
    raw.width = video.videoWidth;
    raw.height = video.videoHeight;
    const rawCtx = raw.getContext('2d');
    // The live preview is mirrored via CSS (booth.css #video), so mirror
    // the capture too — otherwise the saved photo looks "backwards"
    // compared to what the guest saw on screen.
    rawCtx.translate(raw.width, 0);
    rawCtx.scale(-1, 1);
    rawCtx.drawImage(video, 0, 0, raw.width, raw.height);

    const previewIsPortrait = isPortraitBox($('camera-wrap'));
    const frameIsLandscape = raw.width > raw.height;
    if (!(previewIsPortrait && frameIsLandscape)) {
      return raw; // shape already matches what the guest saw — nothing to fix
    }

    const fixed = document.createElement('canvas');
    fixed.width = raw.height;
    fixed.height = raw.width;
    const ctx = fixed.getContext('2d');
    ctx.translate(fixed.width / 2, fixed.height / 2);
    ctx.rotate((ROTATE_LANDSCAPE_FRAMES_CLOCKWISE ? 90 : -90) * (Math.PI / 180));
    ctx.drawImage(raw, -raw.width / 2, -raw.height / 2);
    return fixed;
  }

  /** Footer height in px for a canvas of the given width — see FOOTER_HEIGHT_RATIO. */
  function footerHeightFor(canvasWidth) {
    return Math.round(canvasWidth * FOOTER_HEIGHT_RATIO);
  }

  /** Paints the branding footer (background colour + centred logo) onto a composited canvas. */
  function drawBranding(ctx, canvasWidth, canvasHeight, footerHeight) {
    ctx.fillStyle = event.background_color;
    ctx.fillRect(0, canvasHeight - footerHeight, canvasWidth, footerHeight);
    if (logoImage) {
      const maxLogoW = canvasWidth * 0.6;
      const maxLogoH = footerHeight * 0.7;
      const scale = Math.min(maxLogoW / logoImage.width, maxLogoH / logoImage.height, 1);
      const w = logoImage.width * scale;
      const h = logoImage.height * scale;
      ctx.drawImage(
        logoImage,
        (canvasWidth - w) / 2,
        canvasHeight - footerHeight + (footerHeight - h) / 2,
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

  /**
   * Composites a single capture + branding footer into the final output
   * canvas. The output's aspect ratio matches the live preview's actual
   * on-screen box (full-bleed, see booth.css #camera-wrap), so the crop is
   * always what the guest visually saw — not a guessed fixed ratio that may
   * not match this device's camera/screen shape.
   */
  function compositeSingle(frame) {
    const box = $('camera-wrap').getBoundingClientRect();
    const aspect = box.width / box.height; // width / height, e.g. ~0.46 on a typical phone
    const width = aspect <= 1 ? Math.round(OUTPUT_LONG_EDGE * aspect) : OUTPUT_LONG_EDGE;
    const height = aspect <= 1 ? OUTPUT_LONG_EDGE : Math.round(OUTPUT_LONG_EDGE / aspect);
    const footerHeight = footerHeightFor(width);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    drawCover(ctx, frame, 0, 0, width, height - footerHeight);
    drawBranding(ctx, width, height, footerHeight);
    return canvas;
  }

  /** Composites multiple captures stacked into a compact vertical strip + branding footer. */
  function compositeStrip(frames) {
    const gap = 16;
    const width = STRIP_CANVAS_WIDTH;
    const cellHeight = Math.round(width / STRIP_CELL_ASPECT);
    const footerHeight = footerHeightFor(width);
    const totalHeight = frames.length * cellHeight + (frames.length + 1) * gap + footerHeight;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = totalHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = event.background_color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    frames.forEach((frame, i) => {
      const y = gap + i * (cellHeight + gap);
      drawCover(ctx, frame, gap, y, width - gap * 2, cellHeight);
    });

    drawBranding(ctx, width, totalHeight, footerHeight);
    return canvas;
  }

  /** Runs camera -> countdown(s) -> capture(s) -> composite, then shows the preview screen. */
  async function runCaptureFlow(type) {
    showScreen('screen-camera');
    await startCamera(); // resolves once real stream dimensions are known, not a guessed delay
    // Let the camera auto-exposure/focus settle for a beat before the first countdown.
    await new Promise((r) => setTimeout(r, 400));

    const shotCount = type === 'strip' ? STRIP_SHOTS : 1;
    const frames = [];

    for (let i = 0; i < shotCount; i++) {
      $('shot-progress').textContent = shotCount > 1 ? `Shot ${i + 1} of ${shotCount}` : '';
      $('shot-progress').classList.toggle('is-hidden', shotCount <= 1);
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
