/*
 * game.js — the interactive penalty shootout (canvas).
 *
 * Two-sided: on ATTACK you drag from the ball to aim (direction + power) and
 * release to shoot at a continuous goal area; on DEFENCE you pick which third
 * the keeper dives (tap L / C / R, or drag) against a short timer. The goal mouth
 * is split into Left/Centre/Right thirds — a save needs the keeper committed to
 * the same third as the shot, and corner placement beats the keeper.
 *
 * Difficulty magnitudes all live in Config.TUNING (see config.js). No SDK calls
 * here — rewarded-ad retakes are delegated to a callback.
 */
(function (root) {
  'use strict';

  var T = root.Tournament;
  var Keeper = root.Keeper;
  var Sound = root.Sound;

  // normalized x-centre of each third in goal space (-1..1)
  var THIRD_X = { L: -0.6, C: 0, R: 0.6 };

  // Map a continuous dive x (0..1, left->right) to the nearest available sprite
  // pose. Height does not change the sprite (only 3 dive sprites + centre); the
  // continuous (kx,ky) is honoured by translating the sprite to the real point.
  function poseForKx(kx) {
    return kx < 0.4 ? 'L' : kx > 0.6 ? 'R' : 'C';
  }

  function ShootoutMatch(opts) {
    this.canvas = opts.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.teamA = opts.teamA;       // player's team
    this.teamB = opts.teamB;       // opponent
    this.mode = opts.mode;         // 'group' | 'knockout'
    this.roundIndex = opts.roundIndex || 0;
    this.keeperA = opts.keeperA;   // player's keeper rating (defends B's kicks)
    this.keeperB = opts.keeperB;   // opponent keeper rating (defends A's kicks)
    this.allowRetake = !!opts.allowRetake;
    this.isFinalKickPotential = !!opts.isFinalKickPotential;

    this.onUpdate = opts.onUpdate || function () {};
    this.onKickResult = opts.onKickResult || function () {};
    this.onRetakeOffer = opts.onRetakeOffer || null;
    this.onEnd = opts.onEnd || function () {};
    this.onWinningKick = opts.onWinningKick || null;

    this.rng = opts.rng || Math.random;
    this.state = T.newShootout(this.mode);
    this.retakeUsed = false;

    this.phase = 'idle';
    this.shake = 0;
    this.timeScale = 1;
    this.banner = null; // {text, good, until}

    this._raf = null;
    this._anim = null;
    this._drag = null;
    this._dragging = false;
    this._lastTs = 0;
    this._trail = [];
    this._keeper = { pose: 'ready', t: 0, kit: 'opp' }; // current keeper render state
    this._diveDeadline = 0;
    this._diveTimer = null;

    this._bindInput();
    this._resize();
  }

  ShootoutMatch.prototype.start = function () {
    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
    this._nextTurn();
  };

  ShootoutMatch.prototype.destroy = function () {
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._diveTimer) clearTimeout(this._diveTimer);
    this._unbindInput();
  };

  // --- geometry --------------------------------------------------------------
  ShootoutMatch.prototype._resize = function () {
    var dpr = root.devicePixelRatio || 1;
    var rect = this.canvas.getBoundingClientRect();
    this.W = rect.width;
    this.H = rect.height;
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.goal = {
      left: this.W * 0.12,
      right: this.W * 0.88,
      top: this.H * 0.16,
      line: this.H * 0.50
    };
    this.goal.width = this.goal.right - this.goal.left;
    this.goal.height = this.goal.line - this.goal.top;
    // Ball size from real-world proportion vs the goal mouth height (so the
    // sprite and the interactive ball share one believable scale).
    var ballRatio = (root.Config.TUNING && root.Config.TUNING.BALL_DIAMETER_RATIO) || 0.09;
    this.ballR = Math.max(10, ballRatio * this.goal.height / 2);
    this.ballHome = { x: this.W * 0.5, y: this.H * 0.86 };
    this.ball = { x: this.ballHome.x, y: this.ballHome.y, rot: 0 };
    this.maxDrag = this.H * 0.30;
  };

  ShootoutMatch.prototype._goalPoint = function (sx, sy) {
    var g = this.goal;
    return {
      x: (g.left + g.right) / 2 + sx * (g.width / 2),
      y: g.line - sy * g.height
    };
  };

  // Same mapping but from normalized goal space gx,gy in [0,1] (left->right,
  // bottom->top) — the space the geometric resolution works in.
  ShootoutMatch.prototype._goalPointN = function (gx, gy) {
    return this._goalPoint(gx * 2 - 1, gy);
  };

  // --- input -----------------------------------------------------------------
  ShootoutMatch.prototype._bindInput = function () {
    var self = this;
    this._onDown = function (e) { self._pointerDown(e); };
    this._onMove = function (e) { self._pointerMove(e); };
    this._onUp = function (e) { self._pointerUp(e); };
    this._onResize = function () { self._resize(); };
    this.canvas.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
    window.addEventListener('resize', this._onResize);
  };
  ShootoutMatch.prototype._unbindInput = function () {
    this.canvas.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    window.removeEventListener('resize', this._onResize);
  };
  ShootoutMatch.prototype._evtPoint = function (e) {
    var rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  ShootoutMatch.prototype._pointerDown = function (e) {
    Sound && Sound.unlock && Sound.unlock();
    if (this.phase === 'aim') {
      var p = this._evtPoint(e);
      if (Math.hypot(p.x - this.ball.x, p.y - this.ball.y) > this.ballR * 4) return;
      this._dragging = true;
      this._drag = p;
    } else if (this.phase === 'dive') {
      // Continuous dive: tap anywhere in the goal mouth to choose (kx,ky).
      var q = this._evtPoint(e);
      var g = this.goal;
      var kx = T.clamp((q.x - g.left) / g.width, 0, 1);
      var ky = T.clamp((g.line - q.y) / g.height, 0, 1);
      this._commitDefense({ kx: kx, ky: ky });
    }
  };
  ShootoutMatch.prototype._pointerMove = function (e) {
    if (this._dragging) this._drag = this._evtPoint(e);
  };
  ShootoutMatch.prototype._pointerUp = function () {
    if (!this._dragging) return;
    this._dragging = false;
    this._fireFromDrag();
  };

  ShootoutMatch.prototype._dragToAim = function () {
    var dx = this._drag.x - this.ballHome.x;
    var dyUp = this.ballHome.y - this._drag.y;
    var dist = Math.min(Math.hypot(dx, dyUp), this.maxDrag);
    return {
      x: T.clamp(dx / (this.W * 0.34), -1, 1),
      y: T.clamp((dyUp - this.maxDrag * 0.10) / (this.maxDrag * 0.85), 0, 1),
      power: T.clamp(dist / this.maxDrag, 0.2, 1),
      dyUp: dyUp
    };
  };

  ShootoutMatch.prototype._fireFromDrag = function () {
    var a = this._dragToAim();
    if (a.dyUp < this.maxDrag * 0.12) { this._drag = null; return; } // too small, ignore
    this._drag = null;
    this._playerShoot({ x: a.x, y: a.y, power: a.power });
  };

  // --- turn flow -------------------------------------------------------------
  ShootoutMatch.prototype._nextTurn = function () {
    if (T.isComplete(this.state)) { this._finish(); return; }
    this.onUpdate(this.state);
    this._trail = [];
    this.ball = { x: this.ballHome.x, y: this.ballHome.y, rot: 0 };
    if (this.state.turn === 'A') {
      this.phase = 'aim';
      this._keeper = { pose: 'ready', t: 0, kit: 'opp' };
    } else {
      this._beginDefense();
    }
  };

  // ===== ATTACK ==============================================================
  ShootoutMatch.prototype._resolvePlayerShot = function (shot) {
    var t = root.Config.TUNING;
    // Miss only on genuinely extreme swipes.
    if (Math.abs(shot.x) > t.MISS_EDGE_X) {
      var pw = t.MISS_MAX_CHANCE * (Math.abs(shot.x) - t.MISS_EDGE_X) / (1 - t.MISS_EDGE_X);
      if (this.rng() < pw) {
        return { result: 'wide', target: { x: shot.x + (shot.x >= 0 ? 0.22 : -0.22), y: shot.y } };
      }
    }
    if (shot.y > t.MISS_HIGH_Y) {
      var po = t.MISS_MAX_CHANCE * (shot.y - t.MISS_HIGH_Y) / (1 - t.MISS_HIGH_Y);
      if (this.rng() < po) {
        return { result: 'over', target: { x: shot.x, y: shot.y + 0.25 } };
      }
    }
    // Woodwork.
    if (Math.abs(shot.x) > 0.88 && this.rng() < t.POST_CHANCE) {
      return { result: 'post', target: { x: shot.x * 0.97, y: shot.y } };
    }
    // Geometric resolution: the keeper predicts a continuous dive point and the
    // shot is SAVED iff that point is within reach of the shot. Pure geometry —
    // the ball ends at (gx,gy) and the keeper ends at (kx,ky), so the visual
    // always matches the verdict.
    var gx = (shot.x + 1) / 2, gy = shot.y;
    var dive = Keeper.predictDive({ gx: gx, gy: gy }, this.keeperB, this.roundIndex, this.rng);
    var reach = Keeper.keeperReach(this.keeperB, this.roundIndex);
    var saved = T.isSaved({ gx: gx, gy: gy }, dive, reach);
    return {
      result: saved ? 'save' : 'goal',
      target: { x: shot.x, y: shot.y },
      dive: dive // {kx, ky} in normalized goal space
    };
  };

  ShootoutMatch.prototype._playerShoot = function (shot) {
    var self = this;
    var info = this._resolvePlayerShot(shot);
    this.phase = 'flying';
    Sound && Sound.play('kick');
    var to = this._goalPoint(info.target.x, info.target.y);
    var dur = 430 / this.timeScale;

    // The keeper ends exactly at its dive point (kx,ky). On a save that point is
    // within reach of the shot, so keeper and ball visually meet.
    var dive = info.dive || { kx: 0.5, ky: root.Config.TUNING.KEEPER_REST_Y };
    var diveTo = this._goalPointN(dive.kx, dive.ky);
    this._keeper = { pose: poseForKx(dive.kx), t: 0, kit: 'opp', toX: diveTo.x, toY: diveTo.y };
    this._animKeeper(dur);

    this._animateBall(to, dur, function () {
      self._applyResult('A', info, shot);
    });
  };

  // ===== DEFENCE (you pick the dive) =========================================
  ShootoutMatch.prototype._beginDefense = function () {
    var self = this;
    // AI opponent picks a shot: stronger teams aim corners more.
    var skill = (this.teamB.rating - 50) / 49;
    var aimCorner = this.rng() < (0.45 + skill * 0.4);
    var third = ['L', 'C', 'R'][Math.floor(this.rng() * 3)];
    if (!aimCorner) third = this.rng() < 0.5 ? 'C' : third;
    var sx = THIRD_X[third] + (this.rng() * 0.2 - 0.1);
    var sy = aimCorner ? (0.45 + this.rng() * 0.4) : (0.15 + this.rng() * 0.4);
    this._oppShot = { x: T.clamp(sx, -0.95, 0.95), y: T.clamp(sy, 0, 0.98) };

    this.phase = 'dive';
    this._keeper = { pose: 'ready', t: 0, kit: 'mine' };
    this._diveDeadline = (root.performance ? performance.now() : Date.now()) + root.Config.TUNING.DIVE_TIMER_MS;
    if (this._diveTimer) clearTimeout(this._diveTimer);
    this._diveTimer = setTimeout(function () {
      // No dive picked in time -> a hesitant, centralish guess.
      if (self.phase === 'dive') {
        self._commitDefense({ kx: 0.3 + self.rng() * 0.4, ky: self.rng() * 0.5 });
      }
    }, root.Config.TUNING.DIVE_TIMER_MS);
  };

  // dive = {kx, ky} continuous point the player chose to dive to. Same geometric
  // check as attack: SAVE iff the dive point is within the keeper's reach of the
  // opponent's shot.
  ShootoutMatch.prototype._commitDefense = function (dive) {
    if (this.phase !== 'dive') return;
    if (this._diveTimer) { clearTimeout(this._diveTimer); this._diveTimer = null; }
    var self = this;
    var opp = this._oppShot;
    var ogx = (opp.x + 1) / 2, ogy = opp.y;
    var reach = Keeper.keeperReach(this.keeperA, this.roundIndex);
    var saved = T.isSaved({ gx: ogx, gy: ogy }, dive, reach);
    var info = { result: saved ? 'save' : 'goal', target: { x: opp.x, y: opp.y }, dive: dive };

    this.phase = 'oppflying';
    Sound && Sound.play('kick');
    var to = this._goalPoint(opp.x, opp.y);
    var diveTo = this._goalPointN(dive.kx, dive.ky);
    this._keeper = { pose: poseForKx(dive.kx), t: 0, kit: 'mine', toX: diveTo.x, toY: diveTo.y };
    var dur = 560; // compressed
    this._animKeeper(dur);
    this._animateBall(to, dur, function () {
      self._applyResult('B', info, opp);
    });
  };

  // ===== result handling =====================================================
  ShootoutMatch.prototype._applyResult = function (side, info, shot) {
    var self = this;
    this.phase = 'result';
    var scored = info.result === 'goal';

    if (info.result === 'goal') { Sound && Sound.play('goal'); this._netRipple = 1; }
    else if (info.result === 'save') { Sound && Sound.play('save'); this.shake = 0.8; }
    else if (info.result === 'post') { Sound && Sound.play('post'); this.shake = 1; }
    else { Sound && Sound.play('miss'); }

    this.banner = { text: this._label(side, info.result), good: side === 'A' ? scored : !scored, until: 0 };
    this.onKickResult({ side: side, result: info.result, scored: scored, state: this.state });

    var commit = function () {
      self.banner = null;
      if (side === 'A' && scored && self._wouldWinTournament()) {
        self.timeScale = 0.35;
        if (self.onWinningKick) self.onWinningKick();
      }
      T.recordKick(self.state, scored);
      self.timeScale = 1;
      setTimeout(function () { self._nextTurn(); }, 250);
    };

    // Rewarded-ad retake: player only, FAILED kick, once per match.
    if (side === 'A' && !scored && this.allowRetake && !this.retakeUsed && this.onRetakeOffer) {
      this.phase = 'paused';
      setTimeout(function () {
        self.onRetakeOffer(function (granted) {
          self.banner = null;
          if (granted) {
            self.retakeUsed = true;
            self._trail = [];
            self.ball = { x: self.ballHome.x, y: self.ballHome.y, rot: 0 };
            self._keeper = { pose: 'ready', t: 0, kit: 'opp' };
            self.phase = 'aim'; // shoot again WITHOUT recording the miss
          } else { commit(); }
        });
      }, 800); // brief freeze so the miss reads first
      return;
    }
    setTimeout(commit, 850); // freeze on the result so it reads
  };

  ShootoutMatch.prototype._label = function (side, result) {
    if (result === 'goal') return side === 'A' ? 'GOAL!' : 'CONCEDED';
    if (result === 'save') return side === 'A' ? 'SAVED!' : 'SAVED!';
    if (result === 'post') return 'OFF THE POST!';
    if (result === 'wide') return 'MISS — WIDE';
    if (result === 'over') return 'MISS — OVER THE BAR';
    return '';
  };

  ShootoutMatch.prototype._wouldWinTournament = function () {
    if (!this.isFinalKickPotential) return false;
    var s = this.state;
    if (s.mode !== 'knockout') return false;
    var remB = Math.max(0, 5 - s.kb);
    if (s.phase === 'active') return (s.a + 1) > s.b + remB;
    return false;
  };

  ShootoutMatch.prototype._finish = function () {
    this.phase = 'done';
    this.onUpdate(this.state);
    this.onEnd(this.state);
  };

  // --- animation -------------------------------------------------------------
  ShootoutMatch.prototype._animateBall = function (to, dur, done) {
    this._anim = { from: { x: this.ball.x, y: this.ball.y }, to: to, dur: dur, t: 0, done: done };
  };
  ShootoutMatch.prototype._animKeeper = function (dur) {
    this._keeperAnim = { dur: dur * 0.85, t: 0 };
  };

  ShootoutMatch.prototype._loop = function (ts) {
    var dt = this._lastTs ? (ts - this._lastTs) : 16;
    this._lastTs = ts;
    dt *= this.timeScale;

    if (this._anim) {
      this._anim.t += dt;
      var k = T.clamp(this._anim.t / this._anim.dur, 0, 1);
      var e = 1 - Math.pow(1 - k, 2);
      var px = this.ball.x, py = this.ball.y;
      this.ball.x = this._anim.from.x + (this._anim.to.x - this._anim.from.x) * e;
      this.ball.y = this._anim.from.y + (this._anim.to.y - this._anim.from.y) * e;
      var moved = Math.hypot(this.ball.x - px, this.ball.y - py);
      this.ball.rot += moved * 0.04;
      this._trail.push({ x: this.ball.x, y: this.ball.y });
      if (this._trail.length > 14) this._trail.shift();
      if (k >= 1) { var d = this._anim.done; this._anim = null; d && d(); }
    }
    if (this._keeperAnim) {
      this._keeperAnim.t += dt;
      this._keeper.t = T.clamp(this._keeperAnim.t / this._keeperAnim.dur, 0, 1);
      if (this._keeper.t >= 1) this._keeperAnim = null;
    }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt / 260);
    if (this._netRipple > 0) this._netRipple = Math.max(0, this._netRipple - dt / 500);

    this._render();
    this._raf = requestAnimationFrame(this._loop);
  };

  // --- rendering -------------------------------------------------------------
  ShootoutMatch.prototype._render = function () {
    var c = this.ctx, W = this.W, H = this.H, g = this.goal;
    c.save();
    if (this.shake > 0) {
      var s = this.shake * 9;
      c.translate((Math.random() * 2 - 1) * s, (Math.random() * 2 - 1) * s);
    }

    // pitch-night background
    var bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#07251a');
    bg.addColorStop(0.45, '#0a2c1c');
    bg.addColorStop(1, '#05140d');
    c.fillStyle = bg;
    c.fillRect(-30, -30, W + 60, H + 60);

    // pitch mow stripes below the line
    for (var i = 0; i < 8; i++) {
      c.fillStyle = i % 2 ? 'rgba(255,255,255,0.018)' : 'rgba(0,0,0,0.05)';
      c.fillRect(0, g.line + i * (H - g.line) / 8, W, (H - g.line) / 8 + 1);
    }
    // penalty spot
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.beginPath(); c.arc(this.ballHome.x, this.ballHome.y + this.ballR * 1.6, 3, 0, 7); c.fill();

    this._drawGoal(c, g);
    if (this.phase === 'aim' || this.phase === 'dive') this._drawThirds(c, g);

    this._drawKeeper(c, g);

    // ball trail
    for (var ti = 0; ti < this._trail.length; ti++) {
      var pt = this._trail[ti];
      var a = (ti / this._trail.length) * 0.4;
      c.fillStyle = 'rgba(255,255,255,' + a + ')';
      c.beginPath(); c.arc(pt.x, pt.y, this.ballR * (0.4 + 0.5 * ti / this._trail.length), 0, 7); c.fill();
    }

    if (this.phase === 'aim' && this._dragging && this._drag) this._drawAim(c);

    this._drawBall(c, this.ball.x, this.ball.y, this.ballR, this.ball.rot);
    c.restore();

    // overlays (not shaken)
    if (this.phase === 'dive') this._drawDivePrompt(c);
    if (this.banner) this._drawBanner(c);
    this._drawHint(c);
  };

  ShootoutMatch.prototype._drawGoal = function (c, g) {
    // net
    c.save();
    c.strokeStyle = 'rgba(255,255,255,0.13)';
    c.lineWidth = 1;
    var cols = 16, rows = 9, rip = this._netRipple || 0;
    for (var i = 0; i <= cols; i++) {
      var x = g.left + g.width * (i / cols);
      c.beginPath(); c.moveTo(x, g.top); c.lineTo(x, g.line); c.stroke();
    }
    for (var j = 0; j <= rows; j++) {
      var y = g.top + g.height * (j / rows) - rip * 4 * Math.sin(j);
      c.beginPath(); c.moveTo(g.left, y); c.lineTo(g.right, y); c.stroke();
    }
    c.restore();
    // frame: posts + crossbar with subtle 3D
    var lw = Math.max(5, this.W * 0.016);
    c.lineCap = 'round';
    c.strokeStyle = '#eef2f0';
    c.lineWidth = lw;
    c.beginPath();
    c.moveTo(g.left, g.line); c.lineTo(g.left, g.top);
    c.lineTo(g.right, g.top); c.lineTo(g.right, g.line);
    c.stroke();
    c.strokeStyle = 'rgba(0,0,0,0.25)';
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(g.left + lw / 2, g.top + lw / 2); c.lineTo(g.right - lw / 2, g.top + lw / 2); c.stroke();
  };

  // faint vertical bands marking the three target thirds
  ShootoutMatch.prototype._drawThirds = function (c, g) {
    c.save();
    var third = g.width / 3;
    for (var i = 0; i < 3; i++) {
      c.fillStyle = i === 1 ? 'rgba(247,201,72,0.05)' : 'rgba(247,201,72,0.08)';
      c.fillRect(g.left + i * third, g.top, third, g.height);
      c.strokeStyle = 'rgba(247,201,72,0.18)';
      c.lineWidth = 1;
      c.strokeRect(g.left + i * third + 1, g.top + 1, third - 2, g.height - 2);
    }
    c.restore();
  };

  ShootoutMatch.prototype._drawAim = function (c) {
    var a = this._dragToAim();
    var tgt = this._goalPoint(a.x, a.y);
    var bx = this.ballHome.x, by = this.ballHome.y;
    // trajectory arrow (slight arc)
    c.save();
    c.strokeStyle = 'rgba(247,201,72,0.9)';
    c.lineWidth = 4; c.lineCap = 'round';
    var midx = (bx + tgt.x) / 2, midy = (by + tgt.y) / 2 - 40;
    c.beginPath();
    c.moveTo(bx, by);
    c.quadraticCurveTo(midx, midy, tgt.x, tgt.y);
    c.stroke();
    // arrowhead
    var ang = Math.atan2(tgt.y - midy, tgt.x - midx);
    c.fillStyle = 'rgba(247,201,72,0.95)';
    c.beginPath();
    c.moveTo(tgt.x, tgt.y);
    c.lineTo(tgt.x - 14 * Math.cos(ang - 0.4), tgt.y - 14 * Math.sin(ang - 0.4));
    c.lineTo(tgt.x - 14 * Math.cos(ang + 0.4), tgt.y - 14 * Math.sin(ang + 0.4));
    c.closePath(); c.fill();
    // reticle
    c.strokeStyle = 'rgba(247,201,72,0.95)'; c.lineWidth = 2.5;
    c.beginPath(); c.arc(tgt.x, tgt.y, 15, 0, 7); c.stroke();
    c.beginPath(); c.moveTo(tgt.x - 22, tgt.y); c.lineTo(tgt.x + 22, tgt.y);
    c.moveTo(tgt.x, tgt.y - 22); c.lineTo(tgt.x, tgt.y + 22); c.stroke();
    c.restore();
    // power bar
    this._drawPowerBar(c, a.power);
  };

  ShootoutMatch.prototype._drawPowerBar = function (c, pow) {
    var W = this.W, H = this.H, bw = W * 0.5, bh = 9, bx = (W - bw) / 2, by = H * 0.945;
    c.fillStyle = 'rgba(0,0,0,0.4)'; c.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
    c.fillStyle = 'rgba(255,255,255,0.15)'; c.fillRect(bx, by, bw, bh);
    c.fillStyle = pow > 0.88 ? '#ff5a5a' : '#f7c948';
    c.fillRect(bx, by, bw * pow, bh);
  };

  // --- ball ------------------------------------------------------------------
  // Sprite ball: draw ball.png with the existing spin + ground shadow. Falls
  // back to the path-drawn ball if the sprite failed to load.
  ShootoutMatch.prototype._drawBall = function (c, x, y, r, rot) {
    var img = root.Sprites && root.Sprites.get('ball');
    if (!img) return this._drawBallPath(c, x, y, r, rot);
    c.save();
    // ground shadow
    c.fillStyle = 'rgba(0,0,0,0.28)';
    c.beginPath(); c.ellipse(x, y + r * 0.92, r * 0.95, r * 0.32, 0, 0, 7); c.fill();
    // spin around the ball centre; the sprite is square so rotation is clean
    c.translate(x, y);
    c.rotate(rot || 0);
    c.drawImage(img, -r, -r, r * 2, r * 2);
    c.restore();
  };

  // Fallback: original path-drawn ball (kept intact).
  ShootoutMatch.prototype._drawBallPath = function (c, x, y, r, rot) {
    c.save();
    // ground shadow
    c.fillStyle = 'rgba(0,0,0,0.28)';
    c.beginPath(); c.ellipse(x, y + r * 0.92, r * 0.95, r * 0.32, 0, 0, 7); c.fill();

    c.translate(x, y);
    c.rotate(rot || 0);
    // base sphere with shading
    var grad = c.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.2, 0, 0, r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.75, '#eef0f2');
    grad.addColorStop(1, '#c7ccd1');
    c.fillStyle = grad;
    c.beginPath(); c.arc(0, 0, r, 0, 7); c.fill();
    c.lineWidth = 1.5; c.strokeStyle = 'rgba(0,0,0,0.25)';
    c.beginPath(); c.arc(0, 0, r, 0, 7); c.stroke();

    // classic black pentagon panels: one centre + five around
    c.fillStyle = '#14181c';
    drawPentagon(c, 0, 0, r * 0.34, -Math.PI / 2);
    for (var k = 0; k < 5; k++) {
      var ang = -Math.PI / 2 + k * (Math.PI * 2 / 5);
      var px = Math.cos(ang) * r * 0.62, py = Math.sin(ang) * r * 0.62;
      drawPentagon(c, px, py, r * 0.20, ang + Math.PI);
    }
    // glossy highlight
    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.beginPath(); c.ellipse(-r * 0.35, -r * 0.4, r * 0.3, r * 0.18, -0.6, 0, 7); c.fill();
    c.restore();
  };

  function drawPentagon(c, cx, cy, rad, rot) {
    c.beginPath();
    for (var i = 0; i < 5; i++) {
      var a = rot + i * (Math.PI * 2 / 5);
      var x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.closePath(); c.fill();
  }

  // --- keeper ----------------------------------------------------------------
  // Map the continuous dive point to the nearest sprite (no new state machine):
  //   ready -> keeper-ready, L -> keeper-dive-left, R -> keeper-dive-right,
  //   C -> keeper-center. Sized by real-world proportion: one shared scale is
  //   derived so the STANDING keeper is KEEPER_HEIGHT_RATIO of the goal mouth
  //   height; every sprite keeps its own aspect (dives render wide/short).
  //   The sprite is translated toward the REAL (kx,ky) dive point so it visually
  //   lands where it mathematically defends. Falls back to the path-drawn keeper
  //   if a needed sprite failed to load.
  var KEEPER_SPRITE = { ready: 'keeperReady', L: 'keeperDiveLeft', R: 'keeperDiveRight', C: 'keeperCenter' };

  ShootoutMatch.prototype._drawKeeper = function (c, g) {
    var Sprites = root.Sprites;
    var k = this._keeper;
    var pose = (k.pose === 'L' || k.pose === 'R' || k.pose === 'C') ? k.pose : 'ready';
    var img = Sprites && Sprites.get(KEEPER_SPRITE[pose]);
    var ref = Sprites && Sprites.get('keeperReady'); // standing reference for scale
    if (!img || !ref) return this._drawKeeperPath(c, g);

    var ratio = root.Config.TUNING.KEEPER_HEIGHT_RATIO || 0.76;
    var scale = (ratio * g.height) / ref.height; // shared metres-per-source-pixel
    var w = img.width * scale, h = img.height * scale;

    // Centre the sprite on the dive point. Idle = standing on the line; as the
    // dive plays out (prog 0->1) the sprite slides to the continuous (kx,ky)
    // canvas point, so it covers exactly where it defends — including the top
    // corners and centre.
    var baseX = (g.left + g.right) / 2;
    var idleCx = baseX, idleCy = g.line - h * 0.5;
    var prog = (pose === 'ready') ? 0 : (k.t || 0);
    var targetX = (k.toX != null) ? k.toX : idleCx;
    var targetY = (k.toY != null) ? k.toY : idleCy;
    var cx = idleCx + (targetX - idleCx) * prog;
    var cy = idleCy + (targetY - idleCy) * prog;

    c.save();
    // grounding shadow stays on the line under the keeper's horizontal position
    c.fillStyle = 'rgba(0,0,0,0.22)';
    c.beginPath();
    c.ellipse(cx, g.line + g.height * 0.02, Math.max(w * 0.3, g.width * 0.06), g.height * 0.03, 0, 0, 7);
    c.fill();
    c.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    c.restore();
  };

  // Fallback: original path-drawn keeper (kept intact).
  ShootoutMatch.prototype._drawKeeperPath = function (c, g) {
    var k = this._keeper;
    var baseX = (g.left + g.right) / 2;
    var baseY = g.line; // stands on the line
    var scale = g.height * 0.012; // overall size unit
    var u = Math.max(2.4, scale);

    // position: lerp toward dive target as t grows
    var tx = baseX, ty = baseY - u * 9;
    var lean = 0, reach = 0;
    if (k.pose === 'L' || k.pose === 'R' || k.pose === 'C') {
      var prog = k.t || 0;
      if (k.toX != null) { tx = baseX + (k.toX - baseX) * prog; }
      else { tx = baseX + THIRD_X[k.pose] * (g.width * 0.42) * prog; }
      ty = (baseY - u * 9) + ((k.toY != null ? k.toY : baseY - u * 9) - (baseY - u * 9)) * prog * 0.6;
      lean = (k.pose === 'L' ? -1 : k.pose === 'R' ? 1 : 0) * prog * 0.8;
      reach = prog;
    }

    var kit = k.kit === 'mine'
      ? { jersey: '#f7c948', dark: '#caa029', short: '#1c1c1c' }
      : { jersey: '#1fb6c9', dark: '#127584', short: '#10333a' };

    c.save();
    c.translate(tx, ty);
    c.rotate(lean * 0.5);

    // shadow
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.beginPath(); c.ellipse(0, u * 9.5, u * 5, u * 1.4, 0, 0, 7); c.fill();

    var armSpread = (k.pose === 'C') ? 0 : reach;
    // legs
    c.strokeStyle = kit.short; c.lineCap = 'round'; c.lineWidth = u * 1.8;
    c.beginPath();
    c.moveTo(-u * 1.1, u * 4); c.lineTo(-u * 1.6 - armSpread * u * 1.5, u * 9);
    c.moveTo(u * 1.1, u * 4); c.lineTo(u * 1.6 + armSpread * u * 1.5, u * 9);
    c.stroke();
    // shorts
    c.fillStyle = kit.short;
    roundRect(c, -u * 2, u * 2.2, u * 4, u * 2.6, u * 0.8); c.fill();
    // torso (jersey)
    c.fillStyle = kit.jersey;
    roundRect(c, -u * 2.4, -u * 3.4, u * 4.8, u * 6, u * 1.4); c.fill();
    c.fillStyle = kit.dark; // side shading
    roundRect(c, u * 1.2, -u * 3.4, u * 1.2, u * 6, u * 0.6); c.fill();

    // arms + gloves: spread toward the dive
    var ay = -u * 2 - reach * u * 1.5;
    c.strokeStyle = kit.jersey; c.lineWidth = u * 1.5;
    var lx = -u * 2.4 - armSpread * u * 5.5, rx = u * 2.4 + armSpread * u * 5.5;
    c.beginPath();
    c.moveTo(-u * 1.8, -u * 2.4); c.lineTo(lx, ay);
    c.moveTo(u * 1.8, -u * 2.4); c.lineTo(rx, ay);
    c.stroke();
    // gloves
    c.fillStyle = '#ffffff'; c.strokeStyle = '#2a2a2a'; c.lineWidth = 1.5;
    c.beginPath(); c.arc(lx, ay, u * 1.25, 0, 7); c.fill(); c.stroke();
    c.beginPath(); c.arc(rx, ay, u * 1.25, 0, 7); c.fill(); c.stroke();

    // head
    c.fillStyle = '#e7b58c';
    c.beginPath(); c.arc(0, -u * 5.4, u * 1.7, 0, 7); c.fill();
    c.fillStyle = '#3a2a1c'; // hair
    c.beginPath(); c.arc(0, -u * 5.9, u * 1.7, Math.PI, 0); c.fill();

    c.restore();
  };

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // --- prompts / banners -----------------------------------------------------
  ShootoutMatch.prototype._drawDivePrompt = function (c) {
    var W = this.W, H = this.H;
    var now = (root.performance ? performance.now() : Date.now());
    var left = Math.max(0, this._diveDeadline - now);
    var frac = left / root.Config.TUNING.DIVE_TIMER_MS;

    c.save();
    c.textAlign = 'center';
    // hint: tap anywhere in the goal (incl. the corners) to dive there
    c.font = '700 ' + Math.round(W * 0.032) + 'px Archivo, sans-serif';
    c.fillStyle = 'rgba(247,201,72,0.85)';
    c.fillText('tap the goal to dive — corners too', W / 2, this.goal.line + 28);
    // prompt + timer bar
    c.fillStyle = '#fff';
    c.font = '900 ' + Math.round(W * 0.06) + 'px "Archivo Black", Archivo, sans-serif';
    c.fillText('DIVE!', W / 2, H * 0.66);
    var bw = W * 0.5, bx = (W - bw) / 2, by = H * 0.69;
    c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(bx, by, bw, 7);
    c.fillStyle = frac < 0.3 ? '#ff5a5a' : '#f7c948'; c.fillRect(bx, by, bw * frac, 7);
    c.restore();
  };

  ShootoutMatch.prototype._drawBanner = function (c) {
    var W = this.W, H = this.H;
    c.save();
    c.textAlign = 'center';
    c.font = '900 ' + Math.round(W * 0.085) + 'px "Archivo Black", Archivo, sans-serif';
    c.fillStyle = this.banner.good ? '#ffd766' : '#ff5a5a';
    c.shadowColor = 'rgba(0,0,0,0.6)'; c.shadowBlur = 14; c.shadowOffsetY = 3;
    c.fillText(this.banner.text, W / 2, H * 0.40);
    c.restore();
  };

  ShootoutMatch.prototype._drawHint = function (c) {
    var W = this.W, H = this.H, msg = '';
    if (this.phase === 'aim' && !this._dragging) msg = 'Drag the ball to aim · release to shoot';
    else if (this.phase === 'oppflying') msg = this.teamB.name + ' shooting…';
    if (!msg) return;
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.font = '600 ' + Math.round(W * 0.038) + 'px Archivo, sans-serif';
    c.textAlign = 'center';
    c.fillText(msg, W / 2, H * 0.98);
  };

  root.ShootoutMatch = ShootoutMatch;
})(typeof self !== 'undefined' ? self : this);
