/*
 * main.js — Penalty Nations 2026 application orchestrator.
 *
 * Owns the screen state machine and the tournament progression that wraps the
 * pure engine (tournament.js): menu -> draw -> group stage -> knockout, with the
 * player's matches played interactively and everything else simulated. On
 * elimination or after the final it always returns to the hub, simulating the
 * remainder and pinning a champion banner.
 */
(function (root) {
  'use strict';

  var Config = root.Config;
  var T = root.Tournament;
  var Teams = root.Teams;
  var Draw = root.Draw;
  var Keeper = root.Keeper;
  var Ads = root.Ads;
  var Sound = root.Sound;
  var UI = root.UI;

  var App = {};
  var S = null; // session state
  var stage = null; // DOM root

  // --------------------------------------------------------------------------
  App.init = function () {
    stage = document.getElementById('stage');
    Ads.init();
    App.showMenu();
  };

  function setScreen(html, cls) {
    stage.className = 'stage ' + (cls || '');
    stage.innerHTML = html;
  }
  function $(sel) { return stage.querySelector(sel); }
  function on(sel, fn) { var e = $(sel); if (e) e.addEventListener('click', function (ev) { Sound.unlock(); Sound.play('click'); fn(ev); }); }
  function lookup(id) { return Teams.byId(id); }

  // ==========================================================================
  // MENU
  // ==========================================================================
  App.showMenu = function () {
    var teamOptions = Teams.TEAMS.slice().sort(function (a, b) {
      return a.name.localeCompare(b.name);
    }).map(function (t) {
      return '<option value="' + t.id + '">' + t.name + ' (' + t.rating + ')</option>';
    }).join('');

    setScreen(
      '<div class="menu">' +
      '<div class="menu-badge">2026 · 48 TEAMS</div>' +
      '<h1 class="title">Penalty<span>Nations</span>2026</h1>' +
      '<p class="subtitle">Every match decided from the spot.</p>' +
      '<div class="panel">' +
        '<label class="field-label">Your team</label>' +
        '<select id="teamSel" class="select">' + teamOptions + '</select>' +
        '<label class="field-label">Draw</label>' +
        '<div class="seg">' +
          '<button class="seg-btn active" data-mode="official">Official draw</button>' +
          '<button class="seg-btn" data-mode="random">Random draw</button>' +
        '</div>' +
        '<button id="playBtn" class="btn btn-gold btn-lg">Enter the tournament</button>' +
      '</div>' +
      '<div class="menu-foot">Swipe to shoot · real flags · IFAB shootout rules</div>' +
      '</div>', 'screen-menu');

    var mode = 'official';
    Array.prototype.forEach.call(stage.querySelectorAll('.seg-btn'), function (b) {
      b.addEventListener('click', function () {
        mode = b.getAttribute('data-mode');
        Sound.play('click');
        Array.prototype.forEach.call(stage.querySelectorAll('.seg-btn'), function (x) { x.classList.remove('active'); });
        b.classList.add('active');
      });
    });
    on('#playBtn', function () {
      App.startTournament(mode, $('#teamSel').value);
    });
  };

  // ==========================================================================
  // TOURNAMENT SETUP
  // ==========================================================================
  App.startTournament = function (mode, teamId) {
    var seed = (Date.now() & 0xffffffff) >>> 0;
    var rng = T.makeRng(seed);
    var groups = mode === 'official' ? Draw.officialDraw() : Draw.randomDraw(rng);
    var playerTeam = Teams.byId(teamId);
    var pgi = -1;
    groups.forEach(function (g, i) {
      if (g.teams.some(function (t) { return t.id === teamId; })) pgi = i;
    });

    S = {
      mode: mode,
      rng: rng,
      groups: groups,
      playerTeam: playerTeam,
      playerGroupIndex: pgi,
      form: { wins: 0, kicksFaced: 0, savesMade: 0 },
      groupResults: groups.map(function () { return []; }),
      matchday: 0,
      groupStageDone: false,
      standingsByGroup: null,
      qualifiers: null,
      bracketRounds: null,
      roundIndex: 0, // 0 = R32 ... 4 = Final
      champion: null,
      playerStatus: 'alive', // alive | eliminated | champion | runnerup
      eliminationRound: null
    };

    App.showHub();
  };

  // ==========================================================================
  // HUB
  // ==========================================================================
  App.showHub = function (opts) {
    opts = opts || {};
    var banner = '';
    if (S.champion) {
      var champ = lookup(S.champion.id);
      banner = '<div class="champ-banner">' + UI.flag(champ) +
        '<div><div class="cb-label">CHAMPIONS</div><div class="cb-name">' + champ.name + '</div></div>' +
        '<div class="cb-trophy">🏆</div></div>';
    }

    var statusLine = hubStatusLine();

    var groupsHtml = S.groups.map(function (g, i) {
      var st = currentStandings(i);
      return UI.groupTable(g, st, S.playerTeam.id, qualCutFor(i));
    }).join('');

    var bracketHtml = S.bracketRounds
      ? UI.bracketView(S.bracketRounds, lookup, S.playerTeam.id, T.ROUND_NAMES)
      : '<div class="bracket-empty">The Round of 32 unlocks once the group stage is complete.</div>';

    var cta = hubCta();

    setScreen(
      banner +
      '<div class="hub">' +
        '<div class="hub-head">' +
          '<div class="hub-title">' + Config.TITLE + '</div>' +
          statusLine +
        '</div>' +
        '<div class="tabs">' +
          '<button class="tab active" data-tab="groups">Groups</button>' +
          '<button class="tab" data-tab="bracket">Bracket</button>' +
        '</div>' +
        '<div class="tab-body" id="tabGroups"><div class="groups-grid">' + groupsHtml + '</div></div>' +
        '<div class="tab-body hidden" id="tabBracket">' + bracketHtml + '</div>' +
        cta +
      '</div>', 'screen-hub');

    Array.prototype.forEach.call(stage.querySelectorAll('.tab'), function (t) {
      t.addEventListener('click', function () {
        Sound.play('click');
        Array.prototype.forEach.call(stage.querySelectorAll('.tab'), function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        var which = t.getAttribute('data-tab');
        $('#tabGroups').classList.toggle('hidden', which !== 'groups');
        $('#tabBracket').classList.toggle('hidden', which !== 'bracket');
      });
    });
    on('#continueBtn', App.continue);
    on('#menuBtn', App.showMenu);

    // scroll my group into view
    var mine = stage.querySelector('.group-card.my-group');
    if (mine && opts.scrollToGroup) mine.scrollIntoView({ block: 'center' });
  };

  function hubStatusLine() {
    if (S.playerStatus === 'champion') return '<div class="hub-status win">You won Penalty Nations 2026! 🏆</div>';
    if (S.playerStatus === 'runnerup') return '<div class="hub-status">Runner-up. So close.</div>';
    if (S.playerStatus === 'eliminated') {
      return '<div class="hub-status out">Eliminated · ' + (S.eliminationRound || 'group stage') + '</div>';
    }
    if (!S.groupStageDone) return '<div class="hub-status">Group stage · Matchday ' + (S.matchday + 1) + ' of 3</div>';
    return '<div class="hub-status">' + (T.ROUND_NAMES[S.roundIndex] || 'Knockouts') + '</div>';
  }

  function hubCta() {
    if (S.playerStatus === 'alive') {
      var label = !S.groupStageDone
        ? 'Play Matchday ' + (S.matchday + 1)
        : 'Play ' + (T.ROUND_NAMES[S.roundIndex] || 'next match');
      return '<button id="continueBtn" class="btn btn-gold btn-lg sticky-cta">' + label + '</button>';
    }
    return '<button id="menuBtn" class="btn btn-ghost btn-lg sticky-cta">New tournament</button>';
  }

  // qualification cut line shown in group tables (top 2 always qualify)
  function qualCutFor(groupIndex) {
    return 2;
  }

  function currentStandings(i) {
    if (S.standingsByGroup) return S.standingsByGroup[i];
    return T.computeStandings(S.groups[i], S.groupResults[i]);
  }

  // ==========================================================================
  // CONTINUE — route to the next player action
  // ==========================================================================
  App.continue = function () {
    if (S.playerStatus !== 'alive') return;
    if (!S.groupStageDone) return App.playGroupMatchday();
    return App.playKnockoutMatch();
  };

  // ----- GROUP STAGE --------------------------------------------------------
  App.playGroupMatchday = function () {
    var gi = S.playerGroupIndex;
    var pid = S.playerTeam.id;
    var split = T.playerMatchday(S.groups[gi], pid, S.matchday);
    var playerFix = split.playerFixture;

    var oppId = playerFix.home === pid ? playerFix.away : playerFix.home;
    var opponent = lookup(oppId);
    App.showMatchPreview({
      opponent: opponent,
      roundLabel: 'Group Stage · Matchday ' + (S.matchday + 1),
      roundIndex: 0,
      mode: 'group',
      onResolve: function (state) {
        // record player's result (player is whichever side they actually were)
        // engine: A = player (always kicks first in our match setup)
        var playerScored = state.a, oppScored = state.b;
        var res = playerFix.home === pid
          ? { home: pid, away: oppId, hg: playerScored, ag: oppScored }
          : { home: oppId, away: pid, hg: oppScored, ag: playerScored };
        S.groupResults[gi].push(res);

        // simulate the rest of this matchday — never the player's own fixture
        simulateMatchday(S.matchday);

        S.matchday++;
        if (S.matchday >= 3) finalizeGroupStage();
        returnToHub();
      }
    });
  };

  // Simulate this matchday's fixtures everywhere EXCEPT the one the player just
  // played. The player's fixture is excluded by team id, so it is never both
  // recorded and simulated (fixes the double-count bug).
  function simulateMatchday(mdIndex) {
    var pid = S.playerTeam.id;
    S.groups.forEach(function (g, gi) {
      T.matchdayFixtures(g)[mdIndex].forEach(function (fix) {
        if (gi === S.playerGroupIndex && (fix.home === pid || fix.away === pid)) return;
        var home = lookup(fix.home), away = lookup(fix.away);
        var r = T.simulateGroupMatch(home, away, S.rng);
        S.groupResults[gi].push({ home: fix.home, away: fix.away, hg: r.a, ag: r.b });
      });
    });
  }

  function finalizeGroupStage() {
    S.standingsByGroup = S.groups.map(function (g, i) {
      return T.computeStandings(g, S.groupResults[i]);
    });
    S.qualifiers = T.determineQualifiers(S.standingsByGroup);
    var bracket = T.buildBracket(S.qualifiers.qualified);
    S.bracket = bracket;
    S.bracketRounds = [bracket.firstRound.map(cloneMatch)];
    S.groupStageDone = true;
    S.roundIndex = 0;

    var qualified = S.qualifiers.qualified.some(function (q) { return q.id === S.playerTeam.id; });
    if (!qualified) {
      S.playerStatus = 'eliminated';
      S.eliminationRound = 'Group stage';
      simulateEntireKnockout();
    }
  }

  // ----- KNOCKOUTS ----------------------------------------------------------
  App.playKnockoutMatch = function () {
    var round = S.bracketRounds[S.roundIndex];
    var pid = S.playerTeam.id;
    var pm = null;
    round.forEach(function (m) {
      if ((m.home && m.home.id === pid) || (m.away && m.away.id === pid)) pm = m;
    });
    if (!pm) { // safety: shouldn't happen while alive
      S.playerStatus = 'eliminated';
      simulateEntireKnockout();
      return returnToHub();
    }
    var playerIsHome = pm.home.id === pid;
    var opponent = playerIsHome ? pm.away : pm.home;
    var isFinal = round.length === 1;

    App.showMatchPreview({
      opponent: opponent,
      roundLabel: T.ROUND_NAMES[S.roundIndex],
      roundIndex: S.roundIndex + 1, // 1-based for keeper sharpness
      mode: 'knockout',
      isFinal: isFinal,
      onResolve: function (state) {
        var playerWon = state.winner === 'A';
        pm.winner = playerWon ? (playerIsHome ? pm.home : pm.away) : (playerIsHome ? pm.away : pm.home);
        // simulate the other matches in this round
        round.forEach(function (m) {
          if (m === pm) return;
          if (m.winner) return;
          var s = T.simulateShootout(m.home, m.away, 'knockout', S.rng);
          m.winner = s.winner === 'A' ? m.home : m.away;
        });

        if (isFinal) {
          S.champion = pm.winner;
          S.playerStatus = playerWon ? 'champion' : 'runnerup';
          return playerWon ? App.showChampion() : App.showRunnerUp();
        }

        // build next round
        var next = [];
        for (var i = 0; i < round.length; i += 2) {
          next.push({ home: round[i].winner, away: round[i + 1].winner });
        }
        S.bracketRounds[S.roundIndex + 1] = next.map(cloneMatch);
        S.roundIndex++;

        if (!playerWon) {
          S.playerStatus = 'eliminated';
          S.eliminationRound = T.ROUND_NAMES[S.roundIndex - 1];
          simulateFromCurrentRound();
          return App.showEliminated();
        }
        returnToHub();
      }
    });
  };

  function cloneMatch(m) {
    return { home: m.home, away: m.away, winner: m.winner || null };
  }

  // simulate every remaining knockout round from the current bracket state
  function simulateFromCurrentRound() {
    var ri = S.roundIndex;
    while (true) {
      var round = S.bracketRounds[ri];
      round.forEach(function (m) {
        if (m.winner) return;
        var s = T.simulateShootout(m.home, m.away, 'knockout', S.rng);
        m.winner = s.winner === 'A' ? m.home : m.away;
      });
      if (round.length === 1) { S.champion = round[0].winner; break; }
      var next = [];
      for (var i = 0; i < round.length; i += 2) next.push({ home: round[i].winner, away: round[i + 1].winner });
      S.bracketRounds[ri + 1] = next.map(cloneMatch);
      ri++;
    }
  }

  function simulateEntireKnockout() {
    S.roundIndex = 0;
    simulateFromCurrentRound();
  }

  // ==========================================================================
  // MATCH PREVIEW
  // ==========================================================================
  App.showMatchPreview = function (cfg) {
    var pTeam = S.playerTeam;
    var keeperP = Keeper.keeperRating(pTeam, cfg.roundIndex, S.form);
    var keeperO = Keeper.keeperRating(cfg.opponent, cfg.roundIndex, null);
    var rule = cfg.mode === 'group'
      ? '5 kicks each · level after 5 is a draw'
      : 'Best of 5 · sudden death if level';

    setScreen(
      '<div class="preview">' +
        '<div class="prev-round">' + cfg.roundLabel + '</div>' +
        '<div class="prev-rule">' + rule + '</div>' +
        '<div class="versus">' +
          '<div class="vs-team">' + UI.flag(pTeam, 'big') + '<div class="vs-name">' + pTeam.name + '</div>' +
            UI.keeperBadge(keeperP) + '</div>' +
          '<div class="vs-mid">VS</div>' +
          '<div class="vs-team">' + UI.flag(cfg.opponent, 'big') + '<div class="vs-name">' + cfg.opponent.name + '</div>' +
            UI.keeperBadge(keeperO) + '</div>' +
        '</div>' +
        '<button id="koBtn" class="btn btn-gold btn-lg">Kick off</button>' +
      '</div>', 'screen-preview');

    on('#koBtn', function () {
      App.startShootout({
        opponent: cfg.opponent,
        mode: cfg.mode,
        roundIndex: cfg.roundIndex,
        keeperP: keeperP,
        keeperO: keeperO,
        roundLabel: cfg.roundLabel,
        isFinal: cfg.isFinal,
        onResolve: cfg.onResolve
      });
    });
  };

  // ==========================================================================
  // SHOOTOUT
  // ==========================================================================
  App.startShootout = function (cfg) {
    setScreen(
      '<div class="match">' +
        '<div class="match-top">' +
          '<div class="mt-team"><span>' + UI.flag(S.playerTeam) + ' ' + S.playerTeam.name + '</span>' +
            '<span class="mt-score" id="scoreA">0</span></div>' +
          '<div class="mt-vs">' + cfg.roundLabel + '</div>' +
          '<div class="mt-team"><span class="mt-score" id="scoreB">0</span>' +
            '<span>' + cfg.opponent.name + ' ' + UI.flag(cfg.opponent) + '</span></div>' +
        '</div>' +
        '<div class="kick-dots" id="kickDots"></div>' +
        '<canvas id="pitch" class="pitch"></canvas>' +
      '</div>', 'screen-match');

    Ads.gameplayStart();
    var canvas = $('#pitch');
    var allowRetake = Config.ADS_ENABLED; // rewarded retake available

    var m = new root.ShootoutMatch({
      canvas: canvas,
      teamA: S.playerTeam,
      teamB: cfg.opponent,
      mode: cfg.mode,
      roundIndex: cfg.roundIndex || 0,
      keeperA: cfg.keeperP,
      keeperB: cfg.keeperO,
      allowRetake: allowRetake,
      isFinalKickPotential: !!cfg.isFinal,
      rng: S.rng,
      onUpdate: function (state) {
        $('#scoreA').textContent = state.a;
        $('#scoreB').textContent = state.b;
        renderDots(state);
      },
      onKickResult: function (info) {
        // track player keeper form (opponent kicking at us); the outcome label
        // is drawn on the canvas by the match itself.
        if (info.side === 'B') {
          S.form.kicksFaced++;
          if (info.result === 'save') S.form.savesMade++;
        }
      },
      onRetakeOffer: function (retakeCb) {
        showRetakeOffer(retakeCb);
      },
      onWinningKick: function () {
        document.body.classList.add('slowmo');
        setTimeout(function () { document.body.classList.remove('slowmo'); }, 1500);
      },
      onEnd: function (state) {
        Ads.gameplayStop();
        m.destroy();
        var playerWon = state.winner === 'A';
        if (state.winner === 'draw') {} else if (playerWon) S.form.wins++;
        App.showMatchResult(state, cfg);
      }
    });
    m.start();
  };

  function renderDots(state) {
    var a = [], b = [];
    state.history.forEach(function (h) {
      var d = '<span class="dot ' + (h.scored ? 'sc' : 'ms') + '"></span>';
      if (h.team === 'A') a.push(d); else b.push(d);
    });
    var el = $('#kickDots');
    if (el) el.innerHTML = '<div class="dot-row">' + a.join('') + '</div><div class="dot-row b">' + b.join('') + '</div>';
  }

  function showRetakeOffer(retakeCb) {
    var overlay = UI.el(
      '<div class="overlay"><div class="overlay-card">' +
      '<div class="ov-title">Missed!</div>' +
      '<div class="ov-text">Watch a short ad to retake this kick? (once per match)</div>' +
      '<button class="btn btn-gold" id="ovRetake">▶ Watch &amp; retake</button>' +
      '<button class="btn btn-ghost" id="ovSkip">No thanks</button>' +
      '</div></div>');
    stage.appendChild(overlay);
    overlay.querySelector('#ovRetake').addEventListener('click', function () {
      Sound.play('click');
      Ads.showRewarded(function (granted) {
        overlay.remove();
        retakeCb(granted);
      });
    });
    overlay.querySelector('#ovSkip').addEventListener('click', function () {
      Sound.play('click');
      overlay.remove();
      retakeCb(false);
    });
  }

  // ==========================================================================
  // RESULTS
  // ==========================================================================
  App.showMatchResult = function (state, cfg) {
    var playerWon = state.winner === 'A';
    var draw = state.winner === 'draw';
    var head = draw ? 'DRAW' : playerWon ? 'WIN' : 'DEFEAT';
    Sound.play(playerWon ? 'win' : draw ? 'whistle' : 'lose');

    setScreen(
      '<div class="result ' + (playerWon ? 'res-win' : draw ? 'res-draw' : 'res-loss') + '">' +
        '<div class="res-head">' + head + '</div>' +
        '<div class="res-score">' + state.a + ' – ' + state.b + '</div>' +
        '<div class="res-teams">' + UI.flag(S.playerTeam) + ' ' + S.playerTeam.name +
          '  vs  ' + cfg.opponent.name + ' ' + UI.flag(cfg.opponent) + '</div>' +
        '<button id="afterMatch" class="btn btn-gold btn-lg">Continue</button>' +
      '</div>', 'screen-result');

    on('#afterMatch', function () { cfg.onResolve(state); });
  };

  // return to hub with an interstitial between rounds
  function returnToHub() {
    Ads.showInterstitial().then(function () {
      App.showHub({ scrollToGroup: true });
    });
  }

  App.showEliminated = function () {
    setScreen(
      '<div class="endscreen elim">' +
        '<div class="end-emoji">🥲</div>' +
        '<div class="end-head">Eliminated</div>' +
        '<div class="end-sub">' + S.playerTeam.name + ' are out · ' + (S.eliminationRound || 'group stage') + '</div>' +
        '<div class="end-note">We\'ll play out the rest of Penalty Nations 2026 for you.</div>' +
        '<button id="toHub" class="btn btn-gold btn-lg">See how it ends</button>' +
      '</div>', 'screen-end');
    on('#toHub', returnToHub);
  };

  App.showChampion = function () {
    Sound.play('win');
    setScreen(
      '<div class="endscreen champ">' +
        '<div class="confetti"></div>' +
        '<div class="trophy-big">🏆</div>' +
        '<div class="end-head gold">CHAMPIONS</div>' +
        '<div class="end-sub">' + UI.flag(S.playerTeam, 'big') + ' ' + S.playerTeam.name +
          ' win Penalty Nations 2026!</div>' +
        '<button id="toHub" class="btn btn-gold btn-lg">Lift the trophy</button>' +
      '</div>', 'screen-end');
    on('#toHub', returnToHub);
  };

  App.showRunnerUp = function () {
    Sound.play('lose');
    var champ = lookup(S.champion.id);
    setScreen(
      '<div class="endscreen runnerup">' +
        '<div class="trophy-big dim">🏆</div>' +
        '<div class="end-head">Runner-up</div>' +
        '<div class="end-sub">' + UI.flag(champ, 'big') + ' ' + champ.name + ' lift the trophy.</div>' +
        '<div class="end-note">' + S.playerTeam.name + ' fell at the final hurdle.</div>' +
        '<button id="toHub" class="btn btn-gold btn-lg">Back to the hub</button>' +
      '</div>', 'screen-end');
    on('#toHub', returnToHub);
  };

  root.App = App;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', App.init);
  } else {
    App.init();
  }
})(typeof self !== 'undefined' ? self : this);
