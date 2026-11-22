/*
 * TrueFrame — pixel-level forensics. Pure functions over RGBA pixel arrays (no DOM),
 * so they can be unit-tested outside the browser.
 *
 *  spectral()   Fourier analysis of the high-pass residual. Latent-diffusion and GAN
 *               decoders upsample with stride-2 layers, which leaves periodic peaks on a
 *               regular grid in the spectrum (periods 8, 4 and 2 px).
 *  noise()      Sensor-noise floor and its consistency, estimated in flat regions
 *               (Immerkær's fast noise-variance estimator).
 *  cfa()        Colour-filter-array (Bayer) demosaicing traces. A real camera samples one
 *               colour per photosite and interpolates the rest, leaving a 2×2 periodic
 *               correlation that generated images do not have.
 *  blockiness() 8×8 JPEG block-grid strength (compression history).
 */
(function (root) {
  'use strict';
  const TF = (root.TrueFrame = root.TrueFrame || {});
  const U = TF.util;

  function prepare(imageData) {
    const w = imageData.width;
    const h = imageData.height;
    const rgba = imageData.data;
    const luma = new Float32Array(w * h);
    for (let i = 0, j = 0; i < luma.length; i++, j += 4) luma[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
    return { w, h, rgba, luma };
  }

  function positions(total, T, n) {
    if (n <= 1) return [Math.floor((total - T) / 2)];
    const out = [];
    for (let i = 0; i < n; i++) out.push(Math.round((i * (total - T)) / (n - 1)));
    return out;
  }

  // Centre crop rectangle no larger than max×max.
  function region(w, h, max) {
    const rw = Math.min(w, max);
    const rh = Math.min(h, max);
    return { x0: Math.floor((w - rw) / 2), y0: Math.floor((h - rh) / 2), rw, rh };
  }

  // ------------------------------------------------------------------ spectral

  async function spectral(src) {
    const { w, h, luma } = src;
    const minSide = Math.min(w, h);
    const T = minSide >= 1024 ? 512 : minSide >= 256 ? 256 : minSide >= 128 ? 128 : 0;
    if (!T) return null;
    const maxTiles = T === 512 ? 3 : 4;
    const xs = positions(w, T, Math.min(maxTiles, Math.max(1, Math.floor(w / T))));
    const ys = positions(h, T, Math.min(maxTiles, Math.max(1, Math.floor(h / T))));
    const N = T * T;
    const acc = new Float64Array(N);
    const accRaw = new Float64Array(N);
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    const win = TF.fft.hann(T);
    // The raw-luminance spectrum only feeds the spectral-decay check; skip its FFTs (half the
    // work of this step) while that check is disabled in calibration.js.
    const wantRaw = !TF.calibration || !TF.calibration.decay || TF.calibration.decay.enabled !== false;
    let used = 0;

    for (const y0 of ys) {
      for (const x0 of xs) {
        // --- high-pass residual (4-neighbour Laplacian)
        let sum = 0;
        let sum2 = 0;
        for (let y = 0; y < T; y++) {
          const gy = y0 + y;
          const up = (gy > 0 ? gy - 1 : 0) * w;
          const dn = (gy < h - 1 ? gy + 1 : gy) * w;
          const row = gy * w;
          for (let x = 0; x < T; x++) {
            const gx = x0 + x;
            const lf = gx > 0 ? gx - 1 : 0;
            const rt = gx < w - 1 ? gx + 1 : gx;
            const r = luma[row + gx] - 0.25 * (luma[row + lf] + luma[row + rt] + luma[up + gx] + luma[dn + gx]);
            re[y * T + x] = r;
            sum += r;
            sum2 += r * r;
          }
        }
        const mean = sum / N;
        const variance = sum2 / N - mean * mean;
        if (variance < 0.02) continue; // flat or clipped tile carries no information
        for (let y = 0; y < T; y++) {
          const wy = win[y];
          for (let x = 0; x < T; x++) {
            const k = y * T + x;
            re[k] = (re[k] - mean) * wy * win[x];
          }
        }
        im.fill(0);
        TF.fft.fft2(re, im, T);
        let tot = 0;
        for (let k = 1; k < N; k++) tot += re[k] * re[k] + im[k] * im[k];
        if (tot > 0) for (let k = 1; k < N; k++) acc[k] += (re[k] * re[k] + im[k] * im[k]) / tot;

        // --- raw luminance spectrum (for the spectral-decay profile)
        if (wantRaw) {
          let lm = 0;
          for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) lm += luma[(y0 + y) * w + x0 + x];
          lm /= N;
          for (let y = 0; y < T; y++) {
            const wy = win[y];
            for (let x = 0; x < T; x++) re[y * T + x] = (luma[(y0 + y) * w + x0 + x] - lm) * wy * win[x];
          }
          im.fill(0);
          TF.fft.fft2(re, im, T);
          let totR = 0;
          for (let k = 1; k < N; k++) totR += re[k] * re[k] + im[k] * im[k];
          if (totR > 0) for (let k = 1; k < N; k++) accRaw[k] += (re[k] * re[k] + im[k] * im[k]) / totR;
        }
        used++;
        await U.yieldUI();
      }
    }
    if (!used) return null;
    for (let k = 0; k < N; k++) {
      acc[k] /= used;
      accRaw[k] /= used;
    }
    acc[0] = acc[1];

    const at = (u, v) => acc[(((v % T) + T) % T) * T + (((u % T) + T) % T)];
    const ringBuf = [];
    function peakStat(u, v) {
      let peak = 0;
      for (let dv = -1; dv <= 1; dv++) for (let du = -1; du <= 1; du++) peak = Math.max(peak, at(u + du, v + dv));
      ringBuf.length = 0;
      for (let dv = -6; dv <= 6; dv++) {
        for (let du = -6; du <= 6; du++) {
          if (Math.max(Math.abs(du), Math.abs(dv)) >= 3) ringBuf.push(at(u + du, v + dv));
        }
      }
      ringBuf.sort((a, b) => a - b);
      const med = ringBuf[ringBuf.length >> 1];
      return Math.log10((peak + 1e-30) / (med + 1e-30));
    }

    // Grid points at multiples of T/8, classified by the shortest period that explains them.
    const step = T / 8;
    const groups = { p8: [], p8axis: [], p4: [], p4axis: [], p2: [], p2axis: [] };
    const grid = [];
    for (let l = 0; l < 8; l++) {
      for (let k = 0; k < 8; k++) {
        if (!k && !l) continue;
        const s = peakStat(k * step, l * step);
        const axis = k === 0 || l === 0;
        const p = k % 4 === 0 && l % 4 === 0 ? 'p2' : k % 2 === 0 && l % 2 === 0 ? 'p4' : 'p8';
        groups[p + (axis ? 'axis' : '')].push(s);
        grid.push({ k, l, s, period: p });
      }
    }
    // Control points: same statistic far from any T/16 grid node, to self-calibrate.
    const rnd = U.rng(1234);
    const ctrlOff = [];
    const ctrlAxis = [];
    const g16 = T / 16;
    const nearGrid = (c) => {
      const r = c % g16;
      return r < 4 || r > g16 - 4;
    };
    let tries = 0;
    while ((ctrlOff.length < 160 || ctrlAxis.length < 48) && tries++ < 20000) {
      const u = Math.floor(g16 + rnd() * (T - 2 * g16));
      const v = Math.floor(g16 + rnd() * (T - 2 * g16));
      if (ctrlOff.length < 160 && !(nearGrid(u) && nearGrid(v))) ctrlOff.push(peakStat(u, v));
      if (ctrlAxis.length < 48 && !nearGrid(u)) ctrlAxis.push(rnd() < 0.5 ? peakStat(u, 0) : peakStat(0, u));
    }
    const cOff = U.median(ctrlOff);
    const cAxis = U.median(ctrlAxis);
    const cOffHi = U.percentile(ctrlOff, 0.98);
    const cAxisHi = U.percentile(ctrlAxis, 0.98);
    const excess = (arr, base) => (arr.length ? U.mean(arr) - base : 0);
    const scores = {
      p8: excess(groups.p8, cOff),
      p8axis: excess(groups.p8axis, cAxis),
      p4: excess(groups.p4, cOff),
      p4axis: excess(groups.p4axis, cAxis),
      p2: excess(groups.p2, cOff),
      p2axis: excess(groups.p2axis, cAxis),
    };
    let strong = 0;
    for (const g of grid) if (g.s > ((g.k === 0 || g.l === 0) ? cAxisHi : cOffHi)) strong++;

    // Radial power profile of the raw image → spectral slope and high-frequency deviation.
    const half = T / 2;
    const rsum = new Float64Array(half + 1);
    const rcnt = new Float64Array(half + 1);
    for (let v = 0; v < T && wantRaw; v++) {
      const fv = v <= half ? v : v - T;
      for (let u = 0; u < T; u++) {
        const fu = u <= half ? u : u - T;
        const r = Math.round(Math.sqrt(fu * fu + fv * fv));
        if (r >= 1 && r <= half) {
          rsum[r] += accRaw[v * T + u];
          rcnt[r]++;
        }
      }
    }
    const lr = [];
    const lp = [];
    for (let r = Math.max(2, Math.round(T / 32)); r <= Math.round(T / 8); r++) {
      if (rcnt[r] && rsum[r] > 0) {
        lr.push(Math.log10(r));
        lp.push(Math.log10(rsum[r] / rcnt[r]));
      }
    }
    let slope = NaN;
    let icpt = NaN;
    if (lr.length > 3) {
      const mx = U.mean(lr);
      const my = U.mean(lp);
      let sxy = 0;
      let sxx = 0;
      for (let i = 0; i < lr.length; i++) {
        sxy += (lr[i] - mx) * (lp[i] - my);
        sxx += (lr[i] - mx) * (lr[i] - mx);
      }
      slope = sxy / sxx;
      icpt = my - slope * mx;
    }
    const dev = [];
    for (let r = Math.round(T / 4); r <= Math.round(0.45 * T); r++) {
      if (rcnt[r] && rsum[r] > 0) dev.push(Math.log10(rsum[r] / rcnt[r]) - (icpt + slope * Math.log10(r)));
    }
    const profile = [];
    for (let r = 1; r <= half; r++) profile.push(rcnt[r] ? Math.log10(rsum[r] / rcnt[r] + 1e-30) : null);

    // Visualisation: centred log spectrum of the residual, 8-bit.
    const vis = new Uint8ClampedArray(N);
    const logs = new Float32Array(N);
    for (let k = 0; k < N; k++) logs[k] = Math.log10(acc[k] + 1e-30);
    const sample = [];
    for (let k = 0; k < N; k += 7) sample.push(logs[k]);
    const lo = U.percentile(sample, 0.02);
    const hi = U.percentile(sample, 0.9995);
    for (let v = 0; v < T; v++) {
      for (let u = 0; u < T; u++) {
        const sv = (v + half) % T;
        const su = (u + half) % T;
        vis[v * T + u] = Math.round(255 * U.clamp((logs[sv * T + su] - lo) / (hi - lo || 1), 0, 1));
      }
    }

    return {
      T,
      tiles: used,
      scores,
      strongPeaks: strong,
      gridPoints: grid.length,
      control: { off: cOff, axis: cAxis },
      slope,
      hfDeviation: dev.length ? U.mean(dev) : NaN,
      profile,
      vis,
    };
  }

  // ------------------------------------------------------------------ noise

  function noise(src) {
    const { w, h, luma } = src;
    const B = 32;
    const R = region(w, h, 2560);
    const blocks = [];
    for (let by = R.y0; by + B <= R.y0 + R.rh; by += B) {
      for (let bx = R.x0; bx + B <= R.x0 + R.rw; bx += B) {
        let sI = 0;
        let sM = 0;
        let sG = 0;
        let clip = 0;
        let n = 0;
        const y1 = Math.max(1, by);
        const y2 = Math.min(h - 1, by + B);
        const x1 = Math.max(1, bx);
        const x2 = Math.min(w - 1, bx + B);
        for (let y = y1; y < y2; y++) {
          for (let x = x1; x < x2; x++) {
            const i = y * w + x;
            const c = luma[i];
            const m =
              luma[i - w - 1] - 2 * luma[i - w] + luma[i - w + 1] - 2 * luma[i - 1] + 4 * c - 2 * luma[i + 1] + luma[i + w - 1] - 2 * luma[i + w] + luma[i + w + 1];
            sM += m < 0 ? -m : m;
            const gx = luma[i + 1] - luma[i - 1];
            const gy = luma[i + w] - luma[i - w];
            sG += (gx < 0 ? -gx : gx) + (gy < 0 ? -gy : gy);
            sI += c;
            if (c <= 3 || c >= 252) clip++;
            n++;
          }
        }
        if (!n) continue;
        blocks.push({ mean: sI / n, sigma: (Math.sqrt(Math.PI / 2) * sM) / (6 * n), grad: sG / n, clip: clip / n });
      }
    }
    const valid = blocks.filter((b) => b.mean > 16 && b.mean < 240 && b.clip < 0.05);
    if (valid.length < 12) return { insufficient: true, blocks: blocks.length };
    const byGrad = valid.slice().sort((a, b) => a.grad - b.grad);
    const flat = byGrad.slice(0, Math.max(8, Math.floor(valid.length * 0.25)));
    const sig = flat.map((b) => b.sigma);
    const floor = U.median(sig);
    const cv = floor > 0 ? U.mad(sig) / floor : 0;
    const dead = valid.filter((b) => b.sigma < 0.4).length / valid.length;
    // Spearman correlation between brightness and noise in flat blocks.
    const rank = (arr) => {
      const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
      const r = new Array(arr.length);
      idx.forEach((p, k) => (r[p[1]] = k));
      return r;
    };
    const rm = rank(flat.map((b) => b.mean));
    const rs = rank(sig);
    const mr = (flat.length - 1) / 2;
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < flat.length; i++) {
      num += (rm[i] - mr) * (rs[i] - mr);
      da += (rm[i] - mr) ** 2;
      db += (rs[i] - mr) ** 2;
    }
    const texture = U.median(valid.map((b) => b.grad));
    return {
      floor,
      cv,
      deadFraction: dead,
      brightnessCorrelation: da && db ? num / Math.sqrt(da * db) : 0,
      textureToNoise: floor > 0 ? texture / floor : Infinity,
      flatBlocks: flat.length,
      validBlocks: valid.length,
    };
  }

  // ------------------------------------------------------------------ CFA / demosaicing

  function cfa(src) {
    const { w, h, rgba } = src;
    const B = 64;
    const R = region(w, h, 2048);
    const x0 = R.x0 & ~1;
    const y0 = R.y0 & ~1;
    const dG = [];
    const rCls = [];
    const bCls = [];
    const rStr = [];
    const bStr = [];
    const W4 = w * 4; // one row of RGBA bytes
    const rs = new Float64Array(4);
    const bs = new Float64Array(4);
    const ns = new Float64Array(4);
    for (let by = y0; by + B <= y0 + R.rh && by + B < h; by += B) {
      for (let bx = x0; bx + B <= x0 + R.rw && bx + B < w; bx += B) {
        let sA = 0;
        let nA = 0;
        let sB = 0;
        let nB = 0;
        rs.fill(0);
        bs.fill(0);
        ns.fill(0);
        const xs = Math.max(1, bx);
        for (let y = Math.max(1, by); y < by + B; y++) {
          // i indexes pixel (x, y); neighbours are ±4 bytes (left/right) and ±W4 (up/down).
          for (let x = xs, i = (y * w + xs) * 4; x < bx + B; x++, i += 4) {
            const g = rgba[i + 1];
            if (g < 4 || g > 251) continue;
            const pg = (rgba[i - 3] + rgba[i + 5] + rgba[i - W4 + 1] + rgba[i + W4 + 1]) * 0.25;
            const e = Math.abs(g - pg);
            if (((x + y) & 1) === 0) {
              sA += e;
              nA++;
            } else {
              sB += e;
              nB++;
            }
            const cls = (x & 1) | ((y & 1) << 1);
            rs[cls] += Math.abs(rgba[i] - (rgba[i - 4] + rgba[i + 4] + rgba[i - W4] + rgba[i + W4]) * 0.25);
            bs[cls] += Math.abs(rgba[i + 2] - (rgba[i - 2] + rgba[i + 6] + rgba[i - W4 + 2] + rgba[i + W4 + 2]) * 0.25);
            ns[cls]++;
          }
        }
        if (nA < 200 || nB < 200) continue;
        const mA = sA / nA;
        const mB = sB / nB;
        if (mA + mB < 0.8) continue; // flat block: nothing to measure
        dG.push(Math.log(mA / mB));
        if (ns.every((n) => n > 50)) {
          const rm = rs.map((s, i) => s / ns[i]);
          const bm = bs.map((s, i) => s / ns[i]);
          const argmax = (a) => a.indexOf(Math.max(...a));
          const lr = (a) => {
            const mx = Math.max(...a);
            const rest = (a.reduce((x, y) => x + y, 0) - mx) / 3;
            return rest > 0 ? Math.log(mx / rest) : 0;
          };
          rCls.push(argmax(rm));
          bCls.push(argmax(bm));
          rStr.push(lr(rm));
          bStr.push(lr(bm));
        }
      }
    }
    if (dG.length < 6) return { insufficient: true, blocks: dG.length };
    const D = U.median(dG);
    const consistency = dG.filter((d) => Math.sign(d) === Math.sign(D)).length / dG.length;
    const mode = (arr) => {
      const c = [0, 0, 0, 0];
      arr.forEach((v) => c[v]++);
      const m = c.indexOf(Math.max(...c));
      return { cls: m, share: arr.length ? c[m] / arr.length : 0 };
    };
    const rM = mode(rCls);
    const bM = mode(bCls);
    return {
      greenStrength: Math.abs(D),
      greenConsistency: consistency,
      greenPhase: D > 0 ? 'even' : 'odd',
      red: { cls: rM.cls, consistency: rM.share, strength: U.median(rStr) },
      blue: { cls: bM.cls, consistency: bM.share, strength: U.median(bStr) },
      // Bayer: red and blue photosites sit on opposite diagonals of the 2×2 cell.
      rbOpposite: (rM.cls ^ bM.cls) === 3,
      blocks: dG.length,
    };
  }

  // ------------------------------------------------------------------ JPEG block grid

  function blockiness(src) {
    const { w, h, luma } = src;
    const col = new Float64Array(8);
    const colN = new Float64Array(8);
    const row = new Float64Array(8);
    const rowN = new Float64Array(8);
    const stepY = Math.max(1, Math.floor((w * h) / 4e6));
    for (let y = 0; y < h; y += stepY) {
      const o = y * w;
      for (let x = 1; x < w; x++) {
        let d = luma[o + x] - luma[o + x - 1];
        d = d < 0 ? -d : d;
        if (d > 30) d = 30;
        col[x & 7] += d;
        colN[x & 7]++;
      }
    }
    for (let y = 1; y < h; y += 1) {
      if (y % stepY) continue;
      const o = y * w;
      for (let x = 0; x < w; x += 1) {
        let d = luma[o + x] - luma[o - w + x];
        d = d < 0 ? -d : d;
        if (d > 30) d = 30;
        row[y & 7] += d;
        rowN[y & 7]++;
      }
    }
    const ratio = (s, n) => {
      const m = Array.from(s, (v, i) => (n[i] ? v / n[i] : 0));
      const mx = Math.max(...m);
      const ph = m.indexOf(mx);
      const rest = (m.reduce((a, b) => a + b, 0) - mx) / 7;
      return { ratio: rest > 0 ? mx / rest : 1, phase: ph };
    };
    const H = ratio(col, colN);
    const V = ratio(row, rowN);
    return { horizontal: H.ratio, vertical: V.ratio, phaseX: H.phase, phaseY: V.phase, score: Math.sqrt(H.ratio * V.ratio) };
  }

  // ------------------------------------------------------------------ visual maps

  // Residual magnitude averaged down to at most maxSide px (the "noise map").
  function residualMap(src, maxSide) {
    const { w, h, luma } = src;
    const s = Math.max(1, Math.ceil(Math.max(w, h) / maxSide));
    const ow = Math.floor(w / s);
    const oh = Math.floor(h / s);
    const out = new Float32Array(ow * oh);
    for (let oy = 0; oy < oh; oy++) {
      for (let ox = 0; ox < ow; ox++) {
        let acc = 0;
        let n = 0;
        for (let y = oy * s; y < oy * s + s; y++) {
          if (y < 1 || y >= h - 1) continue;
          for (let x = ox * s; x < ox * s + s; x++) {
            if (x < 1 || x >= w - 1) continue;
            const i = y * w + x;
            const r = 4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - w] - luma[i + w];
            acc += r < 0 ? -r : r;
            n++;
          }
        }
        out[oy * ow + ox] = n ? acc / n : 0;
      }
    }
    return { data: out, width: ow, height: oh };
  }

  TF.forensics = { prepare, spectral, noise, cfa, blockiness, residualMap };
})(typeof window !== 'undefined' ? window : globalThis);
