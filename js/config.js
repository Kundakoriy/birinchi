/*
 * config.js — global build configuration, feature flags & gameplay tuning.
 * Loaded first; everything else reads from window.Config.
 */
(function (root) {
  'use strict';

  root.Config = {
    TITLE: 'Penalty Nations 2026',

    // Ad / SDK build target: 'gd' | 'crazy' | 'none'
    // 'none' is itch.io / local debug (fake ads). See ads.js.
    BUILD_TARGET: 'none',

    // GameDistribution game id.
    GD_GAME_ID: 'b38f8037c3f044128fc24ed6faaaba06',

    // Monetization master switch (wire now, behind a flag).
    ADS_ENABLED: true,
    ADS_DEBUG_FAKE: true, // show a visible fake-ad overlay in debug builds

    DEBUG: true,

    // ------------------------------------------------------------------------
    // GAMEPLAY TUNING — adjust these by feel. All values are 0..1 unless noted.
    // Scoring should be the DEFAULT outcome of a decent shot; saves/misses the
    // exception (~70-80% conversion for well-aimed shots in early rounds).
    // "skill" below = (keeperRating - 40) / 59, i.e. 0 at rating 40, 1 at 99.
    // "round" = knockout depth (0 = group, 1 = R32, 2 = R16, ... 5 = Final).
    // ------------------------------------------------------------------------
    TUNING: {
      // --- ATTACK (you shooting at the AI keeper) ---------------------------
      // Chance the keeper guesses the correct third (L/C/R). If it guesses
      // wrong it dives the wrong way and the shot is almost always a goal.
      KEEPER_GUESS_BASE: 0.30,        // at skill 0 (~ a third, i.e. random)
      KEEPER_GUESS_SKILL: 0.34,       // + this * skill
      KEEPER_GUESS_PER_ROUND: 0.02,   // + this * round
      // Save chance WHEN the keeper dives into the correct third. Corner shots
      // cut this down a lot, so aiming the corners is rewarded.
      KEEPER_SAVE_BASE: 0.42,         // at skill 0
      KEEPER_SAVE_SKILL: 0.30,        // + this * skill
      KEEPER_SAVE_PER_ROUND: 0.03,    // + this * round
      CORNER_SAVE_REDUCTION: 0.78,    // a perfect corner shot removes up to this much save chance
      WRONG_GUESS_SAVE: 0.05,         // tiny chance to still save when wrong-footed

      // --- MISSES (you only miss on genuinely extreme swipes) --------------
      MISS_EDGE_X: 0.90,              // |aimX| beyond this risks going wide
      MISS_HIGH_Y: 0.86,             // aimY beyond this risks going over the bar
      MISS_MAX_CHANCE: 0.55,         // cap on miss probability at the extremes
      POST_CHANCE: 0.30,             // chance a shot right on the woodwork hits the post

      // --- DEFENSE (you diving to save the AI's kick) ----------------------
      // Your save chance when you dive into the CORRECT third.
      DEF_SAVE_BASE: 0.55,           // at skill 0
      DEF_SAVE_SKILL: 0.30,          // + this * skill (of YOUR keeper)
      DEF_SAVE_PER_ROUND: 0.02,      // + this * round
      DEF_WRONG_SAVE: 0.06,          // chance to save when you dive the wrong way
      DIVE_TIMER_MS: 2200,           // how long you have to pick a dive

      // --- SPRITE SIZING (real-world proportions vs the rendered goal mouth) -
      // Sprites are scaled by real-world size relative to the goal (7.32m x
      // 2.44m), NOT by their pixel dimensions, so they read at a believable
      // scale. Each sprite keeps its own aspect ratio (dives render wide/short,
      // ready/centre render tall) via a single shared metres-per-pixel scale
      // derived from the standing (ready) keeper.
      KEEPER_HEIGHT_RATIO: 0.76,     // standing keeper ~1.85m vs 2.44m goal height
      BALL_DIAMETER_RATIO: 0.09      // ball ~0.22m vs 2.44m goal height
    }
  };
})(typeof self !== 'undefined' ? self : this);
