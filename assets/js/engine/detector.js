/*
 * TrueFrame — analysis pipeline. Runs every layer on a File and returns a report:
 *   { kind, file, meta, forensics, neural, signals[], fusion, visuals, warnings, timings }
 */
(function (root) {
  'use strict';
  const TF = (root.TrueFrame = root.TrueFrame || {});
  const U = TF.util;

  const STEPS = {
    image: [
      { id: 'meta', label: 'Reading metadata & file structure' },
      { id: 'provenance', label: 'Checking Content Credentials & AI labels' },
      { id: 'decode', label: 'Decoding pixels' },
      { id: 'frequency', label: 'Frequency analysis (FFT)' },
      { id: 'sensor', label: 'Camera-sensor & noise forensics' },
      { id: 'neural', label: 'Neural-network ensemble' },
      { id: 'fusion', label: 'Weighing the evidence' },
    ],
    video: [
      { id: 'meta', label: 'Reading the video container' },
      { id: 'provenance', label: 'Checking Content Credentials & AI labels' },
      { id: 'frames', label: 'Extracting frames across the clip' },
      { id: 'neural', label: 'Neural analysis of every frame' },
      { id: 'fusion', label: 'Weighing the evidence' },
    ],
  };

  class UserError extends Error {}

  const FORMAT_NAMES = {
    jpeg: 'JPEG', png: 'PNG', webp: 'WebP', gif: 'GIF', heic: 'HEIC', avif: 'AVIF', tiff: 'TIFF', bmp: 'BMP',
    mp4: 'MP4', mov: 'MOV', webm: 'WebM', '3gp': '3GP', avi: 'AVI', image: 'Image', video: 'Video',
  };
  function formatName(meta) {
    if (meta.format === 'webp' && meta.webp) return meta.webp.lossless && !meta.webp.lossy ? 'WebP (lossless)' : 'WebP';
    return FORMAT_NAMES[meta.format] || String(meta.format || '').toUpperCase();
  }

  function provenanceLine(sigs) {
    const p = sigs.filter((s) => s.category === 'provenance');
    if (!p.length) return 'No credentials or AI labels found';
    return p.map((s) => s.title).join(' · ');
  }

  function stripSpectral(sp) {
    if (!sp) return null;
    const o = Object.assign({}, sp);
    delete o.vis;
    return o;
  }

  // Pixel forensics run in a Web Worker when possible (same code, identical results), so the
  // page stays responsive and the work overlaps with the neural networks and ELA.
  const FX_WORKER_URL = (function () {
    try {
      const s = root.document && root.document.currentScript && root.document.currentScript.src;
      return s && /^https?:/.test(s) && typeof Worker !== 'undefined' ? new URL('forensics-worker.js', s).href : null;
    } catch (e) {
      return null;
    }
  })();

  async function forensicsLocal(imageData, onSpectral) {
    const FX = TF.forensics;
    const src = FX.prepare(imageData);
    const spectral = await FX.spectral(src);
    onSpectral(spectral);
    await U.yieldUI();
    const blockiness = FX.blockiness(src);
    const cfa = FX.cfa(src);
    await U.yieldUI();
    const noise = FX.noise(src);
    const map = FX.residualMap(src, 1000);
    return { spectral, blockiness, cfa, noise, map };
  }

  /** getData() returns fresh RGBA ImageData of the analysis region (called again on fallback). */
  function runForensics(getData, onSpectral) {
    if (!FX_WORKER_URL) return forensicsLocal(getData(), onSpectral);
    return new Promise((resolve, reject) => {
      let w;
      try {
        w = new Worker(FX_WORKER_URL);
      } catch (e) {
        resolve(forensicsLocal(getData(), onSpectral));
        return;
      }
      let spectral;
      let gotSpectral = false;
      const fallback = () => {
        w.terminate();
        forensicsLocal(getData(), gotSpectral ? () => {} : onSpectral).then(resolve, reject);
      };
      w.onerror = (ev) => {
        if (ev && ev.preventDefault) ev.preventDefault();
        fallback();
      };
      w.onmessage = (e) => {
        const m = e.data || {};
        if (m.type === 'spectral') {
          spectral = m.spectral;
          gotSpectral = true;
          onSpectral(spectral);
        } else if (m.type === 'sensor') {
          w.terminate();
          resolve({ spectral, blockiness: m.blockiness, cfa: m.cfa, noise: m.noise, map: m.map });
        } else if (m.type === 'error') fallback();
      };
      const img = getData();
      w.postMessage({ w: img.width, h: img.height, buffer: img.data.buffer }, [img.data.buffer]);
    });
  }

  // ------------------------------------------------------------------ image

  async function analyzeImage(file, meta, report, tier, onStep, emit) {
    const IO = TF.imageops;
    const E = TF.evidence;

    onStep('provenance', 'active');
    const hadDims = !!(meta.width && meta.height);
    let msigs = E.metadataSignals(meta, {});
    report.signals.push(...msigs);
    emit();
    onStep('provenance', 'done', provenanceLine(msigs));

    onStep('decode', 'active');
    let bmp = null;
    try {
      bmp = await IO.decodeImage(file);
    } catch (e) {
      bmp = null;
    }
    if (!bmp) {
      report.warnings.push("Your browser can't decode this image format, so only its metadata was analysed. Convert it to JPEG or PNG for a full check.");
      onStep('decode', 'error', 'Format not supported by this browser');
      ['frequency', 'sensor', 'neural'].forEach((s) => onStep(s, 'skipped'));
      return;
    }
    const { w, h } = IO.sizeOf(bmp);
    report.file.width = w;
    report.file.height = h;
    if (!hadDims) {
      meta.width = w;
      meta.height = h;
      const fresh = E.metadataSignals(meta, {});
      report.signals = report.signals.filter((s) => msigs.indexOf(s) < 0).concat(fresh);
      msigs = fresh;
    }
    report.visuals.thumb = IO.thumbnail(bmp, 240, 0.8);

    // Native-resolution analysis canvas (resampling would erase forensic traces).
    let crop = null;
    if (w * h > 24e6) {
      const cw = Math.min(w, 4096);
      const ch = Math.min(h, 4096);
      crop = { x: (w - cw) >> 1, y: (h - ch) >> 1, w: cw, h: ch };
      report.warnings.push('Very large image: pixel forensics used the central 4096 × 4096 region.');
    }
    const canvas = IO.draw(bmp, crop ? { crop } : {});
    const aw = canvas.width;
    const ah = canvas.height;
    // The forensic maps cover the analysed region; keep a matching base image for overlays.
    report.visuals.mapAspect = aw / ah;
    if (crop) report.visuals.mapBase = IO.thumbnail(canvas, 1400, 0.85);
    onStep('decode', 'done', `${w} × ${h} px`);

    // Neural networks: start now (they run in their own workers) so they overlap with the
    // pixel forensics instead of waiting for them. One view of the image: a mirrored second
    // view was tested and made no difference to accuracy, at twice the cost.
    let neuralRun = null;
    if (tier === 'off') onStep('neural', 'skipped', 'Turned off in settings');
    else {
      onStep('neural', 'active', 'Preparing the model input');
      const f = IO.fit(w, h, 512);
      const inputs = [{ data: IO.imageData(IO.draw(bmp, { width: f.w, height: f.h })) }];
      neuralRun = TF.neural.run(tier, inputs, (txt) => onStep('neural', 'active', txt));
    }

    const fx = {};
    onStep('frequency', 'active');
    const forensics = runForensics(
      () => IO.imageData(canvas),
      (spectral) => {
        fx.spectral = spectral;
        if (spectral) report.visuals.spectrum = IO.gray8ToCanvas(spectral.vis, spectral.T, spectral.T).toDataURL('image/png');
        emit();
        onStep('frequency', 'done', spectral ? `${spectral.tiles} tiles × ${spectral.T} px FFT` : 'Image too small for this check');
        onStep('sensor', 'active');
      }
    );
    // Error-level analysis needs a canvas, so it runs here while the worker computes.
    await U.yieldUI();
    try {
      const big = aw * ah > 6e6;
      const ef = IO.fit(aw, ah, 2400);
      const elaSrc = big ? IO.draw(canvas, { width: ef.w, height: ef.h }) : canvas;
      const ela = await IO.ela(elaSrc, 0.9);
      if (ela) {
        const df = IO.fit(ela.width, ela.height, 1400);
        report.visuals.ela = IO.draw(ela, { width: df.w, height: df.h }).toDataURL('image/jpeg', 0.85);
      }
    } catch (e) {
      /* ELA is a visual aid only */
    }
    const fr = await forensics;
    fx.blockiness = fr.blockiness;
    fx.cfa = fr.cfa;
    fx.noise = fr.noise;
    const nm = fr.map;
    report.visuals.noise = IO.heatmap(nm.data, nm.width, nm.height, { lo: 0, hiPct: 0.985, gamma: 0.6 }).toDataURL('image/jpeg', 0.85);
    const q = E.reliability(meta, aw, ah);
    report.signals.push(...E.pixelSignals(fx, meta, { reliability: q }));
    report.forensics = { spectral: stripSpectral(fx.spectral), noise: fx.noise, cfa: fx.cfa, blockiness: fx.blockiness, reliability: q };
    emit();
    onStep('sensor', 'done', q < 0.99 ? `Weighted ×${q.toFixed(2)} for compression/size` : 'Full-strength evidence');

    if (neuralRun) {
      const res = await neuralRun;
      report.neural = res;
      const s = E.neuralSignal(res, { video: false });
      if (s) report.signals.push(s);
      emit();
      const ok = res.models.filter((m) => m.p != null);
      if (!ok.length) {
        report.warnings.push('The neural models could not be loaded (offline or blocked?). The verdict relies on the other checks only.');
        onStep('neural', 'error', 'Models unavailable — check your connection');
      } else onStep('neural', 'done', ok.map((m) => `${m.name}: ${U.pct(m.p)}`).join(' · '));
    }
    if (bmp.close) bmp.close();
  }

  // ------------------------------------------------------------------ video

  function waitEvent(el, ev, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        cleanup();
        reject(new Error('timeout: ' + ev));
      }, ms);
      const ok = () => {
        cleanup();
        resolve();
      };
      const bad = () => {
        cleanup();
        reject(new Error('media error'));
      };
      function cleanup() {
        clearTimeout(t);
        el.removeEventListener(ev, ok);
        el.removeEventListener('error', bad);
      }
      el.addEventListener(ev, ok);
      el.addEventListener('error', bad);
    });
  }

  function seek(video, t) {
    return new Promise((resolve) => {
      let done = false;
      const fin = () => {
        if (done) return;
        done = true;
        video.removeEventListener('seeked', fin);
        resolve();
      };
      video.addEventListener('seeked', fin);
      video.currentTime = t;
      setTimeout(fin, 6000);
    });
  }

  async function extractFrames(file, wanted, onEach) {
    const IO = TF.imageops;
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    try {
      const loaded = waitEvent(video, 'loadeddata', 20000);
      video.src = url;
      await loaded;
      let duration = video.duration;
      if (!isFinite(duration) || duration <= 0) {
        video.currentTime = 1e7;
        await seek(video, 1e7);
        duration = video.duration;
        if (!isFinite(duration)) duration = video.currentTime || 1;
      }
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) throw new Error('no decodable video track');
      const count = Math.max(1, Math.min(wanted, Math.ceil(duration * 2)));
      const frames = [];
      const fit = IO.fit(w, h, 1280);
      for (let i = 0; i < count; i++) {
        const t = Math.min(Math.max(0, duration - 0.05), (duration * (i + 0.5)) / count);
        await seek(video, t);
        const frame = { t, canvas: IO.draw(video, { width: fit.w, height: fit.h }) };
        frames.push(frame);
        if (onEach) onEach(i + 1, count, frame);
      }
      return { frames, duration, width: w, height: h };
    } finally {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    }
  }

  async function analyzeVideo(file, meta, report, tier, onStep, emit) {
    const IO = TF.imageops;
    const E = TF.evidence;
    onStep('provenance', 'active');
    const msigs = E.metadataSignals(meta, {});
    report.signals.push(...msigs);
    emit();
    onStep('provenance', 'done', provenanceLine(msigs));

    onStep('frames', 'active');
    // Frames go to the neural networks as soon as each one is decoded, so extraction and
    // inference overlap instead of running one after the other.
    const feed = tier === 'off' ? null : TF.neural.createFeed(10);
    const neuralRun = feed ? TF.neural.run(tier, feed, (txt) => onStep('neural', 'active', txt)) : null;
    if (feed) onStep('neural', 'active', 'Waiting for the first frame');
    let vid;
    try {
      vid = await extractFrames(file, 10, (i, n, frame) => {
        onStep('frames', 'active', `Frame ${i} of ${n}`);
        if (!feed) return;
        feed.expected = n;
        const s = IO.fit(frame.canvas.width, frame.canvas.height, 512);
        feed.push({ data: IO.imageData(IO.draw(frame.canvas, { width: s.w, height: s.h })) });
      });
    } catch (e) {
      if (feed) feed.end();
      report.signals.push(...E.videoSignals(meta, {}));
      report.warnings.push("Your browser can't decode this video's codec, so only the container metadata was analysed. Try an MP4 (H.264) or WebM copy.");
      onStep('frames', 'error', 'Codec not supported by this browser');
      onStep('neural', 'skipped');
      return;
    }
    if (feed) feed.end();
    report.file.width = vid.width;
    report.file.height = vid.height;
    report.file.duration = vid.duration;
    const mid = vid.frames[Math.floor(vid.frames.length / 2)];
    report.visuals.thumb = IO.thumbnail(mid.canvas, 240, 0.8);
    report.visuals.frames = vid.frames.map((f) => ({ t: f.t, thumb: IO.thumbnail(f.canvas, 220, 0.75), large: IO.thumbnail(f.canvas, 720, 0.82), p: null }));
    report.signals.push(...E.videoSignals(meta, { duration: vid.duration, width: vid.width, height: vid.height }));
    emit();
    onStep('frames', 'done', `${vid.frames.length} frames across ${U.formatDuration(vid.duration)}`);

    if (!neuralRun) {
      onStep('neural', 'skipped', 'Turned off in settings');
      return;
    }
    const inputs = feed.items;
    const res = await neuralRun;
    report.neural = res;
    report.visuals.frames.forEach((fr, i) => {
      const ps = res.models.map((m) => m.perInput && m.perInput[i]).filter((p) => p != null);
      fr.p = ps.length ? U.sigmoid(U.mean(ps.map((x) => U.clamp(U.logit(x), -6, 6)))) : null;
    });
    const s = E.neuralSignal(res, { video: true, frames: inputs.length });
    if (s) report.signals.push(s);
    emit();
    const fps = report.visuals.frames.map((f) => f.p).filter((p) => p != null);
    if (fps.length >= 4) {
      const hi = fps.filter((p) => p >= 0.6).length;
      const lo = fps.filter((p) => p <= 0.4).length;
      if (hi >= 2 && lo >= 2) {
        report.signals.push(E.sig({
          id: 'framemix', category: 'video', llr: 0,
          title: 'Frames disagree with each other',
          summary: `${hi} sampled frames look AI-generated and ${lo} look real. The clip may mix real footage with generated shots — check the frame timeline.`,
        }));
      }
    }
    const ok = res.models.filter((m) => m.p != null);
    if (!ok.length) {
      report.warnings.push('The neural models could not be loaded (offline or blocked?). The verdict relies on the other checks only.');
      onStep('neural', 'error', 'Models unavailable — check your connection');
    } else onStep('neural', 'done', ok.map((m) => `${m.name}: ${U.pct(m.p)}`).join(' · '));
  }

  // ------------------------------------------------------------------ entry

  async function analyze(file, opts = {}) {
    const onStep = opts.onStep || (() => {});
    const tier = TF.neural.TIERS[opts.tier] ? opts.tier : TF.neural.DEFAULT_TIER;
    const T0 = performance.now();
    const report = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      createdAt: new Date().toISOString(),
      file: { name: file.name || 'pasted file', size: file.size, type: file.type },
      signals: [],
      visuals: {},
      warnings: [],
      timings: {},
      tier,
    };
    onStep('meta', 'active');
    const meta = await TF.metadata.parse(file);
    if (!meta.kind) throw new UserError("This doesn't look like an image or a video. Try a JPG, PNG, WEBP, HEIC, MP4, MOV or WEBM file.");
    report.kind = meta.kind;
    report.meta = meta;
    report.file.format = formatName(meta);
    const dims = meta.width && meta.height ? ` · ${meta.width} × ${meta.height}` : '';
    onStep('meta', 'done', `${report.file.format}${dims} · ${U.formatBytes(file.size)}`);
    report.timings.meta = Math.round(performance.now() - T0);
    // Start downloading / initialising the neural networks now, in parallel with the other checks.
    if (tier !== 'off' && TF.neural.prepareTier) TF.neural.prepareTier(tier);

    // Live updates: lets the UI show a running estimate and new views as they are computed.
    const emit = () => {
      if (!opts.onUpdate) return;
      try {
        opts.onUpdate(report);
      } catch (e) {
        /* UI errors must not break the analysis */
      }
    };
    if (meta.kind === 'image') await analyzeImage(file, meta, report, tier, onStep, emit);
    else await analyzeVideo(file, meta, report, tier, onStep, emit);

    onStep('fusion', 'active');
    report.fusion = TF.fusion.fuse(report.signals, report.kind);
    onStep('fusion', 'done', report.fusion.verdict.label);
    report.timings.total = Math.round(performance.now() - T0);
    return report;
  }

  TF.detector = { analyze, plan: (kind) => STEPS[kind] || STEPS.image, STEPS, UserError, formatName };
})(typeof window !== 'undefined' ? window : globalThis);
