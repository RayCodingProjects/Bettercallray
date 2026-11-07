(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const EASE = 'cubic-bezier(.32,.72,0,1)';
  const SPRING = 'cubic-bezier(.34,1.32,.64,1)';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const animate = (el, frames, opts) => {
    if (reduceMotion.matches || !el || !el.animate) return null;
    try { return el.animate(frames, opts); } catch (e) { return null; }
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage blocked */ } }
  };

  /* ================= Paths ================= */

  const join = (...parts) => parts.filter((p) => p != null && p !== '').join('/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
  const parentOf = (p) => (p.indexOf('/') === -1 ? '' : p.slice(0, p.lastIndexOf('/')));
  const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);
  const extOf = (n) => (n.indexOf('.') <= 0 ? '' : n.split('.').pop().toLowerCase());
  const stem = (n) => (extOf(n) ? n.slice(0, n.lastIndexOf('.')) : n);
  const cleanName = (n) => String(n).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 120);
  const isDoc = (n) => /^(html?)$/.test(extOf(n));
  const shown = (n) => (isDoc(n) ? stem(n) : n);

  function uniqueName(name, taken) {
    if (!taken.has(name.toLowerCase())) return name;
    const s = stem(name);
    const e = extOf(name) ? '.' + extOf(name) : '';
    for (let i = 2; ; i++) {
      const n = s + ' (' + i + ')' + e;
      if (!taken.has(n.toLowerCase())) return n;
    }
  }
  async function uniquePath(dir, name, except) {
    const taken = new Set((await fs.list(dir)).filter((i) => i.path !== except).map((i) => i.name.toLowerCase()));
    return join(dir, uniqueName(name, taken));
  }

  /* ================= GitHub: where your files live ================= */

  // The repository comes from assets/js/config.js when it's filled in, otherwise from the
  // GitHub Pages address (https://owner.github.io/repo/), otherwise from what was typed
  // the first time on this device.
  const CONFIG = window.HABERVERSE_CONFIG || {};
  const FOLDER_NAME = CONFIG.folder != null ? String(CONFIG.folder).split('/').map(cleanName).filter(Boolean).join('/') : 'HABERVERSE';
  const REPO_KEY = 'haberverse.repository';
  const tokenKey = (c) => 'haberverse.token:' + c.owner + '/' + c.repo;

  function pagesRepo() {
    const m = /^([a-z0-9-]+)\.github\.io$/i.exec(location.hostname);
    if (!m) return null;
    const first = location.pathname.split('/').filter(Boolean)[0];
    return { owner: m[1], repo: first && !/\.html?$/i.test(first) ? decodeURIComponent(first) : m[1] + '.github.io' };
  }
  function findRepo() {
    if (CONFIG.owner && CONFIG.repo) return { owner: CONFIG.owner, repo: CONFIG.repo };
    return pagesRepo() || ls.get(REPO_KEY);
  }

  const b64ToBytes = (b64) => {
    const s = atob(String(b64).replace(/\s/g, ''));
    const a = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
  };
  const blobToB64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

  const fs = {
    kind: 'github',
    name: 'GitHub',
    cfg: { owner: '', repo: '', branch: '', root: FOLDER_NAME, token: '' },
    shas: new Map(),
    snapshot: null, // without a token: one look at the whole repository, reused until something changes
    get canWrite() { return !!this.cfg.token; },
    detail() { return this.cfg.owner + '/' + this.cfg.repo; },
    full(p) { return join(this.cfg.root, p); },
    rel(full) { return this.cfg.root ? full.slice(this.cfg.root.length + 1) : full; },
    enc(p) { return p.split('/').map(encodeURIComponent).join('/'); },
    repo(rest) { return '/repos/' + encodeURIComponent(this.cfg.owner) + '/' + encodeURIComponent(this.cfg.repo) + rest; },
    contents(p) { return this.repo('/contents/' + this.enc(this.full(p))); },
    ref() { return '?ref=' + encodeURIComponent(this.cfg.branch); },

    async api(path, opts) {
      opts = opts || {};
      const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
      if (this.cfg.token) headers.Authorization = 'Bearer ' + this.cfg.token;
      if (opts.body) headers['Content-Type'] = 'application/json';
      let res;
      try { res = await fetch('https://api.github.com' + path, { method: opts.method || 'GET', headers, body: opts.body, cache: 'no-store' }); }
      catch (e) { throw Object.assign(new Error('Can’t reach GitHub. Check your internet connection.'), { offline: true }); }
      if (!res.ok) {
        let msg = '';
        try { msg = (await res.json()).message || ''; } catch (e) { /* no body */ }
        const limited = (res.status === 403 || res.status === 429) && /rate limit/i.test(msg);
        const text = res.status === 401 ? 'GitHub didn’t accept your access token. Connect again with a new one.'
          : limited ? (this.cfg.token ? 'GitHub needs a short break (too many requests). Try again in a few minutes.' : 'GitHub limits how often your files can be looked at without a token. Connect to keep going.')
          : res.status === 403 ? 'Your token can’t change this repository. Give it Contents: Read and write.'
          : res.status === 404 ? 'Not found on GitHub.' : msg || 'GitHub answered with an error (' + res.status + ').';
        throw Object.assign(new Error(text), { status: res.status, limited });
      }
      return res.status === 204 ? null : res.json();
    },

    // Finds the branch to use (and tells whether the repository can be seen at all).
    async branchName() {
      if (!this.cfg.branch) this.cfg.branch = (await this.api(this.repo(''))).default_branch || 'main';
      return this.cfg.branch;
    },

    itemsFrom(entries) {
      const out = [];
      const seen = new Set();
      entries.forEach((t) => {
        if (this.cfg.root && !t.path.startsWith(this.cfg.root + '/')) return;
        const path = this.rel(t.path);
        if (!path || path.split('/').some((s) => s.startsWith('.'))) return;
        seen.add(path);
        out.push({ path, name: baseOf(path), kind: t.type === 'tree' ? 'folder' : 'file', size: t.size || 0, sha: t.sha });
      });
      // Folders that only hold a hidden .keep file still show up.
      entries.forEach((t) => {
        if (t.type !== 'blob' || !this.cfg.root || !t.path.startsWith(this.cfg.root + '/')) return;
        const parts = this.rel(t.path).split('/');
        for (let i = 1; i < parts.length; i++) {
          const p = parts.slice(0, i).join('/');
          if (!seen.has(p) && !p.split('/').some((s) => s.startsWith('.'))) { seen.add(p); out.push({ path: p, name: baseOf(p), kind: 'folder', size: 0 }); }
        }
      });
      return out;
    },

    async look() {
      if (this.snapshot) return this.snapshot;
      const branch = await this.branchName();
      const commit = (await this.api(this.repo('/git/ref/heads/' + encodeURIComponent(branch)))).object.sha;
      let tree = { tree: [] };
      try { tree = await this.api(this.repo('/git/trees/' + commit + '?recursive=1')); }
      catch (e) { if (e.status !== 404 && e.status !== 409) throw e; }
      this.snapshot = { commit, items: this.itemsFrom(tree.tree) };
      return this.snapshot;
    },

    async list(dir) {
      if (!this.canWrite) return (await this.look()).items.filter((i) => parentOf(i.path) === dir);
      await this.branchName();
      let data;
      try { data = await this.api(this.contents(dir) + this.ref()); } catch (e) { if (e.status === 404) return []; throw e; }
      if (!Array.isArray(data)) return [];
      return data.filter((x) => !x.name.startsWith('.')).map((x) => {
        const path = this.rel(x.path);
        if (x.type === 'file') this.shas.set(path, x.sha);
        return { path, name: x.name, kind: x.type === 'dir' ? 'folder' : 'file', size: x.size || 0, sha: x.sha };
      });
    },

    async all() {
      if (!this.canWrite) return (await this.look()).items;
      const branch = await this.branchName();
      let tree;
      try { tree = await this.api(this.repo('/git/trees/' + encodeURIComponent(branch) + '?recursive=1')); }
      catch (e) { if (e.status === 404 || e.status === 409) return []; throw e; }
      return this.itemsFrom(tree.tree);
    },

    async read(path) {
      if (!this.canWrite) {
        // Without a token, file contents come straight from GitHub's file server, pinned to the exact version listed.
        const { commit } = await this.look();
        let res;
        try { res = await fetch('https://raw.githubusercontent.com/' + encodeURIComponent(this.cfg.owner) + '/' + encodeURIComponent(this.cfg.repo) + '/' + commit + '/' + this.enc(this.full(path))); }
        catch (e) { throw Object.assign(new Error('Can’t reach GitHub. Check your internet connection.'), { offline: true }); }
        if (!res.ok) throw Object.assign(new Error(res.status === 404 ? 'That file isn’t there anymore.' : 'GitHub couldn’t send the file (' + res.status + ').'), { status: res.status });
        return res.blob();
      }
      await this.branchName();
      const meta = await this.api(this.contents(path) + this.ref());
      this.shas.set(path, meta.sha);
      let b64 = meta.encoding === 'base64' ? meta.content : '';
      if (!b64 && meta.size) b64 = (await this.api(this.repo('/git/blobs/' + meta.sha))).content;
      return new Blob([b64ToBytes(b64 || '')]);
    },

    async write(path, blob, message) {
      await this.branchName();
      const content = await blobToB64(blob);
      const url = this.contents(path);
      const body = (sha) => JSON.stringify(Object.assign({ message: message || 'Save ' + baseOf(path), content, branch: this.cfg.branch }, sha ? { sha } : {}));
      let res;
      try {
        res = await this.api(url, { method: 'PUT', body: body(this.shas.get(path)) });
      } catch (e) {
        if (e.status !== 409 && e.status !== 422) throw e;
        // The copy on GitHub changed (or ours was stale): write on top of the latest one.
        let sha = null;
        try { sha = (await this.api(url + this.ref())).sha; } catch (e2) { if (e2.status !== 404) throw e2; }
        res = await this.api(url, { method: 'PUT', body: body(sha) });
      }
      this.shas.set(path, res.content.sha);
    },

    async mkdir(path) { await this.write(join(path, '.keep'), new Blob([]), 'Create folder ' + baseOf(path)); },

    // Several changes in one commit: used for moving, renaming and deleting.
    async commitTree(change, message) {
      const branch = encodeURIComponent(await this.branchName());
      const head = (await this.api(this.repo('/git/ref/heads/' + branch))).object.sha;
      const base = (await this.api(this.repo('/git/commits/' + head))).tree.sha;
      const tree = await this.api(this.repo('/git/trees/' + base + '?recursive=1'));
      const changes = change(tree.tree.filter((t) => t.type === 'blob'));
      if (!changes.length) return;
      const nt = await this.api(this.repo('/git/trees'), { method: 'POST', body: JSON.stringify({ base_tree: base, tree: changes }) });
      const nc = await this.api(this.repo('/git/commits'), { method: 'POST', body: JSON.stringify({ message, tree: nt.sha, parents: [head] }) });
      await this.api(this.repo('/git/refs/heads/' + branch), { method: 'PATCH', body: JSON.stringify({ sha: nc.sha }) });
      this.shas.clear();
    },
    async remove(path) {
      const f = this.full(path);
      await this.commitTree((blobs) => blobs.filter((t) => t.path === f || t.path.startsWith(f + '/'))
        .map((t) => ({ path: t.path, mode: t.mode, type: 'blob', sha: null })), 'Delete ' + baseOf(path));
    },
    async move(from, to) {
      const f = this.full(from);
      const t2 = this.full(to);
      await this.commitTree((blobs) => {
        const out = [];
        blobs.forEach((t) => {
          if (t.path !== f && !t.path.startsWith(f + '/')) return;
          out.push({ path: t2 + t.path.slice(f.length), mode: t.mode, type: 'blob', sha: t.sha });
          out.push({ path: t.path, mode: t.mode, type: 'blob', sha: null });
        });
        return out;
      }, 'Move ' + baseOf(from) + ' to ' + (to || '/'));
    }
  };

  // Changes go one at a time, so saves, moves and uploads never trip over each other.
  // Anything that changes the repository asks for the token first if this device has none.
  let chain = Promise.resolve();
  const serial = (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };
  let allCache = null;
  const changedStore = () => { allCache = null; fs.snapshot = null; };
  const change = (fn) => async (...args) => {
    await ensureWrite(false);
    const r = await serial(() => fn(...args));
    changedStore();
    return r;
  };
  const ops = {
    write: change((p, b, m) => fs.write(p, b, m)),
    mkdir: change((p) => fs.mkdir(p)),
    remove: change((p) => fs.remove(p)),
    move: change((a, b) => fs.move(a, b))
  };
  async function everything() {
    if (!allCache) allCache = fs.all().catch((e) => { allCache = null; throw e; });
    return allCache;
  }

  /* ================= File types ================= */

  const ICON_LINES = '<svg viewBox="0 0 24 24"><path d="M7 7h10M7 12h10M7 17h6"/></svg>';
  const ICON_PIC = '<svg viewBox="0 0 24 24"><path d="M4 18l5-6 4 4 3-3 4 5"/><circle cx="15.5" cy="8" r="1.6"/></svg>';
  const ICON_FILE = '<svg viewBox="0 0 24 24"><path d="M14 4H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8z"/></svg>';
  const FOLDER = '<svg viewBox="0 0 24 24"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6l2 2h7.4A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/></svg>';
  const DOTS = '<svg viewBox="0 0 24 24"><circle cx="12" cy="5.5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="18.5" r="1.7"/></svg>';

  function typeOf(name) {
    const e = extOf(name);
    if (e === 'html' || e === 'htm') return { t: 'doc', label: 'Document', color: '#007aff', glyph: ICON_LINES };
    if (/^(png|jpe?g|gif|webp|bmp|avif|svg|ico)$/.test(e)) return { t: 'image', label: 'Image', color: '#ff9f0a', glyph: ICON_PIC };
    if (e === 'pdf') return { t: 'pdf', label: 'PDF', color: '#ff3b30', glyph: 'PDF' };
    if (/^(docx?|odt|rtf|pages)$/.test(e)) return { t: 'word', label: 'Word document', color: '#2b5fd9', glyph: 'W' };
    if (/^(xlsx?|ods|csv|tsv|numbers)$/.test(e)) return { t: 'sheet', label: 'Spreadsheet', color: '#34c759', glyph: 'XLS' };
    if (/^(pptx?|odp|key)$/.test(e)) return { t: 'slides', label: 'Slides', color: '#ff9500', glyph: 'PPT' };
    if (/^(mp4|mov|webm|mkv|avi)$/.test(e)) return { t: 'video', label: 'Video', color: '#ff2d55', glyph: '▶' };
    if (/^(mp3|wav|m4a|ogg|flac|aac)$/.test(e)) return { t: 'audio', label: 'Audio', color: '#ff2d55', glyph: '♪' };
    if (/^(txt|md|markdown|log|text)$/.test(e)) return { t: 'text', label: 'Text', color: '#8e8e93', glyph: ICON_LINES };
    if (/^(json|xml|js|mjs|ts|tsx|jsx|py|java|c|cpp|h|cs|css|scss|sql|ya?ml|toml|sh|rb|go|rs|php|swift|kt|tex|ini)$/.test(e)) return { t: 'code', label: 'Code', color: '#5856d6', glyph: '&lt;/&gt;' };
    if (/^(zip|rar|7z|gz|tar)$/.test(e)) return { t: 'archive', label: 'Archive', color: '#8e8e93', glyph: 'ZIP' };
    return { t: 'other', label: (e ? e.toUpperCase() + ' file' : 'File'), color: '#8e8e93', glyph: ICON_FILE };
  }
  const tileHTML = (name) => { const ty = typeOf(name); return '<span class="tile" style="background:' + ty.color + '">' + ty.glyph + '</span>'; };
  const CONVERTIBLE = /^(docx|docm|odt|rtf|pdf|pptx|xlsx|xls|ods|csv|tsv|txt|md|markdown|json|xml|js|ts|py|java|c|cpp|cs|css|sql|ya?ml|tex|log)$/;

  function sizeText(n) {
    if (!n) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return Math.round(n / 102.4) / 10 + ' KB';
    return Math.round(n / 104857.6) / 10 + ' MB';
  }
  function dateText(t) {
    if (!t) return '—';
    const d = new Date(t);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  }

  /* ================= State ================= */

  const content = $('#content');
  const crumbsEl = $('#crumbs');
  const searchEl = $('#search');
  let view = 'home';
  let cwd = '';
  let items = [];
  let query = '';
  let layout = ls.get('haberverse.layout') === 'list' ? 'list' : 'grid';
  let renderToken = 0;

  const connId = () => fs ? fs.kind + ':' + fs.detail() : '';
  const recentKey = () => 'haberverse.recent:' + connId();
  const recents = () => ls.get(recentKey()) || [];
  function touchRecent(path) {
    ls.set(recentKey(), [{ path, t: Date.now() }].concat(recents().filter((r) => r.path !== path)).slice(0, 40));
  }
  function moveRecent(from, to) {
    ls.set(recentKey(), recents().map((r) => (r.path === from || r.path.startsWith(from + '/') ? { path: to + r.path.slice(from.length), t: r.t } : r)));
  }
  function dropRecent(path) { ls.set(recentKey(), recents().filter((r) => r.path !== path && !r.path.startsWith(path + '/'))); }

  /* ================= Toast ================= */

  let toastTimer = null;
  function toast(msg, bad) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('bad', !!bad);
    t.classList.add('open');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('open'), bad ? 4200 : 2600);
  }

  /* ================= Dialog ================= */

  let dlgDone = null;
  function dialog({ title, message, value, ok, danger, select }) {
    const wrap = $('#dialog');
    const input = $('#dlgInput');
    $('#dlgTitle').textContent = title;
    $('#dlgMsg').textContent = message || '';
    $('#dlgMsg').hidden = !message;
    input.hidden = value == null;
    input.value = value == null ? '' : value;
    const okBtn = $('#dlgOk');
    okBtn.textContent = ok || 'OK';
    okBtn.className = 'btn ' + (danger ? 'danger' : 'primary');
    wrap.classList.add('open');
    setTimeout(() => {
      if (value != null) {
        input.focus();
        const end = select === 'stem' && extOf(value) ? value.lastIndexOf('.') : value.length;
        input.setSelectionRange(0, end);
      } else okBtn.focus();
    }, 60);
    return new Promise((resolve) => { dlgDone = resolve; });
  }
  function closeDialog(result) {
    if (!dlgDone) return;
    $('#dialog').classList.remove('open');
    const d = dlgDone;
    dlgDone = null;
    d(result);
  }
  $('#dialogForm').addEventListener('submit', (e) => {
    e.preventDefault();
    closeDialog($('#dlgInput').hidden ? true : $('#dlgInput').value);
  });
  $('#dlgCancel').addEventListener('click', () => closeDialog(null));
  $('#dialog').addEventListener('mousedown', (e) => { if (e.target.id === 'dialog') closeDialog(null); });
  $('#dialog').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeDialog(null); } });

  /* ================= Menus ================= */

  let openMenu = null;
  function showMenu(menu, x, y, anchor) {
    hideMenus();
    menu.classList.add('open');
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    const left = Math.max(8, Math.min(x, window.innerWidth - w - 8));
    const top = y + h > window.innerHeight - 8 ? Math.max(8, y - h) : y;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.style.transformOrigin = (top < y ? 'bottom' : 'top') + ' ' + (left < x ? 'right' : 'left');
    openMenu = { menu, anchor };
    if (anchor) anchor.classList.add('on');
  }
  function hideMenus() {
    if (!openMenu) return;
    openMenu.menu.classList.remove('open');
    if (openMenu.anchor) openMenu.anchor.classList.remove('on');
    openMenu = null;
  }
  document.addEventListener('mousedown', (e) => { if (openMenu && !openMenu.menu.contains(e.target)) hideMenus(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideMenus(); });
  window.addEventListener('resize', hideMenus);

  /* ================= Rendering ================= */

  function setLayoutIcon() {
    $('#viewBtn').innerHTML = layout === 'grid'
      ? '<svg viewBox="0 0 24 24"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>'
      : '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>';
    $('#viewBtn').title = layout === 'grid' ? 'List view' : 'Grid view';
  }

  function drawCrumbs() {
    crumbsEl.textContent = '';
    const add = (label, path, last) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'crumb' + (last ? ' last' : '');
      b.textContent = label;
      if (path != null) {
        b.dataset.drop = path;
        b.addEventListener('click', () => go(path));
      }
      crumbsEl.appendChild(b);
    };
    const chev = () => crumbsEl.insertAdjacentHTML('beforeend', '<svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>');
    if (query) { add('Search results for “' + query + '”', null, true); return; }
    if (view === 'recent') { add('Recent', null, true); return; }
    const parts = cwd ? cwd.split('/') : [];
    add('My HABERVERSE', '', !parts.length);
    parts.forEach((p, i) => { chev(); add(p, parts.slice(0, i + 1).join('/'), i === parts.length - 1); });
  }

  function skeleton() {
    content.innerHTML = '<div class="sec-title">&nbsp;</div><div class="folder-grid">' + '<div class="skeleton" style="height:54px"></div>'.repeat(4) +
      '</div><div class="sec-title">&nbsp;</div><div class="file-grid">' + '<div class="skeleton" style="height:208px"></div>'.repeat(6) + '</div>';
  }

  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

  async function render(opts) {
    opts = opts || {};
    const token = ++renderToken;
    drawCrumbs();
    document.querySelectorAll('.nav').forEach((n) => n.classList.toggle('on', !query && n.dataset.nav === view));
    if (!opts.quiet) skeleton();
    let list;
    try {
      if (query) {
        const q = query.toLowerCase();
        list = (await everything()).filter((i) => shown(i.name).toLowerCase().indexOf(q) !== -1).slice(0, 200);
      } else if (view === 'recent') {
        list = recents().map((r) => ({ path: r.path, name: baseOf(r.path), kind: 'file', modified: r.t, opened: r.t }));
      } else {
        list = await fs.list(cwd);
      }
    } catch (e) {
      if (token !== renderToken) return;
      content.innerHTML = '';
      const box = document.createElement('div');
      box.className = 'empty';
      box.innerHTML = '<svg class="big-folder" viewBox="0 0 24 24">' + FOLDER.slice(FOLDER.indexOf('<path')) + '<h2>Can’t open this folder</h2><p></p><div class="actions"><button class="btn primary" type="button">Try again</button><button class="btn" type="button"></button></div>';
      box.querySelector('p').textContent = e.message || 'Something went wrong.';
      const [again, connect] = box.querySelectorAll('button');
      again.addEventListener('click', () => render());
      connect.textContent = fs.canWrite ? 'Connect again' : 'Connect to GitHub';
      connect.addEventListener('click', async () => { if (await connectBox(fs.canWrite ? 'expired' : 'save')) render(); });
      content.appendChild(box);
      return;
    }
    if (token !== renderToken) return;
    items = list;
    draw(opts);
  }

  function draw(opts) {
    const folders = items.filter((i) => i.kind === 'folder').sort(byName);
    const files = items.filter((i) => i.kind === 'file').sort(view === 'recent' && !query ? (a, b) => b.opened - a.opened : byName);
    content.textContent = '';
    if (!folders.length && !files.length) { drawEmpty(); return; }
    const showWhere = !!query || view === 'recent';
    if (layout === 'list') {
      const rows = document.createElement('div');
      rows.className = 'rows';
      rows.innerHTML = '<div class="row-head"><span></span><span>Name</span><span>' + (view === 'recent' && !query ? 'Opened' : 'Modified') + '</span><span>Size</span><span></span></div>';
      folders.concat(files).forEach((it) => rows.appendChild(rowEl(it, showWhere)));
      content.appendChild(rows);
    } else {
      if (folders.length) {
        content.insertAdjacentHTML('beforeend', '<div class="sec-title">Folders</div>');
        const g = document.createElement('div');
        g.className = 'folder-grid';
        folders.forEach((it) => g.appendChild(folderEl(it, showWhere)));
        content.appendChild(g);
      }
      if (files.length) {
        content.insertAdjacentHTML('beforeend', '<div class="sec-title">' + (view === 'recent' && !query ? 'Recently opened' : 'Files') + '</div>');
        const g = document.createElement('div');
        g.className = 'file-grid';
        files.forEach((it) => g.appendChild(fileEl(it, showWhere)));
        content.appendChild(g);
      }
    }
    if (!opts.quiet) {
      Array.from(content.querySelectorAll('.folder, .file, .row')).slice(0, 40).forEach((el, i) => {
        animate(el, [{ opacity: 0, transform: 'translateY(10px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 460, delay: i * 22, easing: EASE, fill: 'backwards' });
      });
    }
  }

  function drawEmpty() {
    const box = document.createElement('div');
    box.className = 'empty';
    if (query) {
      box.innerHTML = '<h2>No matches</h2><p>Nothing in HABERVERSE is called “' + esc(query) + '”.</p>';
    } else if (view === 'recent') {
      box.innerHTML = '<svg class="big-folder" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="#d4dcea" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="#d4dcea" stroke-width="2" stroke-linecap="round"/></svg><h2>Nothing opened yet</h2><p>Documents you open show up here, newest first.</p>';
    } else {
      box.innerHTML = '<svg class="big-folder" viewBox="0 0 24 24">' + FOLDER.slice(FOLDER.indexOf('<path')) +
        '<h2>' + (cwd ? 'This folder is empty' : 'Your HABERVERSE is empty') + '</h2><p>Start a document, or drag files and folders from your computer onto this window.</p>' +
        '<div class="actions"><button class="btn primary" type="button" data-e="doc">New document</button><button class="btn" type="button" data-e="files">Upload files</button></div>';
      box.querySelector('[data-e="doc"]').addEventListener('click', (e) => newDocument(e.currentTarget));
      box.querySelector('[data-e="files"]').addEventListener('click', () => pick('files'));
    }
    content.appendChild(box);
  }

  function moreBtn(it) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'more';
    b.setAttribute('aria-label', 'More actions for ' + shown(it.name));
    b.innerHTML = DOTS;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = b.getBoundingClientRect();
      itemMenu(it, r.left, r.bottom + 4, b);
    });
    return b;
  }

  function wire(el, it) {
    el.dataset.path = it.path;
    el.dataset.kind = it.kind;
    el.tabIndex = 0;
    el.draggable = true;
    el._item = it;
    if (it.kind === 'folder') el.dataset.drop = it.path;
    el.addEventListener('click', (e) => { if (!e.target.closest('.more')) openItem(it, el); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') openItem(it, el); });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); itemMenu(it, e.clientX, e.clientY, el.querySelector('.more')); });
  }

  function folderEl(it, where) {
    const el = document.createElement('div');
    el.className = 'folder';
    el.innerHTML = FOLDER + '<span class="name"></span>';
    el.querySelector('.name').textContent = it.name;
    if (where && parentOf(it.path)) el.querySelector('.name').insertAdjacentHTML('beforeend', '<span class="where"></span>');
    if (where && parentOf(it.path)) el.querySelector('.where').textContent = parentOf(it.path);
    el.appendChild(moreBtn(it));
    wire(el, it);
    return el;
  }

  function fileEl(it, where) {
    const el = document.createElement('div');
    el.className = 'file';
    const ty = typeOf(it.name);
    el.innerHTML = '<div class="thumb"><span class="tile big" style="background:' + ty.color + '">' + ty.glyph + '</span></div><div class="meta">' + tileHTML(it.name) + '<span class="name"></span></div>';
    const nm = el.querySelector('.name');
    nm.textContent = shown(it.name);
    if (where) {
      const w = document.createElement('span');
      w.className = 'where';
      w.textContent = parentOf(it.path) || 'My HABERVERSE';
      nm.appendChild(w);
    }
    el.querySelector('.meta').appendChild(moreBtn(it));
    wire(el, it);
    thumbs.observe(el);
    return el;
  }

  function rowEl(it, where) {
    const el = document.createElement('div');
    el.className = 'row';
    el.innerHTML = (it.kind === 'folder' ? '<svg class="fold" viewBox="0 0 24 24">' + FOLDER.slice(FOLDER.indexOf('<path')) : tileHTML(it.name)) +
      '<span class="name"></span><span class="dim">' + esc(dateText(it.modified)) + '</span><span class="dim">' + (it.kind === 'folder' ? '—' : esc(sizeText(it.size))) + '</span>';
    const nm = el.querySelector('.name');
    nm.textContent = it.kind === 'folder' ? it.name : shown(it.name);
    if (where) {
      const w = document.createElement('span');
      w.className = 'where';
      w.textContent = parentOf(it.path) || 'My HABERVERSE';
      nm.appendChild(w);
    }
    el.appendChild(moreBtn(it));
    wire(el, it);
    return el;
  }

  /* ---------- Thumbnails, loaded as cards scroll into view ---------- */

  const thumbCache = new Map();
  const thumbQueue = [];
  let thumbBusy = 0;
  const thumbs = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      thumbs.unobserve(en.target);
      thumbQueue.push(en.target);
    });
    pumpThumbs();
  }, { root: content, rootMargin: '300px' });

  function pumpThumbs() {
    while (thumbBusy < 3 && thumbQueue.length) {
      const card = thumbQueue.shift();
      if (!card.isConnected) continue;
      thumbBusy++;
      loadThumb(card).catch(() => {}).finally(() => { thumbBusy--; pumpThumbs(); });
    }
  }

  // A document's own HTML, cleaned, shown as a tiny page.
  function docPreview(text) {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const root = doc.querySelector('[data-ultidash]') || doc.body;
    root.querySelectorAll('script,style,link,meta,iframe,object,embed,form,input,button,textarea,select,video,audio').forEach((n) => n.remove());
    root.querySelectorAll('*').forEach((el) => {
      Array.from(el.attributes).forEach((a) => { if (/^on/i.test(a.name)) el.removeAttribute(a.name); });
      if (el.tagName === 'A') el.removeAttribute('href');
    });
    Array.from(root.children).slice(30).forEach((n) => n.remove());
    return root.innerHTML;
  }

  async function loadThumb(card) {
    const it = card._item;
    const t = typeOf(it.name).t;
    if (!/^(doc|image|text|code)$/.test(t) || it.size > 8e6) return;
    const key = it.path + '|' + (it.sha || it.modified || it.size || '');
    let res = thumbCache.get(key);
    if (!res) {
      const blob = await fs.read(it.path);
      if (t === 'image') res = { kind: 'img', url: URL.createObjectURL(blob) };
      else if (t === 'doc') res = { kind: 'doc', html: docPreview(await blob.text()) };
      else res = { kind: 'text', text: await blob.slice(0, 1800).text() };
      thumbCache.set(key, res);
    }
    const box = card.querySelector('.thumb');
    if (!box) return;
    box.textContent = '';
    if (res.kind === 'img') {
      const img = document.createElement('img');
      img.className = 'pic';
      img.alt = '';
      img.src = res.url;
      box.appendChild(img);
    } else if (res.kind === 'doc') {
      const page = document.createElement('div');
      page.className = 'mini';
      page.innerHTML = res.html;
      if (!page.textContent.trim() && !page.querySelector('img')) page.classList.add('empty');
      box.appendChild(page);
    } else {
      const pre = document.createElement('div');
      pre.className = 'txt';
      pre.textContent = res.text;
      box.appendChild(pre);
    }
  }

  /* ================= Navigation ================= */

  function go(path) {
    query = '';
    searchEl.value = '';
    location.hash = '#/' + path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  }
  function route() {
    const h = location.hash.replace(/^#/, '');
    if (h === 'recent') { view = 'recent'; cwd = ''; }
    else { view = 'home'; cwd = h.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean).map(decodeURIComponent).join('/'); }
    if (fs) render();
  }
  window.addEventListener('hashchange', route);
  document.querySelectorAll('.nav').forEach((n) => n.addEventListener('click', () => {
    query = '';
    searchEl.value = '';
    if (n.dataset.nav === 'recent') { if (location.hash === '#recent') render(); else location.hash = '#recent'; }
    else if (location.hash === '#/' || location.hash === '') render(); else go('');
  }));
  $('#viewBtn').addEventListener('click', () => {
    layout = layout === 'grid' ? 'list' : 'grid';
    ls.set('haberverse.layout', layout);
    setLayoutIcon();
    draw({});
  });
  $('#refreshBtn').addEventListener('click', async () => {
    const b = $('#refreshBtn');
    b.classList.add('spin');
    changedStore();
    thumbCache.clear();
    await render({ quiet: true });
    b.classList.remove('spin');
  });
  let searchTimer = null;
  searchEl.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { query = searchEl.value.trim(); render(); }, 220);
  });
  searchEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') { searchEl.value = ''; query = ''; render(); } });

  /* ================= Opening things ================= */

  function openItem(it, el) {
    if (it.kind === 'folder') { go(it.path); return; }
    if (isDoc(it.name)) openDocument(it.path, { from: el });
    else preview(it);
  }

  function itemMenu(it, x, y, anchor) {
    const m = $('#ctxMenu');
    const folder = it.kind === 'folder';
    const doc = !folder && isDoc(it.name);
    const conv = !folder && !doc && CONVERTIBLE.test(extOf(it.name));
    const entries = [
      ['open', folder ? 'Open' : doc ? 'Open' : 'Preview', '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>'],
      conv && ['asdoc', 'Open as document', '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>'],
      'sep',
      ['rename', 'Rename', '<svg viewBox="0 0 24 24"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z"/></svg>'],
      !folder && ['copy', 'Make a copy', '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>'],
      !folder && ['download', 'Download', '<svg viewBox="0 0 24 24"><path d="M12 4v12m0 0l-4-4m4 4l4-4M4 18v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1"/></svg>'],
      view === 'recent' && !query && ['forget', 'Remove from Recent', '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9 12h6"/></svg>'],
      'sep',
      ['delete', 'Delete', '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>']
    ].filter(Boolean);
    m.textContent = '';
    entries.forEach((en) => {
      if (en === 'sep') { if (m.lastElementChild && !m.lastElementChild.classList.contains('sep')) m.insertAdjacentHTML('beforeend', '<div class="sep"></div>'); return; }
      const b = document.createElement('button');
      b.type = 'button';
      if (en[0] === 'delete') b.className = 'danger';
      b.innerHTML = en[2];
      b.appendChild(document.createTextNode(en[1]));
      b.addEventListener('click', () => { hideMenus(); itemAction(en[0], it); });
      m.appendChild(b);
    });
    showMenu(m, x, y, anchor);
  }

  const cardFor = (path) => Array.from(content.querySelectorAll('[data-path]')).find((el) => el.dataset.path === path);

  async function itemAction(act, it) {
    try {
      if (act === 'open') openItem(it, cardFor(it.path));
      else if (act === 'asdoc') await openAsDocument(it);
      else if (act === 'rename') await renameItem(it);
      else if (act === 'copy') await copyItem(it);
      else if (act === 'download') await downloadItem(it);
      else if (act === 'forget') { dropRecent(it.path); render({ quiet: true }); }
      else if (act === 'delete') await deleteItem(it);
    } catch (e) {
      toast(e.message || 'That didn’t work.', true);
    }
  }

  async function renameItem(it) {
    const current = it.kind === 'folder' ? it.name : shown(it.name);
    const answer = await dialog({ title: 'Rename', value: current, ok: 'Rename', select: it.kind === 'folder' || isDoc(it.name) ? 'all' : 'stem' });
    if (answer == null) return;
    let name = cleanName(answer);
    if (!name || name === current) return;
    if (it.kind === 'file' && isDoc(it.name)) name += '.' + extOf(it.name);
    const target = await uniquePath(parentOf(it.path), name, it.path);
    await ops.move(it.path, target, it.kind);
    moveRecent(it.path, target);
    toast('Renamed to “' + shown(baseOf(target)) + '”');
    render({ quiet: true });
  }

  async function copyItem(it) {
    const target = await uniquePath(parentOf(it.path), (isDoc(it.name) ? 'Copy of ' + stem(it.name) + '.html' : 'Copy of ' + it.name));
    await ops.write(target, await fs.read(it.path));
    toast('Copy made');
    render({ quiet: true });
  }

  async function downloadItem(it) {
    const blob = await fs.read(it.path);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = it.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function deleteItem(it) {
    const what = it.kind === 'folder' ? 'the folder “' + it.name + '” and everything in it' : '“' + shown(it.name) + '”';
    const ok = await dialog({
      title: 'Delete ' + (it.kind === 'folder' ? 'folder' : 'file') + '?',
      message: 'This deletes ' + what + '.' + (fs.kind === 'github' ? ' Earlier versions stay in your repository’s history.' : ' This can’t be undone.'),
      ok: 'Delete',
      danger: true
    });
    if (!ok) return;
    const card = cardFor(it.path);
    if (card) animate(card, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.85)' }], { duration: 260, easing: EASE, fill: 'forwards' });
    try {
      await ops.remove(it.path);
    } catch (e) {
      if (card) card.getAnimations().forEach((a) => a.cancel());
      throw e;
    }
    dropRecent(it.path);
    toast('Deleted “' + shown(it.name) + '”');
    render({ quiet: true });
  }

  /* ---------- New ---------- */

  function blankDoc() {
    return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>Untitled document</title></head><body>\n' +
      '<article data-ultidash data-font="sans" data-size="18" data-named="false"><p><br></p></article>\n</body></html>\n';
  }
  const workDir = () => (view === 'home' && !query ? cwd : '');

  async function newDocument(fromEl) {
    try {
      const path = await uniquePath(workDir(), 'Untitled document.html');
      await ops.write(path, new Blob([blankDoc()], { type: 'text/html' }), 'Create ' + baseOf(path));
      openDocument(path, { from: fromEl });
    } catch (e) { toast(e.message || 'Couldn’t create the document.', true); }
  }

  async function newFolder() {
    const answer = await dialog({ title: 'New folder', value: 'Untitled folder', ok: 'Create' });
    if (answer == null) return;
    const name = cleanName(answer) || 'Untitled folder';
    try {
      const path = await uniquePath(workDir(), name);
      await ops.mkdir(path);
      if (view !== 'home' || query) go(workDir());
      else await render({ quiet: true });
      const card = cardFor(path);
      if (card) animate(card, [{ opacity: 0, transform: 'scale(.7)' }, { opacity: 1, transform: 'none' }], { duration: 520, easing: SPRING });
    } catch (e) { toast(e.message || 'Couldn’t create the folder.', true); }
  }

  $('#newBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const r = $('#newBtn').getBoundingClientRect();
    showMenu($('#newMenu'), r.left, r.bottom + 6);
  });
  $('#newMenu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-new]');
    if (!b) return;
    hideMenus();
    if (b.dataset.new === 'doc') newDocument($('#newBtn'));
    else if (b.dataset.new === 'folder') newFolder();
    else pick(b.dataset.new);
  });

  function pick(which) {
    const input = which === 'dir' ? $('#pickDir') : $('#pickFiles');
    input.value = '';
    input.click();
  }
  $('#pickFiles').addEventListener('change', (e) => upload(Array.from(e.target.files).map((f) => ({ file: f, rel: f.name })), workDir()));
  $('#pickDir').addEventListener('change', (e) => upload(Array.from(e.target.files).map((f) => ({ file: f, rel: f.webkitRelativePath || f.name })), workDir()));

  /* ================= Preview for files that aren't documents ================= */

  let pvItem = null;
  let pvUrl = null;
  async function preview(it) {
    pvItem = it;
    const pv = $('#preview');
    const body = $('#pvBody');
    $('#pvName').textContent = it.name;
    $('#pvAsDoc').hidden = !CONVERTIBLE.test(extOf(it.name));
    body.innerHTML = '<div class="sheet-spin" style="position:static;margin:auto;width:28px;height:28px;border:3px solid rgba(255,255,255,.2);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite"></div>';
    pv.classList.add('open');
    try {
      const blob = await fs.read(it.path);
      if (pvItem !== it) return;
      const t = typeOf(it.name).t;
      if (pvUrl) URL.revokeObjectURL(pvUrl);
      const typed = t === 'pdf' ? new Blob([blob], { type: 'application/pdf' }) : extOf(it.name) === 'svg' ? new Blob([blob], { type: 'image/svg+xml' }) : blob;
      pvUrl = URL.createObjectURL(typed);
      body.textContent = '';
      let el;
      if (t === 'image') { el = document.createElement('img'); el.src = pvUrl; el.alt = it.name; }
      else if (t === 'pdf') { el = document.createElement('iframe'); el.src = pvUrl; el.title = it.name; }
      else if (t === 'video') { el = document.createElement('video'); el.src = pvUrl; el.controls = true; }
      else if (t === 'audio') { el = document.createElement('audio'); el.src = pvUrl; el.controls = true; }
      else if (t === 'text' || t === 'code' || /^(csv|tsv|svg)$/.test(extOf(it.name))) {
        el = document.createElement('pre');
        el.textContent = await blob.slice(0, 400000).text();
      } else {
        el = document.createElement('div');
        el.className = 'pv-none';
        el.innerHTML = tileHTML(it.name) + '<p>No preview for this kind of file.</p>';
      }
      body.appendChild(el);
    } catch (e) {
      body.innerHTML = '<div class="pv-none"><p></p></div>';
      body.querySelector('p').textContent = e.message || 'Couldn’t open the file.';
    }
  }
  function closePreview() {
    $('#preview').classList.remove('open');
    pvItem = null;
    setTimeout(() => { if (!pvItem) { $('#pvBody').textContent = ''; if (pvUrl) { URL.revokeObjectURL(pvUrl); pvUrl = null; } } }, 300);
  }
  $('#pvClose').addEventListener('click', closePreview);
  $('#pvDownload').addEventListener('click', () => { if (pvItem) downloadItem(pvItem).catch((e) => toast(e.message, true)); });
  $('#pvAsDoc').addEventListener('click', () => { const it = pvItem; closePreview(); if (it) openAsDocument(it).catch((e) => toast(e.message, true)); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#preview').classList.contains('open')) closePreview(); });

  // Makes an editable document next to the file and brings its content in.
  async function openAsDocument(it) {
    const blob = await fs.read(it.path);
    const file = new File([blob], it.name, { type: blob.type });
    const path = await uniquePath(parentOf(it.path), stem(it.name) + '.html');
    const doc = blankDoc().replace('data-named="false"', 'data-named="true"').replace('<title>Untitled document</title>', '<title>' + esc(stem(it.name)) + '</title>');
    await ops.write(path, new Blob([doc], { type: 'text/html' }), 'Create ' + baseOf(path));
    openDocument(path, { from: cardFor(it.path), importFile: file });
  }

  /* ================= The editor, opened over the drive ================= */

  const sheet = $('#docSheet');
  const frame = $('#docFrame');
  let frameReady = null;
  let docOpen = null;
  let openedResolve = null;

  function ensureFrame() {
    if (!frameReady) {
      frameReady = new Promise((resolve) => {
        const onMsg = (e) => {
          if (e.source !== frame.contentWindow || !e.data || e.data.type !== 'ready') return;
          window.removeEventListener('message', onMsg);
          resolve();
        };
        window.addEventListener('message', onMsg);
        frame.src = 'editor.html?embed=1';
      });
    }
    return frameReady;
  }
  const toFrame = (msg) => { if (frame.contentWindow) frame.contentWindow.postMessage(msg, '*'); };

  function rectFor(el) {
    const r = el && el.getBoundingClientRect && el.getBoundingClientRect();
    if (r && r.width) return r;
    return { left: window.innerWidth / 2 - 120, top: window.innerHeight / 2 - 160, width: 240, height: 320 };
  }
  const zoomFrom = (r) => 'translate(' + r.left + 'px,' + r.top + 'px) scale(' + (r.width / window.innerWidth) + ',' + (r.height / window.innerHeight) + ')';

  async function openDocument(path, opts) {
    opts = opts || {};
    if (docOpen) return;
    docOpen = { path };
    hideMenus();
    const from = rectFor(opts.from);
    sheet.classList.remove('ready');
    sheet.classList.add('on');
    animate(sheet, [
      { transform: zoomFrom(from), borderRadius: '18px', opacity: .6 },
      { transform: 'none', borderRadius: '0px', opacity: 1 }
    ], { duration: 520, easing: EASE });
    try {
      const [, blob] = await Promise.all([ensureFrame(), fs.read(path)]);
      const text = await blob.text();
      if (!docOpen || docOpen.path !== path) return;
      const opened = new Promise((resolve) => { openedResolve = resolve; setTimeout(resolve, 2000); });
      toFrame({ type: 'open', path, name: stem(baseOf(path)), text, importFile: opts.importFile || null });
      await opened;
      sheet.classList.add('ready');
      frame.focus();
      touchRecent(path);
      history.pushState({ doc: path }, '');
    } catch (e) {
      docOpen = null;
      sheet.classList.remove('on');
      toast(e.message || 'Couldn’t open the document.', true);
    }
  }

  async function closeDocument() {
    if (!docOpen) return;
    const path = docOpen.path;
    docOpen = null;
    await flushSaves();
    if (pending.size) toast('Your latest changes aren’t saved yet. Click the GitHub button at the bottom left to connect and save them.', true);
    const finalPath = renamed.get(path) || path;
    await render({ quiet: true });
    const card = cardFor(finalPath);
    const to = card ? card.getBoundingClientRect() : null;
    const a = animate(sheet, [
      { transform: 'none', borderRadius: '0px', opacity: 1 },
      to && to.width ? { transform: zoomFrom(to), borderRadius: '18px', opacity: 0 } : { transform: 'translateY(40px) scale(.96)', borderRadius: '18px', opacity: 0 }
    ], { duration: 420, easing: EASE });
    if (a) await wait(400);
    sheet.classList.remove('on', 'ready');
    if (card) animate(card, [{ transform: 'scale(.94)' }, { transform: 'none' }], { duration: 520, easing: SPRING });
    if (history.state && history.state.doc) history.back();
  }
  window.addEventListener('popstate', () => { if (docOpen && !(history.state && history.state.doc)) closeDocument(); });

  /* ---------- Saving what the editor sends ---------- */

  const pending = new Map();
  const renamed = new Map();
  let flushTimer = null;
  let flushing = null;

  function queueSave(m) {
    let path = m.path;
    while (renamed.has(path)) path = renamed.get(path);
    pending.set(path, Object.assign({}, m, { path }));
    clearTimeout(flushTimer);
    // Every save is a commit, so wait for a pause in typing.
    flushTimer = setTimeout(flushSaves, 4000);
  }

  async function flushSaves() {
    clearTimeout(flushTimer);
    while (flushing) await flushing;
    if (!pending.size) return;
    flushing = (async () => {
      // Without a token yet, ask once; if the answer is "not now", keep the changes waiting.
      try { await ensureWrite(true); } catch (e) {
        toFrame({ type: 'saved', ok: false, message: e.message });
        return;
      }
      while (pending.size) {
        const [path, m] = pending.entries().next().value;
        pending.delete(path);
        let target = path;
        try {
          const wanted = m.named ? cleanName(m.name) : '';
          if (wanted && wanted !== stem(baseOf(path))) {
            target = await uniquePath(parentOf(path), wanted + '.html', path);
            if (target !== path) {
              await ops.move(path, target, 'file');
              renamed.set(path, target);
              moveRecent(path, target);
              if (docOpen && docOpen.path === path) docOpen.path = target;
              toFrame({ type: 'renamed', path: target, name: stem(baseOf(target)) });
            }
          }
          await ops.write(target, new Blob([m.file], { type: 'text/html' }), 'Save ' + baseOf(target));
          toFrame({ type: 'saved', ok: true, path: target });
        } catch (e) {
          toFrame({ type: 'saved', ok: false, message: e.message || 'Couldn’t save' });
        }
      }
    })();
    try { await flushing; } finally { flushing = null; }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow || !e.data || typeof e.data !== 'object') return;
    const m = e.data;
    if (m.type === 'save' && typeof m.file === 'string') queueSave(m);
    else if (m.type === 'close') closeDocument();
    else if (m.type === 'opened' && openedResolve) { openedResolve(); openedResolve = null; }
  });
  window.addEventListener('beforeunload', (e) => {
    if (pending.size || flushing) { flushSaves(); e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushSaves(); });

  /* ================= Moving with drag and drop ================= */

  let dragged = null;
  content.addEventListener('dragstart', (e) => {
    const card = e.target.closest && e.target.closest('[data-path]');
    if (!card) return;
    dragged = card._item;
    e.dataTransfer.setData('application/x-haberverse', dragged.path);
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => card.classList.add('dragging'));
  });
  content.addEventListener('dragend', () => {
    dragged = null;
    document.querySelectorAll('.dragging, .drop-target').forEach((el) => el.classList.remove('dragging', 'drop-target'));
  });
  const isInternal = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('application/x-haberverse') !== -1;
  const hasFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') !== -1;
  const dropTargetAt = (el) => el && el.closest && el.closest('[data-drop]');

  function canDropInto(target) {
    if (!dragged || target == null) return false;
    const dest = target.dataset.drop;
    if (dest === dragged.path || dest.startsWith(dragged.path + '/')) return false;
    return parentOf(dragged.path) !== dest;
  }

  async function moveInto(it, dest) {
    const card = cardFor(it.path);
    const targetEl = Array.from(document.querySelectorAll('[data-drop]')).find((el) => el.dataset.drop === dest);
    if (card && targetEl) {
      const a = card.getBoundingClientRect();
      const b = targetEl.getBoundingClientRect();
      animate(card, [
        { transform: 'none', opacity: 1 },
        { transform: 'translate(' + (b.left + b.width / 2 - a.left - a.width / 2) + 'px,' + (b.top + b.height / 2 - a.top - a.height / 2) + 'px) scale(.15)', opacity: 0 }
      ], { duration: 460, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' });
      animate(targetEl, [{ transform: 'scale(1)' }, { transform: 'scale(1.08)', offset: .6 }, { transform: 'scale(1)' }], { duration: 560, delay: 300, easing: SPRING });
    }
    try {
      const target = await uniquePath(dest, it.name);
      await ops.move(it.path, target, it.kind);
      moveRecent(it.path, target);
      toast('Moved to ' + (dest ? baseOf(dest) : 'My HABERVERSE'));
    } catch (e) {
      toast(e.message || 'Couldn’t move it.', true);
    }
    render({ quiet: true });
  }

  /* ================= Uploading from the computer ================= */

  const zone = $('#dropZone');
  let zoneDepth = 0;

  function zoneText(target) {
    const dest = target ? target.dataset.drop : workDir();
    $('#dropText').textContent = 'Drop to upload to ' + (dest ? baseOf(dest) : 'My HABERVERSE');
  }

  window.addEventListener('dragenter', (e) => {
    if (isInternal(e) || !hasFiles(e) || docOpen || !fs) return;
    e.preventDefault();
    zoneDepth++;
    zone.classList.add('on');
    zoneText(null);
  });
  window.addEventListener('dragover', (e) => {
    const target = dropTargetAt(e.target);
    document.querySelectorAll('.drop-target').forEach((el) => { if (el !== target) el.classList.remove('drop-target'); });
    if (isInternal(e)) {
      if (target && canDropInto(target)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        target.classList.add('drop-target');
      }
      return;
    }
    if (!hasFiles(e) || docOpen || !fs) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (target && target.dataset.drop != null && view === 'home') target.classList.add('drop-target');
    zoneText(target && view === 'home' ? target : null);
  });
  window.addEventListener('dragleave', (e) => {
    if (isInternal(e)) return;
    zoneDepth = Math.max(0, zoneDepth - 1);
    if (!zoneDepth || (!e.relatedTarget && (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight))) {
      zoneDepth = 0;
      zone.classList.remove('on');
    }
  });
  window.addEventListener('drop', (e) => {
    const target = dropTargetAt(e.target);
    document.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
    if (isInternal(e)) {
      e.preventDefault();
      if (dragged && target && canDropInto(target)) moveInto(dragged, target.dataset.drop);
      return;
    }
    if (!hasFiles(e)) return;
    e.preventDefault();
    zoneDepth = 0;
    zone.classList.remove('on');
    if (docOpen || !fs) return;
    // Folders arrive as entries that have to be read before the event ends.
    const entries = Array.from(e.dataTransfer.items || []).filter((i) => i.kind === 'file').map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null));
    const files = Array.from(e.dataTransfer.files || []);
    const dest = target && view === 'home' ? target.dataset.drop : workDir();
    collect(entries, files).then((list) => upload(list, dest));
  });

  async function collect(entries, files) {
    if (!entries.length || entries.some((x) => !x)) return files.map((f) => ({ file: f, rel: f.name }));
    const out = [];
    const readAll = (reader) => new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    async function visit(entry, prefix) {
      if (entry.isFile) {
        const f = await new Promise((resolve, reject) => entry.file(resolve, reject));
        out.push({ file: f, rel: join(prefix, f.name) });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const here = join(prefix, entry.name);
        let batch;
        let any = false;
        do {
          batch = await readAll(reader);
          for (const child of batch) { any = true; await visit(child, here); }
        } while (batch.length);
        if (!any) out.push({ folder: true, rel: here });
      }
    }
    for (const entry of entries) await visit(entry, '');
    return out;
  }

  const CHECK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#34c759"/><path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const CROSS = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#ff3b30"/><path d="M9 9l6 6M15 9l-6 6" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>';

  async function upload(list, dir) {
    if (!list.length || !fs) return;
    const taken = new Set((await fs.list(dir)).map((i) => i.name.toLowerCase()));
    const tops = new Map();
    const jobs = list.map((j) => {
      const parts = j.rel.split('/').filter(Boolean).map(cleanName);
      if (!tops.has(parts[0])) {
        const n = uniqueName(parts[0] || 'Untitled', taken);
        taken.add(n.toLowerCase());
        tops.set(parts[0], n);
      }
      parts[0] = tops.get(parts[0]);
      return Object.assign({}, j, { path: join(dir, ...parts) });
    });
    const panel = $('#uploads');
    const listEl = $('#upList');
    listEl.textContent = '';
    const fileJobs = jobs.filter((j) => !j.folder);
    $('#upTitle').textContent = 'Uploading ' + fileJobs.length + (fileJobs.length === 1 ? ' item' : ' items');
    panel.classList.add('open');
    fileJobs.slice(0, 200).forEach((j, i) => {
      const row = document.createElement('div');
      row.className = 'up-row';
      row.style.animationDelay = Math.min(i, 10) * 30 + 'ms';
      row.innerHTML = tileHTML(j.path) + '<span class="name"></span><span class="up-state"><span class="spin"></span></span>';
      row.querySelector('.name').textContent = j.rel;
      listEl.appendChild(row);
      j.row = row;
    });
    let ok = 0;
    for (const j of jobs) {
      try {
        if (j.folder) await ops.mkdir(j.path);
        else await ops.write(j.path, j.file, 'Upload ' + baseOf(j.path));
        ok += j.folder ? 0 : 1;
        if (j.row) j.row.querySelector('.up-state').innerHTML = CHECK;
      } catch (e) {
        if (j.row) {
          j.row.querySelector('.up-state').innerHTML = CROSS;
          const err = document.createElement('span');
          err.className = 'up-err';
          err.textContent = e.message || 'Failed';
          j.row.querySelector('.name').appendChild(document.createElement('br'));
          j.row.querySelector('.name').appendChild(err);
        }
      }
    }
    $('#upTitle').textContent = ok + (ok === 1 ? ' upload' : ' uploads') + ' complete';
    if (view === 'home' && !query) await render({ quiet: true });
    (Array.from(tops.values())).forEach((name) => {
      const card = cardFor(join(dir, name));
      if (card) animate(card, [{ opacity: 0, transform: 'translateY(-24px) scale(.85)' }, { opacity: 1, transform: 'none' }], { duration: 620, easing: SPRING });
    });
    clearTimeout(upload.timer);
    upload.timer = setTimeout(() => panel.classList.remove('open'), 6000);
  }
  $('#upClose').addEventListener('click', () => $('#uploads').classList.remove('open'));

  /* ================= Connecting to GitHub ================= */

  const ICON_GH = '<svg viewBox="0 0 24 24"><path d="M7 18a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18 8.5a4 4 0 0 1-1 9.5z"/></svg>';
  const box = $('#unlock');
  const BOX_TEXT = {
    save: ['Connect to save', 'HABERVERSE saves straight into your GitHub repository. Paste an access token once on this device, and from then on every change saves by itself.'],
    private: ['Open your HABERVERSE', 'Your repository is private, so GitHub needs your access token before it shows your files. You only do this once on this device.'],
    expired: ['Connect again', 'GitHub didn’t accept the token saved on this device. It may have expired. Paste a new one.'],
    repo: ['Where is your HABERVERSE?', 'This copy isn’t running on GitHub Pages, so write the repository that holds your HABERVERSE folder.'],
    busy: ['Connect to keep going', 'GitHub limits how often your files can be looked at without a token. Paste your access token to continue.']
  };
  let boxWaiting = [];
  let boxReason = '';
  let saveDeclined = false;

  // The one-time box for the access token (and the repository, when it can't be worked out).
  function connectBox(reason) {
    return new Promise((resolve) => {
      boxWaiting.push(resolve);
      if (box.classList.contains('open')) return;
      boxReason = reason;
      const needRepo = !fs.cfg.owner;
      $('#ukTitle').textContent = BOX_TEXT[reason][0];
      $('#ukText').textContent = BOX_TEXT[reason][1];
      $('#ukRepoRow').hidden = !needRepo;
      $('#ukRepo').value = needRepo ? '' : fs.detail();
      $('#ukToken').value = '';
      $('#ukToken').placeholder = needRepo ? 'Optional for a public repository' : 'github_pat_…';
      $('#ukCancel').hidden = reason === 'private' || reason === 'repo';
      $('#ukGo').textContent = reason === 'save' ? 'Connect' : 'Open HABERVERSE';
      $('#ukMsg').textContent = '';
      box.classList.add('open');
      setTimeout(() => (needRepo ? $('#ukRepo') : $('#ukToken')).focus(), 80);
    });
  }
  function closeBox(ok) {
    box.classList.remove('open');
    const waiting = boxWaiting;
    boxWaiting = [];
    waiting.forEach((r) => r(ok));
  }
  $('#ukCancel').addEventListener('click', () => closeBox(false));
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#ukCancel').hidden) { e.preventDefault(); closeBox(false); } });
  $('#ukForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#ukMsg');
    const go = $('#ukGo');
    msg.textContent = '';
    const before = Object.assign({}, fs.cfg);
    if (!$('#ukRepoRow').hidden) {
      const m = /(?:github\.com[/:])?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec($('#ukRepo').value.trim());
      if (!m) { msg.textContent = 'Write the repository as your-name/your-repo.'; return; }
      fs.cfg.owner = m[1];
      fs.cfg.repo = m[2];
      fs.cfg.branch = CONFIG.branch || '';
    }
    const token = $('#ukToken').value.trim();
    if (!token && boxReason !== 'repo') { msg.textContent = 'Paste your access token.'; return; }
    go.disabled = true;
    const label = go.textContent;
    go.textContent = 'Checking…';
    try {
      fs.cfg.token = token;
      const info = await fs.api(fs.repo(''));
      if (!fs.cfg.branch) fs.cfg.branch = info.default_branch || 'main';
      if (token && info.permissions && info.permissions.push === false) throw new Error('This token can see the repository but can’t save to it. Give it Contents: Read and write.');
      if (token) ls.set(tokenKey(fs.cfg), token);
      if (!$('#ukRepoRow').hidden) ls.set(REPO_KEY, { owner: fs.cfg.owner, repo: fs.cfg.repo });
      fs.shas.clear();
      changedStore();
      thumbCache.clear();
      saveDeclined = false;
      updateStorage();
      closeBox(true);
    } catch (err) {
      Object.assign(fs.cfg, before);
      msg.textContent = err.status === 404
        ? (token ? 'This token can’t see that repository. Under Repository access, pick it.' : 'That repository wasn’t found. If it’s private, paste your access token too.')
        : err.message || 'GitHub didn’t accept that.';
    } finally {
      go.disabled = false;
      go.textContent = label;
    }
  });

  const notSaved = () => Object.assign(new Error('Not saved yet. Connect to GitHub to save.'), { notSaved: true });

  // Changing anything needs the token. Autosaves only ask once; after "Not now" they wait
  // until you connect from the button at the bottom left.
  async function ensureWrite(auto) {
    if (fs.canWrite) return;
    if (auto && saveDeclined) throw notSaved();
    const ok = await connectBox('save');
    if (!ok) { saveDeclined = true; throw notSaved(); }
    if (view === 'home' && !query && !docOpen) render({ quiet: true });
  }

  function updateStorage() {
    $('#storageIco').innerHTML = ICON_GH;
    $('#storageName').textContent = fs.cfg.owner ? fs.detail() : 'GitHub';
    $('#storageDetail').textContent = fs.canWrite ? 'Connected · saves automatically' : 'Read only · click to connect';
    $('#storageBtn').classList.toggle('readonly', !fs.canWrite);
  }

  $('#storageBtn').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!fs.canWrite) {
      if (await connectBox('save')) { flushSaves(); render({ quiet: true }); }
      return;
    }
    const r = $('#storageBtn').getBoundingClientRect();
    const m = $('#storageMenu');
    showMenu(m, r.left, r.top - 8);
    m.style.top = Math.max(8, r.top - m.offsetHeight - 8) + 'px';
    m.style.transformOrigin = 'bottom left';
  });
  $('#storageMenu').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-st]');
    if (!b) return;
    hideMenus();
    if (b.dataset.st === 'github') {
      const a = document.createElement('a');
      a.href = 'https://github.com/' + fs.cfg.owner + '/' + fs.cfg.repo + '/tree/' + encodeURIComponent(fs.cfg.branch) + '/' + fs.enc(fs.cfg.root);
      a.target = '_blank';
      a.rel = 'noopener';
      a.click();
      return;
    }
    const ok = await dialog({ title: 'Disconnect this device?', message: 'Your files stay on GitHub. To save again on this device you’ll paste the token once more.', ok: 'Disconnect', danger: true });
    if (!ok) return;
    await flushSaves();
    ls.del(tokenKey(fs.cfg));
    fs.cfg.token = '';
    fs.shas.clear();
    changedStore();
    updateStorage();
    render({ quiet: true });
  });

  async function boot() {
    $('#app').hidden = false;
    const found = findRepo();
    if (found) {
      fs.cfg.owner = found.owner;
      fs.cfg.repo = found.repo;
      fs.cfg.branch = CONFIG.branch || '';
      fs.cfg.token = ls.get(tokenKey(found)) || '';
    }
    updateStorage();
    if (!fs.cfg.owner) await connectBox('repo');
    // Make sure GitHub shows the repository; ask for the token only when it has to.
    for (;;) {
      try { await fs.branchName(); break; }
      catch (e) {
        const reason = e.status === 401 ? 'expired' : e.status === 404 ? 'private' : e.limited && !fs.canWrite ? 'busy' : '';
        if (!reason) break; // offline or another problem: the file list explains it
        if (reason === 'expired') { ls.del(tokenKey(fs.cfg)); fs.cfg.token = ''; updateStorage(); }
        if (!(await connectBox(reason)) && reason === 'busy') break;
      }
    }
    route();
  }

  /* ================= Start ================= */

  setLayoutIcon();
  boot();
})();
