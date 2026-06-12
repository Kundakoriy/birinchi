/*
 * keeper.js — goalkeeper rating, dive AI, and save-probability model.
 *
 * Keeper rating = f(team strength, current round index, team's results so far).
 * The save model is "third-based": the goal mouth is split into Left / Centre /
 * Right thirds. A save needs the keeper to commit to the SAME third as the shot;
 * corner placement and a wrong guess both make scoring far more likely. All
 * magnitudes come from Config.TUNING so difficulty is tunable in one place.
 */
(function (root) {
  'use strict';

  var T = root.Tournament;
  var Config = root.Config;

  // Badge bands shown on the match preview.
  var BANDS = [
    { min: 0,  label: 'Average',     stars: 1 },
    { min: 68, label: 'Good',        stars: 2 },
    { min: 78, label: 'Elite',       stars: 3 },
    { min: 88, label: 'World-class', stars: 4 }
  ];

  function tuning() { return Config.TUNING; }
  function skillOf(rating) { return T.clamp((rating - 40) / 59, 0, 1); }

  /**
   * @param team       team object {rating}
   * @param roundIndex 0=group, 1=R32, 2=R16, 3=QF, 4=SF, 5=Final
   * @param form       {wins, kicksFaced, savesMade} accumulated this run (optional)
   */
  function keeperRating(team, roundIndex, form) {
    var base = team.rating;
    var roundBonus = (roundIndex || 0) * 1.4; // deeper rounds -> sharper keeper
    var formBonus = 0;
    if (form) {
      formBonus += (form.wins || 0) * 1.2;
      if (form.kicksFaced > 0) {
        formBonus += ((form.savesMade || 0) / form.kicksFaced) * 8;
      }
    }
    return T.clamp(Math.round(base * 0.7 + 15 + roundBonus + formBonus), 40, 99);
  }

  function badge(rating) {
    var band = BANDS[0];
    for (var i = 0; i < BANDS.length; i++) {
      if (rating >= BANDS[i].min) band = BANDS[i];
    }
    return band;
  }

  /**
   * The keeper's SAVE RADIUS in normalized goal space (0..1). Bigger reach for
   * better keepers and deeper rounds. Used by the geometric resolution.
   */
  function keeperReach(rating, roundIndex) {
    var t = tuning();
    return t.KEEPER_REACH + t.KEEPER_REACH_SKILL * skillOf(rating) +
           t.KEEPER_REACH_PER_ROUND * (roundIndex || 0);
  }

  /**
   * AI keeper guesses where the shot will go and returns a continuous dive point
   * {kx, ky} in normalized goal space (covers ALL regions incl. the four
   * corners). Prediction accuracy scales the guess error: a sharp keeper lands
   * near the true shot, a poor one scatters. The keeper also under-commits to
   * height (KEEPER_HIGH_HANDICAP), which keeps the top corners genuinely safer.
   *
   * @param shot {gx, gy} true shot point (normalized)
   */
  function predictDive(shot, rating, roundIndex, rng) {
    var t = tuning();
    rng = rng || Math.random;
    var acc = T.clamp(t.KEEPER_PREDICTION + t.KEEPER_PREDICTION_SKILL * skillOf(rating) +
                      t.KEEPER_PREDICTION_ROUND * (roundIndex || 0), 0, 0.97);
    // Interpolate from a central default toward the true shot by accuracy, then
    // add jitter. A low-accuracy keeper barely leaves centre (corners safe,
    // centre risky); a high-accuracy keeper lands on the shot.
    var kx = 0.5 + (shot.gx - 0.5) * acc + (rng() * 2 - 1) * t.KEEPER_DIVE_NOISE_X;
    var ky = t.KEEPER_REST_Y +
             (shot.gy - t.KEEPER_REST_Y) * acc * (1 - t.KEEPER_HIGH_HANDICAP) +
             (rng() * 2 - 1) * t.KEEPER_DIVE_NOISE_Y;
    return { kx: T.clamp(kx, -0.12, 1.12), ky: T.clamp(ky, -0.12, 1.12) };
  }

  root.Keeper = {
    BANDS: BANDS,
    keeperRating: keeperRating,
    badge: badge,
    keeperReach: keeperReach,
    predictDive: predictDive,
    skillOf: skillOf
  };
})(typeof self !== 'undefined' ? self : this);
