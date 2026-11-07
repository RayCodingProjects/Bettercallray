(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const editor = $('#editor');
  const nameEl = $('#name');
  const menuBtn = $('#menuBtn');
  const menuEl = $('#menu');
  const exportSub = $('#exportSub');
  const slashMenu = $('#slashMenu');
  const bubble = $('#bubble');
  const fileInput = $('#fileInput');
  const savedEl = $('#saved');
  const fontSeg = $('#fontSeg');
  // Opened from HABERVERSE: the page belongs to a file there, and saves go back to it.
  const EMBED = window.parent !== window && /[?&]embed=1/.test(location.search);
  let docPath = null;
  let lastSent = '';
  let lastName = '';

  const KEY = 'ultidash.page.v1';
  const OLD_KEY = 'ultidash.notes.v1';
  const MIN_SIZE = 12;
  const MAX_SIZE = 32;
  const EASE = 'cubic-bezier(.32,.72,0,1)';
  const SPRING = 'cubic-bezier(.34,1.32,.64,1)';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const animate = (el, frames, opts) => {
    if (reduceMotion.matches || !el || !el.animate) return null;
    try { return el.animate(frames, opts); } catch (e) { return null; }
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, reduceMotion.matches ? 0 : ms));

  const COMMANDS = [
    { id: 'todo',    label: 'To-do list',    icon: '☑︎', keys: ['todo', 'to-do', 'task', 'check', 'checklist'] },
    { id: 'h1',      label: 'Heading 1',     icon: 'H1', keys: ['h1', 'heading', 'title'] },
    { id: 'h2',      label: 'Heading 2',     icon: 'H2', keys: ['h2', 'heading'] },
    { id: 'h3',      label: 'Heading 3',     icon: 'H3', keys: ['h3', 'heading'] },
    { id: 'p',       label: 'Text',          icon: 'T',  keys: ['text', 'paragraph', 'normal'] },
    { id: 'ul',      label: 'Bulleted list', icon: '•', keys: ['bullet', 'list', 'ul'] },
    { id: 'ol',      label: 'Numbered list', icon: '1.', keys: ['numbered', 'number', 'list', 'ol'] },
    { id: 'quote',   label: 'Quote',         icon: '“', keys: ['quote'] },
    { id: 'divider', label: 'Divider',       icon: '—', keys: ['divider', 'line', 'hr'] }
  ];

  const MARKDOWN = {
    '#': 'h1', '##': 'h2', '###': 'h3',
    '-': 'ul', '*': 'ul', '1.': 'ol',
    '[]': 'todo', '[ ]': 'todo',
    '>': 'quote', '---': 'divider'
  };

  const SIZES = [['s-small', .85], ['s-normal', 1], ['s-large', 1.3], ['s-huge', 1.7]];
  const SIZE_CLASSES = SIZES.map((s) => s[0]);
  const FONT_CLASSES = ['f-sans', 'f-serif', 'f-mono'];
  const IMG_CLASSES = ['img-center', 'img-right', 'img-wrap-left', 'img-wrap-right', 'img-square', 'img-circle'];
  const KEEP_CLASSES = new Set(['todo'].concat(SIZE_CLASSES, FONT_CLASSES, IMG_CLASSES));

  /* ================= Saving (in this browser) ================= */

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };

  const settings = { font: 'sans', size: 18 };
  let saveTimer = null;
  let saveBlocked = false;

  // The page's HTML without any loading cards that are still on screen.
  function contentHTML() {
    if (!editor.querySelector('.drop-skeleton')) return editor.innerHTML;
    const copy = editor.cloneNode(true);
    copy.querySelectorAll('.drop-skeleton').forEach((n) => n.remove());
    return copy.innerHTML;
  }

  function saveNow() {
    clearTimeout(saveTimer);
    if (EMBED) return postSave(false);
    const ok = store.set(KEY, {
      name: named ? nameEl.value.trim() || UNTITLED : UNTITLED,
      named,
      html: contentHTML(),
      font: settings.font,
      size: settings.size
    });
    if (!ok) {
      saveBlocked = true;
      showStatus('Too big to save in this browser. Export it to keep it.', true, 0);
    } else if (saveBlocked) {
      saveBlocked = false;
      showStatus('Saved', false, 1400);
    }
    return ok;
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }

  let statusTimer = null;
  function showStatus(text, warn, ms) {
    $('#savedText').textContent = text;
    savedEl.classList.toggle('warn', !!warn);
    savedEl.classList.add('show');
    clearTimeout(statusTimer);
    if (ms) statusTimer = setTimeout(() => savedEl.classList.remove('show'), ms);
  }
  const flashSaved = () => showStatus('Saved', false, 1400);

  function load() {
    let data = store.get(KEY);
    if (!data) {
      const old = store.get(OLD_KEY);
      if (old && Array.isArray(old.docs)) {
        const doc = old.docs
          .filter((d) => d && d.title !== 'Getting started' && (d.html || '').replace(/<[^>]*>/g, '').trim())
          .sort((a, b) => (b.updated || 0) - (a.updated || 0))[0];
        if (doc) data = { name: doc.title, html: doc.html };
      }
    }
    data = data || {};
    named = data.named != null ? !!data.named : !!(data.name && !/^untitled( document)?$/i.test(String(data.name).trim()));
    nameEl.value = named ? data.name : UNTITLED;
    editor.innerHTML = safeHTML(data.html) || '<p><br></p>';
    if (!editor.firstChild) editor.innerHTML = '<p><br></p>';
    if (['sans', 'serif', 'mono'].includes(data.font)) settings.font = data.font;
    if (data.size >= MIN_SIZE && data.size <= MAX_SIZE) settings.size = data.size;
  }

  /* ================= Name, the Google Docs way ================= */
  // Until you name it, the page is "Untitled document". Clicking the name suggests the page's
  // first words, selected so typing replaces them; on an empty page the field opens blank.
  // Clearing the name brings "Untitled document" back, and Esc cancels.

  const UNTITLED = 'Untitled document';
  let named = false;
  let nameBefore = '';
  let nameCancelled = false;
  let clickedIntoName = false;
  let caretBeforeName = null;
  const measure = document.createElement('canvas').getContext('2d');

  function sizeName() {
    const cs = getComputedStyle(nameEl);
    measure.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    nameEl.style.width = Math.ceil(measure.measureText(nameEl.value || nameEl.placeholder).width + 22) + 'px';
    document.title = nameEl.value.trim() || UNTITLED;
  }

  function firstWords() {
    const line = (editor.innerText || '').split('\n').map((s) => s.replace(/ /g, ' ').trim()).find(Boolean) || '';
    const text = line.replace(/^([-*•]|\d+[.)]|\[[ xX]?\])\s+/, '');
    const sentence = (/^(.+?[.!?])(\s|$)/.exec(text) || [text, text])[1]; // stop at the end of the first sentence
    return sentence.split(/\s+/).slice(0, 7).join(' ').slice(0, 60).replace(/[\s.,;:!?\-–—]+$/, '');
  }

  function rememberCaret() {
    const s = sel();
    if (s.rangeCount && inEditor(s.anchorNode)) caretBeforeName = s.getRangeAt(0).cloneRange();
  }
  function backToPage() {
    editor.focus({ preventScroll: true });
    const s = sel();
    if (caretBeforeName && inEditor(caretBeforeName.startContainer)) { s.removeAllRanges(); s.addRange(caretBeforeName); }
    else placeCaret(editor.lastElementChild || editor, true);
  }

  nameEl.addEventListener('mousedown', () => {
    if (document.activeElement !== nameEl) { clickedIntoName = true; rememberCaret(); }
  });
  // Keep the suggestion selected after the click that focused the field.
  nameEl.addEventListener('mouseup', (e) => { if (clickedIntoName) { e.preventDefault(); clickedIntoName = false; } });
  nameEl.addEventListener('focus', () => {
    if (!caretBeforeName) rememberCaret();
    nameBefore = nameEl.value;
    if (!named) {
      const guess = firstWords();
      nameEl.value = guess;
      sizeName();
      if (guess) animate(nameEl, [{ backgroundColor: 'rgba(0,122,255,.18)' }, { backgroundColor: 'rgba(0,122,255,0)' }], { duration: 900, easing: EASE });
    }
    nameEl.select();
  });
  nameEl.addEventListener('input', sizeName);
  nameEl.addEventListener('blur', () => {
    if (nameCancelled) {
      nameCancelled = false;
      nameEl.value = nameBefore;
    } else {
      const v = nameEl.value.replace(/\s+/g, ' ').trim();
      named = !!v;
      nameEl.value = v || UNTITLED;
      saveNow();
    }
    sizeName();
    caretBeforeName = null;
  });
  nameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      if (e.key === 'Escape') nameCancelled = true;
      backToPage();
    }
  });
  const fileBase = () => (nameEl.value.trim() || UNTITLED).replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);

  /* ================= Page font and size ================= */

  function placeThumb(seg) {
    const on = seg.querySelector('button.on');
    const thumb = seg.querySelector('.thumb');
    if (!on || !thumb) return;
    thumb.style.width = on.offsetWidth + 'px';
    thumb.style.transform = 'translateX(' + on.offsetLeft + 'px)';
  }

  function applySettings() {
    editor.dataset.font = settings.font;
    editor.style.setProperty('--size', settings.size + 'px');
    $('#sizeVal').textContent = settings.size;
    fontSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.font === settings.font));
    placeThumb(fontSeg);
    const [down, up] = document.querySelectorAll('.stepper button');
    down.disabled = settings.size <= MIN_SIZE;
    up.disabled = settings.size >= MAX_SIZE;
  }

  fontSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.font === settings.font) return;
    settings.font = b.dataset.font;
    applySettings();
    animate(editor, [{ opacity: .35 }, { opacity: 1 }], { duration: 320, easing: EASE });
    scheduleSave();
  });

  document.querySelector('.stepper').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const step = Number(b.dataset.step);
    settings.size = Math.min(MAX_SIZE, Math.max(MIN_SIZE, settings.size + step));
    applySettings();
    animate($('#sizeVal'), [
      { opacity: 0, transform: 'translateY(' + (step > 0 ? 6 : -6) + 'px)' },
      { opacity: 1, transform: 'none' }
    ], { duration: 220, easing: EASE });
    scheduleSave();
  });

  /* ================= The ⋯ menu ================= */

  function setExport(open) {
    exportSub.classList.toggle('open', open);
    menuEl.querySelector('[data-act="export"]').setAttribute('aria-expanded', String(open));
    exportSub.querySelectorAll('.menu-item').forEach((b, i) => {
      b.tabIndex = open ? 0 : -1;
      b.style.transitionDelay = open ? (40 + i * 35) + 'ms' : '0ms';
    });
  }
  function openMenu() {
    spot = null;
    rememberSpot();
    hideBubble();
    closeSlash();
    menuEl.classList.add('open');
    menuBtn.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => fontSeg.classList.add('ready'));
  }
  function closeMenu() {
    if (!menuEl.classList.contains('open')) return;
    menuEl.classList.remove('open');
    menuBtn.setAttribute('aria-expanded', 'false');
    setTimeout(() => setExport(false), 200);
  }
  menuBtn.addEventListener('click', () => (menuEl.classList.contains('open') ? closeMenu() : openMenu()));
  document.addEventListener('mousedown', (e) => {
    if (menuEl.classList.contains('open') && !e.target.closest('.menu-wrap')) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menuEl.classList.contains('open')) { closeMenu(); menuBtn.focus(); }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (EMBED) postSave(true);
      else if (saveNow()) flashSaved();
    }
  });

  menuEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'export') { setExport(!exportSub.classList.contains('open')); return; }
    closeMenu();
    if (act === 'print') { saveNow(); setTimeout(() => window.print(), 220); }
    else if (act === 'pdf') exportPdf();
    else if (act === 'word') exportWord();
    else if (act === 'text') exportText();
    else if (act === 'import' || act === 'image') {
      rememberSpot();
      const input = act === 'image' ? imageInput : fileInput;
      input.value = '';
      input.click();
    }
  });

  /* ================= Download / export ================= */

  function saveFile(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim();

  /* ---------- Libraries, loaded only the first time a feature needs them ---------- */

  const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/';
  const LIBS = {
    pdfmake: [CDN + 'pdfmake/0.2.7/pdfmake.min.js', CDN + 'pdfmake/0.2.7/vfs_fonts.js'],
    mammoth: [CDN + 'mammoth/1.6.0/mammoth.browser.min.js'],
    pdfjs: [CDN + 'pdf.js/3.11.174/pdf.min.js', CDN + 'pdf.js/3.11.174/pdf.worker.min.js'],
    jszip: [CDN + 'jszip/3.10.1/jszip.min.js'],
    xlsx: [CDN + 'xlsx/0.18.5/xlsx.full.min.js']
  };
  const libLoads = {};
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = resolve;
      s.onerror = () => { s.remove(); reject(Object.assign(new Error('offline'), { offline: true })); };
      document.head.appendChild(s);
    });
  }
  function need(name) {
    if (!libLoads[name]) {
      libLoads[name] = LIBS[name].reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve());
      libLoads[name].catch(() => { libLoads[name] = null; });
    }
    return libLoads[name];
  }

  /* ---------- PDF export: a real PDF file with selectable text ---------- */

  const PDF_W = 612 - 2 * 60; // letter page width minus side margins, in points
  let pdfBusy = false;

  function pdfRuns(node, style, out, base) {
    const kids = Array.from(node.childNodes);
    kids.forEach((n, i) => {
      if (n.nodeType === 3) {
        const t = n.data.replace(/ /g, ' ');
        if (t) out.push(Object.assign({ text: t }, style));
        return;
      }
      if (n.nodeType !== 1) return;
      const tag = n.tagName;
      if (tag === 'BR') { out.push({ text: '\n' }); return; }
      if (/^(IMG|UL|OL|TABLE)$/.test(tag)) return;
      const s = Object.assign({}, style);
      if (tag === 'B' || tag === 'STRONG') s.bold = true;
      if (tag === 'I' || tag === 'EM') s.italics = true;
      if (tag === 'U') s.decoration = 'underline';
      if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') s.decoration = 'lineThrough';
      if (tag === 'A' && n.getAttribute('href')) { s.link = n.href; s.color = '#007aff'; }
      SIZES.forEach(([c, k]) => { if (n.classList.contains(c)) s.fontSize = base * k; });
      pdfRuns(n, s, out, base);
      if (/^(P|DIV|H[1-6]|BLOCKQUOTE|PRE)$/.test(tag) && i < kids.length - 1) out.push({ text: '\n' });
    });
    return out;
  }

  function pdfImage(img) {
    if (!img.naturalWidth) return null;
    let src = img.getAttribute('src') || '';
    if (!/^data:image\/(png|jpe?g);/i.test(src)) {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        src = c.toDataURL('image/png');
      } catch (e) { return null; }
    }
    const r = img.getBoundingClientRect();
    const shown = r.width || img.naturalWidth;
    const out = { image: src, width: Math.min(PDF_W, shown * .75), margin: [0, 4, 0, 8] };
    if (img.style.aspectRatio && r.width) out.height = out.width * r.height / r.width;
    if (img.classList.contains('img-center')) out.alignment = 'center';
    else if (img.classList.contains('img-right') || img.classList.contains('img-wrap-right')) out.alignment = 'right';
    return out;
  }

  function pdfList(list, base) {
    const items = [];
    const sub = (x) => (x.tagName === 'OL' ? { ol: pdfList(x, base) } : { ul: pdfList(x, base) });
    for (const c of list.children) {
      if (c.tagName === 'UL' || c.tagName === 'OL') { items.push(sub(c)); continue; }
      if (c.tagName !== 'LI') continue;
      const runs = pdfRuns(c, {}, [], base);
      const item = { text: runs.length ? runs : ' ' };
      const nested = Array.from(c.children).filter((x) => x.tagName === 'UL' || x.tagName === 'OL');
      items.push(nested.length ? { stack: [item].concat(nested.map(sub)) } : item);
    }
    return items;
  }

  function pdfTodo(list, base, nested) {
    const out = [];
    let done = 0;
    let total = 0;
    const r = base * .42;
    for (const li of list.children) {
      if (li.tagName === 'UL') { out.push({ stack: pdfTodo(li, base, true), margin: [base * 1.4, 0, 0, 0] }); continue; }
      if (li.tagName !== 'LI') continue;
      total++;
      const on = li.getAttribute('data-checked') === 'true';
      if (on) done++;
      const box = on
        ? [{ type: 'ellipse', x: r, y: r, r1: r, r2: r, color: '#007aff' },
           { type: 'polyline', lineWidth: 1.3, lineColor: '#ffffff', points: [{ x: r * .55, y: r }, { x: r * .88, y: r * 1.33 }, { x: r * 1.48, y: r * .68 }] }]
        : [{ type: 'ellipse', x: r, y: r, r1: r, r2: r, lineColor: '#c7c7cc', lineWidth: 1 }];
      const runs = pdfRuns(li, on ? { color: '#86868b', decoration: 'lineThrough' } : {}, [], base);
      out.push({
        columns: [{ width: r * 2 + 4, canvas: box, margin: [0, base * .22, 0, 0] }, { width: '*', text: runs.length ? runs : ' ' }],
        columnGap: 5,
        margin: [0, 1.5, 0, 1.5]
      });
    }
    if (!nested && total) out.push({ text: done + ' of ' + total + ' done', fontSize: 8, color: '#86868b', margin: [0, 2, 0, base * .6] });
    return out;
  }

  function pdfTable(table, base) {
    const rows = Array.from(table.rows).slice(0, 500);
    if (!rows.length) return [];
    const cols = Math.min(20, Math.max.apply(null, rows.map((r) => r.cells.length)));
    if (!cols) return [];
    const body = rows.map((r) => {
      const cells = Array.from(r.cells).slice(0, cols).map((c) => {
        const head = c.tagName === 'TH';
        const runs = pdfRuns(c, head ? { bold: true } : {}, [], base);
        const cell = { text: runs.length ? runs : ' ', fontSize: base * .88 };
        if (head) cell.fillColor = '#f5f5f7';
        return cell;
      });
      while (cells.length < cols) cells.push({ text: ' ' });
      return cells;
    });
    const headerRows = Array.from(rows[0].cells).every((c) => c.tagName === 'TH') ? 1 : 0;
    const line = () => '#e5e5ea';
    return [{
      table: { headerRows, widths: Array(cols).fill('*'), body },
      layout: { hLineColor: line, vLineColor: line, hLineWidth: () => .6, vLineWidth: () => .6, paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 3, paddingBottom: () => 3 },
      margin: [0, 4, 0, 10]
    }];
  }

  function pdfBlock(el, base) {
    const tag = el.tagName;
    if (el.classList.contains('drop-skeleton')) return [];
    const runs = () => { const r = pdfRuns(el, {}, [], base); return r.length ? r : ' '; };
    if (/^H[1-3]$/.test(tag)) return [{ text: runs(), style: tag.toLowerCase() }];
    if (tag === 'UL' && el.classList.contains('todo')) return pdfTodo(el, base, false);
    if (tag === 'UL') return [{ ul: pdfList(el, base), margin: [0, 0, 0, base * .5] }];
    if (tag === 'OL') return [{ ol: pdfList(el, base), margin: [0, 0, 0, base * .5] }];
    if (tag === 'TABLE') return pdfTable(el, base);
    if (tag === 'HR') return [{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: PDF_W, y2: 0, lineWidth: .6, lineColor: '#d1d1d6' }], margin: [0, 10, 0, 12] }];
    if (tag === 'BLOCKQUOTE') {
      return [{
        table: { widths: [2.5, '*'], body: [[{ text: '', fillColor: '#c7c7cc' }, { text: runs(), color: '#6e6e73', margin: [8, 1, 0, 1] }]] },
        layout: 'noBorders',
        margin: [0, 4, 0, 8]
      }];
    }
    if (tag === 'PRE') {
      return [{
        table: { widths: ['*'], body: [[{ text: el.textContent, fontSize: base * .8, preserveLeadingSpaces: true, color: '#3a3a3c', margin: [6, 4, 6, 4] }]] },
        layout: { fillColor: () => '#f2f2f7', hLineWidth: () => 0, vLineWidth: () => 0 },
        margin: [0, 4, 0, 8]
      }];
    }
    const out = [];
    const r = pdfRuns(el, {}, [], base);
    if (r.some((x) => typeof x.text === 'string' && x.text.trim())) out.push({ text: r, margin: [0, 0, 0, base * .45] });
    el.querySelectorAll('img').forEach((img) => { const im = pdfImage(img); if (im) out.push(im); });
    if (!out.length) out.push({ text: ' ', margin: [0, 0, 0, base * .45] });
    return out;
  }

  async function exportPdf() {
    if (pdfBusy) return;
    pdfBusy = true;
    saveNow();
    showStatus('Making PDF…', false, 0);
    try {
      await need('pdfmake');
      const base = Math.round(settings.size * .75 * 10) / 10;
      const content = [];
      for (const el of editor.children) content.push(...pdfBlock(el, base));
      const doc = {
        pageSize: 'LETTER',
        pageMargins: [60, 64, 60, 64],
        info: { title: nameEl.value.trim() || 'Untitled' },
        content,
        defaultStyle: { font: 'Roboto', fontSize: base, lineHeight: 1.3, color: '#1d1d1f' },
        styles: {
          h1: { fontSize: base * 1.75, bold: true, margin: [0, base, 0, base * .35] },
          h2: { fontSize: base * 1.35, bold: true, margin: [0, base * .8, 0, base * .3] },
          h3: { fontSize: base * 1.12, bold: true, color: '#3a3a3c', margin: [0, base * .7, 0, base * .25] }
        },
        footer: (page, pages) => (pages > 1 ? { text: page + ' / ' + pages, alignment: 'center', fontSize: 8, color: '#86868b', margin: [0, 24, 0, 0] } : '')
      };
      await new Promise((resolve, reject) => {
        try { window.pdfMake.createPdf(doc).download(fileBase() + '.pdf', resolve); } catch (e) { reject(e); }
      });
      showStatus('PDF exported', false, 1800);
    } catch (e) {
      showStatus(e && e.offline ? 'Connect to the internet to export a PDF.' : 'Couldn’t make the PDF.', true, 3500);
    } finally {
      pdfBusy = false;
    }
  }

  function portableHtml() {
    const doc = new DOMParser().parseFromString('<body>' + contentHTML() + '</body>', 'text/html');
    doc.querySelectorAll('ul.todo').forEach((ul) => { ul.setAttribute('style', 'list-style:none;padding-left:0'); });
    doc.querySelectorAll('ul.todo > li').forEach((li) => {
      const done = li.getAttribute('data-checked') === 'true';
      li.insertBefore(doc.createTextNode(done ? '☑ ' : '☐ '), li.firstChild);
      if (done) li.setAttribute('style', 'color:#86868b;text-decoration:line-through');
    });
    doc.querySelectorAll('img').forEach((img) => {
      const w = parseFloat(img.style.width);
      if (!w) return;
      img.setAttribute('width', Math.round(w));
      const ar = (img.style.aspectRatio || '').split('/').map(Number);
      if (ar.length === 2 && ar[0] && ar[1]) img.setAttribute('height', Math.round(w * ar[1] / ar[0]));
    });
    doc.querySelectorAll('span[class]').forEach((sp) => {
      const st = [];
      FONT_CLASSES.forEach((c) => { if (sp.classList.contains(c)) st.push('font-family:' + cssVar(c.slice(2))); });
      SIZES.forEach(([c, k]) => { if (sp.classList.contains(c)) st.push('font-size:' + Math.round(settings.size * k * 0.75) + 'pt'); });
      sp.removeAttribute('class');
      if (st.length) sp.setAttribute('style', st.join(';'));
    });
    return doc.body.innerHTML;
  }

  function exportWord() {
    saveNow();
    const html = '﻿<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">' +
      '<head><meta charset="utf-8"><title>' + esc(nameEl.value.trim() || 'Untitled') + '</title>' +
      '<style>body{font-family:' + cssVar(settings.font) + ';font-size:' + Math.round(settings.size * 0.75) + 'pt;line-height:1.5}blockquote{border-left:3px solid #ccc;padding-left:10pt;color:#555}td,th{border:1px solid #ccc;padding:4pt}table{border-collapse:collapse}</style>' +
      '</head><body>' + portableHtml() + '</body></html>';
    saveFile(fileBase() + '.doc', html, 'application/msword');
  }

  function toText() {
    const doc = new DOMParser().parseFromString('<body>' + contentHTML() + '</body>', 'text/html');
    doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    const out = [];
    const text = (el) => el.textContent.replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').trim();
    const walkList = (list, depth) => {
      let i = 1;
      for (const li of list.children) {
        if (li.tagName === 'UL' || li.tagName === 'OL') { walkList(li, depth + 1); continue; }
        if (li.tagName !== 'LI') continue;
        const nested = Array.from(li.children).filter((c) => c.tagName === 'UL' || c.tagName === 'OL');
        nested.forEach((n) => n.remove());
        const pad = '  '.repeat(depth);
        const mark = list.classList.contains('todo') ? (li.getAttribute('data-checked') === 'true' ? '[x] ' : '[ ] ')
          : list.tagName === 'OL' ? (i++) + '. ' : '- ';
        out.push(pad + mark + text(li));
        nested.forEach((n) => walkList(n, depth + 1));
      }
    };
    for (const el of doc.body.childNodes) {
      if (el.nodeType === 3) { if (el.data.trim()) out.push(el.data.trim()); continue; }
      if (el.nodeType !== 1) continue;
      const tag = el.tagName;
      if (tag === 'UL' || tag === 'OL') walkList(el, 0);
      else if (/^H[1-3]$/.test(tag)) { if (out.length) out.push(''); out.push('#'.repeat(Number(tag[1])) + ' ' + text(el)); }
      else if (tag === 'HR') out.push('---');
      else if (tag === 'BLOCKQUOTE') out.push(text(el).split('\n').map((l) => '> ' + l).join('\n'));
      else if (tag === 'TABLE') el.querySelectorAll('tr').forEach((tr) => out.push(Array.from(tr.cells).map(text).join('\t')));
      else if (text(el)) out.push(text(el));
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  function exportText() {
    saveNow();
    saveFile(fileBase() + '.txt', toText(), 'text/plain;charset=utf-8');
  }

  /* ================= Reading files ================= */

  function inlineMd(s) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<i>$2</i>');
  }

  function fromText(src, md) {
    const fmt = md ? inlineMd : esc;
    const out = [];
    let list = null;
    const closeList = () => { if (list) { out.push('</' + list.tag + '>'); list = null; } };
    const openList = (tag, cls) => {
      if (list && list.tag === tag && list.cls === cls) return;
      closeList();
      list = { tag, cls };
      out.push('<' + tag + (cls ? ' class="' + cls + '"' : '') + '>');
    };
    for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
      const line = raw.replace(/\s+$/, '');
      let m;
      if (!line.trim()) { closeList(); continue; }
      if ((m = line.match(/^\s*(?:[-*+]\s+)?\[( |x|X)\]\s+(.*)$/))) {
        openList('ul', 'todo');
        out.push('<li data-checked="' + (m[1] === ' ' ? 'false' : 'true') + '">' + fmt(m[2]) + '</li>');
      } else if ((m = line.match(/^\s*[-*+•]\s+(.*)$/))) {
        openList('ul', '');
        out.push('<li>' + fmt(m[1]) + '</li>');
      } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
        openList('ol', '');
        out.push('<li>' + fmt(m[1]) + '</li>');
      } else if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
        closeList();
        out.push('<h' + m[1].length + '>' + fmt(m[2]) + '</h' + m[1].length + '>');
      } else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        closeList();
        out.push('<hr>');
      } else if ((m = line.match(/^>\s?(.*)$/))) {
        closeList();
        out.push('<blockquote>' + fmt(m[1]) + '</blockquote>');
      } else {
        closeList();
        out.push('<p>' + fmt(line) + '</p>');
      }
    }
    closeList();
    return out.join('');
  }

  function parseCsv(src, delim) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (quoted) {
        if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && src[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  // Rows of cells (from CSV or a spreadsheet) become a table with a header row.
  function rowsToTable(rows) {
    const clean = rows
      .map((r) => Array.from(r || [], (c) => (c == null ? '' : String(c)).trim()))
      .filter((r) => r.some(Boolean))
      .slice(0, 301);
    if (!clean.length) return '';
    let cols = Math.min(20, Math.max.apply(null, clean.map((r) => r.length)));
    while (cols > 1 && clean.every((r) => !r[cols - 1])) cols--;
    const row = (r, tag) => '<tr>' + Array.from({ length: cols }, (_, i) => '<' + tag + '>' + (r[i] ? esc(r[i]) : '<br>') + '</' + tag + '>').join('') + '</tr>';
    const [head, ...body] = clean;
    return '<table><thead>' + row(head, 'th') + '</thead><tbody>' + body.map((r) => row(r, 'td')).join('') + '</tbody></table>';
  }

  // A saved page, exactly as written, minus anything that could run code.
  function safeHTML(html) {
    const doc = new DOMParser().parseFromString('<body>' + (html || '') + '</body>', 'text/html');
    doc.querySelectorAll('script,iframe,object,embed,link,meta,style,base,form,frame,frameset').forEach((n) => n.remove());
    doc.body.querySelectorAll('*').forEach((el) => {
      Array.from(el.attributes).forEach((a) => {
        const v = a.value.replace(/[\s\u0000-\u001f]+/g, '').toLowerCase();
        if (/^on/i.test(a.name) || (/^(href|src|xlink:href|action|formaction)$/i.test(a.name) && /^(javascript|vbscript|data:text)/.test(v))) el.removeAttribute(a.name);
      });
      if (el.style && el.style.marginTop && el.parentNode === doc.body) el.style.marginTop = '';
    });
    return doc.body.innerHTML;
  }

  // Keeps structure and basic formatting; drops colours, scripts and unsafe links.
  function sanitize(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,meta,link,title,iframe,object,embed,noscript,template,svg,canvas,form,input,button,select,textarea,video,audio').forEach((n) => n.remove());
    doc.body.querySelectorAll('span,b,strong').forEach((el) => {
      const st = el.style;
      if (el.tagName !== 'SPAN') {
        if (/^(normal|[1-5]00)$/.test(st.fontWeight)) el.replaceWith(...el.childNodes);
        return;
      }
      if (Array.from(el.classList).some((c) => KEEP_CLASSES.has(c))) return;
      let frag = doc.createDocumentFragment();
      Array.from(el.childNodes).forEach((k) => frag.appendChild(k));
      const wrap = (tag) => {
        const w = doc.createElement(tag);
        w.appendChild(frag);
        frag = doc.createDocumentFragment();
        frag.appendChild(w);
      };
      const deco = st.textDecorationLine || st.textDecoration || '';
      if (/^(bold|bolder|[6-9]00)$/.test(st.fontWeight)) wrap('b');
      if (st.fontStyle === 'italic') wrap('i');
      if (/underline/.test(deco)) wrap('u');
      if (/line-through/.test(deco)) wrap('s');
      el.replaceWith(frag);
    });
    doc.body.querySelectorAll('font').forEach((el) => el.replaceWith(...el.childNodes));
    doc.body.querySelectorAll('*').forEach((el) => {
      const imgSize = el.tagName === 'IMG' ? [el.style.width, el.style.aspectRatio] : null;
      for (const a of Array.from(el.attributes)) {
        const k = a.name.toLowerCase();
        if (k === 'class') {
          const keep = Array.from(el.classList).filter((c) => KEEP_CLASSES.has(c));
          if (keep.length) el.setAttribute('class', keep.join(' ')); else el.removeAttribute('class');
          continue;
        }
        const ok = (k === 'href' && el.tagName === 'A') || ((k === 'src' || k === 'alt') && el.tagName === 'IMG') ||
          k === 'colspan' || k === 'rowspan' || k === 'data-checked';
        if (!ok) el.removeAttribute(a.name);
      }
      if (imgSize) {
        if (/^\d+(\.\d+)?px$/.test(imgSize[0])) el.style.width = imgSize[0];
        if (/^[\d.]+\s*\/\s*[\d.]+$/.test(imgSize[1])) el.style.aspectRatio = imgSize[1];
      }
      if (el.tagName === 'A' && !/^(https?:|mailto:|#)/i.test(el.getAttribute('href') || '')) el.removeAttribute('href');
      if (el.tagName === 'IMG' && !/^(https:|data:image\/(png|jpe?g|gif|webp);)/i.test(el.getAttribute('src') || '')) el.remove();
    });
    return doc.body.innerHTML;
  }

  const extOf = (f) => (f.name.indexOf('.') === -1 ? '' : f.name.split('.').pop().toLowerCase());
  const CODE_EXT = /^(json|xml|js|mjs|cjs|jsx|ts|tsx|py|java|c|cpp|cc|h|hpp|cs|css|scss|less|sql|ini|ya?ml|toml|sh|bash|ps1|bat|rb|go|rs|php|swift|kt|r|lua|pl|dart|scala|tex|log|cfg|conf)$/;
  const BLOCKED = /^(zip|rar|7z|gz|tar|exe|msi|dmg|iso|apk|mp4|mov|avi|mkv|webm|mp3|wav|m4a|flac|ogg|aac|heic|heif|psd|ai|sketch|fig|key|pages|numbers|ttf|otf|woff2?|db|sqlite)$/;
  const fail = (msg) => Object.assign(new Error(msg), { userMessage: msg });

  // What a file is, judged by its extension and type. null means it can't be opened.
  function kindOf(f) {
    const ext = extOf(f);
    const type = (f.type || '').toLowerCase();
    if (/^image\/(png|jpe?g|gif|webp|bmp|avif|svg\+xml|x-icon|vnd\.microsoft\.icon)$/.test(type) || /^(png|jpe?g|gif|webp|bmp|avif|svg|ico)$/.test(ext)) return 'image';
    if (/^(docx|docm|dotx)$/.test(ext)) return 'docx';
    if (ext === 'doc') return 'doc';
    if (ext === 'pdf' || type === 'application/pdf') return 'pdf';
    if (/^(pptx|ppsx|potx)$/.test(ext)) return 'pptx';
    if (ext === 'odt') return 'odt';
    if (/^(xlsx|xlsm|xlsb|xls|ods)$/.test(ext)) return 'sheet';
    if (ext === 'rtf' || /rtf/.test(type)) return 'rtf';
    if (/^(html?|xhtml)$/.test(ext)) return 'html';
    if (ext === 'csv' || ext === 'tsv') return 'csv';
    if (ext === 'md' || ext === 'markdown') return 'md';
    if (CODE_EXT.test(ext)) return 'code';
    if (ext === 'txt' || ext === 'text' || type.startsWith('text/')) return 'text';
    if (BLOCKED.test(ext) || /^(video|audio)\//.test(type)) return null;
    return 'maybe';
  }

  // The kind shown on the card while a file is dragged (only its type is known then).
  function itemKind(type) {
    type = (type || '').toLowerCase();
    if (type.startsWith('image/')) return 'image';
    if (type === 'application/pdf') return 'pdf';
    if (/wordprocessingml|msword|opendocument\.text|rtf/.test(type)) return 'doc';
    if (/spreadsheetml|ms-excel|opendocument\.spreadsheet|csv/.test(type)) return 'sheet';
    if (/presentationml|ms-powerpoint/.test(type)) return 'slides';
    return 'file';
  }

  async function looksLikeText(file) {
    if (file.size > 5 * 1024 * 1024) return false;
    const bytes = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
    let odd = 0;
    for (const b of bytes) {
      if (b === 0) return false;
      if (b < 9 || (b > 13 && b < 32)) odd++;
    }
    return odd <= bytes.length * .02;
  }

  // Images are shrunk so the page still fits in browser storage.
  function shrinkImage(src, keepAlpha) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const nw = img.naturalWidth || 600;
        const nh = img.naturalHeight || 400;
        const k = Math.min(1, 1200 / Math.max(nw, nh));
        const w = Math.max(1, Math.round(nw * k));
        const h = Math.max(1, Math.round(nh * k));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        let out = keepAlpha ? c.toDataURL('image/png') : '';
        if (!out || out.length > 600000) {
          ctx.globalCompositeOperation = 'destination-over';
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, w, h);
          out = c.toDataURL('image/jpeg', .85);
        }
        resolve(out);
      };
      img.onerror = () => reject(fail('This image couldn’t be read.'));
      img.src = src;
    });
  }
  async function imageToDataURL(file) {
    const url = URL.createObjectURL(file);
    try {
      return await shrinkImage(url, /png|gif|webp|svg|icon/i.test(file.type) || /^(png|gif|webp|svg|ico)$/.test(extOf(file)));
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  async function shrinkImagesIn(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    for (const img of Array.from(tpl.content.querySelectorAll('img'))) {
      const src = img.getAttribute('src') || '';
      if (!src.startsWith('data:') || src.length < 300000) continue;
      try { img.setAttribute('src', await shrinkImage(src, /^data:image\/(png|gif|webp)/.test(src))); } catch (e) { img.remove(); }
    }
    return tpl.innerHTML;
  }

  // Web pages and Word's HTML: keep the content, drop layout wrappers, keep headings to three sizes.
  function htmlToBlocks(src) {
    const doc = new DOMParser().parseFromString(src, 'text/html');
    const tpl = document.createElement('template');
    tpl.innerHTML = sanitize((doc.querySelector('[data-ultidash]') || doc.body).innerHTML);
    const root = tpl.content;
    root.querySelectorAll('h4,h5,h6').forEach((h) => {
      const n = document.createElement('h3');
      while (h.firstChild) n.appendChild(h.firstChild);
      h.replaceWith(n);
    });
    const WRAP = /^(DIV|SECTION|ARTICLE|MAIN|HEADER|FOOTER|ASIDE|NAV|FIGURE|FIGCAPTION|CENTER|ADDRESS|DL|DD|DT)$/;
    const BLOCK = 'p,h1,h2,h3,ul,ol,table,blockquote,pre,hr,div,section,article,figure,img';
    for (let again = true; again;) {
      again = false;
      for (const el of Array.from(root.children)) {
        if (!WRAP.test(el.tagName)) continue;
        if (el.querySelector(BLOCK)) el.replaceWith(...el.childNodes);
        else {
          const p = document.createElement('p');
          while (el.firstChild) p.appendChild(el.firstChild);
          el.replaceWith(p);
        }
        again = true;
      }
    }
    return tpl.innerHTML;
  }

  function codeBlock(src, ext) {
    let text = src.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
    if (ext === 'json') { try { text = JSON.stringify(JSON.parse(text), null, 2); } catch (e) { /* keep as written */ } }
    return '<pre>' + esc(text.slice(0, 300000)) + '</pre>';
  }

  async function docxToHTML(buf) {
    await need('mammoth');
    const result = await window.mammoth.convertToHtml({ arrayBuffer: buf });
    return shrinkImagesIn(htmlToBlocks(result.value));
  }

  // PDF text comes as positioned fragments: rebuild lines, then headings, bullets and paragraphs.
  async function pdfToHTML(buf) {
    await need('pdfjs');
    const lib = window.pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = LIBS.pdfjs[1];
    const pdf = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
    const lines = [];
    for (let p = 1; p <= Math.min(pdf.numPages, 300); p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const rows = [];
      for (const it of tc.items) {
        if (typeof it.str !== 'string' || !it.str) continue;
        const y = it.transform[5];
        const size = Math.round(Math.hypot(it.transform[2], it.transform[3]) * 10) / 10 || it.height || 10;
        let row = rows.find((r) => Math.abs(r.y - y) < Math.max(2, size * .4));
        if (!row) { row = { y, size: 0, parts: [] }; rows.push(row); }
        row.parts.push({ x: it.transform[4], w: it.width, s: it.str, size });
        row.size = Math.max(row.size, size);
      }
      rows.sort((a, b) => b.y - a.y);
      for (const row of rows) {
        row.parts.sort((a, b) => a.x - b.x);
        let text = '';
        let end = null;
        for (const part of row.parts) {
          if (end !== null && part.x - end > part.size * .18 && !/\s$/.test(text) && !/^\s/.test(part.s)) text += ' ';
          text += part.s;
          end = part.x + part.w;
        }
        text = text.replace(/\s+/g, ' ').trim();
        const pageNumber = /^(page\s*)?\d{1,4}(\s*(\/|of)\s*\d{1,4})?$/i.test(text);
        if (text && !pageNumber) lines.push({ text, size: row.size, y: row.y, page: p });
      }
    }
    if (!lines.length) return pdfAsImages(pdf);
    const weight = new Map();
    lines.forEach((l) => weight.set(l.size, (weight.get(l.size) || 0) + l.text.length));
    const body = Array.from(weight).sort((a, b) => b[1] - a[1])[0][0];
    const out = [];
    let para = null;
    let inList = false;
    let prev = null;
    const flush = () => { if (para) { out.push('<p>' + esc(para.text) + '</p>'); para = null; } };
    const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
    const appendToLast = (t) => { out[out.length - 1] = out[out.length - 1].replace(/<\/(li|h[1-3])>$/, ' ' + esc(t) + '</$1>'); };
    for (const l of lines) {
      const gap = prev && prev.page === l.page ? prev.y - l.y : Infinity;
      const close = gap < l.size * 1.75;
      const bullet = /^[•●▪◦‣∙·\-–—*]\s+/.exec(l.text);
      if (l.size >= body * 1.25 && l.text.length < 160) {
        flush(); closeList();
        const tag = l.size >= body * 1.6 ? 'h1' : l.size >= body * 1.35 ? 'h2' : 'h3';
        if (prev && prev.tag === tag && close) appendToLast(l.text);
        else out.push('<' + tag + '>' + esc(l.text) + '</' + tag + '>');
        l.tag = tag;
      } else if (bullet) {
        flush();
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push('<li>' + esc(l.text.slice(bullet[0].length)) + '</li>');
      } else if (inList && close && Math.abs(l.size - prev.size) < 1) {
        appendToLast(l.text);
      } else {
        closeList();
        if (para && close && Math.abs(para.size - l.size) < 1) {
          para.text = /[a-z]-$/.test(para.text) && /^[a-z]/.test(l.text) ? para.text.slice(0, -1) + l.text : para.text + ' ' + l.text;
        } else {
          flush();
          para = { text: l.text, size: l.size };
        }
      }
      prev = l;
    }
    flush();
    closeList();
    return out.join('');
  }

  // Scanned PDFs have no text, so their pages come in as pictures.
  async function pdfAsImages(pdf) {
    const out = [];
    for (let p = 1; p <= Math.min(pdf.numPages, 8); p++) {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 1.6 });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      out.push('<p><img src="' + await shrinkImage(c.toDataURL('image/jpeg', .9), false) + '" alt="Page ' + p + '"></p>');
    }
    return out.join('');
  }

  // PowerPoint: each slide becomes a heading with its points underneath.
  async function pptxToHTML(buf) {
    await need('jszip');
    const zip = await window.JSZip.loadAsync(buf);
    const num = (n) => Number((/(\d+)\.xml$/.exec(n) || [0, 0])[1]);
    const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
    if (!names.length) throw fail('This presentation has no slides to read.');
    const out = [];
    for (let i = 0; i < names.length; i++) {
      const xml = new DOMParser().parseFromString(await zip.file(names[i]).async('string'), 'application/xml');
      let title = '';
      const points = [];
      for (const sp of Array.from(xml.getElementsByTagNameNS('*', 'sp'))) {
        const ph = sp.getElementsByTagNameNS('*', 'ph')[0];
        const type = ph ? ph.getAttribute('type') : '';
        const paras = Array.from(sp.getElementsByTagNameNS('*', 'p'))
          .map((p) => Array.from(p.getElementsByTagNameNS('*', 't')).map((t) => t.textContent).join('').trim())
          .filter(Boolean);
        if (!paras.length) continue;
        if ((type === 'title' || type === 'ctrTitle') && !title) title = paras.join(' ');
        else points.push(...paras);
      }
      out.push('<h2>' + esc(title || 'Slide ' + (i + 1)) + '</h2>');
      if (points.length) out.push('<ul>' + points.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>');
    }
    return out.join('');
  }

  // OpenDocument text (LibreOffice, Google Docs download).
  async function odtToHTML(buf) {
    await need('jszip');
    const zip = await window.JSZip.loadAsync(buf);
    const entry = zip.file('content.xml');
    if (!entry) throw fail('This document looks damaged.');
    const xml = new DOMParser().parseFromString(await entry.async('string'), 'application/xml');
    const inline = (el) => {
      let s = '';
      el.childNodes.forEach((n) => {
        if (n.nodeType === 3) s += esc(n.data);
        else if (n.localName === 's') s += ' '.repeat(Number(n.getAttribute('text:c')) || 1);
        else if (n.localName === 'tab') s += ' ';
        else if (n.localName === 'line-break') s += '<br>';
        else if (n.nodeType === 1 && n.localName !== 'note') s += inline(n);
      });
      return s;
    };
    const list = (n) => '<ul>' + Array.from(n.children).filter((c) => c.localName === 'list-item')
      .map((li) => '<li>' + Array.from(li.children).map((c) => (c.localName === 'list' ? list(c) : inline(c))).join(' ') + '</li>').join('') + '</ul>';
    const out = [];
    const walk = (el) => {
      for (const n of Array.from(el.children)) {
        if (n.localName === 'h') {
          const lv = Math.min(3, Number(n.getAttribute('text:outline-level')) || 1);
          out.push('<h' + lv + '>' + inline(n) + '</h' + lv + '>');
        } else if (n.localName === 'p') {
          const t = inline(n);
          if (t.trim()) out.push('<p>' + t + '</p>');
        } else if (n.localName === 'list') out.push(list(n));
        else if (n.localName === 'table') {
          out.push(rowsToTable(Array.from(n.getElementsByTagNameNS('*', 'table-row'))
            .map((r) => Array.from(r.children).filter((c) => c.localName === 'table-cell').map((c) => c.textContent))));
        } else if (n.localName === 'section') walk(n);
      }
    };
    const body = xml.getElementsByTagNameNS('*', 'text')[0];
    if (body) walk(body);
    return out.join('');
  }

  // Excel, LibreOffice and other spreadsheets: each sheet becomes a table.
  async function sheetToHTML(buf) {
    await need('xlsx');
    const wb = window.XLSX.read(new Uint8Array(buf), { type: 'array' });
    const out = [];
    wb.SheetNames.slice(0, 6).forEach((name) => {
      const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: '', raw: false });
      if (!rows.length) return;
      if (wb.SheetNames.length > 1) out.push('<h3>' + esc(name) + '</h3>');
      out.push(rowsToTable(rows));
    });
    return out.join('');
  }

  // Rich Text Format: keep the words and paragraph breaks.
  function rtfToText(rtf) {
    const skipWords = /^(fonttbl|colortbl|stylesheet|info|pict|header|footer|headerl|headerr|footerl|footerr|themedata|colorschememapping|latentstyles|datastore|xmlnstbl|listtable|listoverridetable|rsidtbl|generator|object|fldinst)$/;
    let out = '';
    let skip = false;
    const stack = [];
    for (let i = 0; i < rtf.length;) {
      const ch = rtf[i];
      if (ch === '{') { stack.push(skip); i++; continue; }
      if (ch === '}') { skip = stack.length ? stack.pop() : false; i++; continue; }
      if (ch === '\\') {
        const m = /^\\([a-zA-Z]+)(-?\d+)? ?|^\\'([0-9a-fA-F]{2})|^\\([^a-zA-Z])/.exec(rtf.slice(i, i + 40));
        if (!m) { i++; continue; }
        i += m[0].length;
        if (m[3]) { if (!skip) out += String.fromCharCode(parseInt(m[3], 16)); continue; }
        if (m[4]) {
          if (m[4] === '*') skip = true;
          else if (!skip && '\\{}'.indexOf(m[4]) !== -1) out += m[4];
          else if (!skip && m[4] === '~') out += ' ';
          continue;
        }
        if (skipWords.test(m[1])) { skip = true; continue; }
        if (skip) continue;
        if (m[1] === 'par' || m[1] === 'line') out += '\n';
        else if (m[1] === 'tab') out += ' ';
        else if (m[1] === 'u' && m[2]) {
          const n = Number(m[2]);
          out += String.fromCharCode(n < 0 ? n + 65536 : n);
          if (rtf[i] === '?') i++;
        }
        continue;
      }
      if (ch !== '\r' && ch !== '\n' && !skip) out += ch;
      i++;
    }
    return out;
  }

  async function fileToHTML(file) {
    const ext = extOf(file);
    switch (kindOf(file)) {
      case 'image': return '<p><img src="' + await imageToDataURL(file) + '" alt="' + esc(file.name) + '"></p>';
      case 'docx': return docxToHTML(await file.arrayBuffer());
      case 'pdf': return pdfToHTML(await file.arrayBuffer());
      case 'pptx': return pptxToHTML(await file.arrayBuffer());
      case 'odt': return odtToHTML(await file.arrayBuffer());
      case 'sheet': return sheetToHTML(await file.arrayBuffer());
      case 'rtf': return fromText(rtfToText(await file.text()), false);
      case 'doc': {
        const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
        if (head[0] === 0xD0 && head[1] === 0xCF) throw fail('Old Word .doc files can’t be opened. Save it as .docx and try again.');
        return htmlToBlocks(await file.text()); // Word files saved as web pages, like this app's own export
      }
      case 'html': return htmlToBlocks(await file.text());
      case 'csv': return rowsToTable(parseCsv(await file.text(), ext === 'tsv' ? '\t' : ','));
      case 'md': return fromText(await file.text(), true);
      case 'code': return codeBlock(await file.text(), ext);
      case 'maybe':
        if (!(await looksLikeText(file))) throw fail('“' + file.name + '” isn’t a kind of file this page can open.');
        return fromText(await file.text(), false);
      default: return fromText(await file.text(), false);
    }
  }

  // New blocks float up into place, one after another.
  function reveal(els) {
    els.slice(0, 30).forEach((el, i) => {
      animate(el, [
        { opacity: 0, transform: 'translateY(14px) scale(.985)', filter: 'blur(6px)' },
        { opacity: 1, transform: 'none', filter: 'blur(0)' }
      ], { duration: 560, delay: Math.min(i, 16) * 50, easing: EASE, fill: 'backwards' });
    });
  }

  // Import and Insert image add files where the cursor was, the same way a drop does.
  const imageInput = $('#imageInput');
  let spot = null;
  function rememberSpot() {
    const b = topBlock();
    if (b && b.parentNode === editor) spot = b;
  }
  function spotIndex() {
    const blocks = Array.from(editor.children).filter((b) => !b.classList.contains('drop-skeleton'));
    const at = spot;
    spot = null;
    if (!at || !at.isConnected || at.parentNode !== editor) return blocks.length;
    const i = blocks.indexOf(at);
    if (i === -1) return blocks.length;
    if (at.tagName === 'P' && isEmpty(at) && blocks.length > 1) { at.remove(); return i; }
    return i + 1;
  }
  async function addPicked(input) {
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length || busy) return;
    const ok = files.filter(kindOf);
    if (!ok.length) {
      showStatus(files.length > 1 ? 'These files can’t be opened' : '“' + files[0].name + '” can’t be opened', true, 2600);
      return;
    }
    await addFiles(ok, spotIndex(), files.length - ok.length);
  }
  fileInput.addEventListener('change', () => addPicked(fileInput));
  imageInput.addEventListener('change', () => addPicked(imageInput));

  /* ===================================================================
     Writing: blocks, lists, to-dos, the / menu and shortcuts
     =================================================================== */

  const sel = () => window.getSelection();
  const inEditor = (n) => !!n && (n === editor || editor.contains(n));
  const exec = (cmd, val) => { try { return document.execCommand(cmd, false, val); } catch (e) { return false; } };

  function caretEl() {
    const s = sel();
    if (!s.rangeCount) return null;
    let n = s.anchorNode;
    if (!inEditor(n)) return null;
    if (n.nodeType === 3) n = n.parentNode;
    return n;
  }
  function closestIn(q) {
    const el = caretEl();
    if (!el) return null;
    const f = el.closest(q);
    return f && f !== editor && editor.contains(f) ? f : null;
  }
  function topOf(n, off) {
    if (!inEditor(n)) return null;
    if (n === editor) return editor.childNodes[Math.min(off || 0, editor.childNodes.length - 1)] || null;
    while (n && n.parentNode !== editor) n = n.parentNode;
    return n;
  }
  function topBlock() { const s = sel(); return s.rangeCount ? topOf(s.anchorNode, s.anchorOffset) : null; }
  function selectedBlocks() {
    const s = sel();
    if (!s.rangeCount) return [];
    const r = s.getRangeAt(0);
    const a = topOf(r.startContainer, r.startOffset);
    const b = topOf(r.endContainer, Math.max(0, r.endOffset - 1)) || a;
    if (!a) return [];
    const out = [];
    for (let n = a; n; n = n.nextSibling) { out.push(n); if (n === b) break; }
    return out;
  }
  function placeCaret(node, atEnd) {
    if (!node) return;
    const r = document.createRange();
    if (atEnd && node.lastChild && node.lastChild.nodeName === 'BR') r.setStartBefore(node.lastChild);
    else { r.selectNodeContents(node); r.collapse(!atEnd); }
    const s = sel();
    s.removeAllRanges();
    s.addRange(r);
  }
  function caretAt(el, atEnd) {
    const s = sel();
    if (!s.rangeCount) return false;
    const r = document.createRange();
    try {
      if (atEnd) { r.setStart(s.focusNode, s.focusOffset); r.setEnd(el, el.childNodes.length); }
      else { r.setStart(el, 0); r.setEnd(s.anchorNode, s.anchorOffset); }
    } catch (e) { return false; }
    return r.toString().replace(/​/g, '').length === 0;
  }
  function withSelection(fn) {
    const s = sel();
    const r = s.rangeCount ? s.getRangeAt(0) : null;
    const saved = r && [r.startContainer, r.startOffset, r.endContainer, r.endOffset];
    const map = fn() || new Map();
    if (!saved) return;
    const fix = (n, o) => {
      if (map.has(n)) n = map.get(n);
      if (!n.isConnected) return null;
      const max = n.nodeType === 3 ? n.length : n.childNodes.length;
      return [n, Math.min(o, max)];
    };
    const st = fix(saved[0], saved[1]);
    const en = fix(saved[2], saved[3]);
    if (!st) return;
    const nr = document.createRange();
    nr.setStart(st[0], st[1]);
    if (en) nr.setEnd(en[0], en[1]); else nr.collapse(true);
    s.removeAllRanges();
    s.addRange(nr);
  }
  function unwrap(el) {
    const p = el.parentNode;
    while (el.firstChild) p.insertBefore(el.firstChild, el);
    el.remove();
  }
  const newP = () => { const p = document.createElement('p'); p.appendChild(document.createElement('br')); return p; };
  const isEmpty = (el) => !el.textContent.replace(/[​\s]/g, '') && !(el.querySelector && el.querySelector('img,hr,table'));

  function changed() {
    scheduleSave();
    updateEmpty();
  }
  function updateEmpty() {
    const empty = editor.children.length <= 1 && !editor.textContent.trim() &&
      !editor.querySelector('ul,ol,table,hr,blockquote,pre,h1,h2,h3,img,.drop-skeleton');
    editor.classList.toggle('is-empty', empty);
  }

  function settle(el) {
    animate(el, [{ opacity: .3, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: EASE });
  }

  function replaceTag(el, tag) {
    let n = null;
    withSelection(() => {
      n = document.createElement(tag);
      while (el.firstChild) n.appendChild(el.firstChild);
      if (!n.firstChild) n.appendChild(document.createElement('br'));
      el.replaceWith(n);
      return new Map([[el, n]]);
    });
    return n;
  }
  function listType(list) {
    if (!list) return null;
    if (list.tagName === 'OL') return 'ol';
    return list.classList.contains('todo') ? 'todo' : 'ul';
  }
  function makeList(type) {
    const l = document.createElement(type === 'ol' ? 'ol' : 'ul');
    if (type === 'todo') l.className = 'todo';
    return l;
  }

  function toList(type) {
    const blocks = selectedBlocks();
    const ok = (b) => (b.nodeType === 3 ? !!b.data.trim() : /^(P|H[1-6]|DIV|BLOCKQUOTE)$/.test(b.nodeName) && !b.classList.contains('drop-skeleton'));
    if (!blocks.some(ok)) {
      if (!closestIn('td,th')) return;
      exec(type === 'ol' ? 'insertOrderedList' : 'insertUnorderedList');
      if (type === 'todo') fixTodoLists(closestIn('ul'));
      return;
    }
    withSelection(() => {
      const map = new Map();
      const made = [];
      let list = null;
      for (const b of blocks) {
        if (!ok(b)) { if (b.nodeType === 1) list = null; continue; }
        if (!list) { list = makeList(type); b.before(list); made.push(list); }
        const li = document.createElement('li');
        if (type === 'todo') li.dataset.checked = 'false';
        if (b.nodeType === 3) li.appendChild(b);
        else {
          while (b.firstChild) li.appendChild(b.firstChild);
          b.remove();
          map.set(b, li);
        }
        if (!li.firstChild) li.appendChild(document.createElement('br'));
        list.appendChild(li);
      }
      const first = made[0];
      const prev = first && first.previousElementSibling;
      if (prev && prev.tagName === first.tagName && listType(prev) === listType(first)) {
        while (first.firstChild) prev.appendChild(first.firstChild);
        first.remove();
      }
      return map;
    });
  }

  // Turns list items into paragraphs, splitting the list around them.
  function itemsToParagraphs(items) {
    const list = items[0].parentElement;
    const map = new Map();
    const after = [];
    for (let n = items[items.length - 1].nextSibling; n; n = n.nextSibling) after.push(n);
    let ref = list;
    for (const li of items) {
      const p = document.createElement('p');
      while (li.firstChild) p.appendChild(li.firstChild);
      if (!p.firstChild) p.appendChild(document.createElement('br'));
      li.remove();
      ref.after(p);
      ref = p;
      map.set(li, p);
    }
    if (after.length) {
      const rest = list.cloneNode(false);
      after.forEach((n) => rest.appendChild(n));
      ref.after(rest);
    }
    if (!list.querySelector('li')) list.remove();
    return map;
  }

  function unlist() {
    const s = sel();
    if (!s.rangeCount) return;
    const r = s.getRangeAt(0);
    const liOf = (n) => { const el = n.nodeType === 3 ? n.parentElement : n; return el && el.closest('li'); };
    const a = liOf(r.startContainer);
    const b = liOf(r.endContainer);
    if (!a) return;
    const list = a.parentElement;
    if (list.parentNode !== editor) {
      exec(list.tagName === 'OL' ? 'insertOrderedList' : 'insertUnorderedList');
      return;
    }
    let items = [a];
    if (b && b !== a && b.parentElement === list) {
      items = [];
      for (let n = a; n; n = n.nextElementSibling) { items.push(n); if (n === b) break; }
    }
    withSelection(() => itemsToParagraphs(items));
  }

  function convertList(list, type) {
    withSelection(() => {
      const n = makeList(type);
      while (list.firstChild) n.appendChild(list.firstChild);
      list.replaceWith(n);
      for (const li of n.children) {
        if (type === 'todo') { if (!li.dataset.checked) li.dataset.checked = 'false'; }
        else li.removeAttribute('data-checked');
      }
      return new Map([[list, n]]);
    });
  }

  function setList(type) {
    const li = closestIn('li');
    const list = li && li.parentElement;
    if (listType(list) === type) return;
    if (list) { convertList(list, type); return; }
    toList(type);
  }

  function fixTodoLists(root) {
    if (root && root.tagName === 'UL') root.classList.add('todo');
    editor.querySelectorAll('ul.todo ul:not(.todo)').forEach((u) => u.classList.add('todo'));
    editor.querySelectorAll('ul.todo > li:not([data-checked])').forEach((li) => { li.dataset.checked = 'false'; });
  }

  function setBlock(tag) {
    if (closestIn('li')) unlist();
    const b = topBlock();
    if (b && b.nodeType === 1 && b.tagName === 'BLOCKQUOTE') { replaceTag(b, tag); return; }
    exec('formatBlock', tag);
  }
  function setQuote() {
    if (closestIn('li')) unlist();
    const b = topBlock();
    if (b && b.nodeType === 1 && /^(P|H[1-6]|DIV)$/.test(b.tagName)) replaceTag(b, 'blockquote');
  }
  function insertDivider() {
    const li = closestIn('li');
    if (li && isEmpty(li)) unlist();
    const hr = document.createElement('hr');
    const b = topBlock();
    if (b && b.nodeType === 1 && b.tagName === 'P' && isEmpty(b)) b.replaceWith(hr);
    else if (b) b.after(hr);
    else editor.appendChild(hr);
    let next = hr.nextElementSibling;
    if (!next || next.tagName !== 'P' || !isEmpty(next)) { next = newP(); hr.after(next); }
    placeCaret(next, false);
    animate(hr, [{ transform: 'scaleX(0)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 450, easing: EASE });
  }

  function runCommand(id) {
    switch (id) {
      case 'h1': case 'h2': case 'h3': case 'p': setBlock(id); break;
      case 'ul': case 'ol': case 'todo': setList(id); break;
      case 'quote': setQuote(); break;
      case 'divider': insertDivider(); break;
    }
    if (id !== 'divider') {
      const li = closestIn('li');
      settle(li || topBlock());
    }
    changed();
  }

  /* ---------- To-do items: tick, remove, or drop the circle ---------- */

  const leaving = new WeakSet();

  function removeItem(li) {
    if (leaving.has(li)) return;
    leaving.add(li);
    const list = li.parentElement;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      li.remove();
      if (!list.querySelector('li')) { const p = newP(); list.replaceWith(p); placeCaret(p, false); }
      changed();
    };
    const h = li.offsetHeight;
    li.style.overflow = 'hidden';
    const a = animate(li, [
      { height: h + 'px', opacity: 1, transform: 'none' },
      { height: '0px', opacity: 0, transform: 'translateX(14px)', paddingTop: '0px', paddingBottom: '0px' }
    ], { duration: 280, easing: EASE });
    if (!a) { done(); return; }
    a.onfinish = done;
    setTimeout(done, 360);
  }

  // Double-click on the circle: it pops and shrinks away, and the line becomes plain text.
  function dropCircle(li) {
    if (leaving.has(li)) return;
    const list = li.parentElement;
    if (!list || list.parentNode !== editor) return;
    leaving.add(li);
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      editor.focus({ preventScroll: true });
      placeCaret(li, true);
      const map = itemsToParagraphs([li]);
      const p = map.get(li);
      if (p) placeCaret(p, true);
      changed();
    };
    const circle = animate(li, [
      { transform: 'scale(1) rotate(0deg)', opacity: 1 },
      { transform: 'scale(1.3) rotate(0deg)', opacity: 1, offset: .3 },
      { transform: 'scale(0) rotate(-120deg)', opacity: 0 }
    ], { duration: 420, easing: EASE, pseudoElement: '::before', fill: 'forwards' });
    const slide = animate(li, [
      { paddingLeft: getComputedStyle(li).paddingLeft },
      { paddingLeft: '0px' }
    ], { duration: 360, delay: 160, easing: SPRING, fill: 'forwards' });
    if (!circle && !slide) { done(); return; }
    (slide || circle).onfinish = done;
    setTimeout(done, 650);
  }

  editor.addEventListener('mousedown', (e) => {
    const li = e.target.closest && e.target.closest('li');
    if (!li || !li.parentElement || !li.parentElement.classList.contains('todo')) return;
    const cs = getComputedStyle(li);
    const rect = li.getBoundingClientRect();
    if (e.clientY - rect.top > parseFloat(cs.lineHeight) * 1.2 + 4) return;
    const fromLeft = e.clientX - rect.left;
    const fromRight = rect.right - e.clientX;
    if (fromLeft >= 0 && fromLeft < parseFloat(cs.paddingLeft)) {
      e.preventDefault();
      if (leaving.has(li)) return;
      const on = li.dataset.checked !== 'true';
      li.dataset.checked = on ? 'true' : 'false';
      if (e.detail >= 2) {
        // Second press of a double-click: undo the first tick, then remove the circle.
        dropCircle(li);
        return;
      }
      animate(li, on
        ? [{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }]
        : [{ transform: 'scale(1)' }, { transform: 'scale(.82)' }, { transform: 'scale(1)' }],
      { duration: 380, easing: SPRING, pseudoElement: '::before' });
      changed();
    } else if (fromRight >= 0 && fromRight < parseFloat(cs.paddingRight)) {
      e.preventDefault();
      removeItem(li);
    }
  });

  function fixNewItem() {
    const li = closestIn('li');
    if (!li) return;
    if (li.parentElement.classList.contains('todo')) {
      [li, li.previousElementSibling].forEach((x) => {
        if (x && x.tagName === 'LI' && isEmpty(x)) x.dataset.checked = 'false';
      });
      if (!li.dataset.checked) li.dataset.checked = 'false';
    }
    if (isEmpty(li)) animate(li, [{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: EASE });
  }

  /* ---------- The / menu ---------- */

  let slash = null;
  const slashOpen = () => slashMenu.classList.contains('open');

  function matchCmd(c, q) {
    if (!q) return true;
    const label = c.label.toLowerCase();
    return label.startsWith(q) || label.split(/[\s-]+/).some((w) => w.startsWith(q)) || c.keys.some((k) => k.startsWith(q));
  }
  function openSlash() {
    const s = sel();
    if (!s.rangeCount || !s.isCollapsed) return;
    const node = s.anchorNode;
    const off = s.anchorOffset;
    if (!node || node.nodeType !== 3 || off < 1 || node.data[off - 1] !== '/') return;
    const before = off >= 2 ? node.data[off - 2] : '';
    if (before && !/\s/.test(before)) return;
    slash = { node, offset: off - 1, q: null, items: [], index: 0, place: null };
  }
  const slashScroll = $('#slashScroll');
  const slashList = $('#slashList');
  const slashHl = $('#slashHl');
  const slashEls = new Map();

  function closeSlash() { slash = null; slashMenu.classList.remove('open'); }
  function updateSlash() {
    if (!slash) return;
    const s = sel();
    if (!s.rangeCount || !s.isCollapsed) return closeSlash();
    const { node, offset } = slash;
    if (s.anchorNode !== node || !node.isConnected || s.anchorOffset <= offset || node.data[offset] !== '/') return closeSlash();
    const q = node.data.slice(offset + 1, s.anchorOffset);
    if (/\s/.test(q) || q.length > 20) return closeSlash();
    if (q === slash.q && slashOpen()) return;
    slash.q = q;
    const items = COMMANDS.filter((c) => matchCmd(c, q.toLowerCase()));
    if (!items.length) { slash.items = []; slashMenu.classList.remove('open'); return; }
    const opening = !slashOpen();
    slash.items = items;
    renderSlash(opening);
    positionSlash();
    if (opening) slashMenu.classList.add('open');
  }
  // Each command keeps one element, so filtering can slide items instead of redrawing them.
  function slashEl(c) {
    let el = slashEls.get(c.id);
    if (el) return el;
    el = document.createElement('div');
    el.className = 'slash-item';
    el.setAttribute('role', 'option');
    const ico = document.createElement('span');
    ico.className = 'slash-ico';
    ico.textContent = c.icon;
    const label = document.createElement('span');
    label.className = 'slash-label';
    label.textContent = c.label;
    el.append(ico, label);
    el.addEventListener('mousedown', (e) => { e.preventDefault(); if (slash) runSlash(c); });
    el.addEventListener('mousemove', () => {
      if (!slash) return;
      const i = slash.items.indexOf(c);
      if (i !== -1 && i !== slash.index) setActive(i, true, false);
    });
    slashEls.set(c.id, el);
    return el;
  }

  function stopAnims(el, id) {
    if (!el.getAnimations) return;
    el.getAnimations().forEach((a) => { if (!id || a.id === id) a.cancel(); });
  }

  function renderSlash(opening) {
    const els = slash.items.map(slashEl);
    const keep = new Set(els);
    // Where each item is drawn right now (mid-animation included), inside the list.
    const before = new Map();
    const h0 = slashMenu.offsetHeight;
    if (!opening) {
      const base = slashScroll.getBoundingClientRect().top - slashScroll.scrollTop;
      els.forEach((el) => { if (el.parentNode === slashList) before.set(el, el.getBoundingClientRect().top - base); });
    }
    Array.from(slashList.children).forEach((el) => { if (!keep.has(el)) el.remove(); });
    els.forEach((el, i) => { if (slashList.children[i] !== el) slashList.insertBefore(el, slashList.children[i] || null); });

    els.forEach((el, i) => {
      if (opening) {
        stopAnims(el);
        animate(el, [
          { opacity: 0, transform: 'translateY(-6px) scale(.97)' },
          { opacity: 1, transform: 'none' }
        ], { duration: 380, delay: 40 + i * 24, easing: EASE, fill: 'backwards' });
      } else if (before.has(el)) {
        stopAnims(el, 'slide');
        const d = before.get(el) - el.offsetTop;
        if (Math.abs(d) > .5) {
          const a = animate(el, [{ transform: 'translateY(' + d + 'px)' }, { transform: 'none' }], { duration: 380, easing: EASE });
          if (a) a.id = 'slide';
        }
      } else {
        stopAnims(el);
        animate(el, [
          { opacity: 0, transform: 'scale(.94)' },
          { opacity: 1, transform: 'none' }
        ], { duration: 300, easing: EASE });
      }
    });

    if (opening) {
      slashScroll.scrollTop = 0;
    } else {
      stopAnims(slashMenu, 'grow');
      const h1 = slashMenu.offsetHeight;
      if (h0 && Math.abs(h1 - h0) > 1) {
        const a = animate(slashMenu, [{ height: h0 + 'px' }, { height: h1 + 'px' }], { duration: 380, easing: EASE });
        if (a) a.id = 'grow';
      }
    }
    setActive(0, !opening, true);
  }

  // The blue highlight glides to the chosen item.
  function setActive(i, smooth, scroll) {
    if (!slash) return;
    slash.index = i;
    const els = slash.items.map(slashEl);
    els.forEach((el, k) => el.classList.toggle('active', k === i));
    const el = els[i];
    if (!el) return;
    if (!smooth) slashHl.classList.add('snap');
    slashHl.style.transform = 'translateY(' + el.offsetTop + 'px)';
    slashHl.style.height = el.offsetHeight + 'px';
    if (!smooth) { void slashHl.offsetWidth; slashHl.classList.remove('snap'); }
    if (scroll) {
      const top = el.offsetTop;
      const bottom = top + el.offsetHeight;
      const view = slashScroll.scrollTop;
      const vh = slashScroll.clientHeight;
      const behavior = reduceMotion.matches ? 'auto' : 'smooth';
      if (top < view) slashScroll.scrollTo({ top: Math.max(0, top - 6), behavior });
      else if (bottom > view + vh) slashScroll.scrollTo({ top: bottom - vh + 6, behavior });
    }
  }

  // Opens below the "/" when there is room, otherwise above it, and stays on that side while you type.
  function positionSlash() {
    if (!slash) return;
    const r = document.createRange();
    try { r.setStart(slash.node, slash.offset); r.setEnd(slash.node, slash.offset + 1); } catch (e) { return; }
    const rect = r.getBoundingClientRect();
    if (!slash.place) {
      const h = slashMenu.offsetHeight;
      slash.place = rect.bottom + 8 + h > window.innerHeight - 8 && rect.top - 8 - h > 8 ? 'above' : 'below';
      slashMenu.classList.toggle('above', slash.place === 'above');
    }
    if (slash.place === 'below') {
      slashMenu.style.top = Math.round(rect.bottom + 8) + 'px';
      slashMenu.style.bottom = 'auto';
    } else {
      slashMenu.style.top = 'auto';
      slashMenu.style.bottom = Math.round(window.innerHeight - rect.top + 8) + 'px';
    }
    slashMenu.style.left = Math.round(Math.max(8, Math.min(rect.left - 10, window.innerWidth - slashMenu.offsetWidth - 8))) + 'px';
  }
  function runSlash(c) {
    if (!slash) return;
    const { node, offset } = slash;
    const end = Math.min(node.length, offset + 1 + (slash.q || '').length);
    closeSlash();
    const r = document.createRange();
    r.setStart(node, offset);
    r.setEnd(node, end);
    const s = sel();
    s.removeAllRanges();
    s.addRange(r);
    exec('delete');
    runCommand(c.id);
  }

  /* ---------- Line-start shortcuts: "# ", "- ", "1. ", "[] " ---------- */

  function markdown() {
    const s = sel();
    if (!s.rangeCount || !s.isCollapsed) return;
    const b = topBlock();
    if (!b || b.nodeType !== 1 || b.tagName !== 'P') return;
    const r = document.createRange();
    r.setStart(b, 0);
    r.setEnd(s.anchorNode, s.anchorOffset);
    const text = r.toString().replace(/ /g, ' ');
    if (!text.endsWith(' ')) return;
    const cmd = MARKDOWN[text.slice(0, -1)];
    if (!cmd) return;
    s.removeAllRanges();
    s.addRange(r);
    exec('delete');
    runCommand(cmd);
  }

  /* ---------- Selection bar ---------- */

  let bubbleTimer = null;
  let pointerDown = false;
  const bubbleOpen = () => bubble.classList.contains('open');

  function hideBubble() { bubble.classList.remove('open'); }

  function selectionUsable() {
    const s = sel();
    if (!s.rangeCount || s.isCollapsed || !inEditor(s.anchorNode) || !inEditor(s.focusNode)) return false;
    return !!s.toString().trim();
  }

  function startElement() {
    const r = sel().getRangeAt(0);
    let n = r.startContainer;
    if (n.nodeType === 1) n = n.childNodes[r.startOffset] || n;
    if (n.nodeType === 3 && r.startOffset === n.length && n.nextSibling) n = n.nextSibling;
    return n.nodeType === 3 ? n.parentElement : n;
  }

  function sizeLevel() {
    const el = startElement();
    if (!el) return 1;
    const ratio = parseFloat(getComputedStyle(el).fontSize) / parseFloat(getComputedStyle(editor).fontSize);
    let best = 1;
    SIZES.forEach(([, k], i) => { if (Math.abs(k - ratio) < Math.abs(SIZES[best][1] - ratio)) best = i; });
    return best;
  }

  function fontNow() {
    const el = startElement();
    const span = el && el.closest('.f-sans,.f-serif,.f-mono');
    if (span && editor.contains(span)) return FONT_CLASSES.find((c) => span.classList.contains(c)).slice(2);
    return settings.font;
  }

  function refreshBubble() {
    const q = (c) => { try { return document.queryCommandState(c); } catch (e) { return false; } };
    bubble.querySelectorAll('[data-fmt]').forEach((b) => b.classList.toggle('on', q(b.dataset.fmt)));
    const f = fontNow();
    bubble.querySelectorAll('[data-ff]').forEach((b) => b.classList.toggle('on', b.dataset.ff === f));
    const lvl = sizeLevel();
    bubble.querySelector('[data-fs="-1"]').disabled = lvl <= 0;
    bubble.querySelector('[data-fs="1"]').disabled = lvl >= SIZES.length - 1;
  }

  function positionBubble() {
    const range = sel().getRangeAt(0);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
    const first = rects[0] || range.getBoundingClientRect();
    const box = range.getBoundingClientRect();
    const bw = bubble.offsetWidth;
    const bh = bubble.offsetHeight;
    const topLimit = $('#top').getBoundingClientRect().bottom + 8;
    let below = false;
    let top = first.top - bh - 12;
    if (top < topLimit) {
      const last = rects[rects.length - 1] || box;
      top = last.bottom + 12;
      below = true;
    }
    const anchorX = rects.length > 1 ? box.left + box.width / 2 : first.left + first.width / 2;
    const left = Math.max(8, Math.min(anchorX - bw / 2, window.innerWidth - bw - 8));
    bubble.classList.toggle('below', below);
    bubble.style.top = Math.round(top) + 'px';
    bubble.style.left = Math.round(left) + 'px';
    bubble.style.setProperty('--ax', Math.max(14, Math.min(bw - 14, anchorX - left)) + 'px');
  }

  function updateBubble() {
    clearTimeout(bubbleTimer);
    if (pointerDown || slash || dragging || menuEl.classList.contains('open') || !selectionUsable()) { hideBubble(); return; }
    refreshBubble();
    positionBubble();
    bubble.classList.add('open');
  }
  function scheduleBubble(delay) {
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(updateBubble, delay);
  }

  editor.addEventListener('mousedown', () => { pointerDown = true; hideBubble(); });
  document.addEventListener('mouseup', () => {
    if (!pointerDown) return;
    pointerDown = false;
    scheduleBubble(10);
  });
  editor.addEventListener('keyup', (e) => {
    if (e.key === 'Shift' || e.shiftKey || ((e.ctrlKey || e.metaKey) && /^[abiu]$/i.test(e.key))) scheduleBubble(120);
  });

  function applyInline(kind, cls) {
    const s = sel();
    if (!s.rangeCount || s.isCollapsed) return;
    exec('styleWithCSS', false);
    if (kind === 'size') exec('fontSize', '7'); else exec('fontName', 'ud-mark');
    const marks = Array.from(editor.querySelectorAll(kind === 'size' ? 'font[size="7"]' : 'font[face="ud-mark"]'));
    if (!marks.length) return;
    const texts = [];
    marks.forEach((m) => {
      const w = document.createTreeWalker(m, NodeFilter.SHOW_TEXT);
      let t;
      while ((t = w.nextNode())) texts.push(t);
    });
    const family = kind === 'size' ? SIZE_CLASSES : FONT_CLASSES;
    const spans = marks.map((m) => {
      const sp = document.createElement('span');
      sp.className = cls;
      while (m.firstChild) sp.appendChild(m.firstChild);
      m.replaceWith(sp);
      return sp;
    });
    spans.forEach((sp) => {
      sp.querySelectorAll('span').forEach((inner) => {
        family.forEach((c) => inner.classList.remove(c));
        if (!inner.classList.length) inner.removeAttribute('class');
        if (!inner.attributes.length) unwrap(inner);
      });
      sp.querySelectorAll('font').forEach((f) => {
        f.removeAttribute(kind === 'size' ? 'size' : 'face');
        if (!f.attributes.length) unwrap(f);
      });
    });
    spans.forEach((sp) => {
      let a = sp.parentElement;
      while (a && a !== editor && a.textContent === sp.textContent) {
        const next = a.parentElement;
        if (a.tagName === 'SPAN') {
          family.forEach((c) => a.classList.remove(c));
          if (!a.classList.length) a.removeAttribute('class');
          if (!a.attributes.length) unwrap(a);
        }
        a = next;
      }
    });
    const sameSel = family.map((c) => '.' + c).join(',');
    spans.forEach((sp) => {
      const outer = sp.parentElement && sp.parentElement.closest(sameSel);
      const overrides = outer && editor.contains(outer);
      if (kind === 'size' && cls === 's-normal' && !overrides && !sp.closest('h1,h2,h3')) unwrap(sp);
      else if (kind === 'font' && cls === 'f-' + settings.font && !overrides) unwrap(sp);
    });
    if (texts.length) {
      const r = document.createRange();
      const last = texts[texts.length - 1];
      r.setStart(texts[0], 0);
      r.setEnd(last, last.length);
      s.removeAllRanges();
      s.addRange(r);
    }
    changed();
  }

  bubble.addEventListener('mousedown', (e) => e.preventDefault());
  bubble.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled || !selectionUsable()) return;
    if (b.dataset.fmt) {
      exec(b.dataset.fmt);
      changed();
    } else if (b.dataset.ff) {
      applyInline('font', 'f-' + b.dataset.ff);
    } else if (b.dataset.fs) {
      const lvl = Math.max(0, Math.min(SIZES.length - 1, sizeLevel() + Number(b.dataset.fs)));
      applyInline('size', SIZES[lvl][0]);
    }
    if (!selectionUsable()) return;
    refreshBubble();
    positionBubble();
    bubble.classList.add('open');
  });

  /* ---------- Keys ---------- */

  function handleTab(e) {
    e.preventDefault();
    const cell = closestIn('td,th');
    if (cell) {
      const cells = Array.from(cell.closest('table').querySelectorAll('td,th'));
      const i = cells.indexOf(cell) + (e.shiftKey ? -1 : 1);
      if (i >= 0 && i < cells.length) placeCaret(cells[i], !isEmpty(cells[i]));
      return;
    }
    const li = closestIn('li');
    if (li) {
      if (e.shiftKey && li.parentElement.parentNode === editor) return;
      exec(e.shiftKey ? 'outdent' : 'indent');
      fixTodoLists();
      changed();
      return;
    }
    if (!e.shiftKey) exec('insertText', '    ');
  }

  function handleEnter(e) {
    const li = closestIn('li');
    if (li) {
      if (isEmpty(li) && !li.querySelector('ul,ol') && li.parentElement.parentNode === editor) {
        e.preventDefault();
        unlist();
        changed();
      }
      return;
    }
    const quote = closestIn('blockquote');
    if (quote && quote.parentNode === editor) {
      e.preventDefault();
      if (isEmpty(quote)) replaceTag(quote, 'p');
      else if (caretAt(quote, true)) { const p = newP(); quote.after(p); placeCaret(p, false); }
      else exec('insertLineBreak');
      changed();
    }
  }

  function handleBackspace(e) {
    const s = sel();
    if (!s.rangeCount || !s.isCollapsed) return;
    const li = closestIn('li');
    if (li && li.parentElement.parentNode === editor && caretAt(li, false)) {
      e.preventDefault();
      unlist();
      changed();
      return;
    }
    const quote = closestIn('blockquote');
    if (quote && quote.parentNode === editor && caretAt(quote, false)) {
      e.preventDefault();
      replaceTag(quote, 'p');
      changed();
    }
  }

  editor.addEventListener('keydown', (e) => {
    if (slash && slashOpen() && slash.items.length) {
      const n = slash.items.length;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((slash.index + 1) % n, true, true); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((slash.index - 1 + n) % n, true, true); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); runSlash(slash.items[slash.index]); return; }
    }
    if (e.key === 'Escape') {
      if (slash) { e.preventDefault(); closeSlash(); return; }
      if (bubbleOpen()) { e.preventDefault(); hideBubble(); return; }
    }
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Tab') { handleTab(e); return; }
    if (e.key === 'Enter' && !e.shiftKey && !mod) { handleEnter(e); return; }
    if (e.key === 'Backspace' && !mod) handleBackspace(e);
  });

  /* ---------- Typing ---------- */

  const INLINE = /^(#text|B|STRONG|I|EM|U|S|STRIKE|SPAN|A|FONT|BR|CODE|SUB|SUP|MARK|IMG)$/;
  function normalize() {
    if (!editor.firstChild || editor.innerHTML === '<br>') {
      editor.innerHTML = '<p><br></p>';
      placeCaret(editor.firstChild, false);
      return;
    }
    const stray = Array.from(editor.childNodes).some((n) => INLINE.test(n.nodeName) && !(n.nodeType === 3 && !n.data.trim()));
    if (stray) {
      withSelection(() => {
        let p = null;
        for (const n of Array.from(editor.childNodes)) {
          if (!INLINE.test(n.nodeName)) { p = null; continue; }
          if (n.nodeType === 3 && !n.data.trim() && !p) continue;
          if (!p) { p = document.createElement('p'); n.before(p); }
          p.appendChild(n);
        }
      });
    }
    const last = editor.lastElementChild;
    if (last && /^(TABLE|HR)$/.test(last.tagName)) editor.appendChild(newP());
  }

  editor.addEventListener('input', (e) => {
    normalize();
    if (e.inputType === 'insertText' && e.data === '/') openSlash();
    else if (e.inputType === 'insertText' && e.data === ' ' && !slash) markdown();
    else if (e.inputType === 'insertParagraph') fixNewItem();
    if (slash) updateSlash();
    if (/^(insert|delete)/.test(e.inputType || '')) hideBubble();
    changed();
  });

  editor.addEventListener('blur', () => { closeSlash(); setTimeout(() => { if (document.activeElement !== editor) hideBubble(); }, 0); });

  document.addEventListener('selectionchange', () => {
    if (slash) updateSlash();
    if (pointerDown) return;
    if (!selectionUsable()) { if (bubbleOpen()) hideBubble(); return; }
    scheduleBubble(bubbleOpen() ? 60 : 220);
  });

  editor.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (a && (e.ctrlKey || e.metaKey)) { e.preventDefault(); window.open(a.href, '_blank', 'noopener'); }
  });

  editor.addEventListener('paste', (e) => {
    const html = e.clipboardData && e.clipboardData.getData('text/html');
    if (!html) return;
    e.preventDefault();
    exec('insertHTML', sanitize(html));
  });

  $('#sheet').addEventListener('mousedown', (e) => {
    if (e.target.id !== 'sheet') return;
    e.preventDefault();
    editor.focus();
    placeCaret(editor.lastElementChild || editor, true);
  });

  /* ===================================================================
     Drag and drop files onto the page
     =================================================================== */

  const dropLayer = $('#dropLayer');
  const dropCard = $('#dropCard');
  const cardInner = $('#cardInner');
  const dropLine = $('#dropLine');
  const dropLabel = $('#dropLabel');
  const dropHintText = $('#dropHintText');
  let dragging = false;
  let dragDepth = 0;
  let dropIndex = 0;
  let rafId = 0;
  let busy = false;
  const card = { x: 0, y: 0, tx: 0, ty: 0, rot: 0 };

  const hasFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') !== -1;
  const cardAt = (x, y, rot, scale) => 'translate3d(' + (x + 18) + 'px,' + (y + 16) + 'px,0) rotate(' + rot + 'deg) scale(' + scale + ')';
  const pageBlocks = () => Array.from(editor.children).filter((b) => !b.classList.contains('drop-skeleton'));

  function startDrag(e) {
    dragging = true;
    if (cardInner.getAnimations) cardInner.getAnimations().forEach((a) => a.cancel());
    const items = Array.from(e.dataTransfer.items || []).filter((i) => i.kind === 'file');
    const n = items.length || 1;
    const kinds = items.map((i) => itemKind(i.type));
    const kind = kinds.length && kinds.every((k) => k === kinds[0]) ? kinds[0] : 'file';
    dropCard.classList.toggle('is-image', kind === 'image');
    dropCard.classList.remove('k-pdf', 'k-sheet', 'k-slides');
    if (kind === 'pdf' || kind === 'sheet' || kind === 'slides') dropCard.classList.add('k-' + kind);
    dropCard.classList.toggle('stack', n > 1);
    dropCard.classList.remove('bad');
    dropLayer.classList.remove('bad', 'landing');
    $('#dropCount').textContent = n;
    dropLabel.textContent = n > 1 ? n + ' files' : ({ image: 'Image', pdf: 'PDF', doc: 'Document', sheet: 'Spreadsheet', slides: 'Slides' })[kind] || 'File';
    dropHintText.textContent = n > 1 ? 'Drop to add them to your page' : 'Drop to add it to your page';
    card.x = card.tx = e.clientX;
    card.y = card.ty = e.clientY;
    card.rot = 0;
    dropCard.style.opacity = '';
    dropCard.style.transform = cardAt(card.x, card.y, 0, 1);
    hideBubble();
    closeSlash();
    closeMenu();
    dropLine.classList.add('snap');
    placeLine(e.clientY);
    requestAnimationFrame(() => dropLine.classList.remove('snap'));
    dropLayer.classList.add('on');
    animate(cardInner, [
      { transform: 'scale(.4) rotate(-12deg)', opacity: 0 },
      { transform: 'none', opacity: 1 }
    ], { duration: 520, easing: SPRING });
    follow();
  }

  // The card trails the cursor on a spring and tilts with the speed of the drag.
  function follow() {
    cancelAnimationFrame(rafId);
    const tick = () => {
      const dx = card.tx - card.x;
      const dy = card.ty - card.y;
      card.x += dx * .2;
      card.y += dy * .2;
      card.rot += (Math.max(-16, Math.min(16, dx * .4)) - card.rot) * .18;
      dropCard.style.transform = cardAt(card.x, card.y, card.rot.toFixed(2), 1);
      if (dragging) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  // A blue line shows the gap between blocks where the file will land.
  function placeLine(y) {
    const blocks = pageBlocks();
    const er = editor.getBoundingClientRect();
    let idx = 0;
    let lineY;
    if (editor.classList.contains('is-empty') || !blocks.length) {
      lineY = er.top + 2;
    } else {
      for (const b of blocks) {
        const r = b.getBoundingClientRect();
        if (r.top + r.height / 2 < y) idx++; else break;
      }
      if (idx === 0) lineY = blocks[0].getBoundingClientRect().top - 5;
      else if (idx >= blocks.length) lineY = blocks[blocks.length - 1].getBoundingClientRect().bottom + 5;
      else lineY = (blocks[idx - 1].getBoundingClientRect().bottom + blocks[idx].getBoundingClientRect().top) / 2;
    }
    dropIndex = idx;
    dropLine.style.width = Math.round(er.width) + 'px';
    dropLine.style.transform = 'translate3d(' + Math.round(er.left) + 'px,' + Math.round(lineY - 1.5) + 'px,0)';
  }

  function cancelDrag() {
    dragging = false;
    cancelAnimationFrame(rafId);
    animate(cardInner, [{ transform: 'none', opacity: 1 }, { transform: 'scale(.5) rotate(10deg)', opacity: 0 }], { duration: 220, easing: EASE, fill: 'forwards' });
    setTimeout(() => { if (!dragging) dropLayer.classList.remove('on'); }, reduceMotion.matches ? 0 : 230);
  }

  function rejectDrop(files) {
    const ext = files[0] ? (files[0].name.split('.').pop() || '').toLowerCase() : '';
    dropLabel.textContent = ext && files[0].name.indexOf('.') !== -1 ? 'Can’t add .' + ext : 'Can’t add this';
    dropHintText.textContent = 'Try a document, PDF, slides, spreadsheet, text file or image';
    dropCard.classList.remove('bad');
    void dropCard.offsetWidth; // restart the shake
    dropCard.classList.add('bad');
    dropLayer.classList.add('bad');
    setTimeout(() => {
      if (dragging) return;
      animate(cardInner, [{ transform: 'none', opacity: 1 }, { transform: 'translateY(30px) scale(.7)', opacity: 0 }], { duration: 300, easing: EASE, fill: 'forwards' });
      setTimeout(() => { if (!dragging) dropLayer.classList.remove('on', 'bad'); }, reduceMotion.matches ? 0 : 300);
    }, 1500);
  }

  function makeSkeleton(file) {
    const sk = document.createElement('div');
    sk.className = 'drop-skeleton';
    sk.contentEditable = 'false';
    sk.innerHTML = '<div class="sk-head"><span class="sk-spin"></span><span class="sk-label"></span></div>' +
      '<div class="sk-line"></div><div class="sk-line"></div><div class="sk-line"></div><div class="sk-bar"></div>';
    sk.querySelector('.sk-label').textContent = 'Adding “' + file.name + '”…';
    return sk;
  }

  async function insertFile(file, index) {
    const sk = makeSkeleton(file);
    editor.insertBefore(sk, pageBlocks()[index] || null);
    updateEmpty();
    const h = sk.offsetHeight;
    animate(sk, [
      { height: '0px', opacity: 0, transform: 'scale(.96)', marginTop: '0px', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px' },
      { height: h + 'px', opacity: 1, transform: 'none' }
    ], { duration: 460, easing: SPRING });
    const r = sk.getBoundingClientRect();
    if (r.top < 60 || r.bottom > window.innerHeight) sk.scrollIntoView({ block: 'center', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    const bar = sk.querySelector('.sk-bar');
    requestAnimationFrame(() => { bar.style.width = '68%'; });
    // Big documents take a while: keep the bar creeping forward until they're ready.
    const creep = setTimeout(() => { bar.style.transition = 'width 8s cubic-bezier(.1,.6,.2,1)'; bar.style.width = '94%'; }, 600);
    const started = performance.now();
    let html = null;
    let problem = '';
    try {
      html = await fileToHTML(file);
    } catch (err) {
      html = null;
      problem = err && err.userMessage ? err.userMessage
        : err && err.offline ? 'Connect to the internet to open .' + extOf(file) + ' files.' : '';
    }
    clearTimeout(creep);
    bar.style.transition = '';
    const left = 750 - (performance.now() - started);
    if (left > 0) await wait(left);
    bar.style.width = '100%';
    await wait(260);
    const tpl = document.createElement('template');
    if (html) tpl.innerHTML = html;
    const els = Array.from(tpl.content.childNodes)
      .filter((n) => n.nodeType === 1 || (n.nodeType === 3 && n.data.trim()))
      .map((n) => { if (n.nodeType !== 3) return n; const p = document.createElement('p'); p.textContent = n.data.trim(); return p; });
    if (!els.length) {
      sk.classList.add('failed');
      sk.querySelector('.sk-label').textContent = problem ||
        (html === null ? 'Couldn’t read “' + file.name + '”' : '“' + file.name + '” has nothing to add');
      await wait(problem ? 2800 : 1600);
      const a = animate(sk, [{ height: sk.offsetHeight + 'px', opacity: 1 }, { height: '0px', opacity: 0, marginTop: '0px', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px' }], { duration: 300, easing: EASE });
      if (a) await wait(290);
      sk.remove();
      return index;
    }
    const out = animate(sk, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.97)' }], { duration: 170, easing: 'ease-out' });
    if (out) await wait(160);
    const frag = document.createDocumentFragment();
    els.forEach((el) => frag.appendChild(el));
    sk.replaceWith(frag);
    reveal(els);
    return index + els.length;
  }

  async function handleDrop(files) {
    dragging = false;
    cancelAnimationFrame(rafId);
    const ok = files.filter(kindOf);
    if (!ok.length) { rejectDrop(files); return; }
    if (busy) { cancelDrag(); return; }
    busy = true;
    // The card drops into the blue line, which ripples as it lands.
    dropLayer.classList.add('landing');
    const lr = dropLine.getBoundingClientRect();
    const target = 'translate3d(' + (lr.left + 8) + 'px,' + (lr.top - 26) + 'px,0) rotate(0deg) scale(.18)';
    const fall = animate(dropCard, [
      { transform: dropCard.style.transform, opacity: 1 },
      { transform: target, opacity: .2 }
    ], { duration: 420, easing: 'cubic-bezier(.5,0,.75,0)' });
    dropCard.style.transform = target;
    dropCard.style.opacity = '0';
    if (fall) await wait(400);
    const ripple = animate(dropLine, [
      { boxShadow: '0 0 0 3px rgba(0,122,255,.3)', opacity: 1 },
      { boxShadow: '0 0 0 14px rgba(0,122,255,0)', opacity: 0 }
    ], { duration: 380, easing: EASE });
    if (ripple) await wait(120);
    dropLayer.classList.remove('on', 'landing');

    await addFiles(ok, dropIndex, files.length - ok.length);
  }

  // Shared by drops, Import and Insert image: each file gets a loading card, then its content.
  async function addFiles(files, index, skipped) {
    busy = true;
    try {
      const wasEmpty = editor.classList.contains('is-empty');
      if (wasEmpty) { editor.innerHTML = ''; index = 0; }
      const before = pageBlocks().length;
      for (const f of files) index = await insertFile(f, index);
      normalize();
      const added = pageBlocks().length > before;
      if (wasEmpty && added && !named && document.activeElement !== nameEl) {
        const base = files[0].name.replace(/\.[^.]+$/, '').trim();
        if (base) { nameEl.value = base; named = true; sizeName(); }
      }
      const lastAdded = pageBlocks()[Math.max(0, index - 1)];
      editor.focus({ preventScroll: true });
      if (lastAdded) placeCaret(lastAdded, true);
      changed();
      saveNow();
      if (skipped) showStatus('Skipped ' + skipped + ' file' + (skipped > 1 ? 's' : '') + ' it can’t open', true, 2600);
      else if (added && !saveBlocked) showStatus(files.length > 1 ? 'Added ' + files.length + ' files' : 'Added', false, 1600);
    } finally {
      busy = false;
    }
  }

  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    if (!dragging) startDrag(e);
  }, true);
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dragging) startDrag(e);
    card.tx = e.clientX;
    card.ty = e.clientY;
    placeLine(e.clientY);
  }, true);
  window.addEventListener('dragleave', (e) => {
    if (!dragging) return;
    dragDepth = Math.max(0, dragDepth - 1);
    const outside = !e.relatedTarget && (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight);
    if (dragDepth === 0 || outside) { dragDepth = 0; cancelDrag(); }
  }, true);
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepth = 0;
    placeLine(e.clientY);
    handleDrop(Array.from(e.dataTransfer.files || []));
  }, true);

  /* ===================================================================
     Pictures: select, resize, align, shape, rotate, crop and move
     =================================================================== */

  const imgFrame = $('#imgFrame');
  const imgBar = $('#imgBar');
  const imgSize = $('#imgSize');
  const cropBox = $('#cropBox');
  const cropDims = Array.from(document.querySelectorAll('.crop-dim'));
  const ALIGNS = ['img-center', 'img-right', 'img-wrap-left', 'img-wrap-right'];
  const SHAPES = ['img-square', 'img-circle'];
  let selImg = null;
  let cropping = null;
  let imgRaf = 0;
  let imgBusy = false;
  let moving = null;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const isWrapped = (img) => img.classList.contains('img-wrap-left') || img.classList.contains('img-wrap-right');
  const maxImgWidth = (img) => editor.clientWidth * (isWrapped(img) ? .6 : 1);
  const editable = (img) => /^data:image\//.test(img.getAttribute('src') || '');
  const alignOf = (img) => { const c = ALIGNS.find((x) => img.classList.contains(x)); return c ? c.slice(4) : 'left'; };
  const shapeOf = (img) => { const c = SHAPES.find((x) => img.classList.contains(x)); return c ? c.slice(4) : 'rounded'; };

  function selectImage(img) {
    const fresh = selImg !== img;
    if (fresh) deselectImage();
    selImg = img;
    hideBubble();
    closeSlash();
    editor.focus({ preventScroll: true });
    const r = document.createRange();
    r.selectNode(img);
    const s = sel();
    s.removeAllRanges();
    s.addRange(r);
    refreshImgBar();
    placeImageUI();
    imgFrame.classList.add('on');
    imgBar.classList.add('open');
    if (fresh) trackImage();
  }

  function deselectImage() {
    if (!selImg) return;
    if (cropping) endCrop();
    selImg = null;
    cancelAnimationFrame(imgRaf);
    imgFrame.classList.remove('on', 'sizing', 'crop');
    imgBar.classList.remove('open', 'cropping');
  }

  // Keep the frame glued to the picture while the page scrolls, reflows or animates.
  function trackImage() {
    cancelAnimationFrame(imgRaf);
    let last = '';
    const tick = () => {
      if (!selImg) return;
      if (!selImg.isConnected) { deselectImage(); return; }
      const r = selImg.getBoundingClientRect();
      const key = [r.left, r.top, r.width, r.height, getComputedStyle(selImg).borderTopLeftRadius].join();
      if (key !== last) { last = key; placeImageUI(); }
      imgRaf = requestAnimationFrame(tick);
    };
    imgRaf = requestAnimationFrame(tick);
  }

  function placeImageUI() {
    const img = selImg;
    if (!img) return;
    const r = img.getBoundingClientRect();
    imgFrame.style.left = (r.left + window.scrollX - 3) + 'px';
    imgFrame.style.top = (r.top + window.scrollY - 3) + 'px';
    imgFrame.style.width = (r.width + 6) + 'px';
    imgFrame.style.height = (r.height + 6) + 'px';
    const rad = getComputedStyle(img).borderTopLeftRadius;
    imgFrame.style.borderRadius = /^[\d.]+px$/.test(rad) ? (parseFloat(rad) + 3) + 'px' : rad;
    if (cropping) drawCrop();
    const bw = imgBar.offsetWidth;
    const bh = imgBar.offsetHeight;
    const topLimit = $('#top').getBoundingClientRect().bottom + 8;
    let top = r.top - bh - 14;
    let below = false;
    if (top < topLimit) {
      below = true;
      top = r.bottom + 14;
      if (top + bh > window.innerHeight - 8) top = clamp(r.top + 14, topLimit, window.innerHeight - bh - 8);
    }
    imgBar.classList.toggle('below', below);
    imgBar.style.top = Math.round(top) + 'px';
    imgBar.style.left = Math.round(clamp(r.left + r.width / 2 - bw / 2, 8, window.innerWidth - bw - 8)) + 'px';
  }

  function refreshImgBar() {
    const img = selImg;
    if (!img) return;
    const a = alignOf(img);
    const s = shapeOf(img);
    imgBar.querySelectorAll('[data-align]').forEach((b) => b.classList.toggle('on', b.dataset.align === a));
    imgBar.querySelectorAll('[data-shape]').forEach((b) => b.classList.toggle('on', b.dataset.shape === s));
    const can = editable(img);
    imgBar.querySelector('[data-img="rotate"]').disabled = !can;
    imgBar.querySelector('[data-img="crop"]').disabled = !can;
    imgBar.querySelector('[data-img="reset"]').disabled = !img.style.width && !img.style.aspectRatio;
  }

  // A width in pixels, plus a fixed aspect ratio only when the picture has been stretched.
  function applySize(img, w, h, naturalRatio) {
    w = Math.round(w);
    h = Math.round(h);
    img.style.width = w + 'px';
    const natural = naturalRatio || (img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : w / h);
    img.style.aspectRatio = Math.abs(w / h - natural) / natural < .015 ? '' : w + ' / ' + h;
  }

  /* ---------- Resize from the handles ---------- */

  imgFrame.addEventListener('pointerdown', (e) => {
    const handle = e.target.dataset && e.target.dataset.h;
    if (!handle || !selImg || cropping) return;
    e.preventDefault();
    e.stopPropagation();
    const img = selImg;
    // Layout size, not the on-screen box, so a running animation can't skew it.
    const start = { x: e.clientX, y: e.clientY, w: img.offsetWidth, h: img.offsetHeight };
    const ratio = start.w / start.h;
    const k = alignOf(img) === 'center' ? 2 : 1; // centred pictures grow on both sides
    const maxW = maxImgWidth(img);
    const corner = handle.length === 2;
    imgFrame.classList.add('sizing');
    document.documentElement.style.cursor = getComputedStyle(e.target).cursor;
    imgSize.textContent = Math.round(start.w) + ' × ' + Math.round(start.h);
    const move = (ev) => {
      let dx = (ev.clientX - start.x) * k;
      let dy = ev.clientY - start.y;
      if (handle.indexOf('w') !== -1) dx = -dx;
      if (handle.indexOf('n') !== -1) dy = -dy;
      let w = start.w;
      let h = start.h;
      if (corner && !ev.shiftKey) {
        w = clamp(Math.abs(dx) >= Math.abs(dy * ratio) ? start.w + dx : start.w + dy * ratio, 40, maxW);
        h = w / ratio;
      } else {
        if (/[ew]/.test(handle)) w = clamp(start.w + dx, 40, maxW);
        if (/[ns]/.test(handle)) h = clamp(start.h + dy, 30, 3000);
      }
      applySize(img, w, h);
      imgSize.textContent = Math.round(w) + ' × ' + Math.round(h);
      placeImageUI();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      imgFrame.classList.remove('sizing');
      document.documentElement.style.cursor = '';
      refreshImgBar();
      changed();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  /* ---------- Toolbar actions ---------- */

  function setAlign(img, a) {
    if (alignOf(img) === a) return;
    const before = img.getBoundingClientRect();
    ALIGNS.forEach((c) => img.classList.remove(c));
    if (a !== 'left') img.classList.add('img-' + a);
    const after = img.getBoundingClientRect();
    animate(img, [
      { transform: 'translate(' + (before.left - after.left) + 'px,' + (before.top - after.top) + 'px) scale(' + (before.width / after.width) + ')', transformOrigin: 'top left' },
      { transform: 'none', transformOrigin: 'top left' }
    ], { duration: 560, easing: SPRING });
    changed();
  }

  function setShape(img, s) {
    if (shapeOf(img) === s) return;
    SHAPES.forEach((c) => img.classList.remove(c));
    if (s !== 'rounded') img.classList.add('img-' + s);
    animate(img, [{ transform: 'scale(.95)' }, { transform: 'none' }], { duration: 460, easing: SPRING });
    changed();
  }

  // Draws the picture onto a canvas and returns the result as a new data URL.
  function bakeImage(img, draw) {
    return new Promise((resolve) => {
      const nope = () => { showStatus('This picture can’t be edited.', true, 2400); resolve(null); };
      const im = new Image();
      im.onload = () => {
        try {
          const c = document.createElement('canvas');
          const ctx = c.getContext('2d');
          draw(ctx, im, c);
          const png = /^data:image\/png/.test(img.getAttribute('src') || '');
          let out = png ? c.toDataURL('image/png') : '';
          if (!out || out.length > 700000) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalCompositeOperation = 'destination-over';
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, c.width, c.height);
            out = c.toDataURL('image/jpeg', .9);
          }
          resolve(out);
        } catch (e) { nope(); }
      };
      im.onerror = nope;
      im.src = img.getAttribute('src');
    });
  }

  async function rotateImage(img) {
    if (imgBusy) return;
    imgBusy = true;
    try {
      const ow = img.offsetWidth;
      const oh = img.offsetHeight;
      const ratio = img.naturalHeight / img.naturalWidth; // after turning a quarter
      const src = await bakeImage(img, (ctx, im, c) => {
        c.width = im.naturalHeight;
        c.height = im.naturalWidth;
        ctx.translate(c.width, 0);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(im, 0, 0);
      });
      if (!src) return;
      const sized = !!img.style.width;
      img.src = src;
      if (sized) {
        let w = oh;
        let h = ow;
        const max = maxImgWidth(img);
        if (w > max) { h = h * max / w; w = max; }
        applySize(img, w, h, ratio);
      }
      animate(img, [{ transform: 'rotate(-90deg) scale(.82)', opacity: .5 }, { transform: 'none', opacity: 1 }], { duration: 620, easing: SPRING });
      changed();
    } finally {
      imgBusy = false;
    }
  }

  function resetImage(img) {
    const before = img.offsetWidth;
    img.style.width = '';
    img.style.aspectRatio = '';
    if (!img.getAttribute('style')) img.removeAttribute('style');
    const after = img.offsetWidth;
    animate(img, [{ width: before + 'px' }, { width: after + 'px' }], { duration: 460, easing: EASE });
    changed();
  }

  function deleteImage(img) {
    const block = img.parentElement;
    deselectImage();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      img.remove();
      if (block && block.parentNode === editor && block.tagName === 'P' && isEmpty(block)) block.remove();
      normalize();
      changed();
    };
    const a = animate(img, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.82)' }], { duration: 260, easing: EASE });
    if (!a) { finish(); return; }
    a.onfinish = finish;
    setTimeout(finish, 320);
  }

  /* ---------- Crop ---------- */

  function startCrop() {
    if (!selImg || cropping || !editable(selImg)) return;
    cropping = { l: 0, t: 0, r: 1, b: 1 };
    imgFrame.classList.add('crop');
    imgBar.classList.add('cropping');
    placeImageUI();
    animate(cropBox, [{ transform: 'scale(.94)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: SPRING });
  }

  function drawCrop() {
    if (!cropping || !selImg) return;
    const r = selImg.getBoundingClientRect();
    const W = r.width;
    const H = r.height;
    const x = cropping.l * W;
    const y = cropping.t * H;
    const w = (cropping.r - cropping.l) * W;
    const h = (cropping.b - cropping.t) * H;
    const put = (el, left, top, width, height) => Object.assign(el.style, { left: left + 'px', top: top + 'px', width: Math.max(0, width) + 'px', height: Math.max(0, height) + 'px' });
    put(cropBox, x, y, w, h);
    put(cropDims[0], 0, 0, W, y);
    put(cropDims[1], 0, y + h, W, H - y - h);
    put(cropDims[2], 0, y, x, h);
    put(cropDims[3], x + w, y, W - x - w, h);
  }

  function endCrop() {
    cropping = null;
    imgFrame.classList.remove('crop');
    imgBar.classList.remove('cropping');
  }
  function cancelCrop() { endCrop(); placeImageUI(); }

  async function applyCrop() {
    const c = cropping;
    const img = selImg;
    if (!c || !img) return;
    endCrop();
    if (c.l < .005 && c.t < .005 && c.r > .995 && c.b > .995) { placeImageUI(); return; }
    const ow = img.offsetWidth;
    const oh = img.offsetHeight;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const sx = c.l * nw;
    const sy = c.t * nh;
    const sw = (c.r - c.l) * nw;
    const sh = (c.b - c.t) * nh;
    const src = await bakeImage(img, (ctx, im, cv) => {
      cv.width = Math.max(1, Math.round(sw));
      cv.height = Math.max(1, Math.round(sh));
      ctx.drawImage(im, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    });
    if (!src) return;
    img.src = src;
    applySize(img, ow * (c.r - c.l), oh * (c.b - c.t), sw / sh); // the kept part stays the same size on the page
    animate(img, [{ opacity: .4, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: SPRING });
    refreshImgBar();
    changed();
  }

  cropBox.addEventListener('pointerdown', (e) => {
    if (!cropping || !selImg) return;
    e.preventDefault();
    e.stopPropagation();
    const kind = e.target.dataset.c || 'move';
    const r = selImg.getBoundingClientRect();
    const start = Object.assign({ x: e.clientX, y: e.clientY }, cropping);
    const min = .06;
    const move = (ev) => {
      const fx = (ev.clientX - start.x) / r.width;
      const fy = (ev.clientY - start.y) / r.height;
      let { l, t, r: rr, b } = start;
      if (kind === 'move') {
        const w = rr - l;
        const h = b - t;
        l = clamp(start.l + fx, 0, 1 - w);
        t = clamp(start.t + fy, 0, 1 - h);
        rr = l + w;
        b = t + h;
      } else {
        if (kind.indexOf('w') !== -1) l = clamp(start.l + fx, 0, rr - min);
        if (kind.indexOf('e') !== -1) rr = clamp(start.r + fx, l + min, 1);
        if (kind.indexOf('n') !== -1) t = clamp(start.t + fy, 0, b - min);
        if (kind.indexOf('s') !== -1) b = clamp(start.b + fy, t + min, 1);
      }
      Object.assign(cropping, { l, t, r: rr, b });
      drawCrop();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  $('#cropLayer').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); });

  imgBar.addEventListener('mousedown', (e) => e.preventDefault());
  imgBar.addEventListener('pointerdown', (e) => e.stopPropagation());
  imgBar.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    const img = selImg;
    if (!b || b.disabled || !img) return;
    if (b.dataset.align) setAlign(img, b.dataset.align);
    else if (b.dataset.shape) setShape(img, b.dataset.shape);
    else if (b.dataset.img === 'rotate') await rotateImage(img);
    else if (b.dataset.img === 'crop') startCrop();
    else if (b.dataset.img === 'reset') resetImage(img);
    else if (b.dataset.img === 'delete') { deleteImage(img); return; }
    else if (b.dataset.crop === 'done') await applyCrop();
    else if (b.dataset.crop === 'cancel') cancelCrop();
    if (selImg) { refreshImgBar(); placeImageUI(); }
  });

  /* ---------- Move a picture by dragging it ---------- */

  const ghostAt = (x, y, rot) => 'translate(' + (x - moving.gw / 2) + 'px,' + (y - moving.gh / 2) + 'px) rotate(' + rot + 'deg)';

  function beginMove(img, ev) {
    const r = img.getBoundingClientRect();
    const ghost = document.createElement('img');
    ghost.className = 'img-ghost';
    ghost.src = img.src;
    const gw = Math.min(180, r.width);
    const gh = gw * r.height / r.width;
    ghost.style.width = gw + 'px';
    ghost.style.borderRadius = getComputedStyle(img).borderTopLeftRadius;
    document.body.appendChild(ghost);
    moving = { img, ghost, gw, gh, x: ev.clientX, y: ev.clientY, tx: ev.clientX, ty: ev.clientY, rot: 0, raf: 0 };
    img.style.opacity = '.3';
    imgFrame.classList.remove('on');
    imgBar.classList.remove('open');
    dropLayer.classList.add('on', 'moving');
    dropLine.classList.add('snap');
    placeLine(ev.clientY);
    requestAnimationFrame(() => dropLine.classList.remove('snap'));
    ghost.style.transform = ghostAt(ev.clientX, ev.clientY, 0);
    animate(ghost, [
      { transform: 'translate(' + (r.left + r.width / 2 - gw / 2) + 'px,' + (r.top + r.height / 2 - gh / 2) + 'px) scale(' + (r.width / gw) + ')', opacity: .5 },
      { transform: ghostAt(ev.clientX, ev.clientY, 0), opacity: 1 }
    ], { duration: 340, easing: EASE });
    const tick = () => {
      if (!moving) return;
      const dx = moving.tx - moving.x;
      moving.x += dx * .25;
      moving.y += (moving.ty - moving.y) * .25;
      moving.rot += (clamp(dx * .35, -12, 12) - moving.rot) * .2;
      ghost.style.transform = ghostAt(moving.x, moving.y, moving.rot.toFixed(2));
      if (moving.ty < 80) window.scrollBy(0, -12);
      else if (moving.ty > window.innerHeight - 50) window.scrollBy(0, 12);
      moving.raf = requestAnimationFrame(tick);
    };
    moving.raf = requestAnimationFrame(tick);
  }

  function finishMove() {
    const { img, ghost } = moving;
    cancelAnimationFrame(moving.raf);
    moving = null;
    dropLayer.classList.remove('on', 'moving');
    const blocks = pageBlocks();
    let node = img.parentElement;
    const own = node && node.parentNode === editor && node.tagName === 'P' && !node.textContent.trim() && node.querySelectorAll('img').length === 1;
    const ref = blocks[dropIndex] || null;
    const stays = own && (ref === node || ref === node.nextElementSibling);
    if (!stays) {
      const firsts = new Map(blocks.map((b) => [b, b.getBoundingClientRect().top]));
      if (!own) {
        const p = document.createElement('p');
        p.appendChild(img);
        node = p;
      }
      editor.insertBefore(node, ref);
      blocks.forEach((b) => {
        if (b === node || !b.isConnected) return;
        const d = firsts.get(b) - b.getBoundingClientRect().top;
        if (Math.abs(d) > 1) animate(b, [{ transform: 'translateY(' + d + 'px)' }, { transform: 'none' }], { duration: 440, easing: EASE });
      });
    }
    img.style.opacity = '';
    if (!img.getAttribute('style')) img.removeAttribute('style');
    // The picture lands from where the ghost was let go.
    const gr = ghost.getBoundingClientRect();
    const ir = img.getBoundingClientRect();
    animate(img, [
      { transform: 'translate(' + (gr.left - ir.left) + 'px,' + (gr.top - ir.top) + 'px) scale(' + (gr.width / ir.width) + ')', transformOrigin: 'top left' },
      { transform: 'none', transformOrigin: 'top left' }
    ], { duration: 560, easing: SPRING });
    ghost.remove();
    normalize();
    changed();
    selectImage(img);
  }

  editor.addEventListener('pointerdown', (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG' || !editor.contains(img) || e.button !== 0 || cropping) return;
    e.preventDefault();
    selectImage(img);
    const sx = e.clientX;
    const sy = e.clientY;
    let started = false;
    const move = (ev) => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        started = true;
        beginMove(img, ev);
      }
      moving.tx = ev.clientX;
      moving.ty = ev.clientY;
      placeLine(ev.clientY);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (started && moving) finishMove();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  editor.addEventListener('dragstart', (e) => { if (e.target.tagName === 'IMG') e.preventDefault(); });

  // Clicking anywhere else puts the picture down (and applies a crop in progress).
  document.addEventListener('pointerdown', (e) => {
    if (!selImg || moving) return;
    if (e.target === selImg || imgBar.contains(e.target) || imgFrame.contains(e.target)) return;
    if (cropping) applyCrop();
    deselectImage();
  }, true);

  document.addEventListener('selectionchange', () => {
    if (!selImg || cropping || moving || imgBusy) return;
    const s = sel();
    if (!s.rangeCount || s.isCollapsed) deselectImage();
  });

  document.addEventListener('keydown', (e) => {
    if (!selImg) return;
    if (cropping) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Enter') applyCrop();
      else if (e.key === 'Escape') cancelCrop();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      const img = selImg;
      deselectImage();
      const r = document.createRange();
      r.setStartAfter(img);
      r.collapse(true);
      sel().removeAllRanges();
      sel().addRange(r);
    }
  }, true);

  /* ================= Inside HABERVERSE ================= */

  // The page as a standalone file: it opens in any browser and comes back here intact.
  function docFileHTML() {
    const css = [
      ':root{--sans:' + cssVar('sans') + ';--serif:' + cssVar('serif') + ';--mono:' + cssVar('mono') + ';--size:' + settings.size + 'px}',
      'body{margin:0;background:#fff;color:#1d1d1f;-webkit-font-smoothing:antialiased}',
      'article{max-width:760px;margin:0 auto;padding:48px 24px 96px;font-family:var(--' + settings.font + ');font-size:var(--size);line-height:1.65}',
      'p{margin:0 0 .45em}h1{font-size:1.75em;line-height:1.2;margin:1.1em 0 .35em}h2{font-size:1.35em;line-height:1.28;margin:1em 0 .3em}h3{font-size:1.12em;margin:.9em 0 .25em}',
      'article>:first-child{margin-top:0}ul,ol{padding-left:1.5em;margin:0 0 .6em}a{color:#007aff}',
      'img{display:block;max-width:100%;height:auto;margin:.3em 0;border-radius:10px}.img-square{border-radius:3px}.img-circle{border-radius:50%}',
      '.img-center{margin-left:auto;margin-right:auto}.img-right{margin-left:auto;margin-right:0}',
      '.img-wrap-left{float:left;max-width:60%;margin:.3em 1.1em .5em 0}.img-wrap-right{float:right;max-width:60%;margin:.3em 0 .5em 1.1em}',
      'blockquote{margin:.6em 0;padding-left:1em;border-left:3px solid #c7c7cc;color:#6e6e73}hr{border:0;border-top:1px solid #e5e5ea;margin:1.3em 0;clear:both}',
      'pre{margin:.5em 0 .8em;padding:.8em 1em;border-radius:12px;background:#f5f5f7;font:.82em/1.55 var(--mono);white-space:pre-wrap;clear:both}',
      'table{border-collapse:collapse;width:100%;clear:both}td,th{border:1px solid #e5e5ea;padding:.3em .6em;text-align:left}th{background:#f5f5f7}',
      '.f-sans{font-family:var(--sans)}.f-serif{font-family:var(--serif)}.f-mono{font-family:var(--mono)}',
      '.s-small{font-size:calc(var(--size)*.85)}.s-normal{font-size:var(--size)}.s-large{font-size:calc(var(--size)*1.3)}.s-huge{font-size:calc(var(--size)*1.7)}',
      'ul.todo{list-style:none;padding-left:0}ul.todo>li{position:relative;padding:.12em 0 .12em 1.8em}',
      'ul.todo>li::before{content:"";position:absolute;left:.15em;top:.395em;width:1.1em;height:1.1em;border:1.5px solid #c7c7cc;border-radius:50%;box-sizing:border-box}',
      'ul.todo>li[data-checked="true"]{color:#86868b;text-decoration:line-through}ul.todo>li[data-checked="true"]::before{background:#007aff;border-color:#007aff}'
    ].join('');
    return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>' + esc(named ? nameEl.value.trim() || UNTITLED : UNTITLED) + '</title><style>' + css + '</style></head><body>\n' +
      '<article data-ultidash data-font="' + settings.font + '" data-size="' + settings.size + '" data-named="' + named + '">' +
      contentHTML() + '</article>\n</body></html>\n';
  }

  function postSave(force) {
    if (!docPath) return true;
    const file = docFileHTML();
    const name = named ? nameEl.value.trim() || UNTITLED : UNTITLED;
    if (!force && file === lastSent && name === lastName) return true;
    lastSent = file;
    lastName = name;
    window.parent.postMessage({ type: 'save', path: docPath, file, name, named }, '*');
    showStatus('Saving…', false, 0);
    return true;
  }

  function openDoc(m) {
    deselectImage();
    hideBubble();
    closeSlash();
    closeMenu();
    docPath = m.path;
    const doc = new DOMParser().parseFromString(m.text || '', 'text/html');
    const art = doc.querySelector('[data-ultidash]');
    const fileName = m.name || UNTITLED;
    let html = '';
    settings.font = 'sans';
    settings.size = 18;
    if (art) {
      html = art.innerHTML;
      const f = art.getAttribute('data-font');
      const s = Number(art.getAttribute('data-size'));
      if (['sans', 'serif', 'mono'].includes(f)) settings.font = f;
      if (s >= MIN_SIZE && s <= MAX_SIZE) settings.size = s;
      named = art.hasAttribute('data-named') ? art.getAttribute('data-named') === 'true' : !/^untitled( document)?( \(\d+\))?$/i.test(fileName);
    } else {
      if ((m.text || '').trim()) html = htmlToBlocks(m.text);
      named = !/^untitled( document)?( \(\d+\))?$/i.test(fileName);
    }
    editor.innerHTML = safeHTML(html) || '<p><br></p>';
    normalize();
    nameEl.value = named ? fileName : UNTITLED;
    applySettings();
    sizeName();
    updateEmpty();
    lastSent = docFileHTML();
    lastName = named ? nameEl.value.trim() : UNTITLED;
    savedEl.classList.remove('show');
    window.scrollTo(0, 0);
    editor.focus({ preventScroll: true });
    placeCaret(editor.firstElementChild || editor, false);
    window.parent.postMessage({ type: 'opened', path: docPath }, '*');
    reveal(Array.from(editor.children).slice(0, 12));
    if (m.importFile) addFiles([m.importFile], 0, 0);
  }

  if (EMBED) {
    $('#backBtn').hidden = false;
    $('#backBtn').addEventListener('click', () => {
      if (document.activeElement === nameEl) nameEl.blur(); // commits a name being typed
      clearTimeout(saveTimer);
      postSave(false);
      deselectImage();
      hideBubble();
      closeSlash();
      closeMenu();
      window.parent.postMessage({ type: 'close', path: docPath }, '*');
    });
    window.addEventListener('message', (e) => {
      if (e.source !== window.parent || !e.data || typeof e.data !== 'object') return;
      const m = e.data;
      if (m.type === 'open') openDoc(m);
      else if (m.type === 'renamed') {
        docPath = m.path;
        if (named && document.activeElement !== nameEl) { nameEl.value = m.name; sizeName(); }
      } else if (m.type === 'saved') {
        showStatus(m.ok ? 'Saved' : m.message || 'Couldn’t save', !m.ok, m.ok ? 1400 : 0);
      }
    });
  }

  /* ================= Window ================= */

  window.addEventListener('scroll', () => {
    $('#top').classList.toggle('scrolled', window.scrollY > 4);
    if (slash) positionSlash();
    if (bubbleOpen() && selectionUsable()) positionBubble();
  }, { passive: true });
  window.addEventListener('resize', () => {
    if (slash) positionSlash();
    if (bubbleOpen() && selectionUsable()) positionBubble();
    placeThumb(fontSeg);
  });
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { sizeName(); placeThumb(fontSeg); });

  /* ================= Start ================= */

  exec('defaultParagraphSeparator', 'p');
  exec('styleWithCSS', false);
  if (EMBED) editor.innerHTML = '<p><br></p>';
  else load();
  applySettings();
  sizeName();
  updateEmpty();
  editor.focus();
  placeCaret(editor.lastElementChild || editor, true);
  if (EMBED) window.parent.postMessage({ type: 'ready' }, '*');
})();
