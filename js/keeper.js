/*
 * keeper.js — goalkeeper rating & dive AI.
 *
 * Keeper rating = f(team strength, current round index, team's results so far).
 * A keeper sharpens as the team goes deeper and as it banks good results.
 * The rating drives the dive decision and reach in the interactive shootout.
 */
(function (root) {
  'use strict';

  var T = root.Tournament;

  // Badge bands shown on the match preview.
  var BANDS = [
    { min: 0,  label: 'Average',     stars: 1 },
    { min: 68, label: 'Good',        stars: 2 },
    { min: 78, label: 'Elite',       stars: 3 },
    { min: 88, label: 'World-class', stars: 4 }
  ];

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
   * Decide where the keeper dives and whether it reaches a shot.
   * Shot is {x, y} in normalized goal space: x in [-1,1] (left..right),
   * y in [0,1] (ground..crossbar). Returns {diveX, diveY, reach, willSave?}.
   *
   * The keeper "reads" the shot with accuracy proportional to its rating, then
   * commits to a dive. Reach (save radius) also scales with rating.
   */
  function decideDive(rating, shot, rng) {
    rng = rng || Math.random;
    var skill = (rating - 40) / 59; // 0..1
    // Read accuracy: better keepers guess closer to the true side.
    var readError = (1 - skill) * 0.9;
    var diveX = T.clamp(shot.x + (rng() * 2 - 1) * readError, -1.1, 1.1);
    // Keepers favour mid-height; they rarely read top-corner intent perfectly.
    var diveY = T.clamp(shot.y * skill + (rng() * 0.4), 0, 1);
    var reach = 0.28 + skill * 0.30; // save radius in goal-width units
    return { diveX: diveX, diveY: diveY, reach: reach };
  }

  root.Keeper = {
    BANDS: BANDS,
    keeperRating: keeperRating,
    badge: badge,
    decideDive: decideDive
  };
})(typeof self !== 'undefined' ? self : this);
