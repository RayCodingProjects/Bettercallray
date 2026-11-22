/*
 * TrueFrame — calibration constants for the evidence model.
 *
 * Thresholds are in the units each analyser reports; *LLR values are the
 * log-likelihood ratios a finding contributes (positive = towards AI).
 *
 * Calibrated on a labelled set: 54 AI images (Midjourney v6.1 & v5, SDXL, DALL·E 3,
 * GPT-image-1, GPT-image 4K, Nano Banana Pro, FLUX.2, text-rendering sets) and 44 camera /
 * phone originals (Canon, Nikon, Sony, Fujifilm, Olympus, Panasonic, Samsung, Apple, HTC, DJI…),
 * each also tested metadata-stripped, as 50 % PNG and as a 1280 px JPEG-85 "web copy".
 * See tests/README.md to re-run the harness.
 */
(function (root) {
  'use strict';
  const TF = (root.TrueFrame = root.TrueFrame || {});

  TF.calibration = {
    // Off-axis period-8 peak excess (log10) in the residual spectrum, lossless files without
    // JPEG history only. Real photos: >0.1 in ~4 %, never >0.3. AI PNGs: >0.1 in ~19 %, >0.3 in ~7 %.
    spectral: { weak: 0.1, strong: 0.3, weakLLR: 0.9, strongLLR: 1.8 },

    // JPEG-history detector for lossless files (8×8 block grid strength and phase).
    jpegHistory: { strong: 1.06, aligned: 1.015 },

    // Bayer/CFA demosaicing traces (green quincunx log-contrast + block consistency).
    // g≥0.05 & c≥0.85: 43 % of camera originals vs 0.8 % of AI samples.
    cfa: {
      strong: 0.05,
      strongConsistency: 0.85,
      moderate: 0.03,
      moderateConsistency: 0.8,
      strongLLR: -2.0,
      moderateLLR: -0.9,
      absentLLR: 0.3, // lossless file, no trace
      absentLossyLLR: 0.15,
    },

    // Variation of the noise level across flat regions (robust CV). The absolute noise floor
    // was not discriminative once compression was equalised, so it is reported but not scored.
    noise: { high: 0.35, highLLR: 0.5, elevated: 0.25, elevatedLLR: 0.25, low: 0.1, lowLLR: -0.4, minBlocks: 12 },

    // High-frequency spectral fall-off: not robust across formats, kept informational.
    decay: { enabled: false, low: -0.6, high: 0.4, lowLLR: 0.4, highLLR: -0.3 },

    // Neural ensemble: P(AI) = sigmoid(Σ w·logit(p_model) + bias), fitted by logistic regression
    // on the evaluation set (AUC: SMOGY 0.88, ViT 0.78, both 0.93). ViT-Base over-calls AI on
    // camera photos, which its negative bias corrects. The LLR is shrunk for unseen generators.
    // Fitted on 8-bit weights; the site ships 4-bit weights with one view per image, which keep
    // ensemble AUC within 0.01 (re-fitting on 4-bit outputs traded false alarms for catches, so
    // these weights were kept).
    neural: {
      combos: {
        'smogy+vit': { w: { smogy: 0.497, vit: 0.606 }, bias: -0.49 },
        smogy: { w: { smogy: 0.499 }, bias: 0.72 },
        vit: { w: { vit: 0.632 }, bias: -1.24 },
      },
      clampLogit: 4.5,
      shrink: 0.85,
      videoScale: 0.75,
      cap: 3,
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
