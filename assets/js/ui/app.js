/*
 * TrueFrame — UI controller: input, model preloading, live analysis view (HUD, guess game,
 * facts, download panel), verdict reveal, settings, landing-page effects and navigation.
 */
(function () {
  'use strict';
  const TF = window.TrueFrame;
  const U = TF.util;
  const I = window.TFIcon;
  const UI = window.TFUI;
  const N = TF.neural;
  const esc = UI.esc;
  const $ = UI.$;
  const $$ = UI.$$;
  const RM = UI.reducedMotion;

  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem('tf-' + k);
        return v == null ? d : v;
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem('tf-' + k, v);
      } catch (e) {
        /* storage unavailable: the setting lasts for this visit only */
      }
    },
  };

  const savedTier = store.get('tier', N.DEFAULT_TIER);
  const state = {
    busy: false,
    tier: N.TIERS[savedTier] ? savedTier : N.DEFAULT_TIER,
    stepTotal: 1,
    live: null,
    guess: null,
    current: null, // the report on screen (its object URL is released when replaced)
    models: N.status(),
  };
  const tierKeys = () => N.TIERS[state.tier].models;
  const mb = (bytes) => Math.round(bytes / 1e6);

  // ------------------------------------------------------------------ views
  const VIEWS = ['Idle', 'Analyzing', 'Result', 'Error'];
  function setView(name, scroll) {
    VIEWS.forEach((v) => ($('#view' + v).hidden = v !== name));
    $('#exploreLink').hidden = name !== 'Idle';
    if (scroll) window.scrollTo({ top: 0, behavior: scroll });
  }
  /** Switches view, morphing shared elements (drop zone → live stage → verdict image) where supported. */
  function show(name, opts = {}) {
    const scroll = opts.keepScroll ? null : 'auto';
    if (!document.startViewTransition || RM() || opts.instant) {
      setView(name, opts.keepScroll ? null : RM() ? 'auto' : 'smooth');
      return;
    }
    const html = document.documentElement;
    html.classList.add('vt');
    try {
      const t = document.startViewTransition(() => setView(name, scroll));
      // A transition can be skipped (e.g. the viewport resizes mid-way); the view still switches.
      if (t.ready) t.ready.catch(() => {});
      t.finished.catch(() => {}).then(() => html.classList.remove('vt'));
    } catch (e) {
      html.classList.remove('vt');
      setView(name, scroll);
    }
  }
  function showError(msg) {
    $('#errorMessage').textContent = msg;
    show('Error');
  }

  // ------------------------------------------------------------------ model preloading
  // The neural networks are the only large download. Start them as early as is polite:
  // from the browser cache straight away, over a fast connection once the page is idle, and
  // otherwise as soon as the user shows intent (hovering the drop zone, dragging a file...).
  function warmModels(force) {
    tierKeys().forEach((k) => {
      const s = state.models[k];
      if (force || (s && s.state === 'idle')) N.prepare(k).catch(() => {});
    });
  }
  function fastConnection() {
    const c = navigator.connection;
    if (c) {
      if (c.saveData) return false;
      if (/(^|-)2g$|^3g$/.test(c.effectiveType || '')) return false;
      if (c.type === 'cellular') return false;
      return true;
    }
    // No Network Information API (Safari, Firefox): assume desktops are on a decent link.
    return !!(window.matchMedia && matchMedia('(pointer: fine)').matches);
  }
  async function initModels() {
    if (!tierKeys().length) return;
    const cached = await Promise.all(tierKeys().map((k) => N.isCached(k)));
    const roomy = (navigator.deviceMemory || 8) >= 4;
    if (cached.every(Boolean) && roomy) return warmModels(); // instant: read from disk
    if (store.get('preload', '1') === '1' && fastConnection()) {
      const go = () => warmModels();
      setTimeout(() => (window.requestIdleCallback ? requestIdleCallback(go, { timeout: 4000 }) : go()), 1800);
    }
  }

  N.onStatus((snap) => {
    state.models = snap;
    renderPill();
    renderModelStatus();
    renderDownload();
  });

  function tierProgress() {
    const keys = tierKeys();
    const ms = keys.map((k) => state.models[k]);
    const loaded = ms.reduce((s, m) => s + (m.state === 'ready' ? m.total : m.loaded), 0);
    const total = ms.reduce((s, m) => s + m.total, 0);
    return { keys, ms, loaded, total, frac: total ? loaded / total : 0 };
  }

  function renderPill() {
    const pill = $('#modelPill');
    const { keys, ms, total, frac } = tierProgress();
    let st;
    let text;
    let tip;
    if (!keys.length) {
      st = 'off';
      text = 'Neural off';
      tip = 'Neural networks are switched off in settings. Metadata and forensic checks still run.';
    } else if (ms.every((m) => m.state === 'ready')) {
      st = 'ready';
      text = 'Models ready';
      tip = 'The neural networks are loaded. Every check runs entirely on your device.';
    } else if (ms.some((m) => m.state === 'error')) {
      st = 'error';
      text = 'Models offline';
      tip = 'The neural networks could not be downloaded. Checks still run without them. Click to retry.';
    } else if (ms.some((m) => m.downloading)) {
      st = 'loading';
      text = `Models ${Math.floor(frac * 100)}%`;
      tip = `Downloading the neural networks once (${mb(total)} MB). Your browser keeps them for next time.`;
    } else if (ms.some((m) => m.state === 'loading')) {
      st = 'starting';
      text = 'Starting models';
      tip = 'Starting the neural networks…';
    } else {
      st = 'idle';
      text = 'Load models';
      tip = `The neural networks (${mb(total)} MB) download on first use. Click to get them now.`;
    }
    pill.dataset.state = st;
    const ring = st === 'ready' ? 100 : st === 'loading' ? Math.max(3, Math.round(frac * 100)) : st === 'starting' ? 30 : 0;
    pill.querySelector('.mp-fill').style.strokeDashoffset = String(100 - ring);
    $('#modelPillText').textContent = text;
    pill.setAttribute('data-tip', tip);
    pill.setAttribute('aria-label', `${text}. ${tip}`);
    const glyph = pill.querySelector('.mp-glyph');
    const want = st === 'ready' ? 'check' : st === 'error' ? 'alert' : st === 'off' ? 'minus' : st === 'idle' ? 'download' : '';
    if (glyph.dataset.icon !== want) {
      glyph.dataset.icon = want;
      glyph.innerHTML = want ? I(want) : '';
    }
  }

  $('#modelPill').addEventListener('click', () => {
    const st = $('#modelPill').dataset.state;
    if (st === 'idle' || st === 'error') {
      warmModels(true);
      UI.toast(`Downloading the neural networks (${mb(tierProgress().total)} MB) — your browser keeps them for next time.`);
    } else openSettings();
  });

  // ------------------------------------------------------------------ input
  const dz = $('#dropzone');
  const input = $('#fileInput');
  const OK_EXT = /\.(jpe?g|jfif|png|webp|gif|avif|heic|heif|bmp|tiff?|mp4|m4v|mov|webm|mkv|3gp|avi)$/i;
  const openPicker = () => {
    warmModels();
    input.click();
  };

  dz.addEventListener('click', (e) => {
    const r = dz.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2;
    const rip = document.createElement('span');
    rip.className = 'dz-ripple';
    rip.style.width = rip.style.height = size + 'px';
    rip.style.left = e.clientX - r.left + 'px';
    rip.style.top = e.clientY - r.top + 'px';
    dz.appendChild(rip);
    setTimeout(() => rip.remove(), 700);
    openPicker();
  });
  dz.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openPicker();
    }
  });
  dz.addEventListener('pointerenter', () => warmModels());
  dz.addEventListener('focus', () => warmModels());
  dz.addEventListener('pointermove', (e) => {
    const r = dz.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    dz.style.setProperty('--mx', x + 'px');
    dz.style.setProperty('--my', y + 'px');
  });
  input.addEventListener('change', () => {
    if (input.files && input.files.length) handle(input.files);
    input.value = '';
  });

  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') >= 0;
  const hideDrag = () => {
    $('#dragOverlay').hidden = true;
    dz.classList.remove('is-over');
  };
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    warmModels();
    $('#dragOverlay').hidden = false;
    dz.classList.add('is-over');
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) hideDrag();
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    hideDrag();
    handle(e.dataTransfer.files);
  });
  window.addEventListener('paste', (e) => {
    const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
    if (files.length) {
      e.preventDefault();
      handle(files);
    }
  });

  function handle(files) {
    const list = Array.from(files || []);
    const file = list.find((f) => /^(image|video)\//.test(f.type) || OK_EXT.test(f.name)) || list[0];
    if (!file) return;
    if (state.busy) {
      UI.toast('An analysis is already running — please wait a moment.');
      return;
    }
    if (list.length > 1) UI.toast('Analysing the first file. Drop files one at a time.');
    if (file.size > 4 * 1024 * 1024 * 1024) {
      showError('This file is larger than 4 GB, which is more than a browser can handle.');
      return;
    }
    analyse(file);
  }

  // ------------------------------------------------------------------ live analysis view
  const FACTS = [
    'Many AI services — OpenAI, Adobe Firefly and Microsoft among them — sign their images with Content Credentials (C2PA), a tamper-evident record of how the file was made.',
    'Screenshots, messaging apps and social networks strip most metadata. That is why TrueFrame also studies the pixels themselves.',
    'Image generators enlarge pictures in 2× steps. That can leave a faint grid of peaks every 8 pixels in the frequency spectrum.',
    'A camera sensor sees each pixel through a red, green or blue filter. Rebuilding full colour leaves a tell-tale pattern between neighbouring pixels that generators rarely imitate.',
    'Real photos carry sensor grain everywhere — even in a clear blue sky. Generated images are often unnaturally clean in flat areas.',
    'AI images can still slip up on small text, hands, reflections and repeating patterns such as fences or tiles. Zoom in on those.',
    'Neural detectors learn from examples, so a brand-new generator can fool them until they are retrained. That is why TrueFrame combines six layers.',
    'Popular generators output standard sizes such as 1024 × 1024. Cameras produce sensor sizes like 4032 × 3024.',
    'A “real” verdict is not proof that an image is truthful: real photos can be edited, staged or taken out of context.',
    'Everything you see here is computed on your own device. Your file is never uploaded.',
  ];
  const facts = { i: Math.floor(Math.random() * FACTS.length), timer: null };
  function showFact(i) {
    facts.i = (i + FACTS.length) % FACTS.length;
    const el = $('#factText');
    el.classList.remove('in');
    void el.offsetWidth;
    el.textContent = FACTS[facts.i];
    el.classList.add('in');
    const bar = $('#factTimer');
    bar.classList.remove('run');
    void bar.offsetWidth;
    bar.classList.add('run');
  }
  function startFacts() {
    stopFacts();
    showFact(facts.i + 1);
    facts.timer = setInterval(() => showFact(facts.i + 1), 8000);
  }
  function stopFacts() {
    clearInterval(facts.timer);
    facts.timer = null;
  }
  $('#factNext').addEventListener('click', () => {
    if (facts.timer) startFacts();
    else showFact(facts.i + 1);
  });

  // HUD: elapsed timer + sampling probes over the image
  const fx = { raf: 0, probe: 0, t0: 0 };
  function startHud() {
    stopHud();
    fx.t0 = performance.now();
    const timer = $('#hudTimer');
    // 10 updates a second is all a tenths-of-a-second display needs
    fx.raf = setInterval(() => {
      if (timer) timer.textContent = ((performance.now() - fx.t0) / 1000).toFixed(1) + ' s';
    }, 100);
    if (RM()) return;
    fx.probe = setInterval(() => {
      const media = $('#liveMedia');
      const el = media && media.querySelector('img, video');
      const layer = media && media.querySelector('.probes');
      if (!el || !layer || layer.childElementCount > 7) return;
      const mr = media.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) return;
      const s = 16 + Math.random() * 26;
      const p = document.createElement('i');
      p.style.width = p.style.height = s + 'px';
      p.style.left = r.left - mr.left + Math.random() * (r.width - s) + 'px';
      p.style.top = r.top - mr.top + Math.random() * (r.height - s) + 'px';
      layer.appendChild(p);
      setTimeout(() => p.remove(), 1100);
    }, 240);
  }
  function stopHud() {
    clearInterval(fx.raf);
    clearInterval(fx.probe);
  }

  function buildLive(file, kind, url) {
    const media = $('#liveMedia');
    media.innerHTML = '';
    media.classList.remove('thud');
    if (kind === 'video') {
      const v = document.createElement('video');
      Object.assign(v, { src: url, muted: true, autoplay: true, loop: true, playsInline: true });
      v.className = 'live-el';
      v.addEventListener('error', () => (v.outerHTML = `<div class="lab-empty">${I('video')}<p>Preview not available</p></div>`));
      media.appendChild(v);
    } else {
      const img = new Image();
      img.alt = 'The file being analysed';
      img.className = 'live-el';
      img.src = url;
      img.addEventListener('error', () => (img.outerHTML = `<div class="lab-empty">${I('image')}<p>Preview not available in this browser</p></div>`));
      media.appendChild(img);
    }
    media.insertAdjacentHTML(
      'beforeend',
      `<div class="probes" aria-hidden="true"></div>
       <div class="scan" aria-hidden="true"><span class="scanline"></span></div>
       <div class="hud" aria-hidden="true"><i class="hud-c tl"></i><i class="hud-c tr"></i><i class="hud-c bl"></i><i class="hud-c br"></i>
         <span class="hud-readout"><span class="hud-dot"></span><span id="hudStep">Reading the file</span></span><span class="hud-timer" id="hudTimer">0.0 s</span></div>`
    );
    $('#liveViews').innerHTML = '<span class="live-views-empty">Forensic views will appear here as they are computed.</span>';
    $('#liveGaugeHost').innerHTML = UI.gaugeHTML('liveGauge', 'sm', 'Running');
    $('#liveTitle').textContent = kind === 'video' ? 'Checking your video…' : 'Checking your image…';
    $('#liveFile').textContent = `${file.name || 'Pasted file'} · ${U.formatBytes(file.size)}`;
    $('#liveEstimate').textContent = 'A running estimate appears as evidence comes in.';
    const steps = TF.detector.plan(kind);
    $('#stepsList').innerHTML = steps
      .map((s) => `<li class="step" data-step="${s.id}"><span class="step-icon"></span><span><span class="step-label">${esc(s.label)}</span><span class="step-detail"></span></span></li>`)
      .join('');
    state.stepTotal = steps.length;
    $('#feed').innerHTML = '';
    $('#feedEmpty').hidden = false;
    $('#feedCount').textContent = '';
    $('#live').classList.remove('is-done');
    setProgress(0);
    state.live = { shownSignals: new Set(), shownViews: new Set(), kind, speed: [] };
    state.guess = null;
    renderGuess();
    $('#dlPanel').hidden = true;
    $('#liveHint').textContent =
      'Everything runs on your device — nothing is uploaded. ' +
      (!tierKeys().length ? 'Neural models are turned off in settings.' : tierProgress().ms.every((m) => m.state === 'ready') ? 'The neural networks are loaded and ready.' : `The first check downloads the neural networks once (${mb(tierProgress().total)} MB).`);
  }

  function setProgress(f) {
    const pct = Math.round(U.clamp(f, 0, 1) * 100);
    $('#progressBar').style.width = pct + '%';
    $('#progress').setAttribute('aria-valuenow', String(pct));
  }

  function updateStep(id, status, detail) {
    const li = $(`.step[data-step="${id}"]`);
    if (!li) return;
    li.className = 'step is-' + status;
    const icon = status === 'error' ? 'alert' : status === 'skipped' ? 'minus' : 'check';
    li.querySelector('.step-icon').innerHTML = status === 'active' ? '' : I(icon);
    const d = li.querySelector('.step-detail');
    if (detail != null) d.textContent = detail;
    else if (status === 'active') d.textContent = '';
    if (status === 'active') {
      const hs = $('#hudStep');
      if (hs) hs.textContent = li.querySelector('.step-label').textContent;
    }
    const finished = $$('.step.is-done, .step.is-error, .step.is-skipped').length;
    setProgress((finished + (status === 'active' ? 0.4 : 0)) / state.stepTotal);
  }

  const VIEW_LABELS = { spectrum: 'Spectrum', noise: 'Noise map', ela: 'Error levels' };

  function onLiveUpdate(report) {
    const L = state.live;
    if (!L) return;
    const informative = report.signals.filter((s) => s.direction !== 'neutral');
    if (informative.length) {
      const f = TF.fusion.fuse(report.signals, report.kind);
      UI.gaugeSet($('#liveGauge'), f.p, f.verdict.tone, report.kind);
      $('#liveEstimate').textContent = `Running estimate: ${f.verdict.label} — from ${informative.length} finding${informative.length > 1 ? 's' : ''} so far.`;
    }
    const feed = $('#feed');
    for (const s of report.signals) {
      if (L.shownSignals.has(s) || s.direction === 'neutral') continue;
      L.shownSignals.add(s);
      $('#feedEmpty').hidden = true;
      const tag = s.direction === 'ai' ? 'AI' : 'Real';
      feed.insertAdjacentHTML('afterbegin', `<li class="dir-${s.direction}"><span class="ev-dot dot-${s.direction}"></span><span class="feed-t">${esc(s.title)}</span><span class="feed-tag">${tag}</span></li>`);
      while (feed.children.length > 6) feed.lastElementChild.remove();
    }
    $('#feedCount').textContent = L.shownSignals.size ? `${L.shownSignals.size} so far` : '';
    const views = $('#liveViews');
    const addView = (key, src, label) => {
      if (L.shownViews.has(key) || !src) return;
      L.shownViews.add(key);
      const empty = views.querySelector('.live-views-empty');
      if (empty) empty.remove();
      views.insertAdjacentHTML('beforeend', `<figure class="live-view"><img src="${src}" alt="${esc(label)}"><figcaption>${esc(label)}</figcaption></figure>`);
    };
    ['spectrum', 'noise', 'ela'].forEach((k) => addView(k, report.visuals[k], VIEW_LABELS[k]));
    (report.visuals.frames || []).slice(0, 5).forEach((fr, i) => addView('frame' + i, fr.thumb, fr.t.toFixed(1) + ' s'));
  }

  // model download panel (live view)
  function renderDownload() {
    const panel = $('#dlPanel');
    const L = state.live;
    if (!L) return;
    const { keys, ms, loaded, total } = tierProgress();
    const downloading = ms.some((m) => m.downloading);
    if (!downloading) {
      if (!panel.hidden && ms.every((m) => m.state !== 'loading')) panel.hidden = true;
      if (!panel.hidden) $('#dlMeta').textContent = 'Download complete — starting the networks…';
      return;
    }
    panel.hidden = false;
    $('#dlRows').innerHTML = keys
      .map((k) => {
        const m = state.models[k];
        const f = m.state === 'ready' ? 1 : m.total ? m.loaded / m.total : 0;
        return `<div class="dl-row"><span class="dl-name">${esc(N.MODELS[k].short)}</span><span class="dl-bar"><span style="width:${(f * 100).toFixed(1)}%"></span></span><span class="dl-pct">${m.state === 'ready' ? I('check') : Math.floor(f * 100) + '%'}</span></div>`;
      })
      .join('');
    const now = performance.now();
    L.speed.push([now, loaded]);
    while (L.speed.length > 2 && now - L.speed[0][0] > 4000) L.speed.shift();
    const [t0, b0] = L.speed[0];
    const rate = now - t0 > 600 ? ((loaded - b0) / (now - t0)) * 1000 : 0;
    const left = rate > 0 ? (total - loaded) / rate : 0;
    $('#dlMeta').textContent =
      `${mb(loaded)} of ${mb(total)} MB` +
      (rate > 0 ? ` · ${(rate / 1e6).toFixed(1)} MB/s · about ${left < 60 ? Math.max(1, Math.round(left)) + ' s' : Math.round(left / 60) + ' min'} left` : '') +
      ' · next time it starts instantly';
  }

  // guess game
  function renderGuess() {
    const box = $('#guess');
    $$('.guess-btn', box).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.g === state.guess)));
    box.classList.toggle('is-set', !!state.guess);
    $('#guessQ').innerHTML = state.guess
      ? `<strong>Locked in: ${state.guess === 'ai' ? 'AI' : 'real'}.</strong> Let's see if TrueFrame agrees…`
      : '<strong>Your call?</strong> Make a guess while TrueFrame looks.';
  }
  $('#guess').addEventListener('click', (e) => {
    const b = e.target.closest('.guess-btn');
    if (!b || !state.live) return;
    state.guess = state.guess === b.dataset.g ? null : b.dataset.g;
    renderGuess();
  });

  function guessOutcome(guess, tone) {
    if (!guess) return null;
    if (tone === 'uncertain') return { cls: 'meh', text: 'Too close to call' };
    return (guess === 'ai') === (tone === 'ai') ? { cls: 'ok', text: 'You called it!' } : { cls: 'miss', text: 'Not this time' };
  }

  // verdict reveal: a stamp lands on the image with a burst of sparks
  function burst(host, tone) {
    const col = { ai: 'var(--ai)', real: 'var(--real)', uncertain: 'var(--warn)' }[tone];
    const layer = document.createElement('div');
    layer.className = 'sparks';
    for (let i = 0; i < 30; i++) {
      const s = document.createElement('i');
      const a = Math.random() * Math.PI * 2;
      const d = 90 + Math.random() * 170;
      s.style.setProperty('--dx', (Math.cos(a) * d).toFixed(0) + 'px');
      s.style.setProperty('--dy', (Math.sin(a) * d).toFixed(0) + 'px');
      s.style.setProperty('--rot', Math.round(Math.random() * 540 - 270) + 'deg');
      s.style.background = i % 3 === 0 ? 'var(--accent)' : i % 5 === 0 ? 'var(--warn)' : col;
      s.style.animationDelay = Math.random() * 80 + 'ms';
      if (i % 2) s.classList.add('round');
      layer.appendChild(s);
    }
    host.appendChild(layer);
    setTimeout(() => layer.remove(), 1400);
  }

  async function reveal(report) {
    const f = report.fusion;
    const media = $('#liveMedia');
    stopHud();
    const g = guessOutcome(state.guess, f.verdict.tone);
    media.insertAdjacentHTML(
      'beforeend',
      `<div class="stamp tone-${f.verdict.tone}" aria-hidden="true"><span class="stamp-pct">${Math.round(f.p * 100)}%</span><span class="stamp-word">${esc(f.verdict.label)}</span>${g ? `<span class="stamp-guess ${g.cls}">${esc(g.text)}</span>` : ''}</div>`
    );
    $('#liveEstimate').textContent = `Result: ${f.verdict.label}.` + (g ? ' ' + g.text : '');
    if (RM()) return U.sleep(900);
    await U.sleep(260);
    media.classList.add('thud');
    burst(media, f.verdict.tone);
    await U.sleep(1500);
  }

  async function analyse(file) {
    state.busy = true;
    let url = null;
    try {
      const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
      const sn = TF.metadata.sniff(head, file);
      const kind = sn.kind || (/^video\//.test(file.type) ? 'video' : 'image');
      url = URL.createObjectURL(file);
      buildLive(file, kind, url);
      show('Analyzing');
      startHud();
      startFacts();
      const report = await TF.detector.analyze(file, { tier: state.tier, onStep: updateStep, onUpdate: onLiveUpdate });
      UI.gaugeSet($('#liveGauge'), report.fusion.p, report.fusion.verdict.tone, report.kind);
      $('#live').classList.add('is-done');
      setProgress(1);
      $('#dlPanel').hidden = true;
      await reveal(report);
      report.objectUrl = url;
      report.guess = state.guess;
      if (state.current && state.current.objectUrl) URL.revokeObjectURL(state.current.objectUrl);
      state.current = report;
      openReport(report);
    } catch (err) {
      console.error(err);
      if (url) URL.revokeObjectURL(url);
      showError(
        err instanceof TF.detector.UserError
          ? err.message
          : 'Something went wrong while reading this file. It may be damaged or in a format your browser cannot open. (' + ((err && err.message) || err) + ')'
      );
    } finally {
      state.busy = false;
      state.live = null;
      stopHud();
      stopFacts();
    }
  }

  function openReport(r) {
    UI.renderResult(r, {
      store,
      guess: r.guess,
      onBack: () => show('Idle'),
      onAgain: () => {
        show('Idle');
        openPicker();
      },
    });
    show('Result');
  }

  // ------------------------------------------------------------------ settings
  function renderTiers() {
    $('#tierList').innerHTML = Object.keys(N.TIERS)
      .map((k) => {
        const t = N.TIERS[k];
        return `<label class="tier"><input type="radio" name="tier" value="${k}" ${k === state.tier ? 'checked' : ''}><span class="tier-text"><strong>${esc(t.label)}${k === N.DEFAULT_TIER ? ' — recommended' : ''}</strong><small>${esc(t.note)}</small></span></label>`;
      })
      .join('');
  }
  function renderModelStatus() {
    const host = $('#modelStatus');
    if (!host || !$('#settingsDialog').open) return;
    const keys = tierKeys();
    if (!keys.length) {
      host.innerHTML = '';
      $('#dlNow').hidden = true;
      return;
    }
    const WORD = { idle: 'Not downloaded yet', loading: 'Loading…', ready: 'Ready', error: 'Unavailable' };
    host.innerHTML = keys
      .map((k) => {
        const m = state.models[k];
        const f = m.state === 'ready' ? 1 : m.total ? m.loaded / m.total : 0;
        const word = m.downloading ? `Downloading ${Math.floor(f * 100)}%` : WORD[m.state];
        return `<div class="ms-row is-${m.state}"><span class="ms-name">${esc(N.MODELS[k].name)} <span class="muted">· ${N.MODELS[k].mb} MB</span></span><span class="ms-word">${m.state === 'ready' ? I('check') : ''}${esc(word)}</span><span class="dl-bar"><span style="width:${(f * 100).toFixed(1)}%"></span></span></div>`;
      })
      .join('');
    const allReady = keys.every((k) => state.models[k].state === 'ready');
    const busy = keys.some((k) => state.models[k].state === 'loading');
    $('#dlNow').hidden = allReady;
    $('#dlNow').disabled = busy;
  }
  function openSettings() {
    renderTiers();
    $('#prefPreload').checked = store.get('preload', '1') === '1';
    $('#settingsDialog').showModal();
    renderModelStatus();
  }
  $('#tierList').addEventListener('change', (e) => {
    if (e.target && e.target.name === 'tier') {
      state.tier = e.target.value;
      store.set('tier', state.tier);
      UI.toast(`Neural networks: ${N.TIERS[state.tier].label}`);
      renderPill();
      renderModelStatus();
    }
  });
  $('#prefPreload').addEventListener('change', (e) => store.set('preload', e.target.checked ? '1' : '0'));
  $('#dlNow').addEventListener('click', () => warmModels(true));
  $('#settingsBtn').addEventListener('click', openSettings);

  // ------------------------------------------------------------------ landing effects
  function heroTypewriter() {
    const el = $('#heroSwap');
    if (!el || RM()) return;
    const words = ['made by AI', 'a deepfake', 'AI-generated', 'synthetic'];
    let wi = 0;
    let ci = words[0].length;
    let deleting = true;
    const tick = () => {
      if ($('#viewIdle').hidden || document.hidden) return setTimeout(tick, 900);
      const w = words[wi];
      if (deleting) {
        if (ci > 0) {
          el.textContent = w.slice(0, --ci);
          return setTimeout(tick, 38);
        }
        deleting = false;
        wi = (wi + 1) % words.length;
        return setTimeout(tick, 260);
      }
      const nw = words[wi];
      if (ci < nw.length) {
        el.textContent = nw.slice(0, ++ci);
        return setTimeout(tick, 75);
      }
      deleting = true;
      return setTimeout(tick, 2400);
    };
    setTimeout(tick, 2800);
  }

  function aurora() {
    const a = $('.aurora');
    if (!a || RM()) return;
    let raf = 0;
    window.addEventListener('pointermove', (e) => {
      if (raf || $('#viewIdle').hidden) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        a.style.setProperty('--px', (e.clientX / window.innerWidth - 0.5).toFixed(3));
        a.style.setProperty('--py', (e.clientY / window.innerHeight - 0.5).toFixed(3));
      });
    });
  }

  function scrollReveal() {
    const els = $$('.reveal');
    if (!('IntersectionObserver' in window) || RM()) {
      els.forEach((el) => el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add('in');
            io.unobserve(en.target);
          }
        }),
      { rootMargin: '0px 0px -8% 0px' }
    );
    els.forEach((el) => io.observe(el));
  }

  // ------------------------------------------------------------------ navigation
  $('#brandLink').addEventListener('click', (e) => {
    e.preventDefault();
    if (!state.busy) show('Idle');
  });
  $('#exploreLink').addEventListener('click', (e) => {
    e.preventDefault();
    $('#explore').scrollIntoView({ behavior: RM() ? 'auto' : 'smooth' });
  });
  $('#errorRetry').addEventListener('click', () => {
    show('Idle');
    openPicker();
  });

  // ------------------------------------------------------------------ init
  UI.hydrateIcons();
  UI.initTooltip();
  UI.renderExplorer($('#explorer'));
  setView('Idle', null);
  renderPill();
  heroTypewriter();
  aurora();
  scrollReveal();

  // Dev/testing hooks (served over http only): ?src=<same-origin path> analyses that file,
  // ?tier=off|light|standard overrides the neural setting for this visit.
  const q = new URLSearchParams(location.search);
  if (N.TIERS[q.get('tier')]) {
    state.tier = q.get('tier');
    renderPill();
  }
  initModels();
  const src = q.get('src');
  if (src && /^https?:$/.test(location.protocol) && /^\/?[\w\-./%·() ]+$/.test(src) && !/\.\./.test(src)) {
    fetch(src)
      .then((r) => r.blob())
      .then((b) => handle([new File([b], decodeURIComponent(src.split('/').pop()), { type: b.type })]))
      .catch((e) => console.warn('src load failed', e));
  }
})();
