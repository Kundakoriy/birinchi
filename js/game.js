/*
 * game.js — the interactive penalty shootout (swipe-to-shoot + canvas render).
 *
 * Drives a full shootout using the pure Tournament engine for the rules and the
 * Keeper module for the AI. The human always controls team A and kicks first in
 * each pair; the opponent's kicks are auto-played with a compressed animation.
 *
 * Gameplay: drag from the ball to set direction + power, release to fire. The
 * shot maps to a continuous goal area (no discrete zones). Higher / corner
 * placements carry more miss risk and are harder to save. Mouse-drag works
 * identically on desktop.
 *
 * No SDK calls live here — rewarded-ad retakes are delegated to a callback.
 */
(function (root) {
  'use strict';

  var T = root.Tournament;
  var Keeper = root.Keeper;
  var Sound = root.Sound;

  function ShootoutMatch(opts) {
    this.canvas = opts.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.teamA = opts.teamA;       // player's team
    this.teamB = opts.teamB;       // opponent
    this.mode = opts.mode;         // 'group' | 'knockout'
    this.keeperA = opts.keeperA;   // player's keeper rating (defends B's kicks)
    this.keeperB = opts.keeperB;   // opponent keeper rating (defends A's kicks)
    this.allowRetake = !!opts.allowRetake;
    this.isFinalKickPotential = !!opts.isFinalKickPotential; // tournament-winning slow-mo

    this.onUpdate = opts.onUpdate || function () {};
    this.onKickResult = opts.onKickResult || function () {};
    this.onRetakeOffer = opts.onRetakeOffer || null; // (retakeCb) => void
    this.onEnd = opts.onEnd || function () {};
    this.onWinningKick = opts.onWinningKick || null;

    this.rng = opts.rng || Math.random;
    this.state = T.newShootout(this.mode);
    this.retakeUsed = false;

    this.phase = 'idle'; // idle|aim|flying|result|opponent|paused|done
    this.shake = 0;
    this.timeScale = 1;

    this._raf = null;
    this._anim = null; // current animation descriptor
    this._drag = null; // {x,y} current pointer in canvas space
    this._lastTs = 0;

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
      left: this.W * 0.13,
      right: this.W * 0.87,
      top: this.H * 0.13,
      line: this.H * 0.46 // ground line of the goal mouth
    };
    this.goal.width = this.goal.right - this.goal.left;
    this.goal.height = this.goal.line - this.goal.top;
    this.ballHome = { x: this.W * 0.5, y: this.H * 0.84, r: Math.max(11, this.W * 0.035) };
    this.ball = { x: this.ballHome.x, y: this.ballHome.y };
    this.maxDrag = this.H * 0.30;
  };

  // map normalized shot {x:-1..1, y:0..1} to canvas point
  ShootoutMatch.prototype._goalPoint = function (sx, sy) {
    var g = this.goal;
    return {
      x: (g.left + g.right) / 2 + sx * (g.width / 2),
      y: g.line - sy * g.height
    };
  };

  // --- input -----------------------------------------------------------------
  ShootoutMatch.prototype._bindInput = function () {
    var self = this;
    this._onDown = function (e) { self._pointerDown(e); };
    this._onMove = function (e) { self._pointerMove(e); };
    this._onUp = function (e) { self._pointerUp(e); };
    this.canvas.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
    window.addEventListener('resize', this._onResize = function () { self._resize(); });
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
    if (this.phase !== 'aim') return;
    var p = this._evtPoint(e);
    var d = Math.hypot(p.x - this.ball.x, p.y - this.ball.y);
    if (d > this.ballHome.r * 3.5) return; // must grab near the ball
    this._dragging = true;
    this._drag = p;
    Sound && Sound.unlock && Sound.unlock();
  };
  ShootoutMatch.prototype._pointerMove = function (e) {
    if (!this._dragging) return;
    this._drag = this._evtPoint(e);
  };
  ShootoutMatch.prototype._pointerUp = function () {
    if (!this._dragging) return;
    this._dragging = false;
    this._fireFromDrag();
  };

  ShootoutMatch.prototype._fireFromDrag = function () {
    var dx = this._drag.x - this.ballHome.x;
    var dyUp = this.ballHome.y - this._drag.y; // upward positive
    if (dyUp < this.maxDrag * 0.12) { this._drag = null; return; } // too small, ignore
    var dist = Math.min(Math.hypot(dx, dyUp), this.maxDrag);
    var power = T.clamp(dist / this.maxDrag, 0.2, 1);
    var aimX = T.clamp(dx / (this.W * 0.34), -1, 1);
    var aimY = T.clamp((dyUp - this.maxDrag * 0.12) / (this.maxDrag * 0.85), 0, 1);
    this._drag = null;
    this._playerShoot({ x: aimX, y: aimY, power: power });
  };

  // --- turn flow -------------------------------------------------------------
  ShootoutMatch.prototype._nextTurn = function () {
    if (T.isComplete(this.state)) { this._finish(); return; }
    this.onUpdate(this.state);
    if (this.state.turn === 'A') {
      this.phase = 'aim';
      this.ball = { x: this.ballHome.x, y: this.ballHome.y };
    } else {
      this._opponentShoot();
    }
  };

  // Resolve a player's shot into goal / save / miss / post.
  ShootoutMatch.prototype._resolvePlayerShot = function (shot) {
    // Miss risk grows toward corners, the crossbar, and with raw power.
    var edge = Math.max(Math.abs(shot.x) - 0.78, 0) / 0.22;     // 0..1 near posts
    var high = Math.max(shot.y - 0.72, 0) / 0.28;               // 0..1 near bar
    var powerRisk = Math.max(shot.power - 0.85, 0) / 0.15;
    var missChance = T.clamp(0.04 + edge * 0.45 + high * 0.5 + powerRisk * 0.2, 0, 0.85);
    if (this.rng() < missChance) {
      // wide or over — nudge the visible target outside the frame
      var ox = shot.x + (shot.x >= 0 ? 0.25 : -0.25);
      var oy = shot.y + (high > 0 ? 0.25 : 0.05);
      return { result: shot.y > 0.8 ? 'over' : 'wide', target: { x: ox, y: oy } };
    }
    // Post hit if right on the woodwork.
    if (Math.abs(Math.abs(shot.x) - 0.92) < 0.04 && this.rng() < 0.4) {
      return { result: 'post', target: { x: shot.x, y: shot.y } };
    }
    // Keeper attempts the save.
    var dive = Keeper.decideDive(this.keeperB, shot, this.rng);
    var dpoint = dive; // normalized
    var dist = Math.hypot(shot.x - dpoint.diveX, shot.y - dpoint.diveY);
    var saved = dist < dive.reach;
    return {
      result: saved ? 'save' : 'goal',
      target: { x: shot.x, y: shot.y },
      dive: dive
    };
  };

  ShootoutMatch.prototype._playerShoot = function (shot) {
    var info = this._resolvePlayerShot(shot);
    var self = this;
    this.phase = 'flying';
    Sound && Sound.play('kick');
    var to = this._goalPoint(info.target.x, info.target.y);
    var dur = 400 / this.timeScale;
    // keeper dive target for animation
    if (info.dive) this._keeperDive = this._goalPoint(info.dive.diveX, info.dive.diveY);
    else this._keeperDive = null;

    this._animate(this.ball, to, dur, function () {
      self._applyResult('A', info, shot);
    });
  };

  ShootoutMatch.prototype._opponentShoot = function () {
    this.phase = 'opponent';
    var self = this;
    // AI placement: aims for a corner, accuracy scales with team strength.
    var skill = (this.teamB.rating - 50) / 49;
    var side = this.rng() < 0.5 ? -1 : 1;
    var sx = side * (0.4 + this.rng() * 0.5);
    var sy = 0.2 + this.rng() * 0.6;
    var shot = { x: sx, y: sy, power: 0.7 };
    // Does player's keeper (auto) save? Use the scoring model + a save roll.
    var p = T.goalProbability(this.teamB.rating, this.keeperA);
    var scored = this.rng() < p;
    var info;
    if (!scored) {
      // show a save: keeper dives toward the ball
      info = { result: 'save', target: { x: sx, y: sy },
               dive: { diveX: sx + (this.rng() * 0.2 - 0.1), diveY: sy } };
      this._keeperDive = this._goalPoint(info.dive.diveX, info.dive.diveY);
    } else {
      info = { result: 'goal', target: { x: sx, y: sy } };
      // keeper dives the wrong way
      this._keeperDive = this._goalPoint(-side * (0.4 + this.rng() * 0.4), this.rng() * 0.6);
    }
    this.ball = { x: this.ballHome.x, y: this.ballHome.y };
    Sound && Sound.play('kick');
    var to = this._goalPoint(shot.x, shot.y);
    this._animate(this.ball, to, 600, function () { // compressed ~1s incl. result hold
      self._applyResult('B', info, shot);
    });
  };

  // Apply a resolved kick: maybe offer a retake, else commit to the engine.
  ShootoutMatch.prototype._applyResult = function (side, info, shot) {
    var self = this;
    this.phase = 'result';
    var scored = info.result === 'goal';

    // juice
    if (info.result === 'goal') { Sound && Sound.play('goal'); this._netRipple = 1; }
    else if (info.result === 'save') { Sound && Sound.play('save'); this.shake = 1; }
    else if (info.result === 'post') { Sound && Sound.play('post'); this.shake = 1; }
    else { Sound && Sound.play('miss'); }

    this.onKickResult({ side: side, result: info.result, scored: scored, state: this.state });

    var commit = function () {
      // Tournament-winning kick gets slow-mo + zoom before finishing.
      if (side === 'A' && scored && self._wouldWinTournament()) {
        self.timeScale = 0.35;
        if (self.onWinningKick) self.onWinningKick();
      }
      T.recordKick(self.state, scored);
      self.timeScale = 1;
      setTimeout(function () { self._nextTurn(); }, side === 'B' ? 350 : 550);
    };

    // Rewarded-ad retake: only for the player, on a FAILED kick, once per match.
    if (side === 'A' && !scored && this.allowRetake && !this.retakeUsed && this.onRetakeOffer) {
      this.phase = 'paused';
      this.onRetakeOffer(function (granted) {
        if (granted) {
          self.retakeUsed = true;
          self.ball = { x: self.ballHome.x, y: self.ballHome.y };
          self._keeperDive = null;
          self.phase = 'aim'; // shoot again WITHOUT recording the miss
        } else {
          commit();
        }
      });
      return;
    }
    setTimeout(commit, 700);
  };

  // Would the player scoring this kick decide a tournament-winning final?
  ShootoutMatch.prototype._wouldWinTournament = function () {
    if (!this.isFinalKickPotential) return false;
    var s = this.state;
    if (s.mode !== 'knockout') return false;
    // simulate: A scores now
    var remB = Math.max(0, 5 - s.kb);
    if (s.phase === 'active') return (s.a + 1) > s.b + remB;
    if (s.phase === 'suddendeath') return false; // decided after B kicks
    return false;
  };

  ShootoutMatch.prototype._finish = function () {
    this.phase = 'done';
    this.onUpdate(this.state);
    this.onEnd(this.state);
  };

  // --- animation + render ----------------------------------------------------
  ShootoutMatch.prototype._animate = function (obj, to, dur, done) {
    this._anim = { obj: obj, from: { x: obj.x, y: obj.y }, to: to, dur: dur, t: 0, done: done };
  };

  ShootoutMatch.prototype._loop = function (ts) {
    var dt = this._lastTs ? (ts - this._lastTs) : 16;
    this._lastTs = ts;
    dt *= this.timeScale;

    if (this._anim) {
      this._anim.t += dt;
      var k = T.clamp(this._anim.t / this._anim.dur, 0, 1);
      var e = 1 - Math.pow(1 - k, 2); // ease-out
      this._anim.obj.x = this._anim.from.x + (this._anim.to.x - this._anim.from.x) * e;
      this._anim.obj.y = this._anim.from.y + (this._anim.to.y - this._anim.from.y) * e;
      if (k >= 1) { var d = this._anim.done; this._anim = null; d && d(); }
    }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt / 260);
    if (this._netRipple > 0) this._netRipple = Math.max(0, this._netRipple - dt / 500);

    this._render();
    this._raf = requestAnimationFrame(this._loop);
  };

  ShootoutMatch.prototype._render = function () {
    var c = this.ctx, W = this.W, H = this.H, g = this.goal;
    c.save();
    if (this.shake > 0) {
      var s = this.shake * 9;
      c.translate((Math.random() * 2 - 1) * s, (Math.random() * 2 - 1) * s);
    }

    // pitch-night background
    var bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0a1f14');
    bg.addColorStop(0.5, '#0c2a18');
    bg.addColorStop(1, '#06150d');
    c.fillStyle = bg;
    c.fillRect(-20, -20, W + 40, H + 40);

    // pitch stripes
    c.fillStyle = 'rgba(255,255,255,0.025)';
    for (var i = 0; i < 8; i++) {
      if (i % 2 === 0) c.fillRect(0, g.line + i * (H - g.line) / 8, W, (H - g.line) / 8);
    }

    // goal net
    this._drawGoal(c, g);

    // keeper
    this._drawKeeper(c, g);

    // aim guide while dragging
    if (this.phase === 'aim' && this._dragging && this._drag) {
      var dx = this._drag.x - this.ballHome.x;
      var dyUp = this.ballHome.y - this._drag.y;
      var dist = Math.min(Math.hypot(dx, dyUp), this.maxDrag);
      var pow = T.clamp(dist / this.maxDrag, 0.2, 1);
      var aimX = T.clamp(dx / (W * 0.34), -1, 1);
      var aimY = T.clamp((dyUp - this.maxDrag * 0.12) / (this.maxDrag * 0.85), 0, 1);
      var tgt = this._goalPoint(aimX, aimY);
      c.strokeStyle = 'rgba(247,201,72,0.85)';
      c.lineWidth = 3;
      c.setLineDash([8, 7]);
      c.beginPath(); c.moveTo(this.ballHome.x, this.ballHome.y); c.lineTo(tgt.x, tgt.y); c.stroke();
      c.setLineDash([]);
      // target reticle
      c.strokeStyle = 'rgba(247,201,72,0.95)';
      c.lineWidth = 2;
      c.beginPath(); c.arc(tgt.x, tgt.y, 13, 0, Math.PI * 2); c.stroke();
      // power bar
      this._drawPowerBar(c, pow);
    }

    // ball
    this._drawBall(c, this.ball.x, this.ball.y, this.ballHome.r);

    c.restore();

    // hint text
    if (this.phase === 'aim' && !this._dragging) {
      c.fillStyle = 'rgba(255,255,255,0.55)';
      c.font = '600 ' + Math.round(W * 0.04) + 'px Archivo, sans-serif';
      c.textAlign = 'center';
      c.fillText('Drag the ball to aim · release to shoot', W / 2, H * 0.95);
    } else if (this.phase === 'opponent') {
      c.fillStyle = 'rgba(255,255,255,0.55)';
      c.font = '600 ' + Math.round(W * 0.04) + 'px Archivo, sans-serif';
      c.textAlign = 'center';
      c.fillText(this.teamB.name + ' to kick…', W / 2, H * 0.95);
    }
  };

  ShootoutMatch.prototype._drawGoal = function (c, g) {
    // net
    c.save();
    c.strokeStyle = 'rgba(255,255,255,0.16)';
    c.lineWidth = 1;
    var cols = 14, rows = 8;
    var rip = this._netRipple || 0;
    for (var i = 0; i <= cols; i++) {
      var x = g.left + (g.width) * (i / cols);
      c.beginPath(); c.moveTo(x, g.top); c.lineTo(x, g.line); c.stroke();
    }
    for (var j = 0; j <= rows; j++) {
      var y = g.top + (g.height) * (j / rows) - rip * 4 * Math.sin(j);
      c.beginPath(); c.moveTo(g.left, y); c.lineTo(g.right, y); c.stroke();
    }
    c.restore();
    // posts + bar
    c.strokeStyle = '#f4f4f4';
    c.lineWidth = Math.max(4, this.W * 0.012);
    c.beginPath();
    c.moveTo(g.left, g.line); c.lineTo(g.left, g.top);
    c.lineTo(g.right, g.top); c.lineTo(g.right, g.line);
    c.stroke();
  };

  ShootoutMatch.prototype._drawKeeper = function (c, g) {
    var pos;
    if (this._keeperDive && (this.phase === 'flying' || this.phase === 'result' || this.phase === 'opponent')) {
      pos = this._keeperDive;
    } else {
      pos = this._goalPoint(0, 0.15); // resting, slightly off the line
    }
    var w = g.width * 0.14, h = g.height * 0.55;
    c.save();
    c.fillStyle = '#f7c948';
    c.strokeStyle = '#1a1a1a';
    c.lineWidth = 2;
    // body
    c.beginPath();
    c.ellipse(pos.x, pos.y - h * 0.25, w * 0.5, h * 0.5, 0, 0, Math.PI * 2);
    c.fill(); c.stroke();
    // gloves
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(pos.x - w * 0.55, pos.y - h * 0.35, w * 0.18, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(pos.x + w * 0.55, pos.y - h * 0.35, w * 0.18, 0, Math.PI * 2); c.fill();
    c.restore();
  };

  ShootoutMatch.prototype._drawBall = function (c, x, y, r) {
    c.save();
    c.fillStyle = '#fff';
    c.strokeStyle = '#222';
    c.lineWidth = 2;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); c.stroke();
    // simple pentagon accent
    c.fillStyle = '#222';
    c.beginPath(); c.arc(x, y, r * 0.32, 0, Math.PI * 2); c.fill();
    c.restore();
  };

  ShootoutMatch.prototype._drawPowerBar = function (c, pow) {
    var W = this.W, H = this.H;
    var bw = W * 0.5, bh = 10, bx = (W - bw) / 2, by = H * 0.91;
    c.fillStyle = 'rgba(255,255,255,0.15)';
    c.fillRect(bx, by, bw, bh);
    var col = pow > 0.85 ? '#ff5a5a' : '#f7c948';
    c.fillStyle = col;
    c.fillRect(bx, by, bw * pow, bh);
  };

  root.ShootoutMatch = ShootoutMatch;
})(typeof self !== 'undefined' ? self : this);
