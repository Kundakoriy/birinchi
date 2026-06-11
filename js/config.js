/*
 * config.js — global build configuration & feature flags for Penalty Cup 26.
 * Loaded first; everything else reads from window.Config.
 */
(function (root) {
  'use strict';

  root.Config = {
    TITLE: 'Penalty Cup 26',

    // Ad / SDK build target: 'gd' | 'crazy' | 'none'
    // 'none' is itch.io / local debug (fake ads). See ads.js.
    BUILD_TARGET: 'none',

    // GameDistribution game id — PLACEHOLDER. Replace with the real id before a
    // GD submission (Session 2). Never reuse the Block Blast Adventure id.
    GD_GAME_ID: '0000000000000000000000000000000000000000',

    // Monetization master switch (wire now, behind a flag).
    ADS_ENABLED: true,
    ADS_DEBUG_FAKE: true, // show a visible fake-ad overlay in debug builds

    DEBUG: true
  };
})(typeof self !== 'undefined' ? self : this);
