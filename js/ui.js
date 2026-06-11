/*
 * ui.js — pure DOM/render helpers for Penalty Cup 26 screens.
 * No game logic here; main.js calls these to build markup.
 */
(function (root) {
  'use strict';

  var Keeper = root.Keeper;

  function el(html) {
    var d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstChild;
  }

  function flag(team, extra) {
    if (!team) return '';
    return '<span class="fi fi-' + team.code + ' flag' + (extra ? ' ' + extra : '') + '"></span>';
  }

  function teamRow(team, opts) {
    opts = opts || {};
    return '<span class="team-chip' + (opts.cls ? ' ' + opts.cls : '') + '">' +
      flag(team) + '<span class="team-name">' + team.name + '</span>' +
      (opts.rating ? '<span class="team-rating">' + team.rating + '</span>' : '') +
      '</span>';
  }

  function stars(n) {
    var s = '';
    for (var i = 0; i < 4; i++) s += '<span class="star' + (i < n ? ' on' : '') + '">★</span>';
    return s;
  }

  function keeperBadge(rating) {
    var b = Keeper.badge(rating);
    return '<div class="keeper-badge band-' + b.stars + '">' +
      '<div class="kb-top">GK ' + rating + '</div>' +
      '<div class="kb-label">' + b.label + '</div>' +
      '<div class="kb-stars">' + stars(b.stars) + '</div></div>';
  }

  // standings: ordered rows; cut = how many qualify (dashed line after)
  function groupTable(group, standings, highlightId, cut) {
    var rows = standings.map(function (r, i) {
      var cls = (r.id === highlightId ? ' me' : '');
      var sep = (cut && i === cut - 1) ? ' qual-cut' : '';
      var team = group.teams.filter(function (t) { return t.id === r.id; })[0];
      return '<tr class="' + cls + sep + '">' +
        '<td class="pos">' + (i + 1) + '</td>' +
        '<td class="tcell">' + flag(team) + '<span>' + r.name + '</span></td>' +
        '<td>' + r.P + '</td>' +
        '<td>' + r.W + '</td><td>' + r.D + '</td><td>' + r.L + '</td>' +
        '<td>' + r.GF + ':' + r.GA + '</td>' +
        '<td class="gd">' + (r.GD > 0 ? '+' : '') + r.GD + '</td>' +
        '<td class="pts">' + r.Pts + '</td></tr>';
    }).join('');
    return '<div class="group-card' + (group.teams.some(function (t) { return t.id === highlightId; }) ? ' my-group' : '') + '">' +
      '<div class="group-title">' + group.name + '</div>' +
      '<table class="group-table"><thead><tr>' +
      '<th>#</th><th class="tcell">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF:GA</th><th>GD</th><th>Pts</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  // bracket: rounds = [ [ {home,away,winner} ] ... ]; names via id->team lookup
  function bracketView(rounds, lookup, playerId, roundNames) {
    var cols = rounds.map(function (round, ri) {
      var matches = round.map(function (m) {
        return bracketMatch(m, lookup, playerId);
      }).join('');
      return '<div class="bracket-col"><div class="bracket-round-name">' +
        (roundNames[ri] || ('Round ' + (ri + 1))) + '</div>' + matches + '</div>';
    }).join('');
    return '<div class="bracket-scroll"><div class="bracket">' + cols + '</div></div>';
  }

  function bracketMatch(m, lookup, playerId) {
    return '<div class="bk-match">' +
      bkTeam(m.home, m.winner, lookup, playerId) +
      bkTeam(m.away, m.winner, lookup, playerId) +
      '</div>';
  }
  function bkTeam(row, winner, lookup, playerId) {
    if (!row) return '<div class="bk-team tbd">—</div>';
    var team = lookup(row.id) || row;
    var won = winner && winner.id === row.id;
    var cls = 'bk-team' + (won ? ' won' : '') + (row.id === playerId ? ' me' : '');
    return '<div class="' + cls + '">' + flag(team) +
      '<span class="bk-name">' + (team.name || row.name) + '</span></div>';
  }

  root.UI = {
    el: el,
    flag: flag,
    teamRow: teamRow,
    stars: stars,
    keeperBadge: keeperBadge,
    groupTable: groupTable,
    bracketView: bracketView
  };
})(typeof self !== 'undefined' ? self : this);
