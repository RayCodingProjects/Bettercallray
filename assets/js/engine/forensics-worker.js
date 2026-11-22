/*
 * TrueFrame — pixel-forensics worker.
 * Runs the frequency, sensor (CFA), noise and JPEG-grid analyses off the main thread, so the
 * interface stays smooth and the work overlaps with the neural networks. Same code as the
 * main-thread path (forensics.js), so results are identical.
 * In:  { w, h, buffer }  (RGBA pixels, transferred)
 * Out: { type: 'spectral', spectral } then { type: 'sensor', blockiness, cfa, noise, map }
 */
importScripts('core.js', 'fft.js', 'calibration.js', 'forensics.js');

self.onmessage = async (e) => {
  const FX = self.TrueFrame.forensics;
  const { w, h, buffer } = e.data;
  try {
    const src = FX.prepare({ width: w, height: h, data: new Uint8ClampedArray(buffer) });
    const spectral = await FX.spectral(src);
    self.postMessage({ type: 'spectral', spectral }, spectral ? [spectral.vis.buffer] : []);
    const blockiness = FX.blockiness(src);
    const cfa = FX.cfa(src);
    const noise = FX.noise(src);
    const map = FX.residualMap(src, 1000);
    self.postMessage({ type: 'sensor', blockiness, cfa, noise, map }, [map.data.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
