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

  // Which third of the goal a normalized x (-1..1) falls in.
  function thirdOf(x) {
    if (x < -0.22) return 'L';
    if (x > 0.22) return 'R';
    return 'C';
  }

  // How "cornery" a shot is (0 = central/low, 1 = tucked into a top corner).
  function cornerness(shot) {
    var horiz = T.clamp((Math.abs(shot.x) - 0.2) / 0.7, 0, 1);
    var vert = T.clamp(shot.y / 1.0, 0, 1);
    return T.clamp(horiz * 0.7 + vert * 0.5, 0, 1);
  }

  // The keeper (AI) picks a third to dive into, guessing the true third with a
  // skill/round-dependent probability.
  function aiPickThird(rating, roundIndex, shotThird, rng) {
    var t = tuning();
    var p = T.clamp(t.KEEPER_GUESS_BASE + t.KEEPER_GUESS_SKILL * skillOf(rating) +
                    t.KEEPER_GUESS_PER_ROUND * (roundIndex || 0), 0, 0.95);
    if (rng() < p) return shotThird; // guessed right
    // guessed wrong: pick one of the other two thirds
    var others = ['L', 'C', 'R'].filter(function (x) { return x !== shotThird; });
    return others[Math.floor(rng() * others.length)];
  }

  /**
   * Probability a shot is SAVED, given the defending keeper's rating, the round,
   * whether the keeper committed to the correct third, and the shot's cornerness.
   * Used for BOTH the AI keeper (you attacking) and your keeper (you defending),
   * with separate tuning bands.
   */
  function saveProbability(rating, roundIndex, correctThird, corner, mode) {
    var t = tuning();
    if (mode === 'defense') {
      if (!correctThird) return t.DEF_WRONG_SAVE;
      var d = t.DEF_SAVE_BASE + t.DEF_SAVE_SKILL * skillOf(rating) +
              t.DEF_SAVE_PER_ROUND * (roundIndex || 0);
      return T.clamp(d * (1 - corner * t.CORNER_SAVE_REDUCTION), 0, 0.95);
    }
    // attack: AI keeper saving your shot
    if (!correctThird) return t.WRONG_GUESS_SAVE;
    var s = t.KEEPER_SAVE_BASE + t.KEEPER_SAVE_SKILL * skillOf(rating) +
            t.KEEPER_SAVE_PER_ROUND * (roundIndex || 0);
    return T.clamp(s * (1 - corner * t.CORNER_SAVE_REDUCTION), 0, 0.95);
  }

  root.Keeper = {
    BANDS: BANDS,
    keeperRating: keeperRating,
    badge: badge,
    thirdOf: thirdOf,
    cornerness: cornerness,
    aiPickThird: aiPickThird,
    saveProbability: saveProbability,
    skillOf: skillOf
  };
})(typeof self !== 'undefined' ? self : this);
