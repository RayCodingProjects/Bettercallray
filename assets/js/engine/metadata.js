/*
 * TrueFrame — container & metadata forensics.
 *
 * Parses the file's own bytes (no libraries):
 *   images: JPEG (EXIF, XMP, IPTC, ICC, quantisation tables, APP11/JUMBF),
 *           PNG (tEXt/zTXt/iTXt, eXIf, caBX), WebP (RIFF chunks), HEIC/AVIF, TIFF, GIF
 *   video:  MP4/MOV (ISO-BMFF boxes, QuickTime/Apple/Android keys, C2PA uuid), WebM/MKV (EBML)
 *   provenance: C2PA Content Credentials (JUMBF boxes + CBOR claims + signer certificate names)
 *
 * Output is a plain object consumed by evidence.js.
 */
(function (root) {
  'use strict';
  const TF = (root.TrueFrame = root.TrueFrame || {});
  const U = TF.util;

  // ------------------------------------------------------------------ dictionaries

  // kind: gen = generator, enhance = AI retouch/upscale, label = explicit "AI" label.
  // short: ambiguous short words, only trusted in structured text, never in binary runs.
  const AI_TOOLS = [
    { name: 'Midjourney', re: /midjourney/i, kind: 'gen' },
    { name: 'DALL·E (OpenAI)', re: /dall[\s\-·.]?e(?![a-z])/i, kind: 'gen' },
    { name: 'ChatGPT / OpenAI', re: /chatgpt|gpt[\s_-]?image|gpt[\s_-]?4o|openai/i, kind: 'gen' },
    { name: 'Sora (OpenAI)', re: /\bsora\b/i, kind: 'gen', short: true },
    { name: 'Stable Diffusion', re: /stable[\s_-]?diffusion|\bsdxl\b|stability[\s_-]?ai|\bsd[\s_-]?3(\.5)?\b/i, kind: 'gen' },
    { name: 'ComfyUI', re: /comfy[\s_-]?ui/i, kind: 'gen' },
    { name: 'AUTOMATIC1111 / Forge', re: /automatic1111|stable-diffusion-webui|sd[\s_-]?forge/i, kind: 'gen' },
    { name: 'NovelAI', re: /novel[\s_-]?ai/i, kind: 'gen' },
    { name: 'InvokeAI', re: /invoke[\s_-]?ai/i, kind: 'gen' },
    { name: 'Fooocus', re: /fooocus/i, kind: 'gen' },
    { name: 'Adobe Firefly', re: /firefly/i, kind: 'gen' },
    { name: 'Google Imagen / Gemini', re: /made with google ai|edited with google ai|nano[\s_-]?banana|synthid/i, kind: 'gen' },
    { name: 'Google Imagen / Gemini', re: /\bimagen\s?\d?\b|\bgemini\b/i, kind: 'gen', short: true },
    { name: 'Google Veo', re: /\bveo[\s_-]?\d?\b/i, kind: 'gen', short: true },
    { name: 'Microsoft Designer / Bing', re: /bing image creator|microsoft designer|image creator from microsoft|\bcopilot\b/i, kind: 'gen' },
    { name: 'Meta AI', re: /\bmeta ai\b|imagine with meta|imagined with ai/i, kind: 'gen' },
    { name: 'FLUX (Black Forest Labs)', re: /\bflux(\.\d)?[\s_-]?(dev|pro|schnell|kontext|krea|1\.1)\b|black[\s_-]?forest[\s_-]?labs/i, kind: 'gen' },
    { name: 'Leonardo.Ai', re: /leonardo\.?ai/i, kind: 'gen' },
    { name: 'Ideogram', re: /ideogram/i, kind: 'gen' },
    { name: 'Runway', re: /\brunway(ml)?\b/i, kind: 'gen', short: true },
    { name: 'Kling', re: /\bkling\b|kuaishou/i, kind: 'gen', short: true },
    { name: 'Pika', re: /\bpika(\s?labs|\.art)?\b/i, kind: 'gen', short: true },
    { name: 'Luma Dream Machine', re: /luma[\s_-]?(ai|labs|dream)|dream machine/i, kind: 'gen' },
    { name: 'Hailuo / MiniMax', re: /hailuo|minimax/i, kind: 'gen' },
    { name: 'Grok / xAI', re: /\bgrok\b|\bx\.ai\b|\bxai\b/i, kind: 'gen', short: true },
    { name: 'Recraft', re: /recraft/i, kind: 'gen' },
    { name: 'Krea', re: /\bkrea(\.ai)?\b/i, kind: 'gen', short: true },
    { name: 'Playground AI', re: /playground[\s_-]?(ai|v\d)/i, kind: 'gen' },
    { name: 'DreamStudio', re: /dreamstudio/i, kind: 'gen' },
    { name: 'NightCafe', re: /nightcafe/i, kind: 'gen' },
    { name: 'Craiyon', re: /craiyon/i, kind: 'gen' },
    { name: 'Civitai', re: /civitai/i, kind: 'gen' },
    { name: 'Tensor.Art', re: /tensor\.art/i, kind: 'gen' },
    { name: 'SeaArt', re: /seaart/i, kind: 'gen' },
    { name: 'ByteDance Seedream / Dreamina', re: /seedream|seedance|jimeng|dreamina|doubao/i, kind: 'gen' },
    { name: 'Qwen-Image', re: /qwen[\s_-]?image/i, kind: 'gen' },
    { name: 'Hunyuan', re: /hunyuan/i, kind: 'gen' },
    { name: 'Wan (Alibaba)', re: /\bwan[\s_-]?2\.\d|\bwanx\b|tongyi wanxiang/i, kind: 'gen', short: true },
    { name: 'Kolors', re: /\bkolors\b/i, kind: 'gen', short: true },
    { name: 'Stable Video Diffusion', re: /stable[\s_-]?video/i, kind: 'gen' },
    { name: 'AnimateDiff / Deforum', re: /animatediff|deforum/i, kind: 'gen' },
    { name: 'Canva Magic Media', re: /magic media|dream lab/i, kind: 'gen' },
    { name: 'Remini', re: /\bremini\b/i, kind: 'enhance', short: true },
    { name: 'Lensa', re: /\blensa\b/i, kind: 'enhance', short: true },
    { name: 'Topaz AI', re: /topaz (photo ai|gigapixel|video ai)/i, kind: 'enhance' },
    {
      name: 'Explicit AI label',
      re: /\bai[\s_-]?generated\b|generated (by|with|using) (an )?ai\b|created (by|with|using) ai\b|made with ai\b|contains ai[\s-]generated|\bgenerative ai\b|\bgen[\s_-]?ai\b|\baigc\b|tc260/i,
      kind: 'label',
    },
  ];

  const CAMERA_MAKES =
    /canon|nikon|sony|fujifilm|\bfuji\b|olympus|om digital|panasonic|lumix|leica|pentax|ricoh|hasselblad|phase one|sigma|kodak|casio|minolta|konica|samsung|apple|google|huawei|honor|xiaomi|redmi|\bpoco\b|oneplus|oppo|vivo|realme|motorola|lenovo|\blg\b|lge|htc|nokia|\bhmd\b|asus|\bzte\b|nubia|meizu|tecno|infinix|sharp|nothing|fairphone|\bdji\b|gopro|insta360|blackmagic|red digital|arri|zeiss|parrot|skydio|blackberry|ericsson|microsoft|sony ericsson|yi technology|leaf|mamiya|epson|vivitar|polaroid/i;

  const EDITORS = [
    [/photoshop/i, 'Adobe Photoshop'],
    [/lightroom/i, 'Adobe Lightroom'],
    [/camera raw/i, 'Adobe Camera Raw'],
    [/\bgimp\b/i, 'GIMP'],
    [/affinity/i, 'Affinity Photo'],
    [/capture one/i, 'Capture One'],
    [/snapseed/i, 'Snapseed'],
    [/picsart/i, 'Picsart'],
    [/\bcanva\b/i, 'Canva'],
    [/pixelmator/i, 'Pixelmator'],
    [/luminar/i, 'Luminar'],
    [/darktable/i, 'darktable'],
    [/rawtherapee/i, 'RawTherapee'],
    [/\bdxo\b/i, 'DxO'],
    [/facetune/i, 'Facetune'],
    [/paint\.net/i, 'Paint.NET'],
    [/\bpicasa\b/i, 'Picasa'],
    [/photopea/i, 'Photopea'],
  ];

  const SCREENSHOT_RE = /screenshot|screen shot|snipping tool|sharex|greenshot|lightshot|capture d.écran|bildschirmfoto|captura de pantalla|スクリーンショット|屏幕截图|截屏/i;

  const IPTC_SOURCE_TYPES = {
    trainedalgorithmicmedia: { label: 'AI-generated (trained algorithmic media)', ai: 'full' },
    compositewithtrainedalgorithmicmedia: { label: 'Composite including AI-generated elements', ai: 'partial' },
    algorithmicmedia: { label: 'Algorithmically generated (synthetic)', ai: 'full' },
    compositesynthetic: { label: 'Composite of synthetic elements', ai: 'full' },
    algorithmicallyenhanced: { label: 'Algorithmically enhanced', ai: 'enhanced' },
    datadrivenmedia: { label: 'Data-driven media', ai: 'partial' },
    digitalcapture: { label: 'Original digital capture (camera)', ai: 'none', capture: true },
    computationalcapture: { label: 'Computational capture (phone camera)', ai: 'none', capture: true },
    negativefilm: { label: 'Scanned negative film', ai: 'none', capture: true },
    positivefilm: { label: 'Scanned slide film', ai: 'none', capture: true },
    print: { label: 'Scanned print', ai: 'none', capture: true },
    compositecapture: { label: 'Composite of camera captures', ai: 'none', capture: true },
    humanedits: { label: 'Human edits', ai: 'none' },
    minorhumanedits: { label: 'Minor human edits', ai: 'none' },
    digitalcreation: { label: 'Digital creation (made by a person)', ai: 'none' },
    digitalart: { label: 'Digital art (made by a person)', ai: 'none' },
    screencapture: { label: 'Screen capture', ai: 'none' },
    virtualrecording: { label: 'Virtual recording', ai: 'none' },
    composite: { label: 'Composite', ai: 'none' },
  };

  const C2PA_UUID = 'd8fec3d61b0e483c92975828877ec481';
  const XMP_UUID = 'be7acfcb97a942e89c71999491e3afac';

  // ------------------------------------------------------------------ sniffing

  function sniff(b, file) {
    const s = U.latin1(b, 0, Math.min(32, b.length));
    const name = (file && file.name) || '';
    const type = (file && file.type) || '';
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { format: 'jpeg', kind: 'image' };
    if (b[0] === 0x89 && s.slice(1, 4) === 'PNG') return { format: 'png', kind: 'image' };
    if (s.slice(0, 4) === 'RIFF' && s.slice(8, 12) === 'WEBP') return { format: 'webp', kind: 'image' };
    if (s.slice(0, 4) === 'RIFF' && s.slice(8, 12) === 'AVI ') return { format: 'avi', kind: 'video' };
    if (s.slice(0, 3) === 'GIF') return { format: 'gif', kind: 'image' };
    if (s.slice(0, 2) === 'BM') return { format: 'bmp', kind: 'image' };
    if (s.slice(0, 4) === 'II*\0' || s.slice(0, 4) === 'MM\0*') return { format: 'tiff', kind: 'image' };
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { format: 'webm', kind: 'video' };
    if (s.slice(4, 8) === 'ftyp') {
      const brands = [];
      const size = U.view(b).getUint32(0);
      for (let o = 8; o + 4 <= Math.min(size, b.length); o += 4) if (o !== 12) brands.push(U.latin1(b, o, o + 4));
      const all = brands.join(',');
      if (/avif|avis/.test(all)) return { format: 'avif', kind: 'image', brands };
      if (/heic|heix|heim|heis|hevc|hevx|mif1|msf1/.test(brands[0] || '')) return { format: 'heic', kind: 'image', brands };
      if (brands[0] === 'qt  ') return { format: 'mov', kind: 'video', brands };
      if (/^(3gp|3g2)/.test(brands[0] || '')) return { format: '3gp', kind: 'video', brands };
      return { format: 'mp4', kind: 'video', brands };
    }
    if (/^video\//.test(type) || /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i.test(name)) return { format: 'video', kind: 'video' };
    if (/^image\//.test(type) || /\.(jpe?g|png|webp|gif|avif|heic|heif|bmp|tiff?)$/i.test(name)) return { format: 'image', kind: 'image' };
    return { format: 'unknown', kind: null };
  }

  function newMeta(file, sn) {
    return {
      name: file.name || 'pasted file',
      size: file.size,
      mime: file.type || '',
      format: sn.format,
      kind: sn.kind,
      brands: sn.brands || [],
      width: null,
      height: null,
      exif: null,
      xmp: [],
      xmpFields: {},
      iptc: null,
      text: [], // {source, key, value}
      icc: null,
      jpeg: null,
      png: null,
      webp: null,
      video: null,
      c2paRaw: [],
      c2pa: null,
      metaRegions: [], // binary metadata payloads scanned for readable strings
      textSources: [], // {where, text, tool}
      aiHits: [],
      sourceTypes: [],
      generator: null,
      cameraHints: [],
      notes: [],
    };
  }

  // ------------------------------------------------------------------ EXIF / TIFF

  const TIFF_TAGS = {
    0x010e: 'ImageDescription', 0x010f: 'Make', 0x0110: 'Model', 0x0112: 'Orientation', 0x0131: 'Software',
    0x0132: 'DateTime', 0x013b: 'Artist', 0x8298: 'Copyright', 0x829a: 'ExposureTime', 0x829d: 'FNumber',
    0x8822: 'ExposureProgram', 0x8827: 'ISO', 0x9000: 'ExifVersion', 0x9003: 'DateTimeOriginal',
    0x9004: 'DateTimeDigitized', 0x9010: 'OffsetTime', 0x9011: 'OffsetTimeOriginal', 0x9201: 'ShutterSpeedValue',
    0x9202: 'ApertureValue', 0x9204: 'ExposureBias', 0x9207: 'MeteringMode', 0x9209: 'Flash', 0x920a: 'FocalLength',
    0x9286: 'UserComment', 0xa001: 'ColorSpace', 0xa002: 'PixelXDimension', 0xa003: 'PixelYDimension',
    0xa402: 'ExposureMode', 0xa403: 'WhiteBalance', 0xa405: 'FocalLength35mm', 0xa406: 'SceneCaptureType',
    0xa420: 'ImageUniqueID', 0xa430: 'CameraOwnerName', 0xa431: 'BodySerialNumber', 0xa433: 'LensMake',
    0xa434: 'LensModel', 0xa435: 'LensSerialNumber', 0x9c9b: 'XPTitle', 0x9c9c: 'XPComment', 0x9c9d: 'XPAuthor',
    0x9c9e: 'XPKeywords', 0x9c9f: 'XPSubject',
  };
  const TIFF_SIZES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];

  function parseTIFF(b) {
    if (!b || b.length < 8) return null;
    const le = b[0] === 0x49;
    if (!(le || b[0] === 0x4d)) return null;
    const dv = U.view(b);
    const u16 = (o) => dv.getUint16(o, le);
    const u32 = (o) => dv.getUint32(o, le);
    if (u16(2) !== 42) return null;
    const out = {};
    const seen = new Set();

    function readVal(type, count, o, tag) {
      switch (type) {
        case 2: {
          let s = U.smartText(b.subarray(o, o + count));
          const z = s.indexOf('\0');
          if (z >= 0) s = s.slice(0, z);
          return s.trim();
        }
        case 3:
          return count === 1 ? u16(o) : Array.from({ length: Math.min(count, 16) }, (_, i) => u16(o + 2 * i));
        case 4:
        case 9:
          return count === 1 ? u32(o) : Array.from({ length: Math.min(count, 16) }, (_, i) => u32(o + 4 * i));
        case 5:
        case 10: {
          const vals = [];
          for (let i = 0; i < Math.min(count, 8); i++) {
            const nu = type === 5 ? u32(o + 8 * i) : dv.getInt32(o + 8 * i, le);
            const de = type === 5 ? u32(o + 8 * i + 4) : dv.getInt32(o + 8 * i + 4, le);
            vals.push(de ? nu / de : 0);
          }
          return count === 1 ? vals[0] : vals;
        }
        case 1:
        case 7: {
          const raw = b.subarray(o, o + count);
          if (tag === 0x9286) return decodeUserComment(raw);
          if (tag >= 0x9c9b && tag <= 0x9c9f) return U.utf16(raw, true).replace(/\0+$/, '');
          if (tag === 0x9000) return U.latin1(raw);
          return count <= 4 ? Array.from(raw) : '[' + count + ' bytes]';
        }
        default:
          return null;
      }
    }

    function readIFD(off, kind) {
      if (off < 8 || off + 2 > b.length || seen.has(off) || seen.size > 8) return;
      seen.add(off);
      const n = u16(off);
      if (n > 500) return;
      for (let i = 0; i < n; i++) {
        const e = off + 2 + i * 12;
        if (e + 12 > b.length) break;
        const tag = u16(e);
        const type = u16(e + 2);
        const count = u32(e + 4);
        const sz = (TIFF_SIZES[type] || 1) * count;
        const vo = sz <= 4 ? e + 8 : u32(e + 8);
        if (tag === 0x8769 && kind === 'ifd0') {
          readIFD(u32(e + 8), 'exif');
          continue;
        }
        if (tag === 0x8825 && kind === 'ifd0') {
          readIFD(u32(e + 8), 'gps');
          continue;
        }
        if (sz > 4e6 || vo + sz > b.length) continue;
        if (kind === 'gps') {
          out.GPS = out.GPS || {};
          out.GPS[tag] = readVal(type, count, vo, tag);
          continue;
        }
        if (tag === 0x927c) {
          out.MakerNote = { length: count, signature: U.latin1(b, vo, Math.min(vo + 12, b.length)).replace(/[^\x20-\x7e]/g, '').trim() };
          continue;
        }
        const name = TIFF_TAGS[tag];
        if (!name) continue;
        const v = readVal(type, count, vo, tag);
        if (v !== null && v !== '' && out[name] === undefined) out[name] = v;
      }
    }
    readIFD(u32(4), 'ifd0');
    if (out.GPS) {
      const g = out.GPS;
      out.hasGPS = Array.isArray(g[2]) && g[2].some((x) => x !== 0);
    }
    return out;
  }

  function decodeUserComment(raw) {
    if (raw.length < 8) return U.smartText(raw).replace(/\0+/g, '').trim();
    const head = U.latin1(raw, 0, 8);
    const body = raw.subarray(8);
    let s;
    if (head.startsWith('UNICODE')) {
      const be = body.length > 1 && body[0] === 0 && body[1] !== 0;
      s = U.utf16(body, !be);
    } else if (head.startsWith('ASCII')) s = U.latin1(body);
    else if (head === '\0\0\0\0\0\0\0\0') s = U.smartText(body);
    else s = U.smartText(raw);
    return s.replace(/\0+/g, '').trim();
  }

  // ------------------------------------------------------------------ XMP / IPTC / ICC

  function decodeEntities(s) {
    return s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&amp;/g, '&');
  }

  function xmpGet(x, name) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const vals = [];
    let mm;
    const reAttr = new RegExp('(?:^|[\\s<])' + esc + '\\s*=\\s*"([^"]*)"', 'g');
    while ((mm = reAttr.exec(x))) vals.push(mm[1]);
    const reEl = new RegExp('<' + esc + '(\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</' + esc + '>)', 'g');
    while ((mm = reEl.exec(x))) {
      if (mm[2] != null) {
        const lis = Array.from(mm[2].matchAll(/<rdf:li\b[^>]*>([\s\S]*?)<\/rdf:li>/g), (a) => a[1]);
        if (lis.length) vals.push(...lis);
        else vals.push(mm[2]);
      } else if (mm[1]) {
        const r = /rdf:resource="([^"]*)"/.exec(mm[1]);
        if (r) vals.push(r[1]);
      }
    }
    return U.uniq(vals.map((v) => decodeEntities(v.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())));
  }

  const XMP_FIELDS = [
    'xmp:CreatorTool', 'tiff:Make', 'tiff:Model', 'tiff:Software', 'exif:DateTimeOriginal', 'exif:ExposureTime',
    'exif:FNumber', 'exifEX:LensModel', 'aux:Lens', 'photoshop:Credit', 'photoshop:Source', 'dc:description',
    'dc:creator', 'dc:title', 'dc:subject', 'stEvt:softwareAgent', 'Iptc4xmpExt:DigitalSourceType',
    'Iptc4xmpCore:DigitalSourceType', 'plus:DigitalSourceType', 'exif:UserComment', 'xmp:CreateDate',
  ];

  function parseXMPFields(m) {
    const x = m.xmp.join('\n');
    if (!x) return;
    for (const f of XMP_FIELDS) {
      const v = xmpGet(x, f);
      if (v.length) m.xmpFields[f] = v;
    }
    if (/GCamera:|xmlns:GCamera/.test(x)) m.cameraHints.push('Google Camera XMP');
    if (/apple-fi:|HDRGainMap|xmlns:HDRGainMap/.test(x)) m.cameraHints.push('Apple camera XMP');
    if (/MicroVideo|MotionPhoto/.test(x)) m.cameraHints.push('Motion Photo');
  }

  function parseAPP13(seg, m) {
    if (!U.startsWith(seg, 'Photoshop 3.0\0')) return;
    let p = 14;
    const dv = U.view(seg);
    while (p + 12 <= seg.length && U.startsWith(seg, '8BIM', p)) {
      const id = dv.getUint16(p + 4);
      p += 6;
      let plen = 1 + seg[p];
      if (plen % 2) plen++;
      p += plen;
      if (p + 4 > seg.length) break;
      const size = dv.getUint32(p);
      p += 4;
      if (id === 0x0404) parseIIM(seg.subarray(p, p + size), m);
      p += size + (size % 2);
    }
  }

  const IIM = {
    5: 'ObjectName', 25: 'Keywords', 55: 'DateCreated', 65: 'OriginatingProgram', 80: 'Byline', 105: 'Headline',
    110: 'Credit', 115: 'Source', 116: 'Copyright', 120: 'Caption', 103: 'TransmissionReference',
  };
  function parseIIM(d, m) {
    const iptc = (m.iptc = m.iptc || {});
    let p = 0;
    while (p + 5 <= d.length) {
      if (d[p] !== 0x1c) {
        p++;
        continue;
      }
      const rec = d[p + 1];
      const ds = d[p + 2];
      const len = (d[p + 3] << 8) | d[p + 4];
      p += 5;
      if (len & 0x8000) break;
      if (rec === 2 && IIM[ds]) {
        const v = U.smartText(d.subarray(p, p + len)).trim();
        const k = IIM[ds];
        iptc[k] = iptc[k] ? iptc[k] + '; ' + v : v;
      }
      p += len;
    }
  }

  function parseICC(b) {
    if (!b || b.length < 132) return null;
    const dv = U.view(b);
    const out = {
      cmm: U.latin1(b, 4, 8).trim(),
      deviceClass: U.latin1(b, 12, 16).trim(),
      colorSpace: U.latin1(b, 16, 20).trim(),
      manufacturer: U.latin1(b, 48, 52).replace(/\0/g, '').trim(),
      creator: U.latin1(b, 80, 84).replace(/\0/g, '').trim(),
      description: null,
    };
    const n = Math.min(dv.getUint32(128), 100);
    for (let i = 0; i < n; i++) {
      const o = 132 + i * 12;
      if (o + 12 > b.length) break;
      const sig = U.latin1(b, o, o + 4);
      const off = dv.getUint32(o + 4);
      const size = dv.getUint32(o + 8);
      if (sig !== 'desc' || off + size > b.length || size < 12) continue;
      const t = U.latin1(b, off, off + 4);
      try {
        if (t === 'desc') {
          const len = dv.getUint32(off + 8);
          out.description = U.latin1(b, off + 12, off + 12 + len).replace(/\0/g, '').trim();
        } else if (t === 'mluc' && dv.getUint32(off + 8) > 0) {
          const l = dv.getUint32(off + 20);
          const so = dv.getUint32(off + 24);
          out.description = U.utf16(b.subarray(off + so, off + so + l), false).replace(/\0/g, '').trim();
        }
      } catch (e) {
        /* malformed profile */
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ JPEG

  const ZIGZAG = [
    0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21,
    28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54,
    47, 55, 62, 63,
  ];
  const STD_LUMA = [
    16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51,
    87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101,
    72, 92, 95, 98, 112, 100, 103, 99,
  ];
  const STD_CHROMA = [
    17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99,
    99, 99, 99, 99,
  ].concat(new Array(32).fill(99));

  function estimateQuality(table, std) {
    let best = null;
    for (let q = 1; q <= 100; q++) {
      const s = q < 50 ? 5000 / q : 200 - 2 * q;
      let err = 0;
      for (let i = 0; i < 64; i++) {
        let t = Math.floor((std[i] * s + 50) / 100);
        t = t < 1 ? 1 : t > 255 ? 255 : t;
        err += Math.abs(t - table[i]);
      }
      if (!best || err < best.err) best = { q, err };
    }
    return { quality: best.q, standard: best.err === 0, meanError: best.err / 64 };
  }

  function parseJPEG(b, m) {
    const j = (m.jpeg = { quant: [], progressive: false, subsampling: null, adobe: false, jfif: false, quality: null, markers: [] });
    const dv = U.view(b);
    const app11 = new Map();
    const icc = [];
    let p = 2;
    while (p + 4 <= b.length) {
      if (b[p] !== 0xff) {
        p++;
        continue;
      }
      const marker = b[p + 1];
      if (marker === 0xff) {
        p++;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        p += 2;
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) break; // EOI or start of scan: metadata is over
      const len = dv.getUint16(p + 2);
      if (len < 2) break;
      const seg = b.subarray(p + 4, Math.min(b.length, p + 2 + len));
      j.markers.push(marker);
      if (marker === 0xe1) {
        if (U.startsWith(seg, 'Exif\0')) {
          const ex = parseTIFF(seg.subarray(6));
          if (ex && !m.exif) m.exif = ex;
        } else if (U.startsWith(seg, 'http://ns.adobe.com/xap/1.0/')) {
          m.xmp.push(U.utf8(seg.subarray(seg.indexOf(0) + 1)));
        } else if (U.startsWith(seg, 'http://ns.adobe.com/xmp/extension/')) {
          m.xmp.push(U.utf8(seg.subarray(Math.min(seg.length, seg.indexOf(0) + 1 + 40))));
        } else m.metaRegions.push(seg);
      } else if (marker === 0xe0) {
        if (U.startsWith(seg, 'JFIF')) j.jfif = true;
      } else if (marker === 0xe2) {
        if (U.startsWith(seg, 'ICC_PROFILE\0')) icc.push({ n: seg[12], data: seg.subarray(14) });
        else if (!U.startsWith(seg, 'MPF')) m.metaRegions.push(seg);
      } else if (marker === 0xeb) {
        if (seg[0] === 0x4a && seg[1] === 0x50 && seg.length > 8) {
          const en = (seg[2] << 8) | seg[3];
          const z = U.view(seg).getUint32(4);
          const list = app11.get(en) || [];
          list.push({ z, data: seg.subarray(8) });
          app11.set(en, list);
        }
      } else if (marker === 0xed) {
        parseAPP13(seg, m);
        m.metaRegions.push(seg);
      } else if (marker === 0xee) {
        if (U.startsWith(seg, 'Adobe')) j.adobe = true;
      } else if (marker === 0xfe) {
        const c = U.smartText(seg).replace(/\0+$/, '').trim();
        if (c) m.text.push({ source: 'JPEG comment', key: 'Comment', value: c });
      } else if (marker >= 0xe3 && marker <= 0xef) {
        m.metaRegions.push(seg);
      } else if (marker === 0xdb) {
        let q = 0;
        while (q < seg.length) {
          const pq = seg[q] >> 4;
          const tq = seg[q] & 15;
          q++;
          const table = new Array(64);
          for (let i = 0; i < 64; i++) {
            if (pq) {
              table[ZIGZAG[i]] = (seg[q] << 8) | seg[q + 1];
              q += 2;
            } else table[ZIGZAG[i]] = seg[q++];
          }
          j.quant[tq] = table;
        }
      } else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        j.progressive = marker === 0xc2 || marker === 0xc6 || marker === 0xca || marker === 0xce;
        m.height = (seg[1] << 8) | seg[2];
        m.width = (seg[3] << 8) | seg[4];
        const nc = seg[5];
        const comps = [];
        for (let i = 0; i < nc; i++) comps.push({ h: seg[7 + i * 3] >> 4, v: seg[7 + i * 3] & 15 });
        if (nc === 1) j.subsampling = 'grayscale';
        else if (nc >= 3) {
          const y = comps[0];
          const c = comps[1];
          const hs = y.h / c.h;
          const vs = y.v / c.v;
          j.subsampling = hs === 1 && vs === 1 ? '4:4:4' : hs === 2 && vs === 1 ? '4:2:2' : hs === 2 && vs === 2 ? '4:2:0' : hs + 'x' + vs;
        }
      }
      p += 2 + len;
    }
    for (const list of app11.values()) {
      list.sort((a, c) => a.z - c.z);
      const first = list[0].data;
      const hdr = U.view(first).getUint32(0) === 1 ? 16 : 8;
      const parts = [first];
      for (let i = 1; i < list.length; i++) parts.push(list[i].data.subarray(hdr));
      m.c2paRaw.push(U.concat(parts));
    }
    if (icc.length) {
      icc.sort((a, c) => a.n - c.n);
      m.icc = parseICC(U.concat(icc.map((x) => x.data)));
    }
    if (j.quant[0]) {
      j.quality = estimateQuality(j.quant[0], STD_LUMA);
      if (j.quant[1]) j.qualityChroma = estimateQuality(j.quant[1], STD_CHROMA);
    }
  }

  // ------------------------------------------------------------------ PNG / WebP / ISO-BMFF images / GIF

  async function inflate(bytes) {
    if (typeof DecompressionStream === 'undefined') return null;
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) {
      return null;
    }
  }

  async function parsePNG(b, m) {
    const png = (m.png = { chunks: [], bitDepth: 0, colorType: 0, animated: false });
    const dv = U.view(b);
    let p = 8;
    let guard = 0;
    while (p + 8 <= b.length && guard++ < 100000) {
      const len = dv.getUint32(p);
      const type = U.latin1(b, p + 4, p + 8);
      const s = p + 8;
      const e = s + len;
      if (e > b.length) break;
      const d = b.subarray(s, e);
      if (type !== 'IDAT' && type !== 'fdAT') png.chunks.push(type);
      if (type === 'IHDR') {
        m.width = dv.getUint32(s);
        m.height = dv.getUint32(s + 4);
        png.bitDepth = b[s + 8];
        png.colorType = b[s + 9];
      } else if (type === 'tEXt') {
        const z = d.indexOf(0);
        if (z > 0) m.text.push({ source: 'PNG tEXt', key: U.latin1(d, 0, z), value: U.smartText(d.subarray(z + 1)) });
      } else if (type === 'zTXt') {
        const z = d.indexOf(0);
        if (z > 0) {
          const inf = await inflate(d.subarray(z + 2));
          m.text.push({ source: 'PNG zTXt', key: U.latin1(d, 0, z), value: inf ? U.smartText(inf) : '[compressed text]' });
        }
      } else if (type === 'iTXt') {
        const z = d.indexOf(0);
        if (z > 0) {
          const key = U.latin1(d, 0, z);
          const compressed = d[z + 1] === 1;
          let q = d.indexOf(0, z + 3) + 1; // language tag
          q = d.indexOf(0, q) + 1; // translated keyword
          let body = d.subarray(q);
          if (compressed) body = (await inflate(body)) || new Uint8Array(0);
          const value = U.utf8(body);
          if (key === 'XML:com.adobe.xmp') m.xmp.push(value);
          else m.text.push({ source: 'PNG iTXt', key, value });
        }
      } else if (type === 'eXIf') {
        m.exif = m.exif || parseTIFF(d);
      } else if (type === 'iCCP') {
        const z = d.indexOf(0);
        const inf = await inflate(d.subarray(z + 2));
        m.icc = (inf && parseICC(inf)) || { description: U.latin1(d, 0, z) };
      } else if (type === 'caBX') {
        m.c2paRaw.push(d);
      } else if (type === 'acTL') {
        png.animated = true;
      } else if (type === 'IEND') break;
      else if (!/^(IDAT|fdAT|PLTE|tRNS|gAMA|cHRM|sRGB|pHYs|bKGD|sBIT|hIST|tIME|fcTL)$/.test(type) && len < 1 << 20) {
        m.metaRegions.push(d);
      }
      p = e + 4;
    }
  }

  function parseWebP(b, m) {
    const w = (m.webp = { lossless: false, lossy: false, animated: false, alpha: false, chunks: [] });
    const dv = U.view(b);
    let p = 12;
    while (p + 8 <= b.length) {
      const type = U.latin1(b, p, p + 4);
      const len = dv.getUint32(p + 4, true);
      const s = p + 8;
      const d = b.subarray(s, Math.min(b.length, s + len));
      w.chunks.push(type);
      if (type === 'VP8 ') {
        w.lossy = true;
        if (!m.width && d.length >= 10) {
          m.width = (d[6] | (d[7] << 8)) & 0x3fff;
          m.height = (d[8] | (d[9] << 8)) & 0x3fff;
        }
      } else if (type === 'VP8L') {
        w.lossless = true;
        if (!m.width && d.length >= 5) {
          const bits = d[1] | (d[2] << 8) | (d[3] << 16) | (d[4] << 24);
          m.width = (bits & 0x3fff) + 1;
          m.height = ((bits >> 14) & 0x3fff) + 1;
        }
      } else if (type === 'VP8X') {
        w.animated = !!(d[0] & 2);
        w.alpha = !!(d[0] & 16);
        m.width = 1 + (d[4] | (d[5] << 8) | (d[6] << 16));
        m.height = 1 + (d[7] | (d[8] << 8) | (d[9] << 16));
      } else if (type === 'EXIF') {
        const t = U.startsWith(d, 'Exif\0') ? d.subarray(6) : d;
        m.exif = m.exif || parseTIFF(t);
      } else if (type === 'XMP ') m.xmp.push(U.utf8(d));
      else if (type === 'C2PA') m.c2paRaw.push(d);
      else if (type === 'ICCP') m.icc = parseICC(d);
      else if (type === 'ANIM' || type === 'ANMF') {
        w.animated = true;
        if (type === 'ANMF' && U.findBytes(d, U.ascii('VP8 ')) >= 0) w.lossy = true;
        if (type === 'ANMF' && U.findBytes(d, U.ascii('VP8L')) >= 0) w.lossless = true;
      } else if (type !== 'ALPH') m.metaRegions.push(d.subarray(0, Math.min(d.length, 1 << 20)));
      p = s + len + (len & 1);
    }
  }

  // Generic fallbacks for formats where we do not walk every structure (HEIC, AVIF, GIF, TIFF, BMP).
  function genericScan(b, m) {
    const lim = Math.min(b.length, 8 << 20);
    const isTiff = (t) =>
      (b[t] === 0x4d && b[t + 1] === 0x4d && b[t + 2] === 0 && b[t + 3] === 0x2a) || (b[t] === 0x49 && b[t + 1] === 0x49 && b[t + 2] === 0x2a && b[t + 3] === 0);
    if (!m.exif) {
      // The first "Exif\0\0" in HEIC/AVIF is often the item-type declaration, not the payload:
      // take the occurrence that is actually followed by a TIFF header.
      let i = U.findBytes(b, U.ascii('Exif\0\0'), 0, lim);
      let guard = 0;
      while (i >= 0 && !m.exif && guard++ < 64) {
        if (isTiff(i + 6)) m.exif = parseTIFF(b.subarray(i + 6));
        i = U.findBytes(b, U.ascii('Exif\0\0'), i + 6, lim);
      }
    }
    if (!m.exif && (m.format === 'heic' || m.format === 'avif')) {
      for (const sig of [[0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8], [0x49, 0x49, 0x2a, 0, 8, 0, 0, 0]]) {
        const j = U.findBytes(b, Uint8Array.from(sig), 0, b.length);
        const ex = j >= 0 ? parseTIFF(b.subarray(j)) : null;
        if (ex && (ex.Make || ex.Model || ex.DateTimeOriginal)) {
          m.exif = ex;
          break;
        }
      }
    }
    if (!m.xmp.length) {
      const i = U.findBytes(b, U.ascii('<x:xmpmeta'), 0, lim);
      if (i >= 0) {
        const j = U.findBytes(b, U.ascii('</x:xmpmeta>'), i, Math.min(b.length, i + (4 << 20)));
        if (j > i) m.xmp.push(U.utf8(b.subarray(i, j + 12)));
      }
    }
    if (!m.c2paRaw.length) {
      let i = U.findBytes(b, U.ascii('jumb'), 0, lim);
      while (i >= 4) {
        if (U.findBytes(b, U.ascii('c2pa'), i, i + 64) > 0) {
          m.c2paRaw.push(b.subarray(i - 4));
          break;
        }
        i = U.findBytes(b, U.ascii('jumb'), i + 4, lim);
      }
    }
  }

  function parseISOImage(b, m) {
    // Largest 'ispe' (image spatial extents) is the full picture; smaller ones are grid tiles.
    let i = 0;
    let guard = 0;
    while ((i = U.findBytes(b, U.ascii('ispe'), i + 1, Math.min(b.length, 4 << 20))) > 0 && guard++ < 64) {
      const dv = U.view(b);
      if (i + 16 > b.length) break;
      const w = dv.getUint32(i + 8);
      const h = dv.getUint32(i + 12);
      if (w * h > (m.width || 0) * (m.height || 0) && w < 65536 && h < 65536) {
        m.width = w;
        m.height = h;
      }
    }
    const metaEnd = Math.min(b.length, 1 << 20);
    m.metaRegions.push(b.subarray(0, Math.min(metaEnd, findMdat(b))));
  }
  function findMdat(b) {
    const i = U.findBytes(b, U.ascii('mdat'), 0, Math.min(b.length, 8 << 20));
    return i > 0 ? i : Math.min(b.length, 1 << 20);
  }

  // ------------------------------------------------------------------ C2PA: JUMBF + CBOR

  function parseJUMBF(b, start, end, depth) {
    const boxes = [];
    const dv = U.view(b);
    let p = start;
    while (p + 8 <= end && boxes.length < 4000) {
      let size = dv.getUint32(p);
      const type = U.latin1(b, p + 4, p + 8);
      let hdr = 8;
      if (size === 1) {
        if (p + 16 > end) break;
        size = dv.getUint32(p + 8) * 4294967296 + dv.getUint32(p + 12);
        hdr = 16;
      } else if (size === 0) size = end - p;
      if (size < hdr || p + size > end) break;
      const box = { type, payload: b.subarray(p + hdr, p + size) };
      if (type === 'jumb' && depth < 16) {
        box.children = parseJUMBF(b, p + hdr, p + size, depth + 1);
        const d = box.children[0];
        if (d && d.type === 'jumd' && d.payload.length >= 17) {
          const pl = d.payload;
          box.uuid = U.hex(pl.subarray(0, 16));
          if (pl[16] & 0x02) {
            const z = pl.indexOf(0, 17);
            box.label = U.utf8(pl.subarray(17, z < 0 ? pl.length : z));
          }
        }
      }
      boxes.push(box);
      p += size;
    }
    return boxes;
  }

  function decodeCBOR(bytes) {
    const dv = U.view(bytes);
    let p = 0;
    let items = 0;
    function len(ai) {
      if (ai < 24) return ai;
      if (ai === 24) return bytes[p++];
      if (ai === 25) {
        const v = dv.getUint16(p);
        p += 2;
        return v;
      }
      if (ai === 26) {
        const v = dv.getUint32(p);
        p += 4;
        return v;
      }
      if (ai === 27) {
        const v = dv.getUint32(p) * 4294967296 + dv.getUint32(p + 4);
        p += 8;
        return v;
      }
      if (ai === 31) return -1;
      throw new Error('cbor: bad length');
    }
    function item(depth) {
      if (depth > 48 || ++items > 50000 || p >= bytes.length) throw new Error('cbor: limit');
      const ib = bytes[p++];
      const mt = ib >> 5;
      const ai = ib & 31;
      switch (mt) {
        case 0:
          return len(ai);
        case 1:
          return -1 - len(ai);
        case 2:
        case 3: {
          const n = len(ai);
          if (n < 0) {
            const parts = [];
            while (bytes[p] !== 0xff) parts.push(item(depth + 1));
            p++;
            return mt === 3 ? parts.join('') : U.concat(parts);
          }
          if (p + n > bytes.length) throw new Error('cbor: eof');
          const s = bytes.subarray(p, p + n);
          p += n;
          return mt === 3 ? U.utf8(s) : s;
        }
        case 4: {
          const n = len(ai);
          const arr = [];
          if (n < 0) {
            while (bytes[p] !== 0xff) arr.push(item(depth + 1));
            p++;
          } else for (let i = 0; i < n; i++) arr.push(item(depth + 1));
          return arr;
        }
        case 5: {
          const n = len(ai);
          const obj = Object.create(null);
          const one = () => {
            const k = item(depth + 1);
            obj[typeof k === 'string' ? k : String(k)] = item(depth + 1);
          };
          if (n < 0) {
            while (bytes[p] !== 0xff) one();
            p++;
          } else for (let i = 0; i < n; i++) one();
          return obj;
        }
        case 6:
          len(ai);
          return item(depth + 1);
        default: {
          if (ai === 20) return false;
          if (ai === 21) return true;
          if (ai === 22 || ai === 23) return null;
          if (ai === 24) {
            p++;
            return null;
          }
          if (ai === 25) {
            const h = dv.getUint16(p);
            p += 2;
            const e = (h >> 10) & 31;
            const f = h & 1023;
            const v = e === 0 ? f * Math.pow(2, -24) : e === 31 ? (f ? NaN : Infinity) : (1 + f / 1024) * Math.pow(2, e - 15);
            return h & 0x8000 ? -v : v;
          }
          if (ai === 26) {
            const v = dv.getFloat32(p);
            p += 4;
            return v;
          }
          if (ai === 27) {
            const v = dv.getFloat64(p);
            p += 8;
            return v;
          }
          return null;
        }
      }
    }
    return item(0);
  }

  // Organisation / common names from X.509 certificates embedded in a COSE signature.
  function certNames(b) {
    const out = [];
    for (let i = 0; i + 7 < b.length && out.length < 40; i++) {
      if (b[i] === 0x06 && b[i + 1] === 0x03 && b[i + 2] === 0x55 && b[i + 3] === 0x04 && (b[i + 4] === 0x0a || b[i + 4] === 0x03)) {
        const tag = b[i + 5];
        let n = b[i + 6];
        let o = i + 7;
        if (n & 0x80) {
          const nb = n & 0x7f;
          if (nb > 2) continue;
          n = 0;
          for (let k = 0; k < nb; k++) n = (n << 8) | b[o++];
        }
        if ([0x0c, 0x13, 0x14, 0x16].includes(tag) && o + n <= b.length && n > 0 && n < 200) {
          out.push({ kind: b[i + 4] === 0x0a ? 'O' : 'CN', value: U.utf8(b.subarray(o, o + n)) });
        }
      }
    }
    return out;
  }

  function firstContent(box, type) {
    for (const c of box.children || []) if (c.type === type) return c.payload;
    return null;
  }
  function agentName(a) {
    if (!a) return null;
    if (typeof a === 'string') return a;
    if (typeof a === 'object' && a.name) return a.name + (a.version ? ' ' + a.version : '');
    return null;
  }
  function deepFind(obj, fn, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 12 || obj instanceof Uint8Array) return;
    for (const k of Object.keys(obj)) {
      fn(k, obj[k]);
      deepFind(obj[k], fn, depth + 1);
    }
  }

  function summarizeC2PA(raws) {
    const res = {
      present: false,
      manifestCount: 0,
      generators: [],
      softwareAgents: [],
      actions: [],
      sourceTypes: [],
      signers: [],
      assertions: [],
      title: null,
      strings: [],
      parseError: null,
    };
    for (const raw of raws) {
      let boxes = [];
      try {
        boxes = parseJUMBF(raw, 0, raw.length, 0);
        if (!boxes.length || boxes[0].type !== 'jumb') {
          const i = U.findBytes(raw, U.ascii('jumb'));
          if (i >= 4) boxes = parseJUMBF(raw, i - 4, raw.length, 0);
        }
      } catch (e) {
        res.parseError = String(e.message || e);
      }
      res.strings.push(...U.printableStrings(raw, 5, 3000));
      const store = boxes.find((x) => x.type === 'jumb' && /c2pa/i.test(x.label || '')) || boxes.find((x) => x.type === 'jumb');
      if (!store) {
        if (res.strings.some((s) => /c2pa/i.test(s))) res.present = true;
        continue;
      }
      res.present = true;
      for (const man of (store.children || []).filter((c) => c.type === 'jumb')) {
        res.manifestCount++;
        for (const c of man.children || []) {
          if (c.type !== 'jumb') continue;
          const lab = c.label || '';
          try {
            if (/^c2pa\.claim/.test(lab)) {
              const cb = firstContent(c, 'cbor');
              const cl = cb ? decodeCBOR(cb) : null;
              if (cl) {
                if (typeof cl.claim_generator === 'string') res.generators.push(cl.claim_generator.replace(/\s*c2pa-rs\/[\d.]+/i, '').trim());
                const cgi = cl.claim_generator_info;
                (Array.isArray(cgi) ? cgi : cgi ? [cgi] : []).forEach((g) => {
                  const n = agentName(g);
                  if (n && !/^c2pa-(rs|js|python)/i.test(n)) res.generators.push(n);
                });
                if (cl['dc:title'] && !res.title) res.title = String(cl['dc:title']);
              }
            } else if (lab === 'c2pa.assertions') {
              for (const a of c.children || []) {
                if (a.type !== 'jumb') continue;
                const al = a.label || '';
                res.assertions.push(al);
                const cb = firstContent(a, 'cbor');
                const js = firstContent(a, 'json');
                let data = null;
                try {
                  data = cb ? decodeCBOR(cb) : js ? JSON.parse(U.utf8(js)) : null;
                } catch (e) {
                  data = null;
                }
                if (!data) continue;
                if (/^c2pa\.actions/.test(al) && Array.isArray(data.actions)) {
                  for (const act of data.actions) {
                    if (!act || typeof act !== 'object') continue;
                    const params = act.parameters || {};
                    const entry = {
                      action: String(act.action || ''),
                      agent: agentName(act.softwareAgent) || agentName(params.softwareAgent),
                      source: act.digitalSourceType || params.digitalSourceType || null,
                      description: act.description || params.description || null,
                    };
                    res.actions.push(entry);
                    if (entry.agent) res.softwareAgents.push(entry.agent);
                  }
                }
                deepFind(data, (k, v) => {
                  if (k === 'digitalSourceType' && typeof v === 'string') res.sourceTypes.push(v);
                });
              }
            } else if (/^c2pa\.signature/.test(lab)) {
              const cb = firstContent(c, 'cbor');
              if (cb) res.signers.push(...certNames(cb));
            }
          } catch (e) {
            res.parseError = String(e.message || e);
          }
        }
      }
    }
    res.generators = U.uniq(res.generators);
    res.softwareAgents = U.uniq(res.softwareAgents);
    res.sourceTypes = U.uniq(res.sourceTypes);
    const orgs = U.uniq(res.signers.filter((s) => s.kind === 'O').map((s) => s.value));
    const cns = U.uniq(res.signers.filter((s) => s.kind === 'CN').map((s) => s.value));
    res.signerOrgs = orgs.length ? orgs : cns.slice(0, 3);
    delete res.signers;
    return res;
  }

  // ------------------------------------------------------------------ ISO-BMFF video (MP4 / MOV / 3GP)

  async function readSlice(file, s, e) {
    return new Uint8Array(await file.slice(s, e).arrayBuffer());
  }

  const BOX_CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta', 'edts', 'dinf', 'mvex', 'tref']);
  const THREEGPP_ASSETS = new Set(['auth', 'titl', 'dscp', 'perf', 'gnre', 'kywd', 'loci', 'albm', 'date', 'cprt']);

  async function parseISOVideo(file, m) {
    const v = (m.video = {
      container: m.format,
      majorBrand: null,
      brands: [],
      duration: null,
      creationTime: null,
      tracks: [],
      tags: {},
      hasAudio: false,
      fragmented: false,
      encoder: null,
    });
    let p = 0;
    let guard = 0;
    while (p + 8 <= file.size && guard++ < 500) {
      const h = await readSlice(file, p, Math.min(file.size, p + 16));
      if (h.length < 8) break;
      const dv = U.view(h);
      let size = dv.getUint32(0);
      const type = U.latin1(h, 4, 8);
      let hdr = 8;
      if (size === 1 && h.length >= 16) {
        size = dv.getUint32(8) * 4294967296 + dv.getUint32(12);
        hdr = 16;
      } else if (size === 0) size = file.size - p;
      if (size < 8 || !/^[\x20-\x7e\xa9]{4}$/.test(type)) break;
      if (type === 'moof') v.fragmented = true;
      if (['moov', 'ftyp', 'uuid', 'meta', 'udta'].includes(type)) {
        if (size <= 128 * 1024 * 1024) {
          const body = await readSlice(file, p + hdr, Math.min(file.size, p + size));
          if (type === 'moov' || type === 'udta') walkBoxes(body, 0, body.length, type, null, v, m, 1);
          else if (type === 'meta') walkMeta(body, 0, body.length, v, m, 1);
          else leafBox(type, body, null, null, v, m);
        } else m.notes.push('Movie header too large to inspect fully.');
      }
      p += size;
    }
    finishVideo(v, m);
  }

  function walkMeta(b, s, e, v, m, depth) {
    // ISO 'meta' is a full box (4 bytes version/flags); QuickTime 'meta' is not.
    const off = U.latin1(b, s + 4, s + 8) === 'hdlr' ? 0 : 4;
    const ctx = { keys: [] };
    walkBoxes(b, s + off, e, 'meta', null, v, m, depth + 1, ctx);
  }

  function walkBoxes(b, s, e, parent, track, v, m, depth, ctx) {
    const dv = U.view(b);
    let p = s;
    let guard = 0;
    while (p + 8 <= e && guard++ < 5000) {
      let size = dv.getUint32(p);
      const type = U.latin1(b, p + 4, p + 8);
      let hdr = 8;
      if (size === 1) {
        if (p + 16 > e) break;
        size = dv.getUint32(p + 8) * 4294967296 + dv.getUint32(p + 12);
        hdr = 16;
      } else if (size === 0) size = e - p;
      if (size < hdr || p + size > e) break;
      const bs = p + hdr;
      const be = p + size;
      if (type === 'trak' && depth < 8) {
        const t = { handler: null, codec: null, compressor: null, width: 0, height: 0, timescale: 0, duration: 0, samples: 0, sampleTime: 0 };
        v.tracks.push(t);
        walkBoxes(b, bs, be, type, t, v, m, depth + 1, ctx);
      } else if (type === 'meta' && depth < 8) {
        walkMeta(b, bs, be, v, m, depth);
      } else if (type === 'ilst' && ctx) {
        parseIlst(b, bs, be, ctx.keys, v);
      } else if (BOX_CONTAINERS.has(type) && depth < 8) {
        walkBoxes(b, bs, be, type, track, v, m, depth + 1, ctx);
      } else {
        leafBox(type, b.subarray(bs, be), parent, track, v, m, ctx);
      }
      p = be;
    }
  }

  const mp4Time = (secs) => (secs > 0 ? new Date((secs - 2082844800) * 1000) : null);

  function leafBox(type, b, parent, track, v, m, ctx) {
    const dv = U.view(b);
    try {
      switch (type) {
        case 'ftyp':
          v.majorBrand = U.latin1(b, 0, 4);
          for (let o = 8; o + 4 <= b.length; o += 4) v.brands.push(U.latin1(b, o, o + 4));
          return;
        case 'mvhd': {
          const ver = b[0];
          const ts = ver ? dv.getUint32(20) : dv.getUint32(12);
          const dur = ver ? dv.getUint32(24) * 4294967296 + dv.getUint32(28) : dv.getUint32(16);
          const ct = ver ? dv.getUint32(4) * 4294967296 + dv.getUint32(8) : dv.getUint32(4);
          if (ts) v.duration = dur / ts;
          v.creationTime = mp4Time(ct);
          return;
        }
        case 'tkhd':
          if (track) {
            const o = b[0] ? 88 : 76;
            if (b.length >= o + 8) {
              track.width = Math.round(dv.getUint32(o) / 65536);
              track.height = Math.round(dv.getUint32(o + 4) / 65536);
            }
          }
          return;
        case 'mdhd':
          if (track) {
            const ver = b[0];
            track.timescale = ver ? dv.getUint32(20) : dv.getUint32(12);
            track.duration = ver ? dv.getUint32(24) * 4294967296 + dv.getUint32(28) : dv.getUint32(16);
          }
          return;
        case 'hdlr': {
          const h = U.latin1(b, 8, 12);
          if (track && parent === 'mdia') track.handler = h;
          return;
        }
        case 'stsd':
          if (track && b.length >= 16) {
            track.codec = U.latin1(b, 12, 16).trim();
            if (track.handler === 'vide' && b.length >= 90) {
              const n = Math.min(b[58], 31);
              const name = U.latin1(b, 59, 59 + n).replace(/[^\x20-\x7e]/g, '').trim();
              if (name) track.compressor = name;
            }
          }
          return;
        case 'stts':
          if (track) {
            const n = Math.min(dv.getUint32(4), 100000);
            let count = 0;
            let time = 0;
            for (let i = 0; i < n && 8 + i * 8 + 8 <= b.length; i++) {
              const c = dv.getUint32(8 + i * 8);
              count += c;
              time += c * dv.getUint32(12 + i * 8);
            }
            track.samples = count;
            track.sampleTime = time;
            track.sttsEntries = n;
          }
          return;
        case 'keys':
          if (ctx) {
            const n = Math.min(dv.getUint32(4), 1000);
            let o = 8;
            for (let i = 0; i < n && o + 8 <= b.length; i++) {
              const ks = dv.getUint32(o);
              if (ks < 8) break;
              ctx.keys.push(U.utf8(b.subarray(o + 8, o + ks)));
              o += ks;
            }
          }
          return;
        case 'uuid': {
          const id = U.hex(b.subarray(0, 16));
          if (id === C2PA_UUID) m.c2paRaw.push(b.subarray(16));
          else if (id === XMP_UUID) m.xmp.push(U.utf8(b.subarray(16)));
          else m.metaRegions.push(b.subarray(0, Math.min(b.length, 1 << 20)));
          return;
        }
        case 'XMP_':
          m.xmp.push(U.utf8(b));
          return;
        case 'xml ': {
          // Sony XAVC / pro cameras embed a NonRealTimeMeta XML document with the device.
          const x = U.utf8(b.subarray(4, Math.min(b.length, 1 << 20)));
          const dm = /<Device\b[^>]*\bmanufacturer="([^"]+)"[^>]*\bmodelName="([^"]+)"/i.exec(x);
          if (dm) {
            v.tags['xml.manufacturer'] = dm[1];
            v.tags['xml.modelName'] = dm[2];
            m.cameraHints.push(dm[1] + ' ' + dm[2]);
          }
          m.metaRegions.push(b.subarray(0, Math.min(b.length, 1 << 20)));
          return;
        }
        case 'SDLN':
        case 'smta':
        case 'svss':
          m.cameraHints.push('Samsung camera metadata');
          return;
        case 'FIRM':
        case 'GPMF':
        case 'CAME':
          m.cameraHints.push('GoPro camera metadata');
          return;
        case 'PANA':
          m.cameraHints.push('Panasonic camera metadata');
          return;
        case 'CNCV':
        case 'CNTH':
        case 'CNDA':
          m.cameraHints.push('Canon camera metadata');
          return;
        case 'NCDT':
          m.cameraHints.push('Nikon camera metadata');
          return;
        case 'MVTG':
          m.cameraHints.push('Fujifilm camera metadata');
          return;
        default:
          if (parent === 'udta' && THREEGPP_ASSETS.has(type)) {
            // 3GPP asset boxes: full box + 2-byte language + UTF-8 string
            const s = U.smartText(b.subarray(6)).split('\0')[0].trim();
            v.tags[type] = type === 'loci' ? 'present' : s;
            m.metaRegions.push(b);
            return;
          }
          if (parent === 'udta' || parent === 'meta') {
            if (type.charCodeAt(0) === 0xa9 || /^[a-z]{4}$/i.test(type)) {
              const val = qtString(b);
              if (val) v.tags[type] = val;
            }
            if (b.length < 1 << 20) m.metaRegions.push(b);
          }
      }
    } catch (e) {
      /* tolerate malformed boxes */
    }
  }

  function qtString(b) {
    if (b.length >= 16 && U.latin1(b, 4, 8) === 'data') return U.utf8(b.subarray(16)).replace(/\0+$/, '').trim();
    if (b.length >= 4) {
      const n = U.view(b).getUint16(0);
      if (n > 0 && n <= b.length - 4) return U.smartText(b.subarray(4, 4 + n)).replace(/\0+$/, '').trim();
    }
    return null;
  }

  function parseIlst(b, s, e, keys, v) {
    const dv = U.view(b);
    let p = s;
    while (p + 8 <= e) {
      const size = dv.getUint32(p);
      if (size < 8 || p + size > e) break;
      const raw = b.subarray(p + 4, p + 8);
      const idx = dv.getUint32(p + 4);
      const key = keys.length && idx >= 1 && idx <= keys.length ? keys[idx - 1] : U.latin1(raw);
      let q = p + 8;
      while (q + 16 <= p + size) {
        const ds = dv.getUint32(q);
        if (ds < 16 || q + ds > p + size) break;
        if (U.latin1(b, q + 4, q + 8) === 'data') {
          const t = dv.getUint32(q + 8) & 0xffffff;
          const body = b.subarray(q + 16, q + ds);
          let val;
          if (t === 1 || t === 4 || t === 2) val = U.utf8(body);
          else if (t === 21 || t === 22) val = body.length === 1 ? body[0] : body.length === 2 ? U.view(body).getInt16(0) : body.length === 4 ? U.view(body).getInt32(0) : '';
          else if (t === 23) val = body.length === 4 ? U.view(body).getFloat32(0) : '';
          else val = body.length < 64 ? U.smartText(body).replace(/[^\x20-\x7e]/g, '') : '';
          if (val !== '' && val != null) v.tags[key] = String(val).trim();
        }
        q += ds;
      }
      p += size;
    }
  }

  function finishVideo(v, m) {
    const vt = v.tracks.find((t) => t.handler === 'vide');
    v.hasAudio = v.tracks.some((t) => t.handler === 'soun');
    if (vt) {
      v.width = vt.width;
      v.height = vt.height;
      v.codec = vt.codec;
      if (vt.samples && vt.sampleTime && vt.timescale) v.fps = (vt.samples * vt.timescale) / vt.sampleTime;
      v.variableFrameRate = (vt.sttsEntries || 0) > 3;
      if (!v.duration && vt.timescale) v.duration = vt.duration / vt.timescale;
      if (vt.compressor) v.compressor = vt.compressor;
    }
    const t = v.tags;
    v.encoder = t['©too'] || t['©enc'] || t['com.apple.quicktime.software'] || t['©swr'] || t.encoder || v.compressor || null;
    v.make = t['com.apple.quicktime.make'] || t['©mak'] || t['com.android.manufacturer'] || null;
    v.model = t['com.apple.quicktime.model'] || t['©mod'] || t['com.android.model'] || null;
    v.software = t['com.apple.quicktime.software'] || t['©swr'] || (t['com.android.version'] ? 'Android ' + t['com.android.version'] : null);
    v.location = t['©xyz'] || t['com.apple.quicktime.location.ISO6709'] || (t.loci ? 'present (3GPP location box)' : null);
    v.captureFps = t['com.android.capture.fps'] || null;
    if (t['xml.manufacturer']) {
      v.make = v.make || t['xml.manufacturer'];
      v.model = v.model || t['xml.modelName'];
    }
    if (/XAVC/.test([v.majorBrand, ...v.brands].join(','))) m.cameraHints.push('Sony XAVC recording format');
    const author = t.auth || t['©aut'] || '';
    if (author && (CAMERA_MAKES.test(author) || /flir/i.test(author))) {
      v.make = v.make || author;
      m.cameraHints.push('Recorded by ' + author);
    }
  }

  // ------------------------------------------------------------------ WebM / Matroska (EBML)

  function parseEBML(b, m) {
    const v = (m.video = { container: 'webm', tracks: [], tags: {}, hasAudio: false });
    const MASTER = new Set([0x1a45dfa3, 0x18538067, 0x1549a966, 0x1654ae6b, 0xae, 0xe0, 0xe1, 0x1254c367, 0x7373, 0x67c8]);
    let lastTag = null;
    let timecodeScale = 1e6;
    let rawDuration = null;
    function vint(p, keepMarker) {
      const first = b[p];
      if (first === undefined) return null;
      let n = 1;
      let mask = 0x80;
      while (n <= 8 && !(first & mask)) {
        n++;
        mask >>= 1;
      }
      if (n > 8) return null;
      let val = keepMarker ? first : first & (mask - 1);
      let allOnes = val === mask - 1;
      for (let i = 1; i < n; i++) {
        val = val * 256 + b[p + i];
        if (b[p + i] !== 0xff) allOnes = false;
      }
      return { n, val, unknown: !keepMarker && allOnes };
    }
    function walk(s, e, depth, track) {
      let p = s;
      let guard = 0;
      while (p < e && depth < 8 && guard++ < 20000) {
        const id = vint(p, true);
        if (!id) return;
        const sz = vint(p + id.n, false);
        if (!sz) return;
        const ds = p + id.n + sz.n;
        const de = sz.unknown ? e : Math.min(e, ds + sz.val);
        const ID = id.val;
        if (ID === 0x1f43b675) return; // first Cluster: media data starts here
        if (ID === 0xae) {
          const t = {};
          v.tracks.push(t);
          walk(ds, de, depth + 1, t);
        } else if (MASTER.has(ID)) walk(ds, de, depth + 1, track);
        else {
          const str = () => U.smartText(b.subarray(ds, de)).replace(/\0+$/, '').trim();
          const uint = () => {
            let x = 0;
            for (let i = ds; i < de; i++) x = x * 256 + b[i];
            return x;
          };
          switch (ID) {
            case 0x4282: v.docType = str(); break;
            case 0x4d80: v.muxingApp = str(); break;
            case 0x5741: v.writingApp = str(); break;
            case 0x2ad7b1: timecodeScale = uint(); break;
            case 0x4489:
              rawDuration = de - ds === 4 ? U.view(b.subarray(ds, de)).getFloat32(0) : de - ds === 8 ? U.view(b.subarray(ds, de)).getFloat64(0) : null;
              break;
            case 0x7ba9: v.title = str(); break;
            case 0x86: if (track) track.codec = str(); break;
            case 0x83: if (track) track.type = uint(); break;
            case 0xb0: if (track) track.width = uint(); break;
            case 0xba: if (track) track.height = uint(); break;
            case 0x23e383: if (track) track.defaultDuration = uint(); break;
            case 0x45a3: lastTag = str(); break;
            case 0x4487: if (lastTag) v.tags[lastTag] = str(); break;
          }
        }
        p = de;
      }
    }
    walk(0, b.length, 0, null);
    if (rawDuration != null) v.duration = (rawDuration * timecodeScale) / 1e9;
    const vt = v.tracks.find((t) => t.type === 1);
    v.hasAudio = v.tracks.some((t) => t.type === 2);
    if (vt) {
      v.width = vt.width;
      v.height = vt.height;
      v.codec = vt.codec;
      if (vt.defaultDuration) v.fps = 1e9 / vt.defaultDuration;
    }
    v.encoder = v.writingApp || v.muxingApp || null;
    m.metaRegions.push(b.subarray(0, Math.min(b.length, 64 * 1024)));
  }

  // ------------------------------------------------------------------ interpretation helpers

  function collectTextSources(m) {
    const T = m.textSources;
    const add = (where, text, tool) => {
      if (text != null && String(text).trim()) T.push({ where, text: String(text), tool: !!tool });
    };
    const e = m.exif || {};
    add('EXIF Software', e.Software, true);
    add('EXIF Make', e.Make, true);
    add('EXIF Model', e.Model, true);
    add('EXIF Artist', e.Artist, false);
    add('EXIF ImageDescription', e.ImageDescription, false);
    add('EXIF UserComment', e.UserComment, false);
    add('EXIF Copyright', e.Copyright, false);
    for (const k of ['XPTitle', 'XPComment', 'XPAuthor', 'XPKeywords', 'XPSubject']) add('EXIF ' + k, e[k], false);
    const xf = m.xmpFields;
    (xf['xmp:CreatorTool'] || []).forEach((t) => add('XMP CreatorTool', t, true));
    (xf['stEvt:softwareAgent'] || []).forEach((t) => add('XMP edit history', t, true));
    (xf['tiff:Software'] || []).forEach((t) => add('XMP Software', t, true));
    if (m.xmp.length) add('XMP packet', m.xmp.join('\n').slice(0, 400000), false);
    for (const t of m.text) add(t.source + ' "' + t.key + '"', t.key + ': ' + t.value, /^(software|source|generator|creator|tool|comment)$/i.test(t.key));
    if (m.iptc) for (const k of Object.keys(m.iptc)) add('IPTC ' + k, m.iptc[k], k === 'OriginatingProgram');
    if (m.c2pa && m.c2pa.present) {
      m.c2pa.generators.forEach((g) => add('Content Credentials generator', g, true));
      m.c2pa.softwareAgents.forEach((g) => add('Content Credentials action agent', g, true));
      (m.c2pa.signerOrgs || []).forEach((g) => add('Content Credentials signer', g, true));
    }
    if (m.video) {
      const v = m.video;
      add('Video encoder', v.encoder, true);
      add('Video writing app', v.writingApp, true);
      add('Video muxing app', v.muxingApp, true);
      add('Video title', v.title, false);
      for (const k of Object.keys(v.tags || {})) add('Video tag ' + k, v.tags[k], /too|swr|software|encoder|make|model/i.test(k));
    }
    // Binary metadata payloads: only long readable runs, only unambiguous names (see scanAI).
    const runs = [];
    for (const r of m.metaRegions) {
      runs.push(...U.printableStrings(r, 6, 4000));
      if (runs.length > 20000) break;
    }
    if (m.c2pa && m.c2pa.strings) runs.push(...m.c2pa.strings);
    if (runs.length) T.push({ where: 'embedded metadata', text: runs.join(' \n '), tool: false, binary: true });
  }

  function scanAI(m) {
    const hits = [];
    const seenNames = new Set();
    for (const tool of AI_TOOLS) {
      if (seenNames.has(tool.name)) continue;
      for (const src of m.textSources) {
        // Ambiguous short names only count inside software/tool fields.
        if (tool.short && !src.tool) continue;
        const mm = tool.re.exec(src.text);
        if (!mm) continue;
        const i = mm.index;
        const snippet = src.text.slice(Math.max(0, i - 40), i + mm[0].length + 60).replace(/\s+/g, ' ').trim();
        hits.push({ name: tool.name, kind: tool.kind, where: src.where, tool: src.tool, match: mm[0], snippet });
        seenNames.add(tool.name);
        break;
      }
    }
    // A tool-field hit always outranks a free-text hit.
    hits.sort((a, b) => (b.tool ? 1 : 0) - (a.tool ? 1 : 0));
    m.aiHits = hits;
  }

  function collectSourceTypes(m) {
    const all = [];
    const re = /digitalsourcetype\/([A-Za-z]+)/gi;
    const scan = (s) => {
      let mm;
      while ((mm = re.exec(s))) all.push({ code: mm[1].toLowerCase(), via: 'IPTC/XMP' });
    };
    m.xmp.forEach(scan);
    if (m.c2pa) m.c2pa.sourceTypes.forEach((s) => all.push({ code: String(s).split('/').pop().toLowerCase(), via: 'Content Credentials' }));
    for (const r of m.metaRegions.slice(0, 20)) scan(U.latin1(r, 0, Math.min(r.length, 1 << 20)));
    const seen = new Set();
    m.sourceTypes = all
      .filter((x) => {
        const k = x.code + x.via;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((x) => Object.assign({}, x, IPTC_SOURCE_TYPES[x.code] || { label: x.code, ai: 'unknown' }));
  }

  // Generation settings that image generators write into their output files.
  function findGenerator(m) {
    const items = m.text.slice();
    const e = m.exif || {};
    if (e.UserComment) items.push({ source: 'EXIF UserComment', key: 'UserComment', value: e.UserComment });
    if (e.ImageDescription) items.push({ source: 'EXIF ImageDescription', key: 'ImageDescription', value: e.ImageDescription });
    if (m.xmpFields['dc:description']) items.push({ source: 'XMP description', key: 'description', value: m.xmpFields['dc:description'].join(' ') });
    if (m.xmpFields['exif:UserComment']) items.push({ source: 'XMP UserComment', key: 'UserComment', value: m.xmpFields['exif:UserComment'].join(' ') });
    for (const t of items) {
      const k = String(t.key).toLowerCase();
      const v = String(t.value || '');
      let tool = null;
      if (/\bsteps:\s*\d+/i.test(v) && /\b(sampler|cfg scale|seed|model hash):/i.test(v)) {
        tool = /fooocus/i.test(v) ? 'Fooocus' : /forge/i.test(v) ? 'Stable Diffusion WebUI Forge' : /invoke/i.test(v) ? 'InvokeAI' : 'Stable Diffusion (AUTOMATIC1111-style settings)';
      } else if ((k === 'prompt' || k === 'workflow') && /class_type|"nodes"\s*:|"inputs"\s*:/.test(v)) tool = 'ComfyUI';
      else if (/^(invokeai_metadata|invokeai_graph|sd-metadata|dream)$/.test(k)) tool = 'InvokeAI';
      else if (k === 'software' && /novelai/i.test(v)) tool = 'NovelAI';
      else if (k === 'comment' && /"(steps|sampler|n_samples|uc|scale|noise_schedule)"/.test(v) && /"seed"/.test(v)) tool = 'NovelAI';
      else if (k === 'fooocus_scheme' || (k === 'parameters' && /"(base_model|refiner_model|guidance_scale|sharpness)"/.test(v))) tool = 'Fooocus';
      else if (/^(generation_data|sd_metadata|aigc)$/.test(k)) tool = k === 'aigc' ? 'AIGC label (generative AI)' : 'AI image generator';
      else if (/job id:\s*[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v) || /--(v|niji|ar|stylize|chaos|sref)\s+\S+/.test(v) && /\b(midjourney|mj)\b/i.test(v + ' ' + k)) tool = 'Midjourney';
      else if (k === 'source' && /stable diffusion|novelai|midjourney|dall/i.test(v)) tool = v.trim();
      if (tool) {
        const prompt = v.split(/\nNegative prompt:|\nSteps:/)[0].trim();
        m.generator = { tool, where: t.source + ' "' + t.key + '"', excerpt: U.truncate(v.replace(/\s+/g, ' '), 320), prompt: tool === 'ComfyUI' ? null : U.truncate(prompt, 240) };
        return;
      }
    }
  }

  function interpret(m) {
    parseXMPFields(m);
    if (m.c2paRaw.length) m.c2pa = summarizeC2PA(m.c2paRaw);
    collectTextSources(m);
    scanAI(m);
    collectSourceTypes(m);
    findGenerator(m);
    const e = m.exif || {};
    const make = e.Make || (m.xmpFields['tiff:Make'] || [])[0] || (m.video && m.video.make) || null;
    const model = e.Model || (m.xmpFields['tiff:Model'] || [])[0] || (m.video && m.video.model) || null;
    m.camera = {
      make,
      model,
      knownMake: !!(make && CAMERA_MAKES.test(make)),
      exposure: [e.ExposureTime, e.FNumber, e.ISO, e.FocalLength].filter((x) => x != null && x !== 0 && !(Array.isArray(x) && !x.length)).length,
      makerNote: !!e.MakerNote,
      gps: !!e.hasGPS,
      lens: e.LensModel || (m.xmpFields['exifEX:LensModel'] || [])[0] || null,
      dateOriginal: e.DateTimeOriginal || null,
    };
    const sw = [e.Software, ...(m.xmpFields['xmp:CreatorTool'] || []), ...(m.xmpFields['stEvt:softwareAgent'] || [])].filter(Boolean).join(' | ');
    m.editors = U.uniq(EDITORS.filter(([re]) => re.test(sw)).map(([, n]) => n));
    const screenshotText = [sw, e.UserComment, ...(m.xmpFields['exif:UserComment'] || []), ...m.text.map((t) => t.value)].join(' | ');
    m.screenshot = SCREENSHOT_RE.test(screenshotText) || SCREENSHOT_RE.test(m.name);
    const allMeta = m.textSources.map((s) => s.text).join(' ');
    m.platform = /FBMD/.test(allMeta) ? 'Facebook / Instagram' : /whatsapp/i.test(allMeta + m.name) ? 'WhatsApp' : null;
    m.hasAnyMetadata = !!(m.exif || m.xmp.length || m.text.length || m.iptc || (m.c2pa && m.c2pa.present));
    // don't keep big buffers in the report
    delete m.metaRegions;
    delete m.c2paRaw;
    if (m.c2pa) delete m.c2pa.strings;
    m.textSources = m.textSources.filter((s) => !s.binary);
  }

  // ------------------------------------------------------------------ entry point

  async function parse(file) {
    const head = await readSlice(file, 0, Math.min(file.size, 4096));
    const sn = sniff(head, file);
    const m = newMeta(file, sn);
    try {
      if (m.kind === 'image') {
        const b = new Uint8Array(await file.arrayBuffer());
        if (m.format === 'jpeg') parseJPEG(b, m);
        else if (m.format === 'png') await parsePNG(b, m);
        else if (m.format === 'webp') parseWebP(b, m);
        else if (m.format === 'tiff') {
          m.exif = parseTIFF(b);
          m.metaRegions.push(b.subarray(0, Math.min(b.length, 1 << 20)));
        } else if (m.format === 'heic' || m.format === 'avif') parseISOImage(b, m);
        genericScan(b, m);
      } else if (m.kind === 'video') {
        if (['mp4', 'mov', '3gp'].includes(m.format)) await parseISOVideo(file, m);
        else if (m.format === 'webm') parseEBML(await readSlice(file, 0, Math.min(file.size, 4 << 20)), m);
        else m.video = { container: m.format, tracks: [], tags: {} };
      }
    } catch (err) {
      m.notes.push('Part of the file structure could not be parsed (' + (err && err.message) + ').');
    }
    interpret(m);
    return m;
  }

  TF.metadata = { parse, sniff, parseTIFF, decodeCBOR, parseJUMBF, summarizeC2PA, estimateQuality, AI_TOOLS, CAMERA_MAKES, IPTC_SOURCE_TYPES };
})(typeof window !== 'undefined' ? window : globalThis);
