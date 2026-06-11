/*
 * audio.js — placeholder sound layer (Session 1).
 *
 * Synthesizes simple WebAudio blips so the game has audible feedback without
 * shipping any asset files yet. Session 2 swaps these for real samples behind
 * the same Sound.play(name) interface.
 */
(function (root) {
  'use strict';

  var ctx = null;
  var muted = false;

  function ac() {
    if (!ctx) {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    return ctx;
  }

  // name -> simple tone recipe
  var TONES = {
    kick:    { freq: 180, type: 'square',   dur: 0.08, gain: 0.25 },
    goal:    { freq: 660, type: 'sawtooth', dur: 0.30, gain: 0.30, slide: 1.5 },
    save:    { freq: 120, type: 'square',   dur: 0.18, gain: 0.30, slide: 0.5 },
    miss:    { freq: 90,  type: 'sine',     dur: 0.22, gain: 0.25, slide: 0.6 },
    post:    { freq: 320, type: 'triangle', dur: 0.12, gain: 0.30 },
    whistle: { freq: 1400,type: 'sine',     dur: 0.20, gain: 0.18 },
    click:   { freq: 440, type: 'sine',     dur: 0.05, gain: 0.15 },
    win:     { freq: 523, type: 'sawtooth', dur: 0.5,  gain: 0.30, slide: 2.0 },
    lose:    { freq: 200, type: 'sine',     dur: 0.5,  gain: 0.25, slide: 0.4 }
  };

  function play(name) {
    if (muted) return;
    var a = ac();
    var t = TONES[name];
    if (!a || !t) return;
    try {
      if (a.state === 'suspended') a.resume();
      var osc = a.createOscillator();
      var g = a.createGain();
      osc.type = t.type;
      var now = a.currentTime;
      osc.frequency.setValueAtTime(t.freq, now);
      if (t.slide) osc.frequency.exponentialRampToValueAtTime(t.freq * t.slide, now + t.dur);
      g.gain.setValueAtTime(t.gain, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + t.dur);
      osc.connect(g).connect(a.destination);
      osc.start(now);
      osc.stop(now + t.dur + 0.02);
    } catch (e) { /* ignore */ }
  }

  root.Sound = {
    play: play,
    toggleMute: function () { muted = !muted; return muted; },
    isMuted: function () { return muted; },
    // call on first user gesture to unlock audio on mobile
    unlock: function () { var a = ac(); if (a && a.state === 'suspended') a.resume(); }
  };
})(typeof self !== 'undefined' ? self : this);
