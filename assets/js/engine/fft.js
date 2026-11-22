/*
 * TrueFrame — radix-2 FFT (1-D and 2-D) used by the frequency-domain forensics.
 */
(function (root) {
  'use strict';
  const TF = (root.TrueFrame = root.TrueFrame || {});

  const tables = new Map();
  function getTables(n) {
    let t = tables.get(n);
    if (t) return t;
    const half = n >> 1;
    const cos = new Float64Array(half);
    const sin = new Float64Array(half);
    for (let i = 0; i < half; i++) {
      cos[i] = Math.cos((2 * Math.PI * i) / n);
      sin[i] = -Math.sin((2 * Math.PI * i) / n);
    }
    const rev = new Uint32Array(n);
    const bits = Math.round(Math.log2(n));
    for (let i = 0; i < n; i++) {
      let r = 0;
      let x = i;
      for (let b = 0; b < bits; b++) {
        r = (r << 1) | (x & 1);
        x >>= 1;
      }
      rev[i] = r;
    }
    t = { cos, sin, rev };
    tables.set(n, t);
    return t;
  }

  // In-place forward FFT. re/im are Float64Arrays of power-of-two length.
  function fft1(re, im) {
    const n = re.length;
    const { cos, sin, rev } = getTables(n);
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tr = re[l] * cos[k] - im[l] * sin[k];
          const ti = re[l] * sin[k] + im[l] * cos[k];
          re[l] = re[j] - tr;
          im[l] = im[j] - ti;
          re[j] += tr;
          im[j] += ti;
        }
      }
    }
  }

  // In-place 2-D FFT of an n×n row-major array.
  function fft2(re, im, n) {
    const rr = new Float64Array(n);
    const ri = new Float64Array(n);
    for (let y = 0; y < n; y++) {
      const o = y * n;
      for (let x = 0; x < n; x++) {
        rr[x] = re[o + x];
        ri[x] = im[o + x];
      }
      fft1(rr, ri);
      for (let x = 0; x < n; x++) {
        re[o + x] = rr[x];
        im[o + x] = ri[x];
      }
    }
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) {
        rr[y] = re[y * n + x];
        ri[y] = im[y * n + x];
      }
      fft1(rr, ri);
      for (let y = 0; y < n; y++) {
        re[y * n + x] = rr[y];
        im[y * n + x] = ri[y];
      }
    }
  }

  const hannCache = new Map();
  function hann(n) {
    let w = hannCache.get(n);
    if (w) return w;
    w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    hannCache.set(n, w);
    return w;
  }

  TF.fft = { fft1, fft2, hann };
})(typeof window !== 'undefined' ? window : globalThis);
