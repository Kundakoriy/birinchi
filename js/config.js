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
      // --- GEOMETRIC SHOT RESOLUTION (attack & defence) --------------------
      // The goal mouth is normalized to gx,gy in [0,1]. A shot is SAVED iff the
      // keeper's dive point is within KEEPER_REACH (a radius in that normalized
      // space) of the shot point — pure geometry, no probability roll. Both the
      // ball and the keeper end at their real points, so the visual always
      // matches the verdict. Difficulty = reach size + prediction accuracy.
      KEEPER_REACH: 0.16,             // base save radius (normalized goal units)
      KEEPER_REACH_SKILL: 0.05,       // + this * skill (bigger reach for better keepers)
      KEEPER_REACH_PER_ROUND: 0.007,  // + this * round (0=group .. 5=final)
      // How well the keeper tracks the shot: the dive point interpolates from a
      // CENTRAL default toward the true shot by this accuracy. 0 = stays central
      // (corners are wide open, dead-centre is covered), 1 = dives right at the
      // shot. So a weak/early keeper is easy to beat in the corners; an elite
      // keeper in the final tracks even corner shots. Tuned for ~76% mid-keeper
      // conversion early (corners ~safe, dead-centre ~48%), dropping to ~33%
      // against an elite keeper in the final.
      KEEPER_PREDICTION: 0.22,        // base accuracy at skill 0
      KEEPER_PREDICTION_SKILL: 0.50,  // + this * skill
      KEEPER_PREDICTION_ROUND: 0.05,  // + this * round
      KEEPER_DIVE_NOISE_X: 0.24,      // random horizontal jitter on the dive point
      KEEPER_DIVE_NOISE_Y: 0.22,      // random vertical jitter on the dive point
      KEEPER_HIGH_HANDICAP: 0.15,     // keeper under-commits to height -> top corners a touch safer
      KEEPER_REST_Y: 0.22,            // keeper resting / central-default height

      // --- MISSES (you only miss on genuinely extreme swipes) --------------
      MISS_EDGE_X: 0.90,              // |aimX| beyond this risks going wide
      MISS_HIGH_Y: 0.86,             // aimY beyond this risks going over the bar
      MISS_MAX_CHANCE: 0.55,         // cap on miss probability at the extremes
      POST_CHANCE: 0.30,             // chance a shot right on the woodwork hits the post

      DIVE_TIMER_MS: 2200,           // how long you have to pick a dive on defence

      // --- SPRITE SIZING (real-world proportions vs the rendered goal mouth) -
      // Sprites are scaled by real-world size relative to the goal (7.32m x
      // 2.44m), NOT by their pixel dimensions, so they read at a believable
      // scale. Each sprite keeps its own aspect ratio (dives render wide/short,
      // ready/centre render tall) via a single shared metres-per-pixel scale
      // derived from the standing (ready) keeper.
      KEEPER_HEIGHT_RATIO: 0.76,     // standing keeper ~1.85m vs 2.44m goal height
      BALL_DIAMETER_RATIO: 0.09,     // ball ~0.22m vs 2.44m goal height

      // --- TEAM STRENGTH -> STARS (player-facing readout) ------------------
      // Strength (0-100) maps to a star value; first row whose `min` the rating
      // meets wins. Tune freely. Tier labels come from the star value
      // (>=5 Contender, >=4 Strong, >=3 Solid, else Underdog).
      STAR_THRESHOLDS: [
        { min: 88, stars: 5 },
        { min: 82, stars: 4.5 },
        { min: 78, stars: 4 },
        { min: 74, stars: 3.5 },
        { min: 70, stars: 3 },
        { min: 66, stars: 2.5 },
        { min: 0,  stars: 2 }
      ]
    }
  };
})(typeof self !== 'undefined' ? self : this);
