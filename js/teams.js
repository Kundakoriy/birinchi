/*
 * teams.js — the 48 qualified national teams for Penalty Nations 2026.
 *
 * Each team: { id, name, code (ISO 3166-1 alpha-2 for flag-icons), rating, pot }.
 * Ratings are a 0-100 strength estimate used by the AI / keeper / shootout model.
 * `code` drives the real flag via the flag-icons SVG library (fi fi-xx).
 *
 * No FIFA marks, federation crests, or player names are used anywhere.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Teams = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // pot 1 = top seeds (3 hosts + top 9), pots 2-4 by strength band.
  var TEAMS = [
    // Pot 1
    { id: 'MEX', name: 'Mexico', code: 'mx', rating: 79, pot: 1 },
    { id: 'CAN', name: 'Canada', code: 'ca', rating: 76, pot: 1 },
    { id: 'USA', name: 'United States', code: 'us', rating: 77, pot: 1 },
    { id: 'ESP', name: 'Spain', code: 'es', rating: 94, pot: 1 },
    { id: 'ARG', name: 'Argentina', code: 'ar', rating: 93, pot: 1 },
    { id: 'FRA', name: 'France', code: 'fr', rating: 92, pot: 1 },
    { id: 'ENG', name: 'England', code: 'gb-eng', rating: 90, pot: 1 },
    { id: 'BRA', name: 'Brazil', code: 'br', rating: 90, pot: 1 },
    { id: 'POR', name: 'Portugal', code: 'pt', rating: 88, pot: 1 },
    { id: 'NED', name: 'Netherlands', code: 'nl', rating: 87, pot: 1 },
    { id: 'BEL', name: 'Belgium', code: 'be', rating: 84, pot: 1 },
    { id: 'GER', name: 'Germany', code: 'de', rating: 86, pot: 1 },

    // Pot 2
    { id: 'CRO', name: 'Croatia', code: 'hr', rating: 83, pot: 2 },
    { id: 'MAR', name: 'Morocco', code: 'ma', rating: 82, pot: 2 },
    { id: 'COL', name: 'Colombia', code: 'co', rating: 82, pot: 2 },
    { id: 'URU', name: 'Uruguay', code: 'uy', rating: 83, pot: 2 },
    { id: 'SUI', name: 'Switzerland', code: 'ch', rating: 80, pot: 2 },
    { id: 'JPN', name: 'Japan', code: 'jp', rating: 81, pot: 2 },
    { id: 'SEN', name: 'Senegal', code: 'sn', rating: 80, pot: 2 },
    { id: 'IRN', name: 'Iran', code: 'ir', rating: 74, pot: 2 },
    { id: 'KOR', name: 'Korea Republic', code: 'kr', rating: 77, pot: 2 },
    { id: 'ECU', name: 'Ecuador', code: 'ec', rating: 79, pot: 2 },
    { id: 'AUT', name: 'Austria', code: 'at', rating: 78, pot: 2 },
    { id: 'AUS', name: 'Australia', code: 'au', rating: 73, pot: 2 },

    // Pot 3
    { id: 'NOR', name: 'Norway', code: 'no', rating: 80, pot: 3 },
    { id: 'EGY', name: 'Egypt', code: 'eg', rating: 75, pot: 3 },
    { id: 'ALG', name: 'Algeria', code: 'dz', rating: 75, pot: 3 },
    { id: 'SCO', name: 'Scotland', code: 'gb-sct', rating: 74, pot: 3 },
    { id: 'PAR', name: 'Paraguay', code: 'py', rating: 73, pot: 3 },
    { id: 'TUN', name: 'Tunisia', code: 'tn', rating: 72, pot: 3 },
    { id: 'CIV', name: 'Ivory Coast', code: 'ci', rating: 76, pot: 3 },
    { id: 'QAT', name: 'Qatar', code: 'qa', rating: 70, pot: 3 },
    { id: 'KSA', name: 'Saudi Arabia', code: 'sa', rating: 70, pot: 3 },
    { id: 'RSA', name: 'South Africa', code: 'za', rating: 72, pot: 3 },
    { id: 'UZB', name: 'Uzbekistan', code: 'uz', rating: 71, pot: 3 },
    { id: 'PAN', name: 'Panama', code: 'pa', rating: 67, pot: 3 },

    // Pot 4
    { id: 'CZE', name: 'Czechia', code: 'cz', rating: 76, pot: 4 },
    { id: 'BIH', name: 'Bosnia & Herzegovina', code: 'ba', rating: 75, pot: 4 },
    { id: 'SWE', name: 'Sweden', code: 'se', rating: 78, pot: 4 },
    { id: 'TUR', name: 'Türkiye', code: 'tr', rating: 78, pot: 4 },
    { id: 'HAI', name: 'Haiti', code: 'ht', rating: 64, pot: 4 },
    { id: 'CUW', name: 'Curaçao', code: 'cw', rating: 63, pot: 4 },
    { id: 'NZL', name: 'New Zealand', code: 'nz', rating: 66, pot: 4 },
    { id: 'CPV', name: 'Cape Verde', code: 'cv', rating: 67, pot: 4 },
    { id: 'IRQ', name: 'Iraq', code: 'iq', rating: 68, pot: 4 },
    { id: 'JOR', name: 'Jordan', code: 'jo', rating: 67, pot: 4 },
    { id: 'COD', name: 'Congo DR', code: 'cd', rating: 73, pot: 4 },
    { id: 'GHA', name: 'Ghana', code: 'gh', rating: 74, pot: 4 }
  ];

  var BY_ID = {};
  TEAMS.forEach(function (t) { BY_ID[t.id] = t; });

  function byId(id) { return BY_ID[id]; }
  function pot(n) { return TEAMS.filter(function (t) { return t.pot === n; }); }

  return { TEAMS: TEAMS, byId: byId, pot: pot };
});
