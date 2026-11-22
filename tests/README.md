# TrueFrame evaluation harness

These files let you measure and re-calibrate the detector on your own labelled files.
They are developer tools; the website itself does not need them.

## 1. Prepare a data folder

```
my-data/
  manifest.json
  ai/...      (AI-generated files)
  real/...    (camera / phone originals)
```

`manifest.json` is an array of entries:

```json
[
  { "file": "ai/midjourney/001.png", "label": "ai" },
  { "file": "real/IMG_1234.jpg",     "label": "real", "variant": "original" }
]
```

`variant` is optional and lets you group results (for example `original`, `stripped`, `web`).

## 2. Start the evaluation server

```
python tests/eval_server.py path/to/my-data path/to/results 8765
```

It serves the site, exposes your data folder under `/__data/`, and accepts the results the
harness posts back.

## 3. Run the harness in a browser

Open:

```
http://localhost:8765/tests/harness.html?manifest=/__data/manifest.json&base=/__data/&tier=off&out=run1
```

- `tier` — neural models: `off`, `light` or `standard`
- `dtype` — optional weight precision to compare: `q4` (what the site uses), `q8` or `fp16`
- `out` — results name, written to `path/to/results/run1.json`
- `limit` — analyse only the first N files

The page reloads itself once at the start (to turn on multi-core inference, like the site), then
shows progress and writes `DONE` when finished. Every 25 files it also saves
`path/to/results/<out>.partial.json`, so an interrupted run is not lost. Each result row contains the final
probability, every signal with its log-likelihood ratio, the raw forensic measurements
(spectral peak scores, CFA strength/consistency, noise statistics, block-grid strength) and the
per-model neural scores.

## 4. Re-calibrate

All thresholds and weights live in `assets/js/engine/calibration.js`. A good workflow is:

1. Compute, for each raw measurement, its distribution on AI vs real files of the same format
   (the AUC of a feature tells you whether it carries signal at all).
2. Pick thresholds where the rates differ, and set each LLR to roughly
   `ln(rate among AI files / rate among real files)` — then shrink it, because small test sets
   overstate how well a feature generalises.
3. Re-run the harness and check that no group of real files drifts above 50 %.

Always test with metadata removed and with downscaled/recompressed copies too: pixel-level
traces behave very differently once a file has been through a social network.
