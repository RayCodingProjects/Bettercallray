/*
 * TrueFrame — evidence builders.
 *
 * Every check produces a "signal": a plain-English finding plus a log-likelihood
 * ratio (LLR). Positive LLR = evidence for AI generation, negative = evidence for a
 * real capture, 0 = informational. Magnitudes are calibrated so that +1 roughly
 * means "this observation is e≈2.7× more likely for an AI image than a real one".
 */
(function (root) {
  'use strict';
  const TF = (root.TrueFrame = root.TrueFrame || {});
  const U = TF.util;

  const CATEGORIES = {
    provenance: { label: 'Provenance & AI labels', icon: 'badge', cap: 8 },
    neural: { label: 'Neural networks', icon: 'cpu', cap: 3.5 },
    frequency: { label: 'Frequency analysis', icon: 'wave', cap: 2.2 },
    sensor: { label: 'Camera-sensor forensics', icon: 'camera', cap: 2.4 },
    metadata: { label: 'Metadata & file traits', icon: 'file', cap: 3 },
    compression: { label: 'Compression history', icon: 'layers', cap: 1 },
    video: { label: 'Video structure', icon: 'film', cap: 2.5 },
  };

  function sig(o) {
    const llr = o.llr || 0;
    const a = Math.abs(llr);
    return Object.assign(
      {
        llr,
        direction: llr > 0.05 ? 'ai' : llr < -0.05 ? 'real' : 'neutral',
        strength: a >= 3 ? 'decisive' : a >= 1.5 ? 'strong' : a >= 0.6 ? 'moderate' : a > 0.05 ? 'weak' : 'none',
        definitive: null,
        detail: '',
      },
      o
    );
  }

  const fmtExposure = (e) => {
    const parts = [];
    if (e.ExposureTime) parts.push(e.ExposureTime >= 1 ? e.ExposureTime + ' s' : '1/' + Math.round(1 / e.ExposureTime) + ' s');
    if (e.FNumber) parts.push('f/' + (+e.FNumber).toFixed(1).replace(/\.0$/, ''));
    if (e.ISO) parts.push('ISO ' + (Array.isArray(e.ISO) ? e.ISO[0] : e.ISO));
    if (e.FocalLength) parts.push((+e.FocalLength).toFixed(1).replace(/\.0$/, '') + ' mm');
    return parts.join(', ');
  };

  // ------------------------------------------------------------------ provenance & metadata

  const AI_SIZES = new Set(
    (
      '512x512 768x768 1024x1024 1536x1536 2048x2048 1792x1024 1024x1792 1536x1024 1024x1536 1456x816 816x1456 2912x1632 1632x2912 ' +
      '1232x928 928x1232 1344x768 768x1344 1216x832 832x1216 1152x896 896x1152 1536x640 640x1536 1344x896 896x1344 1408x768 768x1408 ' +
      '1280x896 896x1280 1184x864 864x1184 1248x832 832x1248 1536x672 672x1536 1664x928 928x1664 1472x1104 1104x1472 1328x1328 ' +
      '2304x1792 1792x2304 2688x1536 1536x2688 2464x1856 1856x2464 2016x1152 1152x2016 768x512 512x768 640x640 1360x768 768x1360 ' +
      '1312x736 736x1312 1600x896 896x1600 2560x1440x 1440x2560x'
    ).split(/\s+/)
  );
  const CAMERA_SIZES = new Set(
    (
      '4032x3024 3024x4032 4000x3000 3000x4000 4624x3472 3472x4624 4080x3072 3072x4080 4080x3060 3060x4080 6000x4000 4000x6000 ' +
      '5472x3648 3648x5472 6048x4024 4024x6048 4608x3456 3456x4608 8064x6048 6048x8064 5712x4284 4284x5712 8192x6144 6144x8192 ' +
      '6240x4160 4160x6240 7952x5304 5304x7952 6720x4480 4480x6720 5184x3456 3456x5184 4928x3264 3264x4928 6016x4016 4016x6016 ' +
      '4288x2848 2848x4288 3264x2448 2448x3264 2592x1944 1944x2592 4000x2252 2252x4000 9248x6936 6936x9248 4096x3072 3072x4096 ' +
      '4032x2268 2268x4032 5568x3712 3712x5568 7008x4672 4672x7008 8256x5504 5504x8256 9504x6336 6336x9504 4656x3496 3496x4656'
    ).split(/\s+/)
  );

  const AI_FILENAME =
    /^(dall[·\-_ ]?e|chatgpt[ _-]image|gemini_generated|firefly|grok[-_ ]|leonardo_|ideogram|midjourney|mj_|comfyui|sora[-_ ]|kling|veo[-_ ]?\d|runway|pika|flux[-_]|sdxl|stable[-_ ]?diffusion|image_?fx|imagen|copilot|designer|bing[-_ ]image|ai[-_ ]generated|generated[-_ ]image|nano[-_]?banana|seedream|ideogram|recraft|hailuo|wan[-_]?2)/i;
  const A1111_FILENAME = /^\d{5}-\d{5,12}(-[^.]*)?\.(png|jpe?g|webp)$/i;
  const MJ_FILENAME = /_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(_\d)?\.(png|jpe?g|webp)$/i;
  const CAMERA_FILENAME = /^(IMG_\d{3,}|IMG-\d{8}|IMG\d{8}|DSC[FN]?_?\d{3,}|_DSC\d{3,}|PXL_\d{8}|MVIMG_|VID_\d{8}|VID-\d{8}|GOPR\d|G[HX]\d{6}|DJI_\d|P\d{7}\.|\d{8}_\d{6}(_\d+)?\.(jpe?g|heic|mp4|dng|mov))/i;

  function metadataSignals(meta, opts) {
    const S = [];
    const c = meta.c2pa;
    const hits = meta.aiHits || [];
    const c2paHits = hits.filter((h) => /Content Credentials/.test(h.where));
    const isVideo = meta.kind === 'video';
    const noun = isVideo ? 'video' : 'image';

    // 1. C2PA Content Credentials
    if (c && c.present) {
      const st = c.sourceTypes.map((s) => String(s).split('/').pop().toLowerCase());
      const info = st.map((s) => TF.metadata.IPTC_SOURCE_TYPES[s]).filter(Boolean);
      const full = info.some((i) => i.ai === 'full');
      const partial = info.some((i) => i.ai === 'partial');
      const capture = info.some((i) => i.capture);
      const created = c.actions.some((a) => /c2pa\.created/.test(a.action));
      const vendor = c2paHits.find((h) => h.kind === 'gen');
      const tools = U.uniq([...c.generators, ...c.softwareAgents]).slice(0, 4).join(', ');
      const signer = (c.signerOrgs || []).slice(0, 2).join(', ');
      const detailParts = [];
      if (tools) detailParts.push('Generator / tools: ' + tools);
      if (signer) detailParts.push('Signed by: ' + signer);
      if (info.length) detailParts.push('Declared source: ' + info.map((i) => i.label).join('; '));
      if (c.actions.length) detailParts.push('Actions: ' + U.uniq(c.actions.map((a) => a.action.replace('c2pa.', ''))).join(', '));
      detailParts.push(c.manifestCount + ' manifest(s). The browser reads the credentials but cannot verify the cryptographic signature against trust lists.');
      const detail = detailParts.join(' · ');
      const createdByAI = full || (vendor && !partial && !capture && (created || !c.actions.length));
      if (createdByAI) {
        S.push(sig({
          id: 'c2pa', category: 'provenance', llr: 6, definitive: 'ai',
          title: 'Content Credentials say this was made with AI',
          summary: `This ${noun} carries a C2PA “Content Credentials” record declaring it was generated by AI${vendor ? ' (' + vendor.name + ')' : tools ? ' (' + tools + ')' : ''}. This is the most reliable kind of evidence.`,
          detail,
        }));
      } else if (partial || vendor) {
        S.push(sig({
          id: 'c2pa', category: 'provenance', llr: 3.5,
          title: 'Content Credentials: edited with generative AI',
          summary: `The credentials record that generative AI was used to create or alter part of this ${noun}${vendor ? ' (' + vendor.name + ')' : ''}.`,
          detail,
        }));
      } else if (capture) {
        S.push(sig({
          id: 'c2pa', category: 'provenance', llr: -3.2,
          title: 'Content Credentials: captured by a camera',
          summary: `The credentials state this ${noun} is an original capture${signer ? ', signed by ' + signer : ''}. Cameras with C2PA sign photos at the moment they are taken.`,
          detail,
        }));
      } else {
        S.push(sig({
          id: 'c2pa', category: 'provenance', llr: 0,
          title: 'Content Credentials found',
          summary: `The file has C2PA credentials${tools ? ' from ' + tools : ''}, but they don't declare AI generation or a camera capture.`,
          detail,
        }));
      }
    }

    // 2. Generator settings embedded by AI tools
    if (meta.generator) {
      const g = meta.generator;
      S.push(sig({
        id: 'genparams', category: 'provenance', llr: 7, definitive: 'ai',
        title: `${g.tool} generation settings embedded`,
        summary: 'The file contains the settings an AI image generator writes into its output (prompt, sampler, steps, seed…). Cameras never write these.',
        detail: (g.prompt ? 'Prompt: “' + g.prompt + '” · ' : '') + 'Found in ' + g.where + ': ' + g.excerpt,
      }));
    }

    // 3. IPTC digital source type (XMP label used by Midjourney, Meta, Google, Adobe…)
    const xmpTypes = (meta.sourceTypes || []).filter((s) => s.via !== 'Content Credentials');
    if (xmpTypes.length) {
      const full = xmpTypes.find((s) => s.ai === 'full');
      const part = xmpTypes.find((s) => s.ai === 'partial');
      const enh = xmpTypes.find((s) => s.ai === 'enhanced');
      const cap = xmpTypes.find((s) => s.capture);
      const detail = 'IPTC DigitalSourceType: ' + xmpTypes.map((s) => s.code).join(', ');
      if (full) {
        S.push(sig({ id: 'iptc', category: 'provenance', llr: 5.5, definitive: 'ai', title: 'Labelled “AI-generated” in its metadata',
          summary: `The ${noun}'s IPTC metadata marks it as “${full.label}”. Most major AI services add this label automatically.`, detail }));
      } else if (part) {
        S.push(sig({ id: 'iptc', category: 'provenance', llr: 3, title: 'Labelled as containing AI-generated parts',
          summary: `The metadata marks this ${noun} as “${part.label}” — for example a photo altered with a generative-AI editor.`, detail }));
      } else if (enh) {
        S.push(sig({ id: 'iptc', category: 'provenance', llr: 0.8, title: 'Labelled as algorithmically enhanced',
          summary: 'The metadata says software algorithms enhanced this image (e.g. AI upscaling or retouching), which is not the same as full generation.', detail }));
      } else if (cap) {
        S.push(sig({ id: 'iptc', category: 'provenance', llr: -1.2, title: 'Labelled as a camera capture',
          summary: `The metadata declares this ${noun} as “${cap.label}”. Unsigned labels like this can be edited, so it is supporting evidence only.`, detail }));
      }
    }

    // 4. AI tool names inside metadata (outside C2PA / generator settings)
    const otherHits = hits.filter((h) => !/Content Credentials/.test(h.where) && !(meta.generator && h.name && meta.generator.tool.indexOf(h.name.split(' ')[0]) >= 0));
    if (otherHits.length && !meta.generator) {
      const best = otherHits[0];
      const names = U.uniq(otherHits.map((h) => h.name)).slice(0, 3).join(', ');
      let llr;
      let title;
      if (best.kind === 'enhance') {
        llr = best.tool ? 1.2 : 0.6;
        title = 'Processed by an AI enhancement app';
      } else if (best.tool) {
        llr = best.kind === 'label' ? 4 : 4.5;
        title = best.kind === 'label' ? 'Software field says “AI-generated”' : `Created with ${best.name}`;
      } else {
        llr = best.kind === 'label' ? 2.5 : 2;
        title = best.kind === 'label' ? 'Metadata labels it as AI-generated' : `Metadata mentions ${best.name}`;
      }
      S.push(sig({
        id: 'aitool', category: 'provenance', llr, definitive: best.tool && best.kind === 'gen' ? 'ai' : null, title,
        summary: best.tool
          ? `The ${best.where} field names ${best.kind === 'label' ? 'an AI label' : best.name} as the software that produced this ${noun}.`
          : `Text inside the metadata (${best.where}) refers to ${names}. That usually means the ${noun} was made with it, though a description could just mention it.`,
        detail: 'Matched “' + best.match + '” in: …' + U.truncate(best.snippet, 160) + '…',
      }));
    }

    if (isVideo) return S; // remaining checks are image-specific (videos get videoSignals)

    // 5. Camera capture metadata
    const cam = meta.camera || {};
    const e = meta.exif || {};
    if ((cam.make && cam.knownMake) || cam.exposure >= 2) {
      let llr = -0.7;
      if (cam.model) llr -= 0.3;
      if (cam.exposure >= 3) llr -= 0.8;
      else if (cam.exposure >= 1) llr -= 0.35;
      if (cam.makerNote) llr -= 0.4;
      if (cam.gps) llr -= 0.2;
      if (cam.lens) llr -= 0.15;
      if (meta.cameraHints.length) llr -= 0.3;
      llr = Math.max(llr, -2.4);
      const exp = fmtExposure(e);
      // Many cameras repeat the maker inside the model name ("Canon" + "Canon EOS R5").
      const makeWord = String(cam.make || '').split(/\s+/)[0].toLowerCase();
      const device = cam.model && makeWord && String(cam.model).toLowerCase().indexOf(makeWord) >= 0 ? cam.model : [cam.make, cam.model].filter(Boolean).join(' ');
      S.push(sig({
        id: 'camera', category: 'metadata', llr,
        title: 'Camera capture data present',
        summary: `Shot on ${device || 'a camera'}${exp ? ' (' + exp + ')' : ''}. Real photos carry this; AI images almost never do — but it can be copied or faked, so it isn't proof.`,
        detail: [cam.lens && 'Lens: ' + cam.lens, cam.dateOriginal && 'Taken: ' + cam.dateOriginal, cam.makerNote && 'Manufacturer MakerNote present', cam.gps && 'GPS location present', ...meta.cameraHints].filter(Boolean).join(' · '),
      }));
    } else if (meta.cameraHints.length) {
      S.push(sig({ id: 'camera', category: 'metadata', llr: -0.8, title: 'Phone-camera traces in metadata',
        summary: 'The metadata contains structures written by phone camera apps (' + meta.cameraHints.join(', ') + ').' }));
    } else if (!meta.screenshot && !(c && c.present)) {
      const none = !meta.hasAnyMetadata;
      S.push(sig({
        id: 'nocamera', category: 'metadata', llr: none ? (meta.format === 'png' ? 0.45 : 0.3) : 0.25,
        title: none ? 'No metadata at all' : 'No camera information',
        summary: none
          ? 'The file has no metadata whatsoever. AI images are usually like this, but social networks and messaging apps also strip metadata, so this is only a weak hint.'
          : 'There is no camera make, model or exposure data. AI images never have it; real photos often lose it when shared online, so this is only a weak hint.',
      }));
    }

    // 6. Editing / screenshots / platforms (context)
    if (meta.editors && meta.editors.length) {
      S.push(sig({ id: 'editor', category: 'metadata', llr: 0, title: 'Edited with ' + meta.editors.join(', '),
        summary: 'Editing software touched this file. Edits can include generative features; without Content Credentials we cannot tell which edits were made.' }));
    }
    if (meta.screenshot) {
      S.push(sig({ id: 'screenshot', category: 'metadata', llr: 0, title: 'This looks like a screenshot',
        summary: "A screenshot only shows what was on screen, so the original file's evidence (metadata, sensor traces) is gone. The verdict relies on the visible content." }));
    }
    if (meta.platform) {
      S.push(sig({ id: 'platform', category: 'compression', llr: 0, title: 'Re-encoded by ' + meta.platform,
        summary: 'This copy was processed by a social platform, which strips metadata and re-compresses pixels. Forensic traces are weaker as a result.' }));
    }

    // 7. Dimensions
    const W = (opts && opts.width) || meta.width;
    const H = (opts && opts.height) || meta.height;
    if (W && H && !meta.screenshot) {
      const key = W + 'x' + H;
      if (AI_SIZES.has(key)) {
        S.push(sig({ id: 'dims', category: 'metadata', llr: 0.7, title: `Typical AI output size (${W}×${H})`,
          summary: `${W}×${H} is a native output resolution of popular image generators. Cameras produce other sizes — though people also crop and resize photos.` }));
      } else if (CAMERA_SIZES.has(key)) {
        S.push(sig({ id: 'dims', category: 'metadata', llr: -0.45, title: `Camera-sensor resolution (${W}×${H})`,
          summary: `${W}×${H} matches the native resolution of common camera or phone sensors.` }));
      }
    }

    // 8. File name
    const name = meta.name || '';
    if (AI_FILENAME.test(name) || A1111_FILENAME.test(name) || MJ_FILENAME.test(name)) {
      S.push(sig({ id: 'filename', category: 'metadata', llr: 1.2, title: 'File name looks like an AI download',
        summary: `“${U.truncate(name, 60)}” follows the naming pattern AI tools use for downloads. File names are easy to change, so this is a hint, not proof.` }));
    } else if (CAMERA_FILENAME.test(name)) {
      S.push(sig({ id: 'filename', category: 'metadata', llr: -0.3, title: 'Camera-style file name',
        summary: `“${U.truncate(name, 60)}” follows the naming pattern of cameras and phones.` }));
    }

    // 9. Compression facts (context)
    if (meta.jpeg && meta.jpeg.quality) {
      const q = meta.jpeg.quality;
      S.push(sig({ id: 'jpegq', category: 'compression', llr: 0, title: `JPEG quality ≈ ${q.quality}`,
        summary: q.standard
          ? `Saved with the standard libjpeg tables at quality ${q.quality}${meta.jpeg.subsampling ? ', chroma ' + meta.jpeg.subsampling : ''} — typical of software exports and web services.`
          : `Saved with custom quantisation tables (≈ quality ${q.quality}${meta.jpeg.subsampling ? ', chroma ' + meta.jpeg.subsampling : ''}), as cameras and some editors do.`,
        detail: 'Lower quality destroys fine forensic traces; pixel-level checks are weighted down accordingly.' }));
    }
    return S;
  }

  // ------------------------------------------------------------------ pixel forensics

  function reliability(meta, w, h) {
    let q = 1;
    const jq = meta.jpeg && meta.jpeg.quality ? meta.jpeg.quality.quality : null;
    if (jq != null) q *= jq < 70 ? 0.45 : jq < 85 ? 0.7 : jq < 93 ? 0.85 : 1;
    if (meta.webp && meta.webp.lossy) q *= 0.75;
    if (meta.format === 'heic' || meta.format === 'avif') q *= 0.75;
    const ms = Math.min(w, h);
    q *= ms < 400 ? 0.55 : ms < 700 ? 0.8 : 1;
    if (meta.platform) q *= 0.7;
    if (meta.screenshot) q *= 0.5;
    return q;
  }

  function isLossy(meta) {
    return meta.format === 'jpeg' || (meta.webp && meta.webp.lossy) || meta.format === 'heic' || meta.format === 'avif' || meta.format === 'gif' || meta.kind === 'video';
  }

  function pixelSignals(fx, meta, ctx) {
    const S = [];
    const q = ctx.reliability;
    const lossy = isLossy(meta);
    const blk = fx.blockiness;
    const JH = TF.calibration.jpegHistory;
    // A JPEG grid is either strong, or weaker but aligned to the image origin (where JPEG puts it).
    const jpegHistory = !!blk && (blk.score > JH.strong || (blk.score >= JH.aligned && blk.phaseX === 0 && blk.phaseY === 0));

    if (blk && !lossy && jpegHistory) {
      S.push(sig({ id: 'jpeghistory', category: 'compression', llr: 0, title: 'Previously saved as JPEG',
        summary: `Although this is a ${meta.format.toUpperCase()}, an 8×8 JPEG block grid is visible (strength ${blk.score.toFixed(2)}). It was converted from a JPEG at some point, e.g. a screenshot or re-save.` }));
    }

    // Frequency: periodic upsampling peaks
    const sp = fx.spectral;
    if (sp) {
      const s = sp.scores;
      const grid = s.p8;
      const detail = `FFT of ${sp.tiles} residual tiles (${sp.T} px). Peak excess (log10) — period 8: ${s.p8.toFixed(2)}, period 4: ${s.p4.toFixed(2)}, period 2: ${s.p2.toFixed(2)}; ${sp.strongPeaks}/${sp.gridPoints} grid points stand out. Block-grid strength ${blk ? blk.score.toFixed(3) : 'n/a'}.`;
      if (lossy || jpegHistory) {
        S.push(sig({ id: 'spectral', category: 'frequency', llr: 0, title: 'Frequency fingerprint masked by compression',
          summary: 'JPEG-style compression adds its own 8-pixel grid to the spectrum, which hides the upsampling fingerprint of image generators, so this check is skipped for this file.', detail }));
      } else {
        const C = TF.calibration.spectral;
        let llr = 0;
        if (grid >= C.strong) llr = C.strongLLR;
        else if (grid >= C.weak) llr = U.lerp(C.weakLLR, C.strongLLR, U.ramp(grid, C.weak, C.strong));
        llr *= q;
        S.push(sig({
          id: 'spectral', category: 'frequency', llr,
          title: llr >= 1.2 ? 'Generator grid pattern in the frequency spectrum' : llr > 0.05 ? 'Faint periodic pattern in the spectrum' : 'No generator grid in the spectrum',
          summary: llr > 0.05
            ? 'The Fourier spectrum of the fine detail shows regularly spaced peaks every 8 pixels. AI image decoders upsample in 2× steps and leave exactly this kind of fingerprint; camera photos almost never show it.'
            : 'The spectrum has no regular 8-pixel grid. Many AI images lack it too (especially after resizing), so this does not point either way.',
          detail,
        }));
      }
    }

    // Sensor: Bayer CFA traces
    const cf = fx.cfa;
    if (cf && !cf.insufficient) {
      const C = TF.calibration.cfa;
      const g = cf.greenStrength;
      const gc = cf.greenConsistency;
      let llr;
      let title;
      let summary;
      if (g >= C.strong && gc >= C.strongConsistency) {
        llr = C.strongLLR;
        title = 'Camera-sensor (Bayer) pattern detected';
        summary = 'We found the microscopic colour-filter pattern a real camera sensor leaves when it reconstructs full colour from its red, green and blue photosites. Image generators do not produce it.';
      } else if (g >= C.moderate && gc >= C.moderateConsistency) {
        llr = C.moderateLLR;
        title = 'Faint camera-sensor traces';
        summary = 'There are weak but consistent traces of a camera colour-filter pattern. Compression has blurred them, so they are only moderately convincing.';
      } else {
        llr = lossy ? C.absentLossyLLR : C.absentLLR;
        title = 'No camera-sensor pattern';
        summary = lossy
          ? 'No colour-filter pattern was found. That fits an AI image, but compression and resizing erase it from real photos too, so it is weak evidence.'
          : 'No colour-filter pattern was found even though the file is losslessly stored — real photos usually keep a trace unless they were resized.';
      }
      llr *= llr < 0 ? Math.max(q, 0.6) : q;
      S.push(sig({ id: 'cfa', category: 'sensor', llr, title, summary,
        detail: `Green quincunx contrast ${g.toFixed(3)} (consistency ${(gc * 100).toFixed(0)}% of ${cf.blocks} blocks); red/blue phase ${cf.rbOpposite ? 'diagonally opposite (Bayer-like)' : 'not Bayer-like'} (consistency ${(cf.red.consistency * 100).toFixed(0)}% / ${(cf.blue.consistency * 100).toFixed(0)}%).` }));
    }

    // Sensor: consistency of the noise level across flat regions
    const nz = fx.noise;
    if (nz && !nz.insufficient && nz.flatBlocks >= TF.calibration.noise.minBlocks) {
      const C = TF.calibration.noise;
      let llr = 0;
      let title = 'Noise level looks ordinary';
      let summary = 'The grain in smooth areas varies a normal amount — this check does not point either way.';
      if (nz.cv >= C.high) {
        llr = C.highLLR;
        title = 'Noise varies a lot across the image';
        summary = 'The grain level differs strongly between similar-looking smooth areas. A single camera sensor produces even noise; generated images and composites often do not.';
      } else if (nz.cv >= C.elevated) {
        llr = C.elevatedLLR;
        title = 'Uneven noise across the image';
        summary = 'The grain level is somewhat uneven between smooth areas, which is more typical of generated images than of a single camera sensor.';
      } else if (nz.cv <= C.low) {
        llr = C.lowLLR;
        title = 'Even, sensor-like noise';
        summary = 'Smooth areas carry a very even grain, as a single camera sensor produces.';
      }
      llr *= q;
      S.push(sig({ id: 'noise', category: 'sensor', llr, title, summary,
        detail: `Noise σ in flat areas ≈ ${nz.floor.toFixed(2)} (0–255 scale); variation ${(nz.cv * 100).toFixed(0)}%; noise-free blocks ${(nz.deadFraction * 100).toFixed(0)}%; brightness/noise correlation ${nz.brightnessCorrelation.toFixed(2)}.` }));
    }

    // Frequency: spectral decay
    if (sp && isFinite(sp.hfDeviation) && !lossy && !jpegHistory) {
      const C = TF.calibration.decay;
      if (C.enabled) {
        const d = sp.hfDeviation;
        let llr = d < C.low ? C.lowLLR : d > C.high ? C.highLLR : 0;
        llr *= q;
        if (llr) {
          S.push(sig({ id: 'decay', category: 'frequency', llr,
            title: llr > 0 ? 'Unusual high-frequency fall-off' : 'Natural high-frequency detail',
            summary: llr > 0
              ? 'Fine detail drops off differently from how lenses and sensors record it — a known trait of generated images.'
              : 'The balance between coarse and fine detail follows the pattern of natural photographs.',
            detail: `Spectral slope ${sp.slope.toFixed(2)}, high-frequency deviation ${d.toFixed(2)} (log10).` }));
        }
      }
    }
    return S;
  }

  // ------------------------------------------------------------------ neural

  function neuralSignal(result, ctx) {
    if (!result || !result.models || !result.models.length) return null;
    const ok = result.models.filter((m) => m.p != null);
    if (!ok.length) return null;
    const C = TF.calibration.neural;
    const L = (p) => U.clamp(U.logit(p), -C.clampLogit, C.clampLogit);
    // Calibrated combination for exactly the models that ran (fitted by logistic regression).
    const comboKey = ok.map((m) => m.key).sort().join('+');
    const combo = C.combos[comboKey];
    let z;
    if (combo) {
      z = combo.bias;
      for (const m of ok) z += (combo.w[m.key] || 0) * L(m.p);
    } else {
      z = 0.5 * U.mean(ok.map((m) => L(m.p)));
    }
    // Each model's own calibrated verdict, to report agreement honestly.
    const single = ok.map((m) => {
      const c1 = C.combos[m.key];
      return c1 ? U.sigmoid(c1.bias + c1.w[m.key] * L(m.p)) : m.p;
    });
    const agree = single.every((p) => p > 0.5) || single.every((p) => p < 0.5);
    const spread = Math.max(...single) - Math.min(...single);
    const llr = U.clamp(z * C.shrink * (ctx.video ? C.videoScale : 1), -C.cap, C.cap);
    const avgP = U.sigmoid(z);
    const n = ok.length;
    const models = ok.map((m, i) => `${m.name}: raw ${U.pct(m.p)}, calibrated ${U.pct(single[i])}`).join(' · ');
    const what = ctx.video ? `across ${ctx.frames} sampled frames` : '';
    let title;
    if (avgP >= 0.8) title = 'Neural networks: looks AI-generated';
    else if (avgP >= 0.6) title = 'Neural networks lean towards AI';
    else if (avgP > 0.4) title = 'Neural networks are undecided';
    else if (avgP > 0.2) title = 'Neural networks lean towards real';
    else title = 'Neural networks: looks like a real photo';
    return sig({
      id: 'neural', category: 'neural', llr, title,
      summary: `${n === 1 ? 'Our vision model rates' : `Our ${n} vision models rate`} this ${ctx.video ? 'video' : 'image'} ${U.pct(avgP)} likely AI-generated ${what}${n > 1 ? (agree ? ' and they agree' : ', but they disagree with each other') : ''}. These detectors learned from large sets of real and generated pictures, but can miss brand-new generators.`.replace(/\s+/g, ' '),
      detail: models + (spread > 0.5 ? ' · Large disagreement lowers the weight of this check.' : ''),
      data: { avgP, spread, agree },
    });
  }

  // ------------------------------------------------------------------ video structure

  function videoSignals(meta, info) {
    const S = [];
    const v = meta.video || {};
    const duration = info.duration || v.duration;
    const w = info.width || v.width;
    const h = info.height || v.height;
    const phone = v.make || v.model || Object.keys(v.tags || {}).some((k) => /com\.apple\.quicktime\.(make|model|location|software)|com\.android\.(version|capture|manufacturer)/.test(k)) || meta.cameraHints.length;
    if (phone) {
      let llr = -2.2;
      if (v.location) llr -= 0.4;
      const device = [v.make, v.model].filter(Boolean).join(' ') || (v.software || meta.cameraHints[0] || 'a phone camera app');
      S.push(sig({ id: 'devicetags', category: 'video', llr, title: 'Recorded on a real device',
        summary: `The container holds recording tags written by the camera (${device}${v.location ? ', with GPS location' : ''}). AI video services don't write these, although files can be tampered with.`,
        detail: Object.keys(v.tags || {}).slice(0, 12).join(', ') }));
    } else if (v.location) {
      S.push(sig({ id: 'devicetags', category: 'video', llr: -1.2, title: 'Recorded with a GPS location tag',
        summary: 'The container stores the location where it was recorded, which phones and cameras add automatically. AI video services do not, although tags can be edited.',
        detail: 'Location: ' + v.location }));
    } else {
      S.push(sig({ id: 'devicetags', category: 'video', llr: 0.2, title: 'No camera recording tags',
        summary: 'Phone and camera recordings normally carry device, date and location tags in the container. This file has none — typical for AI output but also for videos re-encoded by apps or websites.' }));
    }
    if (v.encoder) {
      const lavf = /lavf|libav|ffmpeg|lavc/i.test(v.encoder);
      S.push(sig({ id: 'encoder', category: 'video', llr: lavf && !phone ? 0.15 : 0, title: 'Encoded with ' + U.truncate(v.encoder, 40),
        summary: lavf
          ? 'The file was written by FFmpeg, which nearly every AI video service uses — and so do download sites and editing tools.'
          : 'This is the software that wrote the video file.' }));
    }
    if (v.hasAudio === false && (v.tracks || []).length) {
      S.push(sig({ id: 'audio', category: 'video', llr: 0.2, title: 'No audio track',
        summary: 'The video is silent. Most AI video generators output clips without sound; real recordings almost always include a microphone track unless it was removed.' }));
    }
    if (isFinite(duration) && duration > 0) {
      let llr = 0;
      if (duration <= 12) llr = 0.2;
      else if (duration <= 25) llr = 0.05;
      else if (duration > 180) llr = -1;
      else if (duration > 60) llr = -0.6;
      S.push(sig({ id: 'duration', category: 'video', llr, title: 'Length: ' + U.formatDuration(duration),
        summary: llr > 0
          ? 'AI video generators produce short clips (typically 4–20 seconds). This length fits that pattern, though many real clips are short too.'
          : llr < 0
            ? 'Long continuous takes are still rare for AI generators, which favours a real recording (or an edited compilation).'
            : 'This length is common for both real and generated clips.' }));
    }
    if (w && h) {
      const key = w + 'x' + h;
      const aiRes = /^(832x480|480x832|1360x768|768x1360|1280x704|704x1280|1248x704|704x1248|960x960|720x720|1024x1024|1088x1920|1920x1088|848x480|480x848|624x624|1152x640|640x1152)$/.test(key);
      if (aiRes) {
        S.push(sig({ id: 'vres', category: 'video', llr: 0.5, title: `Unusual resolution (${w}×${h})`,
          summary: 'This frame size is used by AI video models but not by cameras or phones.' }));
      }
    }
    if (v.fps) {
      const fps = v.fps;
      if (Math.abs(fps - 24) < 0.05 || Math.abs(fps - 16) < 0.05) {
        S.push(sig({ id: 'fps', category: 'video', llr: 0.1, title: `${fps.toFixed(fps % 1 ? 2 : 0)} frames per second`,
          summary: 'Many AI video models render at 24 (or 16) fps. Film cameras also shoot at 24, while phones default to 30 or 60.' }));
      } else if (v.variableFrameRate && phone) {
        S.push(sig({ id: 'fps', category: 'video', llr: -0.2, title: 'Variable frame rate',
          summary: 'Phone cameras record with a slightly variable frame rate; generated clips have perfectly regular timing.' }));
      }
    }
    return S;
  }

  TF.evidence = { CATEGORIES, metadataSignals, pixelSignals, neuralSignal, videoSignals, reliability, isLossy, sig, fmtExposure };
})(typeof window !== 'undefined' ? window : globalThis);
