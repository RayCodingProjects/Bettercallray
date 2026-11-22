/*
 * TrueFrame — neural-network worker.
 * Hosts one detector model off the main thread, so the interface stays smooth while it
 * downloads and runs, and so several models can download and run in parallel.
 * Started by neural.js; written without static imports so it also loads as a classic worker.
 */
let T = null;
let pipe = null;

self.onmessage = async (e) => {
  const m = e.data || {};
  if (m.type === 'init') {
    try {
      T = await import(m.lib);
      T.env.allowLocalModels = false;
      T.env.useBrowserCache = typeof caches !== 'undefined';
      pipe = await T.pipeline('image-classification', m.id, {
        dtype: m.dtype,
        device: 'wasm',
        revision: m.revision,
        progress_callback: (p) => {
          if (p && p.status === 'progress' && p.total) self.postMessage({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total });
        },
      });
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'fail', message: String((err && err.message) || err) });
    }
    return;
  }
  if (m.type === 'run') {
    try {
      const img = new T.RawImage(new Uint8ClampedArray(m.buffer), m.width, m.height, 4).rgb();
      const out = await pipe(img, { top_k: 5 });
      self.postMessage({ type: 'result', rid: m.rid, out });
    } catch (err) {
      self.postMessage({ type: 'result', rid: m.rid, error: String((err && err.message) || err) });
    }
  }
};

self.postMessage({ type: 'alive' });
