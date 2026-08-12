/* boss.js — Stage 1 boss: a Golem-class organic mass sealed in the chamber
   at the end of the corridor. Armoured shell, a single eye core that only
   opens to attack; that open window is your only chance to damage it. */
(function (NS) {
  'use strict';

  function Boss(game) {
    this.game = game;
    this.x = ENTER_X;
    this.y = NS.PLAYFIELD_H / 2;
    this.targetX = NS.W - 74;
    this.hp = 70;
    this.maxHp = 70;
    this.t = 0;
    this.state = 'enter';        // enter | idle | opening | open | closing | dying
    this.stateT = 0;
    this.eyeOpen = 0;            // 0..1
    this.dead = false;
    this.defeated = false;
    this.hitFlash = 0;
    this.bob = 0;
    this.cells = [];
    this.deathT = 0;
    this.rage = false;
    this.tentacle = 0;
  }
  NS.Boss = Boss;

  /* Entrance geometry. The mass starts well outside the chamber mouth,
     hauls itself in past its own station to loom over the corridor, then
     draws back onto that station as the name locks in. LUNGE is how far
     past the station it comes. */
  var ENTER_X = NS.W + 96;
  var LUNGE = 28;
  function ease(u) { return u < 0 ? 0 : (u > 1 ? 1 : u * u * (3 - 2 * u)); }

  Boss.prototype.coreRect = function () {
    return { x: this.x - 6, y: this.y - 6, w: 12, h: 12 };
  };
  Boss.prototype.bodyRect = function () {
    return { x: this.x - 26, y: this.y - 40, w: 56, h: 80 };
  };

  Boss.prototype.update = function (player) {
    /* core height last frame — the assist gunner leads its shots off this,
       since the mass bobs by ±12px and a 20-frame shot flight misses badly
       if you aim where the eye is rather than where it will be */
    this.prevCy = this.y + this.bob;

    this.t++;
    this.stateT++;
    if (this.hitFlash > 0) this.hitFlash--;
    this.bob = Math.sin(this.t * 0.028) * 12;
    this.tentacle += 0.05;

    if (this.state === 'dying') {
      this.deathT++;
      if (this.deathT % 7 === 0) {
        var ang = Math.random() * Math.PI * 2;
        var r = Math.random() * 32;
        NS.FX.explode(this.x + Math.cos(ang) * r, this.y + this.bob + Math.sin(ang) * r, 1.6, 'fire');
        NS.Audio.sfx.explode();
      }
      if (this.deathT === 120) {
        NS.FX.explode(this.x, this.y + this.bob, 4.5, 'fire');
        NS.Audio.sfx.bigBoom();
      }
      if (this.deathT > 150) { this.dead = true; this.defeated = true; }
      this.updateCells(player);
      return;
    }

    switch (this.state) {
      case 'enter':
        this.enter();
        break;

      case 'idle':
        /* drift toward the player's vertical lane, slowly */
        if (player.alive) {
          var dy = NS.clamp((player.y - (this.y + this.bob)) * 0.02, -0.5, 0.5);
          this.y = NS.clamp(this.y + dy, 46, NS.PLAYFIELD_H - 46);
        }
        if (this.stateT > (this.rage ? 45 : 70)) this.setState('opening');
        /* the shell coughs up cells even while sealed */
        if (this.stateT % (this.rage ? 46 : 72) === 0) this.spawnCell();
        break;

      case 'opening':
        this.eyeOpen = NS.clamp(this.stateT / 20, 0, 1);
        if (this.stateT >= 20) this.setState('open');
        break;

      case 'open':
        this.eyeOpen = 1;
        if (this.stateT === 6 || this.stateT === 34 || (this.rage && this.stateT === 62)) {
          this.fireSpread(player);
        }
        if (this.stateT > (this.rage ? 96 : 74)) this.setState('closing');
        break;

      case 'closing':
        this.eyeOpen = NS.clamp(1 - this.stateT / 18, 0, 1);
        if (this.stateT >= 18) this.setState('idle');
        break;
    }

    if (!this.rage && this.hp <= this.maxHp * 0.45) {
      this.rage = true;
      NS.Audio.sfx.alarm();
      NS.FX.popText(this.x - 20, this.y - 46, 'CORE ENRAGED', '#ff9a9a');
    }

    this.updateCells(player);
  };

  Boss.prototype.setState = function (s) { this.state = s; this.stateT = 0; };

  /* ---- entrance --------------------------------------------------------
     Timed off NS.Intro rather than off its own clock, so the shell settles
     onto its station on exactly the frame the name plate locks in. When the
     cut is not running (a debug warp straight into the fight, say) it falls
     back to its own ramp and plays out the same shape in the same time. */
  Boss.prototype.enter = function () {
    var k = NS.Intro.active ? NS.Intro.k() : NS.clamp(this.stateT / 150, 0, 1);
    var lungeX = this.targetX - LUNGE;

    if (k < 0.58) this.x = NS.lerp(ENTER_X, lungeX, ease(k / 0.58));
    else if (k < 0.80) this.x = lungeX;                 // hangs there, cracking open
    else this.x = NS.lerp(lungeX, this.targetX, ease((k - 0.80) / 0.20));

    /* the eye cracks open while it looms, then seals again as it withdraws —
       a look at what you are fighting, and a promise you cannot hit it yet */
    this.eyeOpen = k > 0.52 && k < 0.86
      ? Math.sin((k - 0.52) / 0.34 * Math.PI) * 0.9
      : 0;

    /* debris shaken off the chamber seal as it forces its way through */
    if (k < 0.62 && this.t % 9 === 0) {
      NS.FX.spark(this.x - 18 + Math.random() * 44,
                  this.y + (Math.random() - 0.5) * 78, 3, 'fire');
    }
    if (k > 0.52 && k < 0.86 && this.t % 13 === 0) NS.Audio.sfx.hit();

    if (k >= 1) {
      this.x = this.targetX;
      this.eyeOpen = 0;
      NS.FX.explode(this.x, this.y, 2.4, 'fire');
      NS.Audio.sfx.explode();
      this.setState('idle');
    }
  };

  /* The wall tendrils, as sampled points along each strand. Both renderers
     walk this, so the 2D curve and the voxel chain cannot drift apart. */
  Boss.prototype.eachTendril = function (steps, fn) {
    var cx = this.x, cy = this.y + this.bob;
    for (var i = 0; i < 5; i++) {
      var ty = cy - 34 + i * 17;
      var x0 = cx + 24, y0 = ty;
      var x1 = cx + 44 + Math.sin(this.tentacle + i) * 5;
      var y1 = ty + Math.cos(this.tentacle * 1.3 + i) * 9;
      var x2 = NS.W + 6, y2 = ty + Math.sin(this.tentacle + i * 2) * 6;
      for (var s = 0; s <= steps; s++) {
        var u = s / steps, v = 1 - u;
        fn(v * v * x0 + 2 * v * u * x1 + u * u * x2,
           v * v * y0 + 2 * v * u * y1 + u * u * y2, i, u);
      }
    }
  };

  /* When the core is damageable, as a frame window measured from now.
     The shell cycle is fully deterministic, so this is exact — the assist
     gunner uses it to time shots to land inside the window rather than
     firing the instant the eye happens to be open. Returns null when the
     core will not be exposed on this cycle. */
  Boss.prototype.openWindow = function () {
    var openDur = this.rage ? 96 : 74;
    var idleDur = this.rage ? 45 : 70;
    var OPEN_AT = 12;      // frames into 'opening' before eyeOpen passes 0.6
    var SHUT_AT = 7;       // frames into 'closing' before it drops back under

    switch (this.state) {
      case 'idle':
        var toOpening = Math.max(0, idleDur - this.stateT + 1);
        return { start: toOpening + OPEN_AT,
                 end: toOpening + 20 + openDur + SHUT_AT };
      case 'opening':
        return { start: Math.max(0, OPEN_AT - this.stateT),
                 end: (20 - this.stateT) + openDur + SHUT_AT };
      case 'open':
        return { start: 0, end: (openDur - this.stateT) + SHUT_AT };
      case 'closing':
        return this.stateT < SHUT_AT ? { start: 0, end: SHUT_AT - this.stateT } : null;
      default:
        return null;    // 'enter' / 'dying'
    }
  };

  Boss.prototype.fireSpread = function (player) {
    var cx = this.x - 8, cy = this.y + this.bob;
    var base = player.alive ? NS.angleTo(cx, cy, player.x, player.y) : Math.PI;
    var arms = this.rage ? 5 : 3;
    for (var i = 0; i < arms; i++) {
      var a = base + (i - (arms - 1) / 2) * 0.26;
      NS.Weapons.enemyShot(cx, cy, Math.cos(a) * 2.1, Math.sin(a) * 2.1, { ignoreTerrain: true, big: true, life: 300 });
    }
    NS.Audio.sfx.alarm();
  };

  Boss.prototype.spawnCell = function () {
    var side = Math.random() < 0.5 ? -1 : 1;
    this.cells.push({
      x: this.x - 18, y: this.y + this.bob + side * 22,
      vx: -0.9 - Math.random() * 0.5, vy: side * 0.35,
      hp: 1, t: 0, dead: false, w: 5, h: 5, phase: Math.random() * 6.28
    });
  };

  Boss.prototype.updateCells = function (player) {
    for (var i = 0; i < this.cells.length; i++) {
      var c = this.cells[i];
      if (c.dead) continue;
      c.t++;
      c.phase += 0.07;
      if (player.alive && c.t > 30) {
        var a = NS.angleTo(c.x, c.y, player.x, player.y);
        c.vx = NS.lerp(c.vx, Math.cos(a) * 1.5, 0.02);
        c.vy = NS.lerp(c.vy, Math.sin(a) * 1.5, 0.02);
      }
      c.x += c.vx;
      c.y += c.vy + Math.sin(c.phase) * 0.25;
      if (c.x < -10 || c.y < -10 || c.y > NS.PLAYFIELD_H + 10) c.dead = true;
    }
    var n = 0;
    for (var j = 0; j < this.cells.length; j++) if (!this.cells[j].dead) this.cells[n++] = this.cells[j];
    this.cells.length = n;
  };

  /* returns true when the shot actually damaged the core */
  Boss.prototype.tryHit = function (rect, dmg, game) {
    /* nothing lands during the entrance cut — the eye is showing itself, not
       exposed, and the fight has not started */
    if (this.state === 'dying' || this.state === 'enter') return false;

    /* cells first */
    for (var i = 0; i < this.cells.length; i++) {
      var c = this.cells[i];
      if (c.dead) continue;
      if (NS.rectHit(rect, { x: c.x - 3, y: c.y - 3, w: 6, h: 6 })) {
        c.dead = true;
        NS.FX.explode(c.x, c.y, 0.7, 'fire');
        NS.Audio.sfx.hit();
        game.addScore(50, c.x, c.y);
        return true;
      }
    }

    var body = this.bodyRect();
    body.y += this.bob;
    if (!NS.rectHit(rect, body)) return false;

    var core = this.coreRect();
    core.y += this.bob;

    /* While the shell is open, the channel in front of the core is clear:
       shots lined up with the eye fly through the armour instead of being
       stopped by it. Everything else pings harmlessly off the plates. */
    var shotMidY = rect.y + rect.h / 2;
    var inChannel = this.eyeOpen > 0.6 &&
                    shotMidY > core.y - 3 && shotMidY < core.y + core.h + 3;

    if (inChannel && !NS.rectHit(rect, core)) return false;   // still travelling

    if (inChannel && NS.rectHit(rect, core)) {
      this.hp -= dmg;
      this.hitFlash = 3;
      NS.FX.spark(core.x + 6, core.y + 6, 4, 'hit');
      NS.Audio.sfx.hit();
      if (this.hp <= 0) {
        this.setState('dying');
        this.deathT = 0;
        game.addScore(5000, this.x, this.y);
        NS.Audio.sfx.bigBoom();
      }
      return true;
    }

    /* armour ping */
    NS.FX.spark(rect.x, rect.y + rect.h / 2, 2, 'hit');
    return true;
  };

  /* solid parts that kill the player on contact */
  Boss.prototype.eachHazard = function (fn) {
    /* the entrance cannot kill you either: the shell sweeps across ground the
       player is standing on, and taking a life for that would be a cheat */
    if (this.state === 'dying' || this.state === 'enter') return;
    var b = this.bodyRect();
    b.y += this.bob;
    fn(b.x, b.y, b.w, b.h);
    for (var i = 0; i < this.cells.length; i++) {
      var c = this.cells[i];
      if (!c.dead) fn(c.x - 3, c.y - 3, 6, 6);
    }
  };

  /* ---- draw ----------------------------------------------------------- */
  Boss.prototype.draw = function (g) {
    var cx = this.x, cy = this.y + this.bob;

    /* writhing tendrils anchored to the chamber wall behind the body */
    g.strokeStyle = '#7a2440';
    g.lineWidth = 2;
    var strand = -1;
    this.eachTendril(10, function (tx, ty, index) {
      if (index !== strand) {
        if (strand >= 0) g.stroke();
        strand = index;
        g.beginPath();
        g.moveTo(tx, ty);
      } else g.lineTo(tx, ty);
    });
    if (strand >= 0) g.stroke();

    /* main mass: layered blobs */
    var flash = this.hitFlash > 0 && !NS.reducedFlash();
    drawBlob(g, cx, cy, 30, 41, flash ? '#ffb9c8' : '#8d2a4a', '#5a1530');
    drawBlob(g, cx + 4, cy, 24, 33, flash ? '#ffd4de' : '#b23d61', '#7c2244');
    drawBlob(g, cx + 2, cy, 16, 22, '#d2618a', '#94304f');

    /* armour plates that slide apart as the eye opens */
    var sep = this.eyeOpen * 9;
    g.fillStyle = flash ? '#fff0f4' : '#e6a5bd';
    g.fillRect((cx - 14) | 0, (cy - 16 - sep) | 0, 26, 8);
    g.fillRect((cx - 14) | 0, (cy + 8 + sep) | 0, 26, 8);
    g.fillStyle = '#7c2244';
    g.fillRect((cx - 14) | 0, (cy - 16 - sep) | 0, 26, 2);
    g.fillRect((cx - 14) | 0, (cy + 14 + sep) | 0, 26, 2);

    /* the core */
    if (this.eyeOpen > 0.05) {
      var spr = flash ? NS.S.bossEyeHit : NS.S.bossEye;
      g.save();
      g.globalAlpha = NS.clamp(this.eyeOpen * 1.4, 0, 1);
      g.drawImage(spr, (cx - 6) | 0, (cy - 6) | 0, 12, Math.max(2, 12 * this.eyeOpen));
      g.restore();
      if (this.eyeOpen > 0.9) {
        g.fillStyle = 'rgba(255,90,90,' + (0.25 + 0.2 * Math.sin(this.t * 0.3)).toFixed(2) + ')';
        g.fillRect((cx - 10) | 0, (cy - 2) | 0, 6, 3);
      }
    } else {
      g.fillStyle = '#42122a';
      g.fillRect((cx - 8) | 0, (cy - 3) | 0, 16, 6);
    }

    /* cells */
    for (var j = 0; j < this.cells.length; j++) {
      var c = this.cells[j];
      if (!c.dead) g.drawImage(NS.S.cell, (c.x - 2) | 0, (c.y - 2) | 0);
    }
  };

  function drawBlob(g, x, y, rx, ry, fill, stroke) {
    g.fillStyle = fill;
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = stroke;
    g.lineWidth = 1;
    g.stroke();
  }

})(NS);
