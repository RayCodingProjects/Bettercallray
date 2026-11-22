/*
 * TrueFrame — neural-network ensemble.
 * Runs open-source AI-image detectors (ViT / Swin transformers fine-tuned on real vs
 * generated images) locally in the browser through Transformers.js + ONNX Runtime Web.
 *
 * Loading strategy (the models are the only large download):
 *  - 4-bit weights: ~117 MB for both models instead of ~180 MB at 8 bits, same accuracy on our
 *    test set (see calibration.js).
 *  - Each model loads in its own Web Worker, so both download and run in parallel and the page
 *    never freezes. Falls back to the main thread where workers are unavailable (file://).
 *  - Multi-threaded: sw.js makes the page cross-origin isolated, which lets ONNX Runtime use
 *    up to 4 CPU cores per model (~3× faster than one core, same scores). WebGPU was tested
 *    and rejected: barely faster on integrated graphics, and the Swin model's scores drift.
 *  - Weights are pinned to a model revision and cached by the browser (Cache API), so repeat
 *    visits start from disk. The UI can prefetch them before the first file is dropped.
 *  - Files come from the Hugging Face CDN, not from the site's own host: a static host such as
 *    GitHub Pages then serves only ~0.5 MB per visitor.
 * The user's files never leave the device.
 */
(function (root) {
  'use strict';
  const TF = (root.TrueFrame = root.TrueFrame || {});
  const U = TF.util;

  const LIB_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
  const DTYPE = 'q4';
  const FILE_SUFFIX = { q4: '_q4', q8: '_quantized', fp16: '_fp16', fp32: '' };

  // Resolve the worker next to this script (works from any page, including tests/).
  const WORKER_URL = (function () {
    try {
      const s = root.document && root.document.currentScript && root.document.currentScript.src;
      return s && /^https?:/.test(s) ? new URL('neural-worker.js', s).href : null;
    } catch (e) {
      return null;
    }
  })();

  // Evaluated candidates: SMOGY Swin (AUC 0.88) and ViT-Base (AUC 0.78) complement each other
  // (0.93 together). A distilled 15 MB ViT was also tested and dropped (AUC 0.61).
  const MODELS = {
    smogy: {
      key: 'smogy',
      id: 'onnx-community/SMOGY-Ai-images-detector-ONNX',
      revision: '3c65d8c3464715af0ae7bcd776740935a7d6217d',
      name: 'Swin detector (SMOGY)',
      short: 'Swin',
      bytes: { q4: 60042880, q8: 93195226 },
    },
    vit: {
      key: 'vit',
      id: 'onnx-community/ai-image-detection-ONNX',
      revision: 'e3cfe99f2841930a040a6281682c10c989965603',
      name: 'ViT-Base detector',
      short: 'ViT',
      bytes: { q4: 56757898, q8: 87333629 },
    },
  };
  const dtype = () => root.__tfDtype || DTYPE; // __tfDtype: evaluation-harness override
  const modelBytes = (key) => MODELS[key].bytes[dtype()] || MODELS[key].bytes.q8;
  Object.keys(MODELS).forEach((k) => Object.defineProperty(MODELS[k], 'mb', { get: () => Math.round(modelBytes(k) / 1e6), enumerable: true }));

  const TIERS = {
    off: { label: 'Off', models: [], note: 'Metadata and forensic checks only — nothing to download' },
    light: { label: 'Light', models: ['smogy'], note: `1 model · ${MODELS.smogy.mb} MB one-time download` },
    standard: { label: 'Standard', models: ['smogy', 'vit'], note: `2 models · ${MODELS.smogy.mb + MODELS.vit.mb} MB one-time download · most accurate` },
  };
  const DEFAULT_TIER = 'standard';
  const tierBytes = (tierKey) => ((TIERS[tierKey] || TIERS[DEFAULT_TIER]).models || []).reduce((s, k) => s + modelBytes(k), 0);

  // ------------------------------------------------------------------ status store
  // state: idle → loading (downloading / starting) → ready | error
  const status = {};
  // cached: null until known; reading weights from the browser cache also reports progress, so
  // only a model that is not cached counts as "downloading".
  Object.keys(MODELS).forEach((k) => (status[k] = { key: k, state: 'idle', loaded: 0, total: 0, files: {}, backend: null, error: null, cached: null }));
  const listeners = new Set();
  let notifyQueued = false;
  function notify() {
    if (notifyQueued) return;
    notifyQueued = true;
    setTimeout(() => {
      notifyQueued = false;
      const snap = snapshot();
      listeners.forEach((fn) => {
        try {
          fn(snap);
        } catch (e) {
          /* listener errors must not break loading */
        }
      });
    }, 80);
  }
  function snapshot() {
    const out = {};
    for (const k in status) {
      const s = status[k];
      out[k] = {
        key: k,
        state: s.state,
        loaded: s.loaded,
        total: s.total || modelBytes(k),
        backend: s.backend,
        error: s.error,
        cached: s.cached,
        downloading: s.state === 'loading' && s.cached === false && s.loaded > 0 && s.loaded < (s.total || modelBytes(k)) * 0.999,
      };
    }
    return out;
  }
  function onStatus(fn) {
    listeners.add(fn);
    fn(snapshot());
    return () => listeners.delete(fn);
  }
  function progressFor(key) {
    return (file, loaded, total) => {
      const s = status[key];
      s.files[file] = [loaded, total];
      let l = 0;
      let t = 0;
      let hasWeights = false;
      for (const f in s.files) {
        l += s.files[f][0];
        t += s.files[f][1];
        if (/\.onnx/.test(f)) hasWeights = true;
      }
      s.loaded = l;
      s.total = hasWeights ? t : t + modelBytes(key);
      notify();
    };
  }

  // ------------------------------------------------------------------ backends
  let libPromise = null;
  function loadLib() {
    if (!libPromise) {
      libPromise = import(LIB_URL)
        .then((T) => {
          T.env.allowLocalModels = false;
          let cacheOk = false;
          try {
            cacheOk = typeof caches !== 'undefined' && location.protocol !== 'file:';
          } catch (e) {
            cacheOk = false;
          }
          T.env.useBrowserCache = cacheOk;
          return T;
        })
        .catch((e) => {
          libPromise = null;
          throw e;
        });
    }
    return libPromise;
  }

  async function mainBackend(model, onProgress) {
    const T = await loadLib();
    const pipe = await T.pipeline('image-classification', model.id, {
      dtype: dtype(),
      device: 'wasm',
      revision: model.revision,
      progress_callback: (p) => {
        if (p && p.status === 'progress' && p.total) onProgress(p.file, p.loaded, p.total);
      },
    });
    return {
      kind: 'main',
      run: async (imageData) => {
        const img = new T.RawImage(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height, 4).rgb();
        const out = await pipe(img, { top_k: 5 });
        await U.yieldUI();
        return out;
      },
    };
  }

  // Rejects with { fallback: true } when the worker itself cannot start, so the caller can
  // retry on the main thread; a failure while loading the model is a real error.
  function workerBackend(model, onProgress) {
    return new Promise((resolve, reject) => {
      let w;
      try {
        w = new Worker(WORKER_URL, { type: 'module' });
      } catch (e) {
        reject({ fallback: true, error: e });
        return;
      }
      let alive = false;
      let ready = false;
      let rid = 0;
      const pending = new Map();
      const failAll = (msg) => {
        pending.forEach((p) => p.reject(new Error(msg)));
        pending.clear();
      };
      w.onerror = (ev) => {
        if (ev && ev.preventDefault) ev.preventDefault();
        const msg = (ev && ev.message) || 'worker error';
        if (!ready) {
          w.terminate();
          reject({ fallback: !alive, error: new Error(msg) });
        } else failAll(msg);
      };
      w.onmessage = (e) => {
        const m = e.data || {};
        if (m.type === 'alive') {
          alive = true;
          w.postMessage({ type: 'init', lib: LIB_URL, id: model.id, revision: model.revision, dtype: dtype() });
        } else if (m.type === 'progress') onProgress(m.file, m.loaded, m.total);
        else if (m.type === 'ready') {
          ready = true;
          resolve({
            kind: 'worker',
            run: (imageData) =>
              new Promise((res, rej) => {
                const id = ++rid;
                pending.set(id, { resolve: res, reject: rej });
                const buf = new Uint8ClampedArray(imageData.data).buffer;
                w.postMessage({ type: 'run', rid: id, width: imageData.width, height: imageData.height, buffer: buf }, [buf]);
              }),
          });
        } else if (m.type === 'fail') {
          w.terminate();
          reject({ fallback: false, error: new Error(m.message) });
        } else if (m.type === 'result') {
          const p = pending.get(m.rid);
          if (!p) return;
          pending.delete(m.rid);
          if (m.error) p.reject(new Error(m.error));
          else p.resolve(m.out);
        }
      };
    });
  }

  let persistAsked = false;
  function keepCache() {
    // Ask the browser not to evict the cached weights under storage pressure. Skipped in
    // Firefox, which shows a permission prompt for this.
    if (persistAsked) return;
    persistAsked = true;
    try {
      const S = navigator.storage;
      if (S && S.persist && !/firefox/i.test(navigator.userAgent)) S.persisted().then((p) => p || S.persist()).catch(() => {});
    } catch (e) {
      /* not supported */
    }
  }

  const ready = {};
  /** Starts downloading and initialising a model (idempotent). Resolves with its backend. */
  function prepare(key) {
    if (!ready[key]) {
      const m = MODELS[key];
      const s = status[key];
      Object.assign(s, { state: 'loading', loaded: 0, total: 0, files: {}, error: null });
      notify();
      if (s.cached !== true)
        isCached(key).then((c) => {
          if (s.state === 'loading') s.cached = c;
          notify();
        });
      const onProgress = progressFor(key);
      const start = WORKER_URL
        ? workerBackend(m, onProgress).catch((e) => {
            if (e && e.fallback) return mainBackend(m, onProgress);
            throw (e && e.error) || e;
          })
        : mainBackend(m, onProgress);
      ready[key] = start
        .then((b) => {
          Object.assign(s, { state: 'ready', backend: b.kind, loaded: s.total || modelBytes(key), cached: true });
          notify();
          keepCache();
          return b;
        })
        .catch((e) => {
          delete ready[key];
          Object.assign(s, { state: 'error', error: String((e && e.message) || e) });
          notify();
          throw e;
        });
    }
    return ready[key];
  }
  function prepareTier(tierKey) {
    const tier = TIERS[tierKey] || TIERS[DEFAULT_TIER];
    return Promise.all(tier.models.map((k) => prepare(k).catch(() => null)));
  }

  /** True when the weights of a model are already in the browser cache (no download needed). */
  async function isCached(key) {
    try {
      if (typeof caches === 'undefined' || location.protocol === 'file:') return false;
      const m = MODELS[key];
      const c = await caches.open('transformers-cache');
      const url = `https://huggingface.co/${m.id}/resolve/${m.revision}/onnx/model${FILE_SUFFIX[dtype()]}.onnx`;
      return !!(await c.match(url));
    } catch (e) {
      return false;
    }
  }

  // ------------------------------------------------------------------ inference
  const AI_RE = /fake|artificial|\bai\b|generated|synthetic|deepfake|machine|computer/i;
  const REAL_RE = /real|human|authentic|natural|realism|photo|genuine/i;
  function aiProbability(out) {
    const list = Array.isArray(out && out[0]) ? out[0] : out || [];
    let ai = 0;
    let real = 0;
    for (const r of list) {
      if (AI_RE.test(r.label)) ai += r.score;
      else if (REAL_RE.test(r.label)) real += r.score;
    }
    return ai + real > 0 ? ai / (ai + real) : null;
  }

  /**
   * A list of inputs that fills up over time (video frames as they are extracted), so the
   * networks can start on the first frame while the next ones are still being decoded.
   * push(input) as they arrive, end() when complete; `expected` sizes the progress display.
   */
  function createFeed(expected) {
    const items = [];
    let ended = false;
    let waiters = [];
    const wakeAll = () => {
      const w = waiters;
      waiters = [];
      w.forEach((fn) => fn());
    };
    return {
      items,
      expected: expected || 0,
      push(x) {
        items.push(x);
        wakeAll();
      },
      end() {
        ended = true;
        wakeAll();
      },
      async get(i) {
        while (i >= items.length && !ended) await new Promise((r) => waiters.push(r));
        return i < items.length ? items[i] : null;
      },
    };
  }

  /**
   * Runs every model of the tier on every input (models in parallel) and averages per model in
   * logit space.
   * inputs: [{ data: ImageData }] or a feed from createFeed()
   * onStatus(text, fraction)
   */
  async function run(tierKey, inputs, onProgressText) {
    const tier = TIERS[tierKey] || TIERS[DEFAULT_TIER];
    const keys = tier.models;
    const feed = Array.isArray(inputs) ? null : inputs;
    const count = () => (feed ? Math.max(feed.expected, feed.items.length) : inputs.length);
    const done = {};
    keys.forEach((k) => (done[k] = 0));
    const say = () => {
      if (!onProgressText) return;
      const total = keys.length * count();
      const finished = keys.reduce((s, k) => s + done[k], 0);
      const loading = keys.filter((k) => status[k].state === 'loading');
      const fetching = loading.filter((k) => status[k].cached === false);
      let text;
      if (loading.length) {
        const l = fetching.reduce((s, k) => s + status[k].loaded, 0);
        const t = fetching.reduce((s, k) => s + (status[k].total || modelBytes(k)), 0);
        text = l > 0 && l < t * 0.999 ? `Downloading the models (${Math.round((l / t) * 100)}% of ${Math.round(t / 1e6)} MB, one-time)` : 'Starting the models';
      } else text = `Running ${keys.length > 1 ? keys.length + ' networks' : 'the network'}${total > keys.length ? ` (${finished}/${total})` : ''}`;
      onProgressText(text, total ? finished / total : 0);
    };
    const off = onStatus(say);
    try {
      const models = await Promise.all(
        keys.map(async (key) => {
          const m = MODELS[key];
          try {
            const b = await prepare(key);
            const ps = [];
            for (let i = 0; ; i++) {
              const inp = feed ? await feed.get(i) : inputs[i];
              if (!inp) break;
              ps.push(aiProbability(await b.run(inp.data)));
              done[key]++;
              say();
            }
            const valid = ps.filter((x) => x != null);
            const p = valid.length ? U.sigmoid(U.mean(valid.map((x) => U.clamp(U.logit(x), -6, 6)))) : null;
            return { key, name: m.name, p, perInput: ps };
          } catch (e) {
            return { key, name: m.name, p: null, error: String((e && e.message) || e) };
          }
        })
      );
      return { tier: tierKey, models };
    } finally {
      off();
    }
  }

  TF.neural = { MODELS, TIERS, DEFAULT_TIER, run, createFeed, prepare, prepareTier, isCached, onStatus, status: snapshot, tierBytes, loadLib, aiProbability };
})(typeof window !== 'undefined' ? window : globalThis);
