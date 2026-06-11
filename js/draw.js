/*
 * draw.js — tournament draw for Penalty Nations 2026.
 *
 *  - officialDraw(): the verified real FIFA World Cup 2026 final draw
 *    (Washington D.C., 5 December 2025). Group position order follows the pots
 *    (pos 1 = Pot 1 seed, pos 4 = Pot 4), with the hosts at A1 (Mexico),
 *    B1 (Canada) and D1 (United States).
 *  - randomDraw(rng): pot-seeded random draw — one team from each pot per group.
 *
 * Returns an array of 12 groups: { name, teams: [teamObj x4] }.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./teams.js'));
  } else {
    root.Draw = factory(root.Teams);
  }
})(typeof self !== 'undefined' ? self : this, function (Teams) {
  'use strict';

  var GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

  // Verified official December 2025 draw — team ids by group, in position order.
  var OFFICIAL = [
    ['MEX', 'KOR', 'RSA', 'CZE'], // A  (host Mexico)
    ['CAN', 'SUI', 'QAT', 'BIH'], // B  (host Canada)
    ['BRA', 'MAR', 'SCO', 'HAI'], // C
    ['USA', 'AUS', 'PAR', 'TUR'], // D  (host United States)
    ['GER', 'ECU', 'CIV', 'CUW'], // E
    ['NED', 'JPN', 'TUN', 'SWE'], // F
    ['BEL', 'IRN', 'EGY', 'NZL'], // G
    ['ESP', 'URU', 'KSA', 'CPV'], // H
    ['FRA', 'SEN', 'NOR', 'IRQ'], // I
    ['ARG', 'AUT', 'ALG', 'JOR'], // J
    ['POR', 'COL', 'UZB', 'COD'], // K
    ['ENG', 'CRO', 'PAN', 'GHA']  // L
  ];

  function buildGroups(idMatrix) {
    return idMatrix.map(function (ids, i) {
      return {
        name: 'Group ' + GROUP_LETTERS[i],
        letter: GROUP_LETTERS[i],
        teams: ids.map(function (id) { return Teams.byId(id); })
      };
    });
  }

  function officialDraw() {
    return buildGroups(OFFICIAL);
  }

  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor((rng ? rng() : Math.random()) * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  // Pot-seeded random: shuffle each pot, then deal pot[k][i] into group i, pos k.
  function randomDraw(rng) {
    var pots = [shuffle(Teams.pot(1), rng), shuffle(Teams.pot(2), rng),
                shuffle(Teams.pot(3), rng), shuffle(Teams.pot(4), rng)];
    var groups = [];
    for (var g = 0; g < 12; g++) {
      groups.push({
        name: 'Group ' + GROUP_LETTERS[g],
        letter: GROUP_LETTERS[g],
        teams: [pots[0][g], pots[1][g], pots[2][g], pots[3][g]]
      });
    }
    return groups;
  }

  return {
    GROUP_LETTERS: GROUP_LETTERS,
    officialDraw: officialDraw,
    randomDraw: randomDraw
  };
});
