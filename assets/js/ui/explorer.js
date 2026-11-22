/*
 * TrueFrame — landing-page "detection layers" explorer with animated illustrations.
 */
(function (root) {
  'use strict';
  const I = root.TFIcon;
  const UI = root.TFUI;

  // ---- illustrations (inline SVG, animated with CSS; colours match the UI palette)
  const ink = '#4f4e4a';
  const line = 'rgba(11,11,11,.12)';

  function artProvenance() {
    const rows = [
      ['File header', '#f2f2ee', ink],
      ['EXIF · camera data', '#f2f2ee', ink],
      ['XMP · “AI-generated” label', 'rgba(91,75,219,.12)', '#5b4bdb'],
      ['C2PA · Content Credentials', 'rgba(227,73,72,.12)', '#c23b3a'],
    ];
    return `<svg viewBox="0 0 360 240" aria-hidden="true">
      <defs><linearGradient id="exPx" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cfd8f3"/><stop offset=".5" stop-color="#e9d9f2"/><stop offset="1" stop-color="#f6dccf"/></linearGradient></defs>
      <rect x="70" y="18" width="220" height="204" rx="14" fill="#fff" stroke="${line}"/>
      ${rows.map((r, i) => `<rect x="84" y="${36 + i * 32}" width="192" height="24" rx="7" fill="${r[1]}"/><text x="96" y="${52 + i * 32}" font-size="10.5" font-weight="600" fill="${r[2]}">${r[0]}</text>`).join('')}
      <rect x="84" y="164" width="192" height="42" rx="7" fill="url(#exPx)"/><text x="180" y="190" font-size="11" font-weight="600" fill="${ink}" text-anchor="middle">pixel data</text>
      <rect class="ex-scanbox" x="78" y="32" width="204" height="32" rx="9" fill="none" stroke="#5b4bdb" stroke-width="2.5"/>
      <g class="ex-popbadge"><rect x="236" y="126" width="112" height="30" rx="15" fill="#e34948"/><text x="292" y="145" text-anchor="middle" fill="#fff" font-size="12" font-weight="700">AI label found</text></g>
    </svg>`;
  }

  function artNeural() {
    const cols = [
      [150, [70, 100, 130, 160]],
      [205, [55, 85, 115, 145, 175]],
      [260, [85, 115, 145]],
    ];
    let edges = '';
    for (let c = 0; c < cols.length - 1; c++) {
      for (const y1 of cols[c][1]) for (const y2 of cols[c + 1][1]) edges += `<line x1="${cols[c][0]}" y1="${y1}" x2="${cols[c + 1][0]}" y2="${y2}" stroke="rgba(91,75,219,.14)"/>`;
    }
    for (const y1 of [70, 100, 130, 160]) edges += `<line x1="112" y1="115" x2="150" y2="${y1}" stroke="rgba(91,75,219,.14)"/>`;
    let nodes = '';
    cols.forEach(([x, ys], c) => ys.forEach((y, i) => (nodes += `<circle class="ex-node" cx="${x}" cy="${y}" r="7" fill="#5b4bdb" style="animation-delay:${c * 0.35 + i * 0.08}s"/>`)));
    return `<svg viewBox="0 0 360 240" aria-hidden="true">
      <defs><linearGradient id="exImg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#bcd3f5"/><stop offset="1" stop-color="#f3c9c6"/></linearGradient></defs>
      <rect x="22" y="70" width="90" height="90" rx="12" fill="url(#exImg)"/><circle cx="52" cy="100" r="10" fill="#fff" opacity=".8"/><path d="M28 152l26-28 18 16 14-12 22 24z" fill="#fff" opacity=".7"/>
      ${edges}${nodes}
      <line x1="260" y1="115" x2="286" y2="115" stroke="rgba(91,75,219,.3)"/>
      <text x="292" y="98" font-size="11" font-weight="700" fill="${ink}">AI 87%</text>
      <rect x="292" y="106" width="56" height="12" rx="6" fill="#e7e7e1"/><rect class="ex-grow" x="292" y="106" width="49" height="12" rx="6" fill="#e34948"/>
      <text x="292" y="140" font-size="11" font-weight="700" fill="${ink}">Real 13%</text>
      <rect x="292" y="148" width="56" height="12" rx="6" fill="#e7e7e1"/><rect class="ex-grow" x="292" y="148" width="8" height="12" rx="6" fill="#2a78d6"/>
    </svg>`;
  }

  function artFrequency() {
    let peaks = '';
    let k = 0;
    for (let i = -3; i <= 3; i++) {
      for (let j = -3; j <= 3; j++) {
        if (!i && !j) continue;
        peaks += `<circle class="ex-peak" cx="${180 + i * 25}" cy="${120 + j * 25}" r="4" fill="#5b4bdb" style="animation-delay:${((k++ * 0.37) % 2).toFixed(2)}s"/>`;
      }
    }
    return `<svg viewBox="0 0 360 240" aria-hidden="true">
      <defs><radialGradient id="exGlow"><stop offset="0" stop-color="#3b2db5"/><stop offset=".18" stop-color="#8f81ef"/><stop offset=".5" stop-color="#e2def8"/><stop offset="1" stop-color="#fff"/></radialGradient></defs>
      <rect x="80" y="20" width="200" height="200" rx="12" fill="#fff" stroke="${line}"/>
      <circle cx="180" cy="120" r="95" fill="url(#exGlow)"/>
      <path d="M180 20v200M80 120h200" stroke="rgba(91,75,219,.25)"/>
      ${peaks}
      <g><rect x="232" y="196" width="120" height="26" rx="13" fill="#fff" stroke="${line}"/><text x="292" y="213" text-anchor="middle" font-size="11" font-weight="600" fill="${ink}">grid = every 8 px</text></g>
    </svg>`;
  }

  function artSensor() {
    const col = { R: '#f4b9b8', G: '#bfe3c7', B: '#b9d1f3' };
    let cells = '';
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 8; c++) {
        const k = r % 2 === 0 ? (c % 2 === 0 ? 'R' : 'G') : c % 2 === 0 ? 'G' : 'B';
        cells += `<rect x="${76 + c * 26}" y="${42 + r * 26}" width="24" height="24" rx="4" fill="${col[k]}"/><text x="${88 + c * 26}" y="${58 + r * 26}" font-size="10" font-weight="700" fill="rgba(17,17,16,.45)" text-anchor="middle">${k}</text>`;
      }
    }
    return `<svg viewBox="0 0 360 240" aria-hidden="true">
      ${cells}
      <g class="ex-lens"><circle cx="110" cy="90" r="34" fill="rgba(255,255,255,.25)" stroke="#5b4bdb" stroke-width="3"/><line x1="134" y1="114" x2="152" y2="132" stroke="#5b4bdb" stroke-width="6" stroke-linecap="round"/></g>
      <g><rect x="250" y="200" width="100" height="26" rx="13" fill="#fff" stroke="${line}"/><text x="300" y="217" text-anchor="middle" font-size="11" font-weight="600" fill="${ink}">Bayer pattern</text></g>
    </svg>`;
  }

  function artMetadata() {
    const rows = [
      ['Make', 'Canon'],
      ['Model', 'EOS R5'],
      ['Exposure', '1/250 s · f/2.8'],
      ['ISO', '100'],
      ['GPS', '48.85° N, 2.35° E'],
    ];
    return `<svg viewBox="0 0 360 240" aria-hidden="true">
      <rect x="66" y="22" width="228" height="196" rx="14" fill="#fff" stroke="${line}"/>
      <text x="84" y="48" font-size="12" font-weight="800" fill="#111110">EXIF</text><text x="276" y="48" font-size="10" font-weight="600" fill="#7a7872" text-anchor="end">camera data</text>
      ${rows
        .map(
          (r, i) => `<line x1="84" x2="276" y1="${62 + i * 30}" y2="${62 + i * 30}" stroke="${line}"/>
        <text x="84" y="${81 + i * 30}" font-size="11" fill="#7a7872">${r[0]}</text><text x="250" y="${81 + i * 30}" font-size="11" font-weight="600" fill="#111110" text-anchor="end">${r[1]}</text>
        <g class="ex-check" style="animation-delay:${i * 0.45}s"><circle cx="266" cy="${77 + i * 30}" r="7" fill="#2a78d6"/><path d="M262.5 ${77 + i * 30}l2.5 2.5 4.5-5" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/></g>`
        )
        .join('')}
    </svg>`;
  }

  function artVideo() {
    const scores = [0.3, 0.8, 0.9, 0.85, 0.4, 0.92];
    let frames = '';
    scores.forEach((s, i) => {
      const x = 44 + i * 46;
      const h = 8 + s * 46;
      frames += `<rect x="${x}" y="98" width="40" height="56" rx="4" fill="${i % 2 ? '#dcd6f7' : '#d3e2f7'}"/>`;
      frames += `<rect class="ex-rise" x="${x + 12}" y="${86 - h}" width="16" height="${h}" rx="4" fill="${s >= 0.6 ? '#e34948' : '#2a78d6'}" style="animation-delay:${i * 0.25}s"/>`;
    });
    let holes = '';
    for (let i = 0; i < 18; i++) holes += `<rect x="${42 + i * 16}" y="90" width="8" height="4" rx="1" fill="#fff"/><rect x="${42 + i * 16}" y="158" width="8" height="4" rx="1" fill="#fff"/>`;
    return `<svg viewBox="0 0 360 240" aria-hidden="true">
      <rect x="36" y="86" width="288" height="80" rx="8" fill="#c9ccd8"/>
      ${holes}${frames}
      <line x1="86" x2="324" y1="86" y2="86" stroke="${line}"/>
      <rect class="ex-playhead" x="40" y="22" width="2" height="148" rx="1" fill="#5b4bdb"/>
      <g><rect x="110" y="190" width="140" height="26" rx="13" fill="#fff" stroke="${line}"/><text x="180" y="207" text-anchor="middle" font-size="11" font-weight="600" fill="${ink}">score for every frame</text></g>
    </svg>`;
  }

  const LAYERS = [
    {
      id: 'provenance', icon: 'badge', title: 'Provenance & AI labels', short: 'Reads the file’s own records',
      text: 'Many AI tools now sign or label what they make. TrueFrame reads C2PA Content Credentials, IPTC “AI-generated” labels and the settings that tools like Stable Diffusion, ComfyUI and Midjourney write into their files.',
      strength: 5, strengthWord: 'Decisive when present',
      catches: ['Files straight from ChatGPT, Gemini, Firefly, Midjourney, Sora…', 'Stable Diffusion and ComfyUI generation settings'],
      misses: ['Screenshots and re-uploads, which strip these records'],
      art: artProvenance,
    },
    {
      id: 'neural', icon: 'cpu', title: 'Neural networks', short: 'Two AI models judge the pixels',
      text: 'Two open-source vision transformers, trained on large sets of real and generated pictures, run locally in your browser. Their votes are combined with weights tuned on real and AI test images.',
      strength: 4, strengthWord: 'Strong',
      catches: ['The typical look of generated textures, light and skin', 'Works even when all metadata is gone'],
      misses: ['Brand-new generators the models have never seen', 'Some unusual real photos can be over-called'],
      art: artNeural,
    },
    {
      id: 'frequency', icon: 'wave', title: 'Frequency forensics', short: 'A Fourier transform reveals hidden grids',
      text: 'Image generators build pictures by repeatedly doubling their size. That leaves a faint pattern repeating every 8 pixels — invisible to the eye, but a regular grid of sharp dots in the frequency spectrum.',
      strength: 2, strengthWord: 'Specific but rare',
      catches: ['Upsampling grids in PNG and other lossless AI images'],
      misses: ['JPEG compression and resizing erase or mask the grid'],
      art: artFrequency,
    },
    {
      id: 'sensor', icon: 'camera', title: 'Camera-sensor forensics', short: 'Looks for a real sensor’s fingerprints',
      text: 'A real camera sees colour through a mosaic of red, green and blue filters, then fills in the gaps. That leaves a microscopic 2 × 2 pattern and even sensor noise — things generators don’t reproduce.',
      strength: 3, strengthWord: 'Strong for camera originals',
      catches: ['Untouched camera and phone originals'],
      misses: ['The traces vanish when a photo is resized or heavily compressed'],
      art: artSensor,
    },
    {
      id: 'metadata', icon: 'file', title: 'Metadata & file traits', short: 'Camera data, sizes and names',
      text: 'Real photos usually carry camera make, lens and exposure data. AI images come out at typical resolutions and with typical download names. Each clue is weak alone, but they add up.',
      strength: 2, strengthWord: 'Supporting evidence',
      catches: ['Exposure data from real cameras', 'Native generator resolutions and file names'],
      misses: ['Metadata is easy to strip — or to fake'],
      art: artMetadata,
    },
    {
      id: 'video', icon: 'film', title: 'Video analysis', short: 'Containers and frames',
      text: 'For videos TrueFrame reads the container — phone recording tags, GPS, encoder, audio track, length — and scores frames sampled across the whole clip, so mixed real/AI edits show up too.',
      strength: 3, strengthWord: 'Moderate',
      catches: ['Phone and camera recording tags', 'AI-looking frames anywhere in the clip'],
      misses: ['Videos re-encoded by apps lose their tags'],
      art: artVideo,
    },
  ];

  UI.renderExplorer = function (host) {
    host.innerHTML = `<div class="ex-list" role="tablist" aria-orientation="vertical" aria-label="Detection layers">${LAYERS.map(
      (l, i) =>
        `<button class="ex-tab" type="button" role="tab" id="ex-tab-${l.id}" aria-selected="${i === 0}" aria-controls="exPanel" tabindex="${i === 0 ? 0 : -1}" data-i="${i}"><span class="ex-icon">${I(l.icon)}</span><span><strong>${l.title}</strong><small>${l.short}</small></span></button>`
    ).join('')}</div><div class="card ex-panel" id="exPanel" role="tabpanel"></div>`;
    const tabs = UI.$$('.ex-tab', host);
    const panel = UI.$('#exPanel', host);

    function select(i, focus) {
      const l = LAYERS[i];
      tabs.forEach((t, k) => {
        t.setAttribute('aria-selected', String(k === i));
        t.tabIndex = k === i ? 0 : -1;
      });
      if (focus) tabs[i].focus();
      panel.setAttribute('aria-labelledby', 'ex-tab-' + l.id);
      panel.innerHTML = `<div class="ex-art stage-bg">${l.art()}</div>
        <div class="ex-copy">
          <h3>${l.title}</h3>
          <p>${l.text}</p>
          <div class="ex-strength"><span>Weight in the verdict</span><span class="bars" aria-hidden="true">${[1, 2, 3, 4, 5].map((k) => `<i class="${k <= l.strength ? 'on' : ''}"></i>`).join('')}</span><strong>${l.strengthWord}</strong></div>
          <div class="ex-lists">
            <div class="yes"><h4>Catches</h4><ul>${l.catches.map((c) => `<li>${I('check')}<span>${c}</span></li>`).join('')}</ul></div>
            <div class="no"><h4>Can miss</h4><ul>${l.misses.map((c) => `<li>${I('x')}<span>${c}</span></li>`).join('')}</ul></div>
          </div>
        </div>`;
      panel.classList.remove('swap');
      void panel.offsetWidth;
      panel.classList.add('swap');
      // restart the auto-tour progress line on the newly selected tab
      host.classList.remove('tick');
      void host.offsetWidth;
      host.classList.add('tick');
    }

    // Auto-tour: while the explorer is on screen and untouched, step through the layers.
    // Hovering pauses it; clicking or using the keyboard hands control to the user for good.
    const DUR = 6500;
    let auto = !UI.reducedMotion() && 'IntersectionObserver' in window;
    let inView = false;
    let hover = false;
    let timer = null;
    host.style.setProperty('--tour', DUR + 'ms');
    const current = () => tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    const sync = () => {
      clearTimeout(timer);
      const on = auto && inView && !hover;
      host.classList.toggle('is-touring', on);
      if (!on) return;
      host.classList.remove('tick');
      void host.offsetWidth;
      host.classList.add('tick');
      timer = setTimeout(function next() {
        select((current() + 1) % tabs.length);
        timer = setTimeout(next, DUR);
      }, DUR);
    };
    const stopTour = () => {
      auto = false;
      sync();
    };
    // The illustrations animate continuously: pause them whenever the explorer is off-screen.
    if ('IntersectionObserver' in window) {
      host.classList.add('is-offscreen');
      new IntersectionObserver(([en]) => host.classList.toggle('is-offscreen', !en.isIntersecting)).observe(host);
    }
    if (auto) {
      const io = new IntersectionObserver(
        ([en]) => {
          inView = en.isIntersecting;
          sync();
          if (!auto) io.disconnect();
        },
        { threshold: 0.4 }
      );
      io.observe(host);
      host.addEventListener('mouseenter', () => {
        hover = true;
        sync();
      });
      host.addEventListener('mouseleave', () => {
        hover = false;
        sync();
      });
      host.addEventListener('pointerdown', stopTour);
      host.addEventListener('keydown', stopTour);
    }

    tabs.forEach((t, i) => t.addEventListener('click', () => select(i)));
    host.querySelector('.ex-list').addEventListener('keydown', (e) => {
      const cur = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
      let next = null;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (cur + 1) % tabs.length;
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (cur - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = tabs.length - 1;
      if (next != null) {
        e.preventDefault();
        select(next, true);
      }
    });
    select(0);
  };
})(window);
