(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const screens = Array.from(document.querySelectorAll('.screen'));

  function showScreen(id) {
    screens.forEach((s) => s.classList.toggle('active', s.id === id));
  }

  const params = new URLSearchParams(window.location.search);
  const boothCode = params.get('code');

  const CAPTURE_WIDTH = 1080;
  const SINGLE_HEIGHT = 1440;
  const STRIP_SHOT_HEIGHT = 900;
  const STRIP_SHOTS = 3;
  const BRAND_FOOTER_HEIGHT = 160;

  let event = null; // { uuid, name, logo_url, background_color, is_full }
  let logoImage = null;
  let stream = null;
  let lastPhotoUuid = null;
  let lastResultDataUrl = null;

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

      document.getElementById('booth-shell').style.backgroundColor = event.background_color;

      if (event.logo_url) {
        logoImage = await loadImage(event.logo_url);
        $('start-logo').src = event.logo_url;
        $('start-logo').classList.remove('hidden');
        $('full-logo').src = event.logo_url;
        $('full-logo').classList.remove('hidden');
      }

      if (event.is_full) {
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

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
  }

  function countdown(seconds) {
    return new Promise((resolve) => {
      const el = $('countdown');
      el.classList.remove('hidden');
      let remaining = seconds;
      el.textContent = String(remaining);
      const timer = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(timer);
          el.classList.add('hidden');
          resolve();
        } else {
          el.textContent = String(remaining);
        }
      }, 1000);
    });
  }

  function grabFrame() {
    const video = $('video');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    // Mirror the capture to match the mirrored live preview.
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

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

  function compositeSingle(frame) {
    const canvas = document.createElement('canvas');
    canvas.width = CAPTURE_WIDTH;
    canvas.height = SINGLE_HEIGHT;
    const ctx = canvas.getContext('2d');
    drawCover(ctx, frame, 0, 0, CAPTURE_WIDTH, SINGLE_HEIGHT - BRAND_FOOTER_HEIGHT);
    drawBranding(ctx, CAPTURE_WIDTH, SINGLE_HEIGHT);
    return canvas;
  }

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

  async function runCaptureFlow(type) {
    showScreen('screen-camera');
    await startCamera();
    // let the camera settle for a beat before the first countdown
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

  async function loadQr(photoUuid) {
    try {
      const res = await fetch(`/api/photos/${photoUuid}/qr`);
      const data = await res.json();
      $('qr-image').src = data.qr_data_uri;
    } catch (err) {
      // non-fatal — guest can still use email or print
    }
  }

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

  $('print-btn').addEventListener('click', () => {
    const printImg = $('print-image');
    printImg.src = lastResultDataUrl;
    printImg.style.display = 'block';
    window.print();
    printImg.style.display = 'none';
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
