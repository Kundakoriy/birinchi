/*
 * sprites.js — image asset preloader for Penalty Nations 2026.
 *
 * Preloads every PNG via Image() and tracks a per-sprite load status. A match
 * must not begin until loading has settled (Sprites.onReady). If an individual
 * sprite fails to load, Sprites.get(name) returns null and the caller falls
 * back to the existing canvas path-drawing for that element.
 *
 * Pure browser module (uses Image only); no game logic here.
 */
(function (root) {
  'use strict';

  var FILES = {
    ball:            'assets/ball.png',
    keeperReady:     'assets/keeper-ready.png',
    keeperDiveLeft:  'assets/keeper-dive-left.png',
    keeperDiveRight: 'assets/keeper-dive-right.png',
    keeperCenter:    'assets/keeper-center.png',
    menuBg:          'assets/menu-bg.png'
  };

  var images = {};
  var status = {}; // name -> 'loading' | 'ok' | 'fail'
  var total = 0, done = 0, ready = false, started = false;
  var readyCbs = [];

  function tick(name, ok) {
    status[name] = ok ? 'ok' : 'fail';
    done++;
    if (done >= total) {
      ready = true;
      var cbs = readyCbs.splice(0);
      cbs.forEach(function (c) { try { c(); } catch (e) {} });
    }
  }

  function loadAll() {
    if (started) return;
    started = true;
    var names = Object.keys(FILES);
    total = names.length;
    if (!total) { ready = true; return; }
    names.forEach(function (name) {
      var img = new Image();
      status[name] = 'loading';
      img.onload = function () { images[name] = img; tick(name, true); };
      img.onerror = function () { tick(name, false); };
      img.src = FILES[name];
    });
  }

  // Returns the loaded HTMLImageElement, or null if it failed / isn't ready.
  function get(name) {
    return status[name] === 'ok' ? images[name] : null;
  }

  function isReady() { return ready; }

  // Run cb once all sprites have settled (loaded or failed). Runs immediately
  // if already settled.
  function onReady(cb) {
    if (ready) cb();
    else readyCbs.push(cb);
  }

  root.Sprites = {
    FILES: FILES,
    loadAll: loadAll,
    get: get,
    isReady: isReady,
    onReady: onReady,
    status: status
  };
})(typeof self !== 'undefined' ? self : this);
