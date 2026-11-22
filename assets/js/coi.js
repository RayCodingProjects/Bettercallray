/*
 * TrueFrame — turns on cross-origin isolation through sw.js (see that file for why).
 * Loaded first in <head>. On the very first visit the page reloads once, immediately, so it is
 * served through the service worker; every later visit is isolated from the start.
 * If anything is unsupported the site simply runs single-threaded.
 */
(function () {
  'use strict';
  try {
    if (window.crossOriginIsolated || !window.isSecureContext || !('serviceWorker' in navigator)) return;
    if (/[?&]coi=0\b/.test(location.search)) return; // opt-out for debugging
    var KEY = 'tf-coi-reloaded';
    // sw.js lives at the site root (two folders up from this script), whichever page loads us.
    var me = document.currentScript && document.currentScript.src;
    var swUrl = me ? new URL('../../sw.js', me).href : 'sw.js';
    var reloadOnce = function () {
      try {
        if (sessionStorage.getItem(KEY)) return; // never loop
        sessionStorage.setItem(KEY, '1');
      } catch (e) {
        return; // without sessionStorage we cannot guard against loops: stay single-threaded
      }
      location.reload();
    };
    navigator.serviceWorker
      .register(swUrl)
      .then(function (reg) {
        // Already controlled yet not isolated: the browser ignores the headers. Nothing to do.
        if (navigator.serviceWorker.controller) return;
        if (reg.active) reloadOnce();
        else navigator.serviceWorker.addEventListener('controllerchange', reloadOnce);
      })
      .catch(function () {
        /* registration refused (private mode, policy…): run single-threaded */
      });
  } catch (e) {
    /* never block the page */
  }
})();
