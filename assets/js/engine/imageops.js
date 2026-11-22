/*
 * TrueFrame — canvas helpers (browser only): decoding, resizing, heat-maps, ELA.
 */
(function (root) {
  'use strict';
  const TF = (root.TrueFrame = root.TrueFrame || {});
  const U = TF.util;
  const IO = (TF.imageops = {});

  IO.canvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  };
  IO.ctx = (c) => c.getContext('2d', { willReadFrequently: true });
  IO.fit = (w, h, max) => {
    const s = Math.min(1, max / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
  };

  // Decode without colour-space conversion so forensic checks see the stored values.
  IO.decodeImage = async (file) => {
    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(file, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      } catch (e) {
        /* fall through */
      }
      try {
        return await createImageBitmap(file);
      } catch (e) {
        /* fall through */
      }
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch (e) {
      URL.revokeObjectURL(url);
      throw new Error('decode');
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return img;
  };

  IO.sizeOf = (src) => ({
    w: src.naturalWidth || src.videoWidth || src.width,
    h: src.naturalHeight || src.videoHeight || src.height,
  });

  // Draw `src` (optionally cropped) to a new canvas of the requested size.
  IO.draw = (src, opts = {}) => {
    const s = IO.sizeOf(src);
    const crop = opts.crop || { x: 0, y: 0, w: s.w, h: s.h };
    const dw = opts.width || crop.w;
    const dh = opts.height || crop.h;
    const c = IO.canvas(dw, dh);
    const x = IO.ctx(c);
    if (opts.background !== false) {
      x.fillStyle = '#ffffff';
      x.fillRect(0, 0, c.width, c.height);
    }
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    if (opts.flip) {
      x.translate(c.width, 0);
      x.scale(-1, 1);
    }
    x.drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, c.width, c.height);
    return c;
  };
  IO.imageData = (c) => IO.ctx(c).getImageData(0, 0, c.width, c.height);

  IO.thumbnail = (src, max = 480, q = 0.82) => {
    const s = IO.sizeOf(src);
    const f = IO.fit(s.w, s.h, max);
    return IO.draw(src, { width: f.w, height: f.h }).toDataURL('image/jpeg', q);
  };

  // Single-hue sequential colour map for a light UI: near-white (low) → deep indigo (high).
  const STOPS = [
    [0, [250, 250, 252]],
    [0.2, [226, 222, 250]],
    [0.45, [168, 155, 240]],
    [0.7, [104, 88, 222]],
    [0.88, [64, 48, 170]],
    [1, [34, 22, 104]],
  ];
  IO.cmap = (t) => {
    t = U.clamp(t, 0, 1);
    for (let i = 1; i < STOPS.length; i++) {
      if (t <= STOPS[i][0]) {
        const [t0, a] = STOPS[i - 1];
        const [t1, b] = STOPS[i];
        const k = (t - t0) / (t1 - t0);
        return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
      }
    }
    return STOPS[STOPS.length - 1][1];
  };
  const LUT = Array.from({ length: 256 }, (_, i) => IO.cmap(i / 255));

  IO.heatmap = (values, w, h, opts = {}) => {
    const sample = [];
    const step = Math.max(1, Math.floor(values.length / 20000));
    for (let i = 0; i < values.length; i += step) sample.push(values[i]);
    const lo = opts.lo != null ? opts.lo : U.percentile(sample, 0.01);
    const hi = opts.hi != null ? opts.hi : U.percentile(sample, opts.hiPct || 0.99) || 1;
    const gamma = opts.gamma || 1;
    const c = IO.canvas(w, h);
    const x = IO.ctx(c);
    const img = x.createImageData(w, h);
    const d = img.data;
    for (let i = 0; i < w * h; i++) {
      const t = Math.pow(U.clamp((values[i] - lo) / (hi - lo || 1), 0, 1), gamma);
      const col = LUT[Math.round(t * 255)];
      d[i * 4] = col[0];
      d[i * 4 + 1] = col[1];
      d[i * 4 + 2] = col[2];
      d[i * 4 + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return c;
  };

  IO.gray8ToCanvas = (vis, w, h) => {
    const vals = new Float32Array(vis.length);
    for (let i = 0; i < vis.length; i++) vals[i] = vis[i];
    return IO.heatmap(vals, w, h, { lo: 0, hi: 255 });
  };

  // Error Level Analysis: re-save at a known JPEG quality and map the differences.
  IO.ela = async (canvas, quality = 0.9) => {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    if (!blob) return null;
    const bmp = await createImageBitmap(blob);
    const c2 = IO.draw(bmp, { width: canvas.width, height: canvas.height });
    const a = IO.imageData(canvas).data;
    const b = IO.imageData(c2).data;
    const n = canvas.width * canvas.height;
    const diff = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      diff[i] = Math.max(Math.abs(a[j] - b[j]), Math.abs(a[j + 1] - b[j + 1]), Math.abs(a[j + 2] - b[j + 2]));
    }
    return IO.heatmap(diff, canvas.width, canvas.height, { lo: 0, hiPct: 0.995, gamma: 0.7 });
  };
})(typeof window !== 'undefined' ? window : globalThis);
