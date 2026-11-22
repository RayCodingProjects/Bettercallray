/*
 * TrueFrame — shared utilities.
 * Every engine file is a classic script that attaches to the global `TrueFrame`
 * namespace, so the site also works when index.html is opened straight from disk.
 */
(function (root) {
  'use strict';
  const TF = (root.TrueFrame = root.TrueFrame || {});
  const U = (TF.util = {});

  U.clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  U.sigmoid = (x) => 1 / (1 + Math.exp(-x));
  U.logit = (p) => {
    const q = U.clamp(p, 1e-4, 1 - 1e-4);
    return Math.log(q / (1 - q));
  };
  U.lerp = (a, b, t) => a + (b - a) * t;
  // Maps x from [a,b] onto [0,1], clamped.
  U.ramp = (x, a, b) => U.clamp((x - a) / (b - a), 0, 1);

  U.yieldUI = () => new Promise((r) => setTimeout(r, 0));
  U.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  U.mean = (a) => {
    if (!a.length) return NaN;
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i];
    return s / a.length;
  };
  U.std = (a) => {
    if (a.length < 2) return 0;
    const m = U.mean(a);
    let s = 0;
    for (let i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return Math.sqrt(s / (a.length - 1));
  };
  U.percentile = (a, p) => {
    if (!a.length) return NaN;
    const s = Array.from(a).sort((x, y) => x - y);
    const idx = (s.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return s[lo] + (s[hi] - s[lo]) * (idx - lo);
  };
  U.median = (a) => U.percentile(a, 0.5);
  U.mad = (a) => {
    const m = U.median(a);
    return U.median(Array.from(a, (v) => Math.abs(v - m)));
  };
  U.uniq = (a) => Array.from(new Set(a.filter((x) => x != null && x !== '')));

  U.formatBytes = (n) => {
    if (!isFinite(n)) return '';
    if (n < 1024) return n + ' B';
    const units = ['KB', 'MB', 'GB'];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + ' ' + units[i];
  };
  U.formatDuration = (s) => {
    if (!isFinite(s)) return 'unknown length';
    if (s < 60) return s.toFixed(s < 10 ? 1 : 0) + ' s';
    const m = Math.floor(s / 60);
    const r = Math.round(s % 60);
    return m + ' min ' + (r ? r + ' s' : '');
  };

  // ---------- bytes & strings ----------
  U.view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);

  U.latin1 = (bytes, start = 0, end = bytes.length) => {
    let out = '';
    const CH = 0x8000;
    end = Math.min(end, bytes.length);
    for (let i = start; i < end; i += CH) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(end, i + CH)));
    }
    return out;
  };

  const decoders = {};
  const decoder = (label, fatal) => {
    const key = label + (fatal ? '!' : '');
    if (!decoders[key]) decoders[key] = new TextDecoder(label, { fatal: !!fatal });
    return decoders[key];
  };
  U.utf8 = (bytes) => decoder('utf-8').decode(bytes);
  U.utf16 = (bytes, littleEndian) => decoder(littleEndian ? 'utf-16le' : 'utf-16be').decode(bytes);
  // UTF-8 when the bytes are valid UTF-8, Latin-1 otherwise (PNG tEXt is
  // nominally Latin-1 but many generators write UTF-8 into it).
  U.smartText = (bytes) => {
    try {
      return decoder('utf-8', true).decode(bytes);
    } catch (e) {
      return U.latin1(bytes);
    }
  };

  U.ascii = (s) => {
    const a = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff;
    return a;
  };
  U.startsWith = (bytes, s, offset = 0) => {
    if (bytes.length < offset + s.length) return false;
    for (let i = 0; i < s.length; i++) if (bytes[offset + i] !== (s.charCodeAt(i) & 0xff)) return false;
    return true;
  };
  U.findBytes = (hay, needle, from = 0, to = hay.length) => {
    const n = needle.length;
    if (!n) return -1;
    const first = needle[0];
    const last = Math.min(to, hay.length) - n;
    outer: for (let i = from; i <= last; i++) {
      if (hay[i] !== first) continue;
      for (let j = 1; j < n; j++) if (hay[i + j] !== needle[j]) continue outer;
      return i;
    }
    return -1;
  };
  U.concat = (parts) => {
    let n = 0;
    for (const p of parts) n += p.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };
  U.hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

  // Readable text runs inside binary data (bytes >= 0x80 are allowed so UTF-8
  // names such as "DALL·E" survive).
  U.printableStrings = (bytes, minLen = 4, limit = 20000) => {
    const out = [];
    let start = -1;
    for (let i = 0; i <= bytes.length; i++) {
      const b = i < bytes.length ? bytes[i] : 0;
      const ok = (b >= 0x20 && b !== 0x7f) || b === 0x09 || b === 0x0a || b === 0x0d;
      if (ok) {
        if (start < 0) start = i;
      } else if (start >= 0) {
        if (i - start >= minLen) {
          out.push(U.smartText(bytes.subarray(start, i)));
          if (out.length >= limit) break;
        }
        start = -1;
      }
    }
    return out;
  };

  // Deterministic PRNG (mulberry32) so analyses are reproducible.
  U.rng = (seed) => {
    let s = seed | 0;
    return () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  U.escapeHtml = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  U.truncate = (s, n) => {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };
  U.pct = (p) => Math.round(p * 100) + '%';
})(typeof window !== 'undefined' ? window : globalThis);
