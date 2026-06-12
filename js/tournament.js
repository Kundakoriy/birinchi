/*
 * tournament.js — Penalty Nations 2026 tournament engine (PURE module, no DOM / no SDK).
 *
 * Contains every rule that decides a result:
 *   - Penalty shootout engine (group rules + IFAB knockout rules with early
 *     termination and sudden death).
 *   - Strength-weighted AI-vs-AI shootout simulation.
 *   - Group standings, tiebreakers, third-placed ranking, qualification.
 *   - Knockout bracket construction and full-tournament simulation.
 *
 * Runs in the browser (window.Tournament) and headlessly in Node
 * (module.exports) so the unit tests can run without a browser.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Tournament = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Random number generation (seedable, deterministic for tests / replays)
  // ---------------------------------------------------------------------------

  /** mulberry32 — small fast deterministic PRNG. Returns a function -> [0,1). */
  function makeRng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  // ---------------------------------------------------------------------------
  // Scoring model
  // ---------------------------------------------------------------------------

  /**
   * Probability that a single penalty is scored, given the kicking team's
   * rating and the defending team's keeper rating. Real shootout conversion
   * sits around ~75%; we modulate it by relative strength.
   */
  function goalProbability(attackerRating, keeperRating) {
    var base = 0.74;
    var adj = (attackerRating - 75) / 250 - (keeperRating - 75) / 300;
    return clamp(base + adj, 0.45, 0.92);
  }

  // ---------------------------------------------------------------------------
  // Geometric shot resolution (PURE) — used by the on-screen player shootout so
  // the verdict always matches the visual. The goal mouth is normalized to
  // gx,gy in [0,1] (left->right, bottom->top). A shot is SAVED when the keeper's
  // dive point lies within `reach` (a radius in that same normalized space) of
  // the shot point. No probability roll decides the outcome — geometry does.
  // ---------------------------------------------------------------------------

  function distance(ax, ay, bx, by) {
    var dx = ax - bx, dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** SAVE when the keeper's dive point is within reach of the shot point. */
  function isSaved(shot, dive, reach) {
    return distance(shot.gx, shot.gy, dive.kx, dive.ky) <= reach;
  }

  /** True when the shot lands inside the goal bounds (with a small margin). */
  function shotOnTarget(gx, gy, margin) {
    margin = margin || 0;
    return gx >= -margin && gx <= 1 + margin && gy >= -margin && gy <= 1 + margin;
  }

  // ---------------------------------------------------------------------------
  // Shootout engine
  // ---------------------------------------------------------------------------
  //
  // The engine is stepwise so it can drive both the interactive player match
  // (one kick recorded per swipe) and fully-simulated AI matches. Team A always
  // kicks first in each pair.
  //
  //   mode 'group'    -> exactly 5 kicks each, no early stop, draws allowed.
  //   mode 'knockout' -> best-of-5 with strict early termination, then sudden
  //                      death decided after each completed pair (IFAB).

  function newShootout(mode) {
    return {
      mode: mode,
      a: 0, // goals A
      b: 0, // goals B
      ka: 0, // kicks taken by A
      kb: 0, // kicks taken by B
      turn: 'A', // who kicks next
      phase: 'active', // 'active' | 'suddendeath' | 'done'
      winner: null, // 'A' | 'B' | 'draw'
      history: [] // [{team:'A'|'B', scored:bool, phase}]
    };
  }

  /** Record the outcome of the current kicker's attempt. No-op once done. */
  function recordKick(s, scored) {
    if (s.phase === 'done') return s; // never any kicks after a decision

    s.history.push({ team: s.turn, scored: !!scored, phase: s.phase });

    if (s.turn === 'A') {
      if (scored) s.a++;
      s.ka++;
      s.turn = 'B';
    } else {
      if (scored) s.b++;
      s.kb++;
      s.turn = 'A';
    }

    evaluate(s);
    return s;
  }

  function evaluate(s) {
    if (s.mode === 'group') {
      // No early termination: both teams always complete 5 kicks.
      if (s.ka === 5 && s.kb === 5) {
        s.phase = 'done';
        s.winner = s.a > s.b ? 'A' : s.b > s.a ? 'B' : 'draw';
      }
      return;
    }

    // Knockout
    if (s.phase === 'active') {
      var remA = Math.max(0, 5 - s.ka);
      var remB = Math.max(0, 5 - s.kb);

      // Strict early termination: stop the instant the result cannot change.
      if (s.a > s.b + remB) {
        s.phase = 'done';
        s.winner = 'A';
        return;
      }
      if (s.b > s.a + remA) {
        s.phase = 'done';
        s.winner = 'B';
        return;
      }

      // Regulation complete?
      if (s.ka === 5 && s.kb === 5) {
        if (s.a !== s.b) {
          s.phase = 'done';
          s.winner = s.a > s.b ? 'A' : 'B';
        } else {
          s.phase = 'suddendeath';
        }
      }
      return;
    }

    if (s.phase === 'suddendeath') {
      // Decide only after a completed pair (both have taken equal kicks).
      if (s.ka === s.kb && s.ka > 5 && s.a !== s.b) {
        s.phase = 'done';
        s.winner = s.a > s.b ? 'A' : 'B';
      }
    }
  }

  /** Convenience: does this shootout still need a kick from someone? */
  function isComplete(s) {
    return s.phase === 'done';
  }

  /**
   * Fully simulate a shootout between two team objects {rating} using the
   * scoring model and an rng. Returns the finished state.
   */
  function simulateShootout(teamA, teamB, mode, rng) {
    rng = rng || Math.random;
    var s = newShootout(mode);
    var guard = 0;
    while (!isComplete(s) && guard < 200) {
      guard++;
      var attacker = s.turn === 'A' ? teamA : teamB;
      var keeper = s.turn === 'A' ? teamB : teamA;
      var p = goalProbability(attacker.rating, keeper.rating);
      recordKick(s, rng() < p);
    }
    return s;
  }

  /** Group match -> {a, b} final scores (5 kicks each). */
  function simulateGroupMatch(teamA, teamB, rng) {
    var s = simulateShootout(teamA, teamB, 'group', rng);
    return { a: s.a, b: s.b };
  }

  // ---------------------------------------------------------------------------
  // Group stage standings & qualification
  // ---------------------------------------------------------------------------

  // A "group" is { name, teams: [teamObj x4] }. Each teamObj has {id,name,rating}.
  // A "result" is { home, away, hg, ag } where home/away are team ids.

  /** Round-robin fixture list (6 matches) of team ids for a group of 4. */
  function groupFixtures(group) {
    var t = group.teams;
    return [
      { home: t[0].id, away: t[1].id },
      { home: t[2].id, away: t[3].id },
      { home: t[0].id, away: t[2].id },
      { home: t[1].id, away: t[3].id },
      { home: t[0].id, away: t[3].id },
      { home: t[1].id, away: t[2].id }
    ];
  }

  /**
   * The 6 fixtures grouped into 3 matchdays of 2 fixtures each. Within a group
   * of 4, every team plays exactly once per matchday (3 matches total).
   */
  function matchdayFixtures(group) {
    var f = groupFixtures(group);
    return [[f[0], f[1]], [f[2], f[3]], [f[4], f[5]]];
  }

  function fixtureHas(fix, teamId) {
    return fix.home === teamId || fix.away === teamId;
  }

  /**
   * For a given matchday, split that matchday's two fixtures into the one the
   * player is in and the one to simulate. Returns { playerFixture, otherFixture }.
   * The player fixture is identified by team id (never by object identity) so it
   * can never be both recorded AND simulated.
   */
  function playerMatchday(group, playerId, mdIndex) {
    var md = matchdayFixtures(group)[mdIndex];
    var playerFixture = fixtureHas(md[0], playerId) ? md[0] : md[1];
    var otherFixture = playerFixture === md[0] ? md[1] : md[0];
    return { playerFixture: playerFixture, otherFixture: otherFixture };
  }

  function blankRow(team) {
    return {
      id: team.id,
      name: team.name,
      rating: team.rating,
      P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0
    };
  }

  /** Apply one result to the standings map. */
  function applyResult(rows, res) {
    var h = rows[res.home];
    var a = rows[res.away];
    h.P++; a.P++;
    h.GF += res.hg; h.GA += res.ag;
    a.GF += res.ag; a.GA += res.hg;
    if (res.hg > res.ag) {
      h.W++; a.L++; h.Pts += 3;
    } else if (res.hg < res.ag) {
      a.W++; h.L++; a.Pts += 3;
    } else {
      h.D++; a.D++; h.Pts += 1; a.Pts += 1;
    }
    h.GD = h.GF - h.GA;
    a.GD = a.GF - a.GA;
  }

  /** Tiebreakers: points, goal difference, goals for, then rating. */
  function compareRows(x, y) {
    if (y.Pts !== x.Pts) return y.Pts - x.Pts;
    if (y.GD !== x.GD) return y.GD - x.GD;
    if (y.GF !== x.GF) return y.GF - x.GF;
    return y.rating - x.rating;
  }

  /**
   * Compute ordered standings (array of rows, best first) for a group given
   * its results.
   */
  function computeStandings(group, results) {
    var rows = {};
    group.teams.forEach(function (t) {
      rows[t.id] = blankRow(t);
    });
    results.forEach(function (r) {
      if (rows[r.home] && rows[r.away]) applyResult(rows, r);
    });
    var arr = group.teams.map(function (t) {
      return rows[t.id];
    });
    arr.sort(compareRows);
    return arr;
  }

  /**
   * Qualification: 12 winners + 12 runners-up + 8 best third-placed -> 32.
   * `standingsByGroup` is an array (per group) of ordered rows. Returns
   * { winners, runnersUp, thirds (best 8), qualified (32 rows, group-tagged) }.
   */
  function determineQualifiers(standingsByGroup) {
    var winners = [];
    var runnersUp = [];
    var allThirds = [];
    standingsByGroup.forEach(function (rows, gi) {
      winners.push(tag(rows[0], gi, 1));
      runnersUp.push(tag(rows[1], gi, 2));
      allThirds.push(tag(rows[2], gi, 3));
    });
    allThirds.sort(compareRows);
    var thirds = allThirds.slice(0, 8);
    var qualified = winners.concat(runnersUp).concat(thirds);
    return { winners: winners, runnersUp: runnersUp, thirds: thirds, qualified: qualified };

    function tag(row, groupIndex, place) {
      var c = Object.assign({}, row);
      c.groupIndex = groupIndex;
      c.place = place;
      return c;
    }
  }

  // ---------------------------------------------------------------------------
  // Knockout bracket
  // ---------------------------------------------------------------------------

  /**
   * Standard single-elimination seed order for a power-of-two bracket.
   * seedOrder(8) -> [1,8,5,4,3,6,7,2]; guarantees seeds 1 & 2 meet only in the
   * final, 1/2/3/4 only in the semis, etc.
   */
  function seedOrder(n) {
    var order = [1, 2];
    while (order.length < n) {
      var next = [];
      var m = order.length * 2 + 1;
      for (var i = 0; i < order.length; i++) {
        next.push(order[i]);
        next.push(m - order[i]);
      }
      order = next;
    }
    return order;
  }

  /**
   * Build the Round of 32. `qualified` is the 32-row array. They are ranked
   * overall by the standard tiebreakers to assign seeds 1..32, then arranged
   * into the bracket so strong teams are kept apart.
   * Returns { seeds: [rows by seed], firstRound: [{home,away}] (16 matches) }.
   */
  function buildBracket(qualified) {
    var ranked = qualified.slice().sort(compareRows);
    var order = seedOrder(32); // 32 entries, bracket position order
    // ranked[seed-1] is the team for that seed.
    var bracketTeams = order.map(function (seed) {
      return ranked[seed - 1];
    });
    var firstRound = [];
    for (var i = 0; i < bracketTeams.length; i += 2) {
      firstRound.push({ home: bracketTeams[i], away: bracketTeams[i + 1] });
    }
    return { ranked: ranked, seeds: bracketTeams, firstRound: firstRound };
  }

  var ROUND_NAMES = ['Round of 32', 'Round of 16', 'Quarter-final', 'Semi-final', 'Final'];

  /**
   * Simulate (or play through) the full knockout from a list of first-round
   * pairings. `playMatch(home, away, roundIndex)` must return the winning row;
   * if omitted, matches are simulated by rating. Returns
   * { rounds: [ [ {home,away,winner} ] ... ], champion }.
   */
  function runKnockout(firstRound, rng, playMatch) {
    rng = rng || Math.random;
    var rounds = [];
    var current = firstRound;
    var ri = 0;
    while (current.length >= 1) {
      var played = current.map(function (m) {
        var winner;
        if (playMatch) {
          winner = playMatch(m.home, m.away, ri);
        } else {
          var s = simulateShootout(m.home, m.away, 'knockout', rng);
          winner = s.winner === 'A' ? m.home : m.away;
        }
        return { home: m.home, away: m.away, winner: winner };
      });
      rounds.push(played);
      if (played.length === 1) {
        return { rounds: rounds, champion: played[0].winner };
      }
      var next = [];
      for (var i = 0; i < played.length; i += 2) {
        next.push({ home: played[i].winner, away: played[i + 1].winner });
      }
      current = next;
      ri++;
    }
    return { rounds: rounds, champion: null };
  }

  return {
    makeRng: makeRng,
    clamp: clamp,
    goalProbability: goalProbability,
    distance: distance,
    isSaved: isSaved,
    shotOnTarget: shotOnTarget,
    newShootout: newShootout,
    recordKick: recordKick,
    isComplete: isComplete,
    simulateShootout: simulateShootout,
    simulateGroupMatch: simulateGroupMatch,
    groupFixtures: groupFixtures,
    matchdayFixtures: matchdayFixtures,
    playerMatchday: playerMatchday,
    computeStandings: computeStandings,
    compareRows: compareRows,
    determineQualifiers: determineQualifiers,
    seedOrder: seedOrder,
    buildBracket: buildBracket,
    runKnockout: runKnockout,
    ROUND_NAMES: ROUND_NAMES
  };
});
