/*
 * Headless unit tests for the Penalty Nations 2026 tournament engine.
 * Run with:  node tests/tournament.test.js   (or: npm test)
 *
 * No test framework dependency — a tiny assert harness keeps it zero-install.
 */
var T = require('../js/tournament.js');

var passed = 0;
var failed = 0;

function ok(cond, msg) {
  if (cond) {
    passed++;
    console.log('  ✓ ' + msg);
  } else {
    failed++;
    console.error('  ✗ ' + msg);
  }
}
function eq(actual, expected, msg) {
  ok(actual === expected, msg + ' (expected ' + expected + ', got ' + actual + ')');
}
function group(name) {
  console.log('\n' + name);
}

// Feed a sequence of kicks into a shootout. `seq` is an array of booleans in
// kick order (A, B, A, B, ...). Stops feeding once the shootout is decided.
function play(mode, seq) {
  var s = T.newShootout(mode);
  for (var i = 0; i < seq.length; i++) {
    T.recordKick(s, seq[i]);
  }
  return s;
}

// ---------------------------------------------------------------------------
group('Knockout: early termination at 3-0 after 3 pairs');
// A scores all 3, B misses all 3. After the 3rd pair, A leads 3-0 with B only
// able to reach 2 -> decided. Kicks 4 and 5 must NOT be taken.
{
  var s = T.newShootout('knockout');
  T.recordKick(s, true);  // A 1-0
  T.recordKick(s, false); // B 1-0
  T.recordKick(s, true);  // A 2-0
  T.recordKick(s, false); // B 2-0
  T.recordKick(s, true);  // A 3-0
  ok(s.phase === 'active', 'not yet decided before B takes its 3rd kick');
  T.recordKick(s, false); // B 3-0  -> decided
  eq(s.phase, 'done', 'decided after 3rd pair');
  eq(s.winner, 'A', 'team A wins');
  eq(s.a, 3, 'A scored 3');
  eq(s.b, 0, 'B scored 0');
  eq(s.ka, 3, 'A took only 3 kicks (early termination)');
  eq(s.kb, 3, 'B took only 3 kicks (early termination)');
  eq(s.history.length, 6, 'exactly 6 kicks recorded, no kicks 4 or 5');
}

// ---------------------------------------------------------------------------
group('Knockout: early termination mid-pair (decision before B kicks)');
// A decision can also land after team A's kick, within a pair. Build a case
// that is NOT already decided after pair 3, but becomes decided on A's 4th kick.
{
  var s = T.newShootout('knockout');
  T.recordKick(s, true);  // A 1-0 (ka1)
  T.recordKick(s, false); // B     (kb1)
  T.recordKick(s, true);  // A 2-0 (ka2)
  T.recordKick(s, false); // B     (kb2)
  T.recordKick(s, false); // A 2-0 (ka3)  <- A misses, so not decided at pair 3
  T.recordKick(s, false); // B     (kb3): a=2,b=0,remB=2 -> 2 > 2? no, active
  ok(s.phase === 'active', 'still active after pair 3 (2-0)');
  T.recordKick(s, true);  // A 3-0 (ka4,kb3): B max = 0+2 = 2 < 3 -> decided mid-pair
  eq(s.phase, 'done', 'decided right after A goes 3-0 (before B kicks pair 4)');
  eq(s.winner, 'A', 'team A wins');
  eq(s.ka, 4, 'A took 4 kicks');
  eq(s.kb, 3, 'B took 3 kicks (did not take its 4th)');
}

// ---------------------------------------------------------------------------
group('Knockout: no extra kicks after decision');
{
  var s = play('knockout', [true, false, true, false, true, false]); // 3-0 decided
  var beforeA = s.a, beforeB = s.b, beforeLen = s.history.length;
  T.recordKick(s, true);  // attempt extra kick
  T.recordKick(s, true);  // attempt another
  eq(s.a, beforeA, 'score A unchanged after decision');
  eq(s.b, beforeB, 'score B unchanged after decision');
  eq(s.history.length, beforeLen, 'no further kicks recorded after decision');
  eq(s.phase, 'done', 'still done');
}

// ---------------------------------------------------------------------------
group('Knockout: sudden death ends on first unequal pair');
{
  // Regulation 5-5 (both score all five), then sudden death.
  var seq = [];
  for (var i = 0; i < 5; i++) { seq.push(true); seq.push(true); } // 5-5
  var s = T.newShootout('knockout');
  seq.forEach(function (v) { T.recordKick(s, v); });
  eq(s.phase, 'suddendeath', 'enters sudden death at 5-5');
  eq(s.a, 5, 'A has 5');
  eq(s.b, 5, 'B has 5');

  // SD pair 1: both score -> still tied, continue.
  T.recordKick(s, true);  // A scores (6-5)
  ok(s.phase === 'suddendeath', 'not decided mid-pair when A scores');
  T.recordKick(s, true);  // B scores (6-6)
  eq(s.phase, 'suddendeath', 'still going after an equal SD pair (6-6)');

  // SD pair 2: A scores, B misses -> decided.
  T.recordKick(s, true);  // A scores (7-6)
  ok(s.phase === 'suddendeath', 'not decided after only A kicks in SD pair');
  T.recordKick(s, false); // B misses -> decided
  eq(s.phase, 'done', 'decided after first unequal SD pair');
  eq(s.winner, 'A', 'A wins sudden death');
  eq(s.a, 7, 'A total 7');
  eq(s.b, 6, 'B total 6');
}

// ---------------------------------------------------------------------------
group('Knockout: sudden death won by team B');
{
  var seq = [];
  for (var i = 0; i < 5; i++) { seq.push(false); seq.push(false); } // 0-0 reg
  var s = T.newShootout('knockout');
  seq.forEach(function (v) { T.recordKick(s, v); });
  eq(s.phase, 'suddendeath', '0-0 regulation -> sudden death');
  T.recordKick(s, false); // A miss
  T.recordKick(s, true);  // B score -> decided
  eq(s.phase, 'done', 'decided');
  eq(s.winner, 'B', 'B wins');
}

// ---------------------------------------------------------------------------
group('Group match: always 5 kicks each, draws allowed, no sudden death');
{
  // 3-3 must be a recorded draw, not extended.
  var s = T.newShootout('group');
  var seq = [true, true, false, true, true, false, true, true, false, false];
  // A: T,F,T,F,T = 3 ; B: T,T,T,F,F = 3
  seq.forEach(function (v) { T.recordKick(s, v); });
  eq(s.phase, 'done', 'group match completes after 5 each');
  eq(s.ka, 5, 'A took exactly 5');
  eq(s.kb, 5, 'B took exactly 5');
  eq(s.winner, 'draw', '3-3 is a draw in group play');
  eq(s.a, 3, 'A scored 3');
  eq(s.b, 3, 'B scored 3');

  // No early termination even when one side is already unreachable.
  var s2 = T.newShootout('group');
  [true, false, true, false, true, false].forEach(function (v) { T.recordKick(s2, v); });
  eq(s2.phase, 'active', 'group match NOT decided at 3-0 after 3 pairs (must finish 5)');
}

// ---------------------------------------------------------------------------
group('Standings: tiebreakers (points, GD, GF, rating) & qualification');
{
  var g = {
    name: 'Group A',
    teams: [
      { id: 'X', name: 'X', rating: 80 },
      { id: 'Y', name: 'Y', rating: 70 },
      { id: 'Z', name: 'Z', rating: 60 },
      { id: 'W', name: 'W', rating: 50 }
    ]
  };
  // X beats everyone, Y & Z tie on points but Y has better GD.
  var results = [
    { home: 'X', away: 'Y', hg: 2, ag: 1 },
    { home: 'X', away: 'Z', hg: 3, ag: 0 },
    { home: 'X', away: 'W', hg: 1, ag: 0 },
    { home: 'Y', away: 'Z', hg: 2, ag: 2 },
    { home: 'Y', away: 'W', hg: 4, ag: 0 },
    { home: 'Z', away: 'W', hg: 1, ag: 1 }
  ];
  var st = T.computeStandings(g, results);
  eq(st[0].id, 'X', 'X tops the group');
  eq(st[0].Pts, 9, 'X has 9 points');
  eq(st[1].id, 'Y', 'Y second on GD over Z');
  eq(st[2].id, 'Z', 'Z third');
  eq(st[3].id, 'W', 'W last');
}

// ---------------------------------------------------------------------------
group('Qualification: 12 winners + 12 runners-up + 8 best thirds = 32');
{
  // Fabricate 12 groups of standings with descending quality.
  var standingsByGroup = [];
  for (var gi = 0; gi < 12; gi++) {
    var rows = [];
    for (var p = 0; p < 4; p++) {
      rows.push({
        id: 'G' + gi + 'P' + p,
        name: 'G' + gi + 'P' + p,
        rating: 90 - gi - p,
        Pts: (3 - p) * 3 - gi, // varied
        GD: (3 - p) * 2 - gi,
        GF: 5 - p
      });
    }
    standingsByGroup.push(rows);
  }
  var q = T.determineQualifiers(standingsByGroup);
  eq(q.winners.length, 12, '12 group winners');
  eq(q.runnersUp.length, 12, '12 runners-up');
  eq(q.thirds.length, 8, '8 best third-placed teams');
  eq(q.qualified.length, 32, '32 qualified teams total');
  // Every winner must be a 1st place row.
  ok(q.winners.every(function (w) { return w.place === 1; }), 'winners tagged place=1');
  ok(q.thirds.every(function (t) { return t.place === 3; }), 'thirds tagged place=3');
}

// ---------------------------------------------------------------------------
group('Bracket: seed order keeps 1 & 2 apart; 32 teams -> single champion');
{
  var order = T.seedOrder(8);
  eq(order.length, 8, 'seed order has 8 entries');
  eq(order[0], 1, 'seed 1 leads the bracket');
  // The essential property: seeds 1 & 2 sit in opposite halves and can only
  // meet in the final; seeds 1-4 only meet in the semis.
  ok(order.indexOf(2) >= 4, 'seed 2 is in the opposite half from seed 1');
  // First-half semifinalists by seed: pairs (order0,order1) & (order2,order3).
  var firstHalf = order.slice(0, 4);
  ok(firstHalf.indexOf(1) !== -1 && firstHalf.indexOf(4) !== -1, 'seeds 1 & 4 share the top half');
  var secondHalf = order.slice(4);
  ok(secondHalf.indexOf(2) !== -1 && secondHalf.indexOf(3) !== -1, 'seeds 2 & 3 share the bottom half');

  // Build 32 fake qualified teams and run a fully simulated knockout.
  var qualified = [];
  for (var i = 0; i < 32; i++) {
    qualified.push({ id: 'T' + i, name: 'T' + i, rating: 50 + i, Pts: i, GD: i, GF: i });
  }
  var bracket = T.buildBracket(qualified);
  eq(bracket.firstRound.length, 16, 'Round of 32 has 16 matches');
  var rng = T.makeRng(12345);
  var res = T.runKnockout(bracket.firstRound, rng);
  eq(res.rounds.length, 5, 'five knockout rounds (R32,R16,QF,SF,Final)');
  eq(res.rounds[0].length, 16, '16 matches in R32');
  eq(res.rounds[4].length, 1, '1 match in the final');
  ok(res.champion && res.champion.id, 'a single champion emerges');
  // Top seed (1 vs 32) pairing sanity.
  eq(bracket.firstRound[0].home.id, bracket.ranked[0].id, 'seed 1 is the top-ranked team');
}

// ---------------------------------------------------------------------------
group('Determinism: same seed -> same simulated result');
{
  var a = { id: 'a', name: 'a', rating: 82 };
  var b = { id: 'b', name: 'b', rating: 70 };
  var r1 = T.simulateShootout(a, b, 'knockout', T.makeRng(7));
  var r2 = T.simulateShootout(a, b, 'knockout', T.makeRng(7));
  eq(r1.a + '-' + r1.b, r2.a + '-' + r2.b, 'identical seed gives identical score');
  eq(r1.winner, r2.winner, 'identical seed gives identical winner');
}

// ---------------------------------------------------------------------------
group('Group stage: every team plays exactly 3 (no double-counting player)');
{
  var g = {
    name: 'Group A', letter: 'A',
    teams: [
      { id: 'P', name: 'Player', rating: 80 },
      { id: 'Q', name: 'Q', rating: 75 },
      { id: 'R', name: 'R', rating: 70 },
      { id: 'S', name: 'S', rating: 65 }
    ]
  };
  var pid = 'P';
  var rng = T.makeRng(42);
  var lookup = {}; g.teams.forEach(function (t) { lookup[t.id] = t; });

  // Reproduce the real orchestration: each matchday the player records their
  // own fixture, and ONLY the other fixture is simulated.
  var results = [];
  var playerFixtures = [];
  for (var md = 0; md < 3; md++) {
    var split = T.playerMatchday(g, pid, md);
    // sanity: the player's fixture must contain the player; the other must not.
    ok(split.playerFixture.home === pid || split.playerFixture.away === pid,
      'matchday ' + md + ': player fixture contains the player');
    ok(split.otherFixture.home !== pid && split.otherFixture.away !== pid,
      'matchday ' + md + ': other fixture does NOT contain the player');
    playerFixtures.push(split.playerFixture);
    // record player's result (stand-in for an interactive shootout)
    results.push({ home: split.playerFixture.home, away: split.playerFixture.away, hg: 3, ag: 2 });
    // simulate the other fixture only
    var o = split.otherFixture;
    var sim = T.simulateGroupMatch(lookup[o.home], lookup[o.away], rng);
    results.push({ home: o.home, away: o.away, hg: sim.a, ag: sim.b });
  }

  eq(results.length, 6, 'exactly 6 fixtures recorded for the group');

  // No fixture (unordered pair) appears twice -> nothing double-counted.
  var seenPairs = {};
  var dup = false;
  results.forEach(function (r) {
    var key = [r.home, r.away].sort().join('-');
    if (seenPairs[key]) dup = true;
    seenPairs[key] = true;
  });
  ok(!dup, 'no fixture is recorded twice (player match not duplicated by sim)');

  var st = T.computeStandings(g, results);
  st.forEach(function (row) {
    eq(row.P, 3, row.name + ' played exactly 3');
  });
  // the player specifically must have played 3, not 6
  var pr = st.filter(function (r) { return r.id === 'P'; })[0];
  eq(pr.P, 3, 'PLAYER played exactly 3 (regression: not 6)');
}

// ---------------------------------------------------------------------------
group('Geometric resolution: save iff keeper dive within reach of the shot');
{
  var reach = 0.30;
  // Top-left corner shot.
  var shot = { gx: 0.05, gy: 0.95 };

  // Keeper dives bottom-right -> far away -> GOAL.
  var diveFar = { kx: 0.90, ky: 0.10 };
  ok(!T.isSaved(shot, diveFar, reach), 'top-left shot vs bottom-right dive is a GOAL');
  ok(T.distance(shot.gx, shot.gy, diveFar.kx, diveFar.ky) > reach, 'distance exceeds reach');

  // Keeper dives to the top-left within reach -> SAVE.
  var diveNear = { kx: 0.08, ky: 0.92 };
  ok(T.isSaved(shot, diveNear, reach), 'top-left shot vs top-left dive (within reach) is a SAVE');
  ok(T.distance(shot.gx, shot.gy, diveNear.kx, diveNear.ky) <= reach, 'distance within reach');

  // Just inside the reach radius -> SAVE; just outside -> GOAL (threshold check).
  ok(T.isSaved(shot, { kx: 0.05, ky: shot.gy - reach * 0.98 }, reach), 'dive just inside reach is a SAVE');
  ok(!T.isSaved(shot, { kx: 0.05, ky: shot.gy - reach * 1.02 }, reach), 'dive just outside reach is a GOAL');

  // Dead-centre shot is covered by a keeper sitting centrally (centre is risky).
  ok(T.isSaved({ gx: 0.5, gy: 0.2 }, { kx: 0.5, ky: 0.18 }, reach), 'central shot vs central keeper is a SAVE');

  // On-target bounds.
  ok(T.shotOnTarget(0.05, 0.95), 'in-bounds shot is on target');
  ok(!T.shotOnTarget(1.2, 0.5, 0.05), 'shot wide of the post is off target');
  ok(!T.shotOnTarget(0.5, 1.2, 0.05), 'shot over the bar is off target');
}

// ---------------------------------------------------------------------------
group('Strength -> stars mapping (and tier labels)');
{
  eq(T.starRating(94), 5, '94 -> 5 stars');
  eq(T.starRating(88), 5, '88 (band edge) -> 5 stars');
  eq(T.starRating(87), 4.5, '87 -> 4.5 stars');
  eq(T.starRating(82), 4.5, '82 (band edge) -> 4.5 stars');
  eq(T.starRating(81), 4, '81 -> 4 stars');
  eq(T.starRating(78), 4, '78 (band edge) -> 4 stars');
  eq(T.starRating(77), 3.5, '77 -> 3.5 stars');
  eq(T.starRating(74), 3.5, '74 (band edge) -> 3.5 stars');
  eq(T.starRating(73), 3, '73 -> 3 stars');
  eq(T.starRating(70), 3, '70 (band edge) -> 3 stars');
  eq(T.starRating(69), 2.5, '69 -> 2.5 stars');
  eq(T.starRating(66), 2.5, '66 (band edge) -> 2.5 stars');
  eq(T.starRating(65), 2, '65 -> 2 stars');
  eq(T.starRating(40), 2, 'very low -> 2 stars (floor)');

  // Tier labels by star band.
  eq(T.tierLabel(5), 'Contender', '5 stars -> Contender');
  eq(T.tierLabel(4.5), 'Strong', '4.5 stars -> Strong');
  eq(T.tierLabel(4), 'Strong', '4 stars -> Strong');
  eq(T.tierLabel(3.5), 'Solid', '3.5 stars -> Solid');
  eq(T.tierLabel(3), 'Solid', '3 stars -> Solid');
  eq(T.tierLabel(2.5), 'Underdog', '2.5 stars -> Underdog');
  eq(T.tierLabel(2), 'Underdog', '2 stars -> Underdog');

  // Honours an overridden threshold table (as the UI passes from Config.TUNING).
  var custom = [{ min: 90, stars: 5 }, { min: 0, stars: 1 }];
  eq(T.starRating(85, custom), 1, 'custom table respected (85 -> 1)');
  eq(T.starRating(95, custom), 5, 'custom table respected (95 -> 5)');
}

// ---------------------------------------------------------------------------
console.log('\n--------------------------------------------------');
console.log('  ' + passed + ' passed, ' + failed + ' failed');
console.log('--------------------------------------------------');
if (failed > 0) process.exit(1);
