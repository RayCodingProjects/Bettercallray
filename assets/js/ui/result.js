/*
 * TrueFrame — interactive result view.
 *  - verdict hero with animated gauge and image lightbox
 *  - "score builder": switch detection layers off/on and watch the verdict recompute
 *  - filterable evidence list with links into the forensic lab
 *  - forensic lab: comparison slider / overlay / side-by-side, magnifier, spectrum explorer,
 *    video frame explorer
 *  - searchable metadata explorer with copy buttons
 */
(function (root) {
  'use strict';
  const TF = root.TrueFrame;
  const U = TF.util;
  const I = root.TFIcon;
  const UI = root.TFUI;
  const esc = UI.esc;
  const $ = UI.$;
  const $$ = UI.$$;

  const STRENGTH_WORDS = {
    ai: { decisive: 'Decisive: AI', strong: 'Strongly suggests AI', moderate: 'Suggests AI', weak: 'Slight hint of AI' },
    real: { decisive: 'Decisive: real', strong: 'Strongly suggests real', moderate: 'Suggests real', weak: 'Slight hint of real' },
  };
  const LAB_FOR_SIGNAL = { spectral: 'spectrum', decay: 'spectrum', noise: 'noise', cfa: 'noise', jpeghistory: 'ela', framemix: 'frames' };
  const TONE_ICON = { ai: 'robot', real: 'camera', uncertain: 'question' };
  const CONF = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };
  const factor = (v) => {
    const f = Math.exp(Math.abs(v));
    return f >= 100 ? '100+' : f >= 10 ? String(Math.round(f)) : f.toFixed(1);
  };
  const layerWord = (v) => {
    const a = Math.abs(v);
    if (a < 0.05) return 'No lean';
    const s = a >= 3 ? 'Decisive' : a >= 1.5 ? 'Strong' : a >= 0.6 ? 'Moderate' : 'Slight';
    return `${s} → ${v > 0 ? 'AI' : 'real'}`;
  };

  let V = null; // current view state

  // ================================================================== entry
  UI.renderResult = function (r, ctx) {
    const mode = ctx.store.get('detail', 'simple') === 'detailed' ? 'detailed' : 'simple';
    V = {
      r,
      ctx,
      mode,
      disabled: new Set(),
      filter: 'all',
      lab: { tab: r.kind === 'video' ? 'frames' : 'original', mode: 'slider', opacity: 0.75, lens: false, grid: false, frame: 0 },
      viewer: null,
    };
    $('#viewResult').innerHTML = template(r, mode);
    UI.hydrateIcons($('#viewResult'));
    mountMedia();
    bindTop();
    renderEvidence(true);
    renderLayers();
    updateVerdict(r.fusion, true);
    renderLabTabs();
    renderMeta();
    // The lab measures its container, so render it once the view is actually visible
    // (view switches can be deferred by a view transition).
    let tries = 0;
    const whenVisible = () => {
      if ($('#viewResult').hidden && tries++ < 60) return requestAnimationFrame(whenVisible);
      renderLab();
    };
    requestAnimationFrame(whenVisible);
  };

  const SHORT = { ai: 'AI', real: 'Real', uncertain: 'Unsure' };
  function guessChip(guess, tone) {
    if (!guess) return '';
    const g = guess === 'ai' ? 'AI' : 'real';
    if (tone === 'uncertain') return `<span class="chip guess-chip is-meh">${I('question')}You guessed ${g} · too close to call</span>`;
    const ok = (guess === 'ai') === (tone === 'ai');
    return `<span class="chip guess-chip ${ok ? 'is-ok' : 'is-miss'}">${I(ok ? 'check' : 'x')}You guessed ${g} · ${ok ? 'TrueFrame agrees' : 'TrueFrame disagrees'}</span>`;
  }

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (V && V.lab.tab === 'frames' && !$('#viewResult').hidden) renderLab();
    }, 200);
  });

  // ================================================================== template
  function template(r, mode) {
    const isVideo = r.kind === 'video';
    const fileLine = [r.file.format, r.file.width && `${r.file.width} × ${r.file.height}`, isVideo && isFinite(r.file.duration) && U.formatDuration(r.file.duration), U.formatBytes(r.file.size)]
      .filter(Boolean)
      .join(' · ');
    const warn = r.warnings.length ? `<div class="warn-box">${I('alert')}<div>${r.warnings.map(esc).join('<br>')}</div></div>` : '';
    return `<div class="result mode-${mode}" id="resultRoot">
      <div class="result-bar">
        <button class="btn btn-ghost btn-sm" type="button" id="backBtn">${I('back')}New check</button>
        <div class="result-bar-right">
          <div class="seg" role="radiogroup" aria-label="Level of detail" id="modeSeg">
            <button type="button" role="radio" data-mode="simple" aria-checked="${mode === 'simple'}" data-tip="Plain-English findings">${I('eye')}<span>Simple</span></button>
            <button type="button" role="radio" data-mode="detailed" aria-checked="${mode === 'detailed'}" data-tip="Show the numbers and technical details">${I('list')}<span>Detailed</span></button>
          </div>
          <button class="icon-btn" type="button" id="copyBtn" aria-label="Copy a text summary" data-tip="Copy a text summary">${I('copy')}</button>
          <button class="icon-btn" type="button" id="downloadBtn" aria-label="Download the full report" data-tip="Download the full report (JSON)">${I('download')}</button>
        </div>
      </div>

      <section class="card verdict-card" id="verdictCard" aria-labelledby="verdictTitle">
        <div class="verdict-media stage-bg${isVideo ? ' is-video' : ''}" id="verdictMedia" ${isVideo ? '' : 'role="button" tabindex="0" aria-label="Enlarge image"'}></div>
        <div class="verdict-body">
          <div class="verdict-top">
            ${UI.gaugeHTML('verdictGauge', '', 'AI likelihood')}
            <div class="verdict-text">
              <span class="verdict-label"><span class="tone-badge" id="toneBadge"></span><span id="verdictSub"></span></span>
              <h2 class="verdict-title" id="verdictTitle"></h2>
              <div class="verdict-meta" id="verdictMeta"></div>
            </div>
          </div>
          <p class="verdict-summary" id="verdictSummary"></p>
          <div class="balance" id="balance"></div>
          <div class="sim-banner" id="simBanner" hidden>${I('sliders')}<span id="simText"></span><button class="btn-link" type="button" id="simReset">Reset</button></div>
          ${warn}
          <p class="file-line">${esc(r.file.name)} · ${esc(fileLine)}</p>
          <div class="verdict-actions">
            <button class="btn btn-primary" type="button" id="againBtn">${I('upload')}Check another file</button>
            <button class="btn btn-ghost" type="button" id="labJump">${I('eye')}Open the forensic lab</button>
          </div>
        </div>
      </section>

      <div class="result-grid">
        <section class="card panel" aria-labelledby="evTitle">
          <div class="panel-head"><h3 id="evTitle">What we found</h3><div class="filter-chips" role="toolbar" aria-label="Filter findings" id="evFilters"></div></div>
          <div id="evList"></div>
        </section>
        <aside class="result-side">
          <section class="card panel" aria-labelledby="layersTitle">
            <div class="panel-head"><h3 id="layersTitle">Score builder</h3><div class="legend"><span><i style="background:var(--real)"></i>Real</span><span><i style="background:var(--ai)"></i>AI</span></div></div>
            <p class="panel-sub">Switch a layer off to see how the verdict would change without it.</p>
            <div class="layers" id="layers"></div>
            <div class="layer-axis"><span>← Points to real</span><span>Points to AI →</span></div>
            <div class="score-path" id="scorePath"></div>
          </section>
        </aside>
      </div>

      <section class="card panel" id="lab" aria-labelledby="labTitle" tabindex="-1">
        <div class="panel-head"><h3 id="labTitle">Forensic lab</h3><p>${isVideo ? 'Click any frame to inspect it' : 'Drag, overlay and magnify what the checks see'}</p></div>
        <div class="lab-toolbar"><div class="seg tabs" role="tablist" aria-label="Forensic views" id="labTabs"></div><div class="lab-tools" id="labTools"></div></div>
        <div class="lab-stage stage-bg" id="labStage" role="tabpanel"></div>
        <p class="lab-caption" id="labCaption"></p>
      </section>

      <section class="card panel" aria-labelledby="metaTitle">
        <div class="panel-head"><h3 id="metaTitle">Metadata explorer</h3>
          <div class="lab-tools"><label class="meta-search">${I('search')}<input type="search" id="metaSearch" placeholder="Search metadata…" aria-label="Search metadata" autocomplete="off"></label>
          <button class="btn btn-ghost btn-sm" type="button" id="copyMeta">${I('copy')}Copy all</button></div>
        </div>
        <div class="meta-groups" id="metaGroups"></div>
      </section>

      <p class="disclaimer">${I('info')}<span>TrueFrame estimates a likelihood from evidence — it cannot prove that a file is real or fake. Compressed, resized or screenshotted files carry fewer traces, and brand-new generators can slip past the neural models. Always consider where a file came from.</span></p>
    </div>`;
  }

  // ================================================================== media & top bar
  function mediaSrc() {
    return V.r.objectUrl;
  }

  function mountMedia() {
    const r = V.r;
    const host = $('#verdictMedia');
    const tone = r.fusion.verdict.tone;
    const stamp = `<span class="media-stamp tone-${tone}" aria-hidden="true">${SHORT[tone]} · ${Math.round(r.fusion.p * 100)}%</span>`;
    if (r.kind === 'video') {
      host.innerHTML = `<video class="live-el" src="${r.objectUrl}" controls muted playsinline preload="metadata" ${r.visuals.thumb ? `poster="${r.visuals.thumb}"` : ''}></video>${stamp}`;
      host.querySelector('video').addEventListener('error', () => {
        host.innerHTML = (r.visuals.thumb ? `<img src="${r.visuals.thumb}" alt="Video preview">` : `<p class="lab-empty">Preview not available in this browser.</p>`) + stamp;
      });
      return;
    }
    host.innerHTML = `<img class="live-el" src="${r.objectUrl}" alt="The analysed image">${stamp}<span class="zoom-hint">${I('zoom')}Click to enlarge</span>`;
    const img = host.querySelector('img');
    img.addEventListener('error', () => {
      if (r.visuals.thumb) img.src = r.visuals.thumb;
      else host.innerHTML = '<p class="lab-empty">Preview not available in this browser.</p>';
    });
    const open = () => UI.lightbox(img.currentSrc || img.src, 'The analysed image');
    host.addEventListener('click', open);
    host.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
  }

  function bindTop() {
    $('#backBtn').addEventListener('click', () => V.ctx.onBack());
    $('#againBtn').addEventListener('click', () => V.ctx.onAgain());
    $('#labJump').addEventListener('click', () => scrollToLab());
    $('#downloadBtn').addEventListener('click', () => downloadReport(V.r));
    $('#copyBtn').addEventListener('click', () => UI.copy(summaryText(V.r), 'Summary copied'));
    $('#simReset').addEventListener('click', () => {
      V.disabled.clear();
      recompute();
    });
    $$('#modeSeg button').forEach((b) =>
      b.addEventListener('click', () => {
        V.mode = b.dataset.mode;
        V.ctx.store.set('detail', V.mode);
        $$('#modeSeg button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        $('#resultRoot').className = 'result mode-' + V.mode;
        renderEvidence();
      })
    );
  }

  function scrollToLab(tab) {
    if (tab && tab !== V.lab.tab) {
      V.lab.tab = tab;
      renderLabTabs();
      renderLab();
    }
    const lab = $('#lab');
    lab.scrollIntoView({ behavior: UI.reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    lab.focus({ preventScroll: true });
  }

  // ================================================================== verdict & simulation
  function updateVerdict(f, initial) {
    const r = V.r;
    const card = $('#verdictCard');
    card.classList.remove('tone-ai', 'tone-real', 'tone-uncertain');
    card.classList.add('tone-' + f.verdict.tone);
    UI.gaugeSet($('#verdictGauge'), f.p, f.verdict.tone, r.kind);
    $('#toneBadge').innerHTML = I(TONE_ICON[f.verdict.tone]);
    $('#verdictSub').textContent = f.verdict.sub;
    $('#verdictTitle').textContent = f.verdict.label;
    $('#verdictMeta').innerHTML =
      `<span class="chip">${I(f.confidence === 'high' ? 'badge' : 'info')}${CONF[f.confidence]}</span>` +
      (f.conflict ? `<span class="chip">${I('alert')}Mixed signals</span>` : '') +
      `<span class="chip">${I('list')}${r.signals.length} checks</span>` +
      guessChip(V.ctx.guess, r.fusion.verdict.tone);
    $('#verdictSummary').textContent = f.summary;
    renderBalance(initial);
    const sim = V.disabled.size > 0;
    $('#simBanner').hidden = !sim;
    if (sim) {
      const real = r.fusion;
      $('#simText').textContent = `Simulation with ${V.disabled.size} layer${V.disabled.size > 1 ? 's' : ''} switched off. With every layer the verdict is ${U.pct(real.p)}: ${real.verdict.label}.`;
    }
    if (!initial) {
      card.animate && !UI.reducedMotion() && card.animate([{ transform: 'scale(0.995)' }, { transform: 'none' }], { duration: 250, easing: 'ease-out' });
    }
    renderScorePath(f);
  }

  function activeSignals() {
    return V.r.signals.filter((s) => !V.disabled.has(s.category));
  }

  function recompute() {
    const f = V.disabled.size ? TF.fusion.fuse(activeSignals(), V.r.kind) : V.r.fusion;
    updateVerdict(f, false);
    renderLayers();
    $$('.ev').forEach((el) => el.classList.toggle('is-muted', V.disabled.has(el.dataset.cat)));
    const media = $('#verdictMedia');
    if (media) media.classList.toggle('is-sim', V.disabled.size > 0);
  }

  // ================================================================== score builder
  function renderLayers() {
    const host = $('#layers');
    const cats = V.r.fusion.categories;
    host.innerHTML = cats
      .map((c) => {
        const off = V.disabled.has(c.key);
        const mag = Math.min(1, Math.abs(c.score) / 4);
        const dir = c.score > 0.05 ? 'ai' : c.score < -0.05 ? 'real' : 'neutral';
        const tip =
          dir === 'neutral'
            ? `${c.label}: no lean (${c.count} check${c.count > 1 ? 's' : ''}).`
            : `${c.label}: evidence ≈ ${factor(c.score)}× more likely for ${dir === 'ai' ? 'an AI image' : 'a real capture'} (${c.count} check${c.count > 1 ? 's' : ''}).`;
        const bar = dir === 'neutral' ? '' : `<span class="${dir === 'ai' ? 'to-ai' : 'to-real'}" style="width:${(Math.max(0.04, mag) * 50).toFixed(1)}%"></span>`;
        return `<div class="layer${off ? ' is-off' : ''}" data-cat="${c.key}" data-tip="${esc(tip)}">
          <button class="switch" type="button" role="switch" aria-checked="${!off}" aria-label="Include ${esc(c.label)} in the verdict" data-cat="${c.key}"></button>
          <span class="layer-name">${I(c.icon)}<span>${esc(c.label)}</span></span>
          <span class="layer-word">${off ? 'Switched off' : esc(layerWord(c.score))}</span>
          <div class="layer-bar">${bar}</div>
        </div>`;
      })
      .join('');
    $$('.switch', host).forEach((sw) =>
      sw.addEventListener('click', () => {
        const k = sw.dataset.cat;
        if (V.disabled.has(k)) V.disabled.delete(k);
        else V.disabled.add(k);
        recompute();
        const again = $(`.switch[data-cat="${k}"]`);
        if (again) again.focus();
      })
    );
    $$('.layer', host).forEach((row) => {
      row.addEventListener('mouseenter', () => highlightCategory(row.dataset.cat, true));
      row.addEventListener('mouseleave', () => highlightCategory(row.dataset.cat, false));
    });
  }

  function highlightCategory(cat, on) {
    $$(`.ev[data-cat="${cat}"]`).forEach((el) => el.classList.toggle('is-flash', on));
    $$(`.bal-seg[data-cat="${cat}"]`).forEach((el) => el.classList.toggle('is-hot', on));
  }

  // Evidence tug-of-war: one block per finding, real on the left and AI on the right, block
  // length = strength (log-likelihood ratio, capped so one finding cannot fill the bar).
  function renderBalance(initial) {
    const host = $('#balance');
    const r = V.r;
    const items = r.signals.map((s, i) => ({ s, i })).filter(({ s }) => s.direction !== 'neutral' && Math.abs(s.llr) >= 0.05);
    if (!items.length) {
      host.innerHTML = '';
      return;
    }
    const w = (s) => Math.min(4, Math.abs(s.llr));
    const side = (dir) => items.filter(({ s }) => s.direction === dir).sort((a, b) => Math.abs(b.s.llr) - Math.abs(a.s.llr));
    const ai = side('ai');
    const real = side('real');
    const sum = (arr) => arr.reduce((t, x) => t + w(x.s), 0);
    const scale = 94 / Math.max(sum(ai), sum(real), 2.5);
    const seg = ({ s, i }, k, arr) => {
      const off = V.disabled.has(s.category);
      const toAi = s.direction === 'ai';
      const tip = `${s.title} — ${toAi ? 'points to AI' : 'points to real'}, ×${factor(s.llr)}${off ? ' (layer switched off)' : ''}`;
      return `<button type="button" class="bal-seg ${toAi ? 'to-ai' : 'to-real'}${off ? ' is-off' : ''}${k === arr.length - 1 ? ' is-end' : ''}" style="width:${(w(s) * scale).toFixed(2)}%;--k:${k}" data-idx="${i}" data-cat="${s.category}" data-tip="${esc(tip)}" aria-label="${esc(tip)}. Show this finding."></button>`;
    };
    const n = (arr, word) => `${arr.length} finding${arr.length === 1 ? '' : 's'} ${word}`;
    host.innerHTML = `<div class="bal-head"><span class="section-label">Evidence tug-of-war</span><span class="bal-hint">One block per finding · longer = stronger · click to jump</span></div>
      <div class="bal${initial ? ' is-new' : ''}" role="group" aria-label="${esc(n(real, 'point to real') + ', ' + n(ai, 'point to AI'))}">
        <div class="bal-half real">${real.map(seg).join('')}</div><div class="bal-half ai">${ai.map(seg).join('')}</div>
      </div>
      <div class="bal-foot"><span><i class="chip-dot dot-real"></i>${n(real, 'point to real')}</span><span>${n(ai, 'point to AI')}<i class="chip-dot dot-ai"></i></span></div>`;
    $$('.bal-seg', host).forEach((b) => {
      b.addEventListener('click', () => jumpToFinding(+b.dataset.idx));
      b.addEventListener('mouseenter', () => $$(`.layer[data-cat="${b.dataset.cat}"]`).forEach((x) => x.classList.add('is-hot')));
      b.addEventListener('mouseleave', () => $$(`.layer[data-cat="${b.dataset.cat}"]`).forEach((x) => x.classList.remove('is-hot')));
    });
  }

  function jumpToFinding(idx) {
    if (V.filter !== 'all') {
      V.filter = 'all';
      renderEvidence();
    }
    const el = $(`.ev[data-idx="${idx}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: UI.reducedMotion() ? 'auto' : 'smooth', block: 'center' });
    el.classList.remove('is-ping');
    void el.offsetWidth;
    el.classList.add('is-ping');
  }

  // Step chart: cumulative probability as each active layer is added (strongest first).
  function renderScorePath(f) {
    const host = $('#scorePath');
    const cats = V.r.fusion.categories.filter((c) => !V.disabled.has(c.key) && Math.abs(c.score) >= 0.05).sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
    const pts = [{ label: 'No evidence', p: 0.5 }];
    let z = 0;
    for (const c of cats) {
      z += c.score;
      pts.push({ label: '+ ' + c.label, p: U.sigmoid(z) });
    }
    if (Math.abs(U.sigmoid(z) - f.p) > 0.005) pts.push({ label: 'Embedded proof applied', p: f.p });
    const W = 320;
    const H = 130;
    const padL = 34;
    const padR = 12;
    const padT = 10;
    const padB = 22;
    const n = pts.length;
    const x = (i) => padL + (n === 1 ? 0 : (i * (W - padL - padR)) / (n - 1));
    const y = (p) => padT + (1 - p) * (H - padT - padB);
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="How the AI likelihood builds up as each layer is added: from 50% to ${U.pct(f.p)}">`;
    [0, 0.5, 1].forEach((t) => {
      svg += `<line x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}" stroke="var(--grid)" stroke-width="1"/>`;
      svg += `<text x="${padL - 6}" y="${y(t) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${t * 100}%</text>`;
    });
    let d = '';
    pts.forEach((pt, i) => {
      d += i ? ` H${x(i)} V${y(pt.p)}` : `M${x(0)} ${y(pt.p)}`;
    });
    svg += `<path class="sp-line" pathLength="1" d="${d}" fill="none" stroke="var(--text-2)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    pts.forEach((pt, i) => {
      const col = pt.p >= 0.65 ? 'var(--ai)' : pt.p <= 0.35 ? 'var(--real)' : 'var(--warn)';
      svg += `<circle class="sp-dot" style="--k:${i / Math.max(1, n - 1)}" cx="${x(i)}" cy="${y(pt.p)}" r="5" fill="${col}" stroke="var(--surface)" stroke-width="2"/>`;
      svg += `<circle cx="${x(i)}" cy="${y(pt.p)}" r="12" fill="transparent" data-tip="${esc(pt.label)}: ${U.pct(pt.p)} AI likelihood"/>`;
    });
    const last = pts[pts.length - 1];
    svg += `<text x="${x(n - 1)}" y="${H - 6}" text-anchor="end" font-size="10.5" font-weight="600" fill="var(--text-2)">${U.pct(last.p)}</text>`;
    svg += `<text x="${x(0)}" y="${H - 6}" text-anchor="start" font-size="10.5" fill="var(--muted)">start</text>`;
    svg += '</svg>';
    host.innerHTML = `<p class="section-label" style="margin-bottom:6px">How the score builds up</p>${svg}`;
  }

  // ================================================================== evidence
  function renderEvidence(initial) {
    const r = V.r;
    const sigs = r.signals;
    const counts = {
      all: sigs.length,
      ai: sigs.filter((s) => s.direction === 'ai').length,
      real: sigs.filter((s) => s.direction === 'real').length,
      neutral: sigs.filter((s) => s.direction === 'neutral').length,
    };
    const F = [
      ['all', 'All', null],
      ['ai', 'Points to AI', 'dot-ai'],
      ['real', 'Points to real', 'dot-real'],
      ['neutral', 'Context', null],
    ];
    $('#evFilters').innerHTML = F.map(
      ([k, label, dot]) =>
        `<button class="filter-chip" type="button" data-f="${k}" aria-pressed="${V.filter === k}" ${counts[k] ? '' : 'disabled'}>${dot ? `<span class="chip-dot ${dot}"></span>` : ''}${label} <span class="n">${counts[k]}</span></button>`
    ).join('');
    $$('#evFilters .filter-chip').forEach((b) =>
      b.addEventListener('click', () => {
        V.filter = b.dataset.f;
        renderEvidence();
      })
    );

    const order = sigs
      .slice()
      .sort((a, b) => (a.direction === 'neutral') - (b.direction === 'neutral') || (b.definitive ? 1 : 0) - (a.definitive ? 1 : 0) || Math.abs(b.llr) - Math.abs(a.llr));
    const shown = order.filter((s) => V.filter === 'all' || s.direction === V.filter);
    const detailed = V.mode === 'detailed';
    const items = shown.map((s, k) => evidenceItem(s, detailed, k)).join('');
    $('#evList').innerHTML = shown.length ? `<ol class="evidence${initial ? ' is-new' : ''}">${items}</ol>` : '<p class="empty-filter">Nothing in this group.</p>';

    $$('#evList .ev').forEach((li) => {
      li.classList.toggle('is-muted', V.disabled.has(li.dataset.cat));
      const t = li.querySelector('[data-act="detail"]');
      if (t)
        t.addEventListener('click', () => {
          const d = li.querySelector('.ev-detail');
          d.hidden = !d.hidden;
          t.setAttribute('aria-expanded', String(!d.hidden));
        });
      const lab = li.querySelector('[data-act="lab"]');
      if (lab) lab.addEventListener('click', () => scrollToLab(lab.dataset.tab));
      li.addEventListener('mouseenter', () => $$(`.layer[data-cat="${li.dataset.cat}"]`).forEach((x) => x.classList.add('is-hot')));
      li.addEventListener('mouseleave', () => $$(`.layer[data-cat="${li.dataset.cat}"]`).forEach((x) => x.classList.remove('is-hot')));
    });
  }

  function labTabFor(s) {
    if (V.r.kind === 'video') return s.id === 'neural' || s.id === 'framemix' ? 'frames' : null;
    const t = LAB_FOR_SIGNAL[s.id];
    if (!t) return null;
    if (t === 'spectrum' && !V.r.visuals.spectrum) return null;
    if ((t === 'noise' || t === 'ela') && !V.r.visuals[t]) return null;
    return t;
  }

  function evidenceItem(s, detailed, k) {
    const cat = TF.evidence.CATEGORIES[s.category] || { icon: 'info' };
    const dir = s.direction;
    const mag = Math.min(1, Math.abs(s.llr) / 4);
    const word = dir === 'neutral' ? 'Context' : STRENGTH_WORDS[dir][s.strength] || STRENGTH_WORDS[dir].weak;
    const meter = dir === 'neutral' ? '' : `<span class="meter" aria-hidden="true"><span class="${dir === 'ai' ? 'to-ai' : 'to-real'}" style="width:${(Math.max(0.08, mag) * 50).toFixed(1)}%"></span></span>`;
    const fac = dir === 'neutral' ? '' : `<span class="ev-factor" data-tip="How much more often this finding occurs in ${dir === 'ai' ? 'AI images' : 'real captures'}">×${factor(s.llr)} → ${dir === 'ai' ? 'AI' : 'real'}</span>`;
    const tab = labTabFor(s);
    const links = [];
    if (s.detail) links.push(`<button type="button" class="tech" data-act="detail" aria-expanded="${detailed}">Technical details ${I('chevron')}</button>`);
    if (tab) links.push(`<button type="button" data-act="lab" data-tab="${tab}">${I('eye')}See it in the lab</button>`);
    return `<li class="ev dir-${dir}" data-cat="${s.category}" data-id="${s.id}" data-idx="${V.r.signals.indexOf(s)}" style="--i:${Math.min(k || 0, 12)}"><div class="ev-row">
      <div class="ev-icon">${I(cat.icon)}</div>
      <div><div class="ev-title">${esc(s.title)}</div><p class="ev-summary">${esc(s.summary)}</p>
        ${links.length ? `<div class="ev-links">${links.join('')}</div>` : ''}
        ${s.detail ? `<p class="ev-detail" ${detailed ? '' : 'hidden'}>${esc(s.detail)}</p>` : ''}</div>
      <div class="ev-impact"><span class="ev-impact-label">${esc(word)}</span>${meter}${fac}</div>
    </div></li>`;
  }

  // ================================================================== forensic lab
  const LAB_TABS_IMAGE = [
    ['original', 'Original', 'image'],
    ['ela', 'Error levels', 'layers'],
    ['noise', 'Noise map', 'camera'],
    ['spectrum', 'Spectrum', 'wave'],
  ];
  const LAB_CAPTIONS = {
    original: 'The file exactly as you provided it. Turn on the magnifier and hover to inspect fine detail — AI images often break down in hair, text, hands and repeating textures.',
    ela: 'Error-level analysis: we re-saved the image as JPEG and mapped how much each area changed (darker = more change). Regions pasted in or edited separately often stand out; an even texture is normal. Drag the divider to compare with the original.',
    noise: 'Noise map: fine grain and detail (darker = more). Real photos show sensor grain everywhere, even in smooth areas such as sky or skin. Generated images often have patches that are unnaturally smooth or uniformly textured.',
    spectrum: 'Frequency spectrum of the fine detail (darker = stronger): the centre holds coarse shapes, the edges the finest detail. Generators leave sharp dark dots on a regular 8-pixel grid. Hover to read the repeat period at any point, or show where those dots would be. JPEG files always show an 8 × 8 grid, so this view is only conclusive for PNG and other lossless files.',
    frames: 'Each column is one frame sampled across the clip, scored by the neural networks. Click a column or a thumbnail to inspect that frame; a clip mixing real footage with generated shots shows a mix of colours.',
  };

  function labTabs() {
    if (V.r.kind === 'video') return [['frames', 'Frames', 'film']];
    return LAB_TABS_IMAGE.filter(([id]) => id === 'original' || V.r.visuals[id]);
  }

  function renderLabTabs() {
    const tabs = labTabs();
    $('#labTabs').innerHTML = tabs
      .map(([id, label, icon]) => `<button type="button" role="tab" data-tab="${id}" aria-selected="${V.lab.tab === id}" aria-controls="labStage">${I(icon)}<span>${label}</span></button>`)
      .join('');
    $$('#labTabs button').forEach((b) =>
      b.addEventListener('click', () => {
        V.lab.tab = b.dataset.tab;
        renderLabTabs();
        renderLab();
      })
    );
  }

  function renderLab() {
    const r = V.r;
    const tab = V.lab.tab;
    const stage = $('#labStage');
    const tools = $('#labTools');
    $('#labCaption').textContent = LAB_CAPTIONS[tab] || '';
    V.viewer = null;
    if (tab === 'frames') {
      tools.innerHTML = '';
      renderFrames(stage);
      return;
    }
    if (tab === 'spectrum') {
      tools.innerHTML = `<button class="btn btn-ghost btn-sm${V.lab.grid ? ' is-on' : ''}" type="button" id="gridToggle" aria-pressed="${V.lab.grid}">${I('grid')}Show generator grid</button>`;
      $('#gridToggle').addEventListener('click', () => {
        V.lab.grid = !V.lab.grid;
        renderLab();
      });
      renderSpectrum(stage);
      return;
    }
    const isMap = tab !== 'original';
    const modeSeg = isMap
      ? `<div class="seg" role="radiogroup" aria-label="Comparison mode">${[
          ['slider', 'Slider', 'split'],
          ['overlay', 'Overlay', 'blend'],
          ['side', 'Side by side', 'columns'],
        ]
          .map(([m, l, ic]) => `<button type="button" role="radio" data-m="${m}" aria-checked="${V.lab.mode === m}">${I(ic)}<span>${l}</span></button>`)
          .join('')}</div>`
      : '';
    const opacity =
      isMap && V.lab.mode === 'overlay'
        ? `<label class="range">Opacity <input type="range" min="0" max="100" value="${Math.round(V.lab.opacity * 100)}" id="opacityRange" aria-label="Overlay opacity"></label>`
        : '';
    const lens = !(isMap && V.lab.mode === 'side')
      ? `<button class="icon-btn${V.lab.lens ? ' is-on' : ''}" type="button" id="lensToggle" aria-pressed="${V.lab.lens}" aria-label="Magnifier" data-tip="Magnifier: hover the image to zoom 3×">${I('zoom')}</button>`
      : '';
    tools.innerHTML = modeSeg + opacity + lens;
    $$('[data-m]', tools).forEach((b) =>
      b.addEventListener('click', () => {
        V.lab.mode = b.dataset.m;
        renderLab();
      })
    );
    const range = $('#opacityRange');
    if (range)
      range.addEventListener('input', () => {
        V.lab.opacity = range.value / 100;
        if (V.viewer) V.viewer.set({ opacity: V.lab.opacity });
      });
    const lb = $('#lensToggle');
    if (lb)
      lb.addEventListener('click', () => {
        V.lab.lens = !V.lab.lens;
        lb.classList.toggle('is-on', V.lab.lens);
        lb.setAttribute('aria-pressed', String(V.lab.lens));
        if (V.viewer) V.viewer.set({ lens: V.lab.lens });
      });

    const base = isMap && r.visuals.mapBase ? r.visuals.mapBase : mediaSrc();
    const aspect = isMap && r.visuals.mapAspect ? r.visuals.mapAspect : r.file.width && r.file.height ? r.file.width / r.file.height : 1.5;
    const labels = { ela: 'Error levels', noise: 'Noise map' };
    V.viewer = UI.viewer(stage, {
      base,
      baseLabel: 'Original',
      top: isMap ? r.visuals[tab] : null,
      topLabel: labels[tab] || '',
      aspect,
      mode: V.lab.mode,
      opacity: V.lab.opacity,
      lens: V.lab.lens,
    });
  }

  function renderSpectrum(stage) {
    const r = V.r;
    const sp = (r.forensics && r.forensics.spectral) || {};
    const sig = r.signals.find((s) => s.id === 'spectral');
    let dots = '';
    for (let k = -4; k <= 3; k++) {
      for (let l = -4; l <= 3; l++) {
        if (!k && !l) continue;
        dots += `<circle cx="${50 + k * 12.5}" cy="${50 + l * 12.5}" r="1.8" fill="none" stroke="var(--ai)" stroke-width="0.6"/>`;
      }
    }
    const p8 = sp.scores ? sp.scores.p8 : null;
    stage.innerHTML = `<div class="spec-wrap">
      <div class="spec${V.lab.grid ? ' show-grid' : ''}" id="spec"><img src="${r.visuals.spectrum}" alt="Frequency spectrum of the image's fine detail"><svg class="spec-grid" viewBox="0 0 100 100" aria-hidden="true">${dots}</svg><div class="spec-cross"></div></div>
      <div class="spec-readout" id="specReadout" aria-live="polite">
        <span class="section-label">Hover the spectrum</span>
        <div class="big" id="specBig">–</div>
        <p id="specText">Move your pointer over the spectrum to see how often the pattern at that point repeats in the image.</p>
        <dl class="kv-mini">
          <dt>Check result</dt><dd>${esc(sig ? sig.title : 'Not run')}</dd>
          ${p8 != null ? `<dt>8-px grid strength</dt><dd>${p8.toFixed(2)} <span class="muted">(≥ 0.10 suspicious, ≥ 0.30 strong)</span></dd>` : ''}
          ${sp.tiles ? `<dt>Analysed</dt><dd>${sp.tiles} tiles of ${sp.T} × ${sp.T} px</dd>` : ''}
        </dl>
      </div>
    </div>`;
    const spec = $('#spec');
    spec.addEventListener('pointermove', (e) => {
      const rc = spec.getBoundingClientRect();
      const x = (e.clientX - rc.left) / rc.width;
      const y = (e.clientY - rc.top) / rc.height;
      spec.style.setProperty('--cx', x * 100 + '%');
      spec.style.setProperty('--cy', y * 100 + '%');
      const dx = x - 0.5;
      const dy = y - 0.5;
      const f = Math.sqrt(dx * dx + dy * dy);
      const onGrid = Math.abs(dx * 8 - Math.round(dx * 8)) < 0.08 && Math.abs(dy * 8 - Math.round(dy * 8)) < 0.08 && f > 0.06;
      if (f < 0.02) {
        $('#specBig').textContent = 'Centre';
        $('#specText').textContent = 'Coarse shapes and overall brightness live here.';
      } else {
        const period = 1 / f;
        const ang = Math.round((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 180;
        $('#specBig').textContent = `Repeats every ${period < 10 ? period.toFixed(1) : Math.round(period)} px`;
        $('#specText').textContent = onGrid
          ? 'This is one of the positions where generator grid peaks appear. A sharp dark dot here — and at its neighbours — is suspicious.'
          : `A pattern at this point would repeat every ${period.toFixed(1)} pixels, running at about ${ang}°. ${period < 3 ? 'That is the finest detail an image can hold.' : ''}`;
      }
    });
  }

  function renderFrames(stage) {
    const frames = V.r.visuals.frames || [];
    if (!frames.length) {
      stage.innerHTML = '<p class="lab-empty">No frames could be decoded in this browser, so only the container was analysed.</p>';
      return;
    }
    const hasP = frames.some((f) => f.p != null);
    // Draw at the container's real width so labels keep their true size on any screen.
    const W = Math.round(U.clamp((stage.clientWidth || 640) - 40, 300, 1100));
    const H = 170;
    const padL = 36;
    const padR = 8;
    const padT = 10;
    const padB = 22;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const n = frames.length;
    const slot = plotW / n;
    const bw = Math.min(24, slot * 0.62);
    const y = (p) => padT + plotH * (1 - p);
    let svg = `<svg class="frames-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="AI likelihood for ${n} frames sampled across the video">`;
    [0, 0.5, 1].forEach((t) => {
      svg += `<line x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}" stroke="var(--grid)" stroke-width="1"/>`;
      svg += `<text x="${padL - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${t * 100}%</text>`;
    });
    frames.forEach((f, i) => {
      const x = padL + slot * i + (slot - bw) / 2;
      const sel = i === V.lab.frame;
      if (f.p != null) {
        const top = y(f.p);
        const h = Math.max(2, padT + plotH - top);
        const col = f.p >= 0.6 ? 'var(--ai)' : f.p <= 0.4 ? 'var(--real)' : 'var(--axis)';
        const r4 = Math.min(4, h / 2, bw / 2);
        const yb = padT + plotH;
        const path = `M${x},${yb} L${x},${yb - h + r4} Q${x},${yb - h} ${x + r4},${yb - h} L${x + bw - r4},${yb - h} Q${x + bw},${yb - h} ${x + bw},${yb - h + r4} L${x + bw},${yb} Z`;
        svg += `<path d="${path}" fill="${col}" ${sel ? 'stroke="var(--accent)" stroke-width="2.5"' : ''} pointer-events="none"/>`;
      }
      if (sel) svg += `<rect x="${padL + slot * i + 1}" y="${padT}" width="${slot - 2}" height="${plotH}" fill="var(--accent-softer)" rx="4" pointer-events="none"/>`;
      const tip = `Frame at ${f.t.toFixed(1)} s${f.p != null ? ` — ${Math.round(f.p * 100)}% likely AI` : ''}`;
      svg += `<rect class="col" data-i="${i}" x="${padL + slot * i}" y="${padT}" width="${slot}" height="${plotH}" fill="transparent" data-tip="${esc(tip)}"/>`;
      if (n <= 12 || i % Math.ceil(n / 8) === 0) svg += `<text x="${padL + slot * i + slot / 2}" y="${H - 6}" text-anchor="middle" font-size="10.5" fill="var(--muted)">${f.t.toFixed(1)}s</text>`;
    });
    svg += '</svg>';
    const f = frames[V.lab.frame] || frames[0];
    const verdictWord = f.p == null ? 'Neural models were off' : f.p >= 0.6 ? 'Looks AI-generated' : f.p <= 0.4 ? 'Looks real' : 'Unsure';
    stage.innerHTML = `<div class="frames-wrap">
      <div class="frame-viewer">
        <img src="${f.large || f.thumb}" alt="Frame at ${f.t.toFixed(1)} seconds">
        <div class="frame-info">
          <span class="section-label">Frame ${V.lab.frame + 1} of ${n} · ${f.t.toFixed(1)} s</span>
          <div class="big">${f.p != null ? Math.round(f.p * 100) + '% AI' : f.t.toFixed(1) + ' s'}</div>
          <p>${verdictWord}</p>
          <div class="frame-nav">
            <button class="btn btn-ghost btn-sm" type="button" id="framePrev" ${V.lab.frame === 0 ? 'disabled' : ''} aria-label="Previous frame">${I('left')}</button>
            <button class="btn btn-ghost btn-sm" type="button" id="frameNext" ${V.lab.frame === n - 1 ? 'disabled' : ''} aria-label="Next frame">${I('right')}</button>
            <button class="btn btn-ghost btn-sm" type="button" id="frameSeek">${I('video')}Play from here</button>
          </div>
        </div>
      </div>
      ${hasP ? `<div class="chart-wrap">${svg}</div>` : '<p class="lab-empty">Turn the neural networks on in settings to score every frame.</p>'}
      ${hasP ? `<div class="legend" style="margin-top:6px"><span><i style="background:var(--real)"></i>Looks real (≤ 40%)</span><span><i style="background:var(--axis)"></i>Unsure</span><span><i style="background:var(--ai)"></i>Looks AI (≥ 60%)</span></div>` : ''}
      <div class="frames-strip">${frames
        .map((fr, i) => `<button type="button" data-i="${i}" aria-current="${i === V.lab.frame}" aria-label="Frame at ${fr.t.toFixed(1)} seconds"><img src="${fr.thumb}" alt=""><span>${fr.p != null ? Math.round(fr.p * 100) + '%' : fr.t.toFixed(1) + 's'}</span></button>`)
        .join('')}</div>
    </div>`;
    const go = (i) => {
      V.lab.frame = U.clamp(i, 0, n - 1);
      renderFrames(stage);
    };
    $$('.col', stage).forEach((c) => c.addEventListener('click', () => go(+c.dataset.i)));
    $$('.frames-strip button', stage).forEach((b) => b.addEventListener('click', () => go(+b.dataset.i)));
    $('#framePrev').addEventListener('click', () => go(V.lab.frame - 1));
    $('#frameNext').addEventListener('click', () => go(V.lab.frame + 1));
    $('#frameSeek').addEventListener('click', () => {
      const vid = $('#verdictMedia video');
      if (!vid) return UI.toast('This video cannot be played in this browser.');
      vid.currentTime = f.t;
      vid.scrollIntoView({ behavior: UI.reducedMotion() ? 'auto' : 'smooth', block: 'center' });
      const p = vid.play();
      if (p && p.catch) p.catch(() => {});
    });
  }

  // ================================================================== metadata explorer
  function metaGroups(r) {
    const m = r.meta || {};
    const f = r.file;
    const G = [];
    const group = (id, title, icon) => {
      const g = { id, title, icon, rows: [] };
      G.push(g);
      return (k, v) => {
        if (v != null && v !== '' && v !== false) g.rows.push([k, String(v)]);
      };
    };
    let add = group('file', 'File', 'file');
    add('File name', f.name);
    add('Format', f.format);
    add('File size', U.formatBytes(f.size));
    add('Dimensions', f.width ? `${f.width} × ${f.height} px` : null);
    if (m.jpeg && m.jpeg.quality) {
      add('JPEG quality', `≈ ${m.jpeg.quality.quality} (${m.jpeg.quality.standard ? 'standard libjpeg tables' : 'custom tables'})`);
      add('Chroma subsampling', m.jpeg.subsampling);
      add('Progressive', m.jpeg.progressive ? 'Yes' : 'No');
    }
    if (m.webp) add('WebP encoding', m.webp.lossless && !m.webp.lossy ? 'Lossless' : 'Lossy' + (m.webp.animated ? ', animated' : ''));
    if (m.icc && m.icc.description) add('Colour profile', m.icc.description);
    add('Analysis time', r.timings.total ? (r.timings.total / 1000).toFixed(1) + ' s' : null);

    add = group('capture', 'Camera & capture', 'camera');
    const e = m.exif || {};
    add('Camera make', e.Make);
    add('Camera model', e.Model);
    add('Lens', e.LensModel);
    add('Exposure', TF.evidence.fmtExposure(e));
    add('Date taken', e.DateTimeOriginal || e.DateTime);
    add('GPS location', e.hasGPS ? 'Present' : null);
    add('Maker notes', e.MakerNote ? `${e.MakerNote.length} bytes${e.MakerNote.signature ? ' (' + e.MakerNote.signature + ')' : ''}` : null);
    (m.cameraHints || []).forEach((h) => add('Camera trace', h));

    add = group('prov', 'Provenance & AI labels', 'badge');
    if (m.c2pa && m.c2pa.present) {
      add('Content Credentials', `Present (${m.c2pa.manifestCount} manifest${m.c2pa.manifestCount === 1 ? '' : 's'}, signature not verified)`);
      add('C2PA generator', m.c2pa.generators.join(', '));
      add('C2PA signed by', (m.c2pa.signerOrgs || []).join(', '));
      add('C2PA actions', U.uniq(m.c2pa.actions.map((a) => a.action.replace('c2pa.', '') + (a.agent ? ' (' + a.agent + ')' : ''))).join(', '));
    }
    (m.sourceTypes || []).forEach((s) => add('Digital source type', s.label + ' — via ' + s.via));
    if (m.generator) add('Generator settings', `${m.generator.tool} — ${m.generator.excerpt}`);
    (m.aiHits || []).forEach((h) => add('AI tool mention', `${h.name} (in ${h.where})`));

    add = group('software', 'Software & editing', 'layers');
    add('Software', e.Software);
    const xf = m.xmpFields || {};
    (xf['xmp:CreatorTool'] || []).forEach((t) => add('Creator tool (XMP)', t));
    (xf['stEvt:softwareAgent'] || []).slice(0, 5).forEach((t) => add('Edit history', t));
    (m.editors || []).forEach((t) => add('Editor detected', t));
    if (m.screenshot) add('Screenshot', 'Yes');
    if (m.platform) add('Re-encoded by', m.platform);

    if (r.kind === 'video' && m.video) {
      add = group('video', 'Video container', 'film');
      const v = m.video;
      add('Duration', isFinite(f.duration) ? U.formatDuration(f.duration) : v.duration ? U.formatDuration(v.duration) : null);
      add('Frame rate', v.fps ? v.fps.toFixed(2) + ' fps' : null);
      add('Video codec', v.codec);
      add('Encoder', v.encoder);
      add('Audio track', v.tracks && v.tracks.length ? (v.hasAudio ? 'Yes' : 'No') : null);
      add('Recording device', [v.make, v.model].filter(Boolean).join(' '));
      add('Device software', v.software);
      add('Location tag', v.location);
      add('Container brands', [v.majorBrand, ...(v.brands || [])].filter(Boolean).join(', '));
      if (v.creationTime) add('Container date', new Date(v.creationTime).toISOString().replace('T', ' ').slice(0, 19) + ' UTC');
      Object.keys(v.tags || {})
        .slice(0, 12)
        .forEach((k) => add('Tag ' + k, U.truncate(v.tags[k], 200)));
    }

    add = group('models', 'Neural models', 'cpu');
    if (r.neural) r.neural.models.forEach((x) => add(x.name, x.p != null ? U.pct(x.p) + ' AI (raw output)' : 'unavailable' + (x.error ? ' — ' + x.error : '')));
    else add('Neural models', 'Not run');

    add = group('text', 'Embedded text', 'tag');
    (m.text || []).slice(0, 12).forEach((t) => add(`${t.source} “${t.key}”`, U.truncate(t.value, 500)));
    if (m.iptc) Object.keys(m.iptc).forEach((k) => add('IPTC ' + k, U.truncate(m.iptc[k], 300)));
    (xf['dc:description'] || []).forEach((t) => add('Description (XMP)', U.truncate(t, 300)));
    if (e.UserComment) add('EXIF comment', U.truncate(e.UserComment, 300));
    if (e.ImageDescription) add('EXIF description', U.truncate(e.ImageDescription, 300));

    return G.filter((g) => g.rows.length);
  }

  function renderMeta() {
    const groups = metaGroups(V.r);
    V.metaGroups = groups;
    const host = $('#metaGroups');
    if (!groups.length) {
      host.innerHTML = '<p class="meta-none">This file carries no readable metadata.</p>';
      return;
    }
    host.innerHTML = groups
      .map(
        (g) => `<div class="meta-group" data-g="${g.id}"><h4>${I(g.icon)}${esc(g.title)}</h4>${g.rows
          .map(
            ([k, v], i) =>
              `<div class="meta-row" data-k="${esc(k.toLowerCase())}" data-v="${esc(v.toLowerCase())}"><span class="meta-k" data-raw="${esc(k)}">${esc(k)}</span><span class="meta-v" data-raw="${esc(v)}">${esc(v)}</span><button class="copy-btn" type="button" data-g="${g.id}" data-i="${i}" aria-label="Copy ${esc(k)}">${I('copy')}</button></div>`
          )
          .join('')}</div>`
      )
      .join('') + '<p class="meta-none" id="metaNoHit" hidden>No metadata matches your search.</p>';
    $$('.copy-btn', host).forEach((b) =>
      b.addEventListener('click', () => {
        const g = groups.find((x) => x.id === b.dataset.g);
        const [k, v] = g.rows[+b.dataset.i];
        UI.copy(`${k}: ${v}`, `Copied “${U.truncate(k, 30)}”`);
      })
    );
    const search = $('#metaSearch');
    search.addEventListener('input', () => filterMeta(search.value));
    $('#copyMeta').addEventListener('click', () => {
      const obj = {};
      groups.forEach((g) => (obj[g.title] = Object.fromEntries(g.rows.map(([k, v], i) => [obj[g.title] && k in obj[g.title] ? k + ' ' + i : k, v]))));
      UI.copy(JSON.stringify(obj, null, 2), 'All metadata copied as JSON');
    });
  }

  function highlight(raw, q) {
    if (!q) return esc(raw);
    const i = raw.toLowerCase().indexOf(q);
    if (i < 0) return esc(raw);
    return esc(raw.slice(0, i)) + '<mark>' + esc(raw.slice(i, i + q.length)) + '</mark>' + esc(raw.slice(i + q.length));
  }

  function filterMeta(qRaw) {
    const q = qRaw.trim().toLowerCase();
    let any = false;
    $$('.meta-group').forEach((g) => {
      let vis = 0;
      $$('.meta-row', g).forEach((row) => {
        const hit = !q || row.dataset.k.includes(q) || row.dataset.v.includes(q);
        row.hidden = !hit;
        const k = row.querySelector('.meta-k');
        const v = row.querySelector('.meta-v');
        k.innerHTML = highlight(k.dataset.raw, q);
        v.innerHTML = highlight(v.dataset.raw, q);
        if (hit) vis++;
      });
      g.hidden = !vis;
      if (vis) any = true;
    });
    const none = $('#metaNoHit');
    if (none) none.hidden = any;
  }

  // ================================================================== export
  function summaryText(r) {
    const f = r.fusion;
    const lines = [
      `TrueFrame result for ${r.file.name}`,
      `${U.pct(f.p)} AI likelihood — ${f.verdict.label} (${f.confidence} confidence)`,
      f.summary,
      '',
      'Key findings:',
    ];
    r.signals
      .filter((s) => s.direction !== 'neutral')
      .sort((a, b) => Math.abs(b.llr) - Math.abs(a.llr))
      .slice(0, 6)
      .forEach((s) => lines.push(`- ${s.title} (${(STRENGTH_WORDS[s.direction][s.strength] || '').toLowerCase()})`));
    lines.push('', `Analysed ${new Date(r.createdAt).toLocaleString()} — an estimate from evidence, not proof.`);
    return lines.join('\n');
  }

  function downloadReport(r) {
    const skip = new Set(['visuals', 'objectUrl']);
    const json = JSON.stringify(r, (k, v) => (skip.has(k) || v instanceof Uint8Array ? undefined : v), 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = (r.file.name || 'file').replace(/\.[^.]+$/, '') + '.trueframe.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    UI.toast('Report downloaded');
  }
})(window);
