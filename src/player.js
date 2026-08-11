/* player.js — the ship, the Gradius/Life Force power meter, and Options.
   Meter slots, left to right:
     SPEED UP | MISSILE | LASER | OPTION | FORCE FIELD
   A capsule advances the highlight; the POWER key spends it.

   The arcade original carries a RIPPLE slot between MISSILE and LASER. It is
   deliberately absent here. */
(function (NS) {
  'use strict';

  var SLOTS = ['SPEED', 'MISSILE', 'LASER', 'OPTION', 'FORCE'];
  /* NES movement is digital and has no inertial ramp: pressing a direction
     immediately applies the current speed and releasing it stops movement.
     Life Force stores ship speed on a 0..10 scale; these are the equivalent
     whole-pixel steps at our native 256x224 simulation resolution. */
  var SPEEDS = [1, 2, 3, 4, 5];
  var MAX_OPTIONS = 2;               // North American NES shared limit
  var TRAIL_GAP = 14;               // frames of delay between each Option
  var INVULN_FRAMES = 110;

  function Player() { this.reset(true); }
  NS.Player = Player;
  Player.SLOTS = SLOTS;
  Player.SPEEDS = SPEEDS.slice();
  Player.MAX_OPTIONS = MAX_OPTIONS;

  Player.prototype.reset = function (full) {
    this.orientation = 'side';
    this.x = 40; this.y = NS.PLAYFIELD_H / 2;
    this.w = 14; this.h = 8;         // hitbox is smaller than the sprite
    this.sw = 20; this.sh = 9;
    this.alive = true;
    this.dying = 0;
    this.invuln = INVULN_FRAMES;
    this.fireCd = 0;
    this.anim = 0;
    this.bank = 0;

    if (full) {
      this.lives = 3;
      this.score = 0;
      /* NES Life Force grants its first score extend at 10,000, then one
         every 30,000 points: 10k, 40k, 70k, 100k, ... */
      this.nextLifeScore = 10000;
    }
    // power-up state — always wiped on death, like the original
    this.capsules = 0;
    this.sel = 0;                     // 0 = nothing highlighted
    this.speedLv = 0;
    this.missileLv = 0;
    this.missile = false;            // compatibility flag for HUD/AI checks
    this.weapon = 'normal';           // 'normal' | 'laser'
    this.options = [];
    this.shield = 0;                  // force field hit points
    this.shieldMax = 4;
    /* Spatial breadcrumbs, newest first. Unlike a frame-delay trail this
       does not fill with duplicate positions while the ship is stationary,
       so Options hold behind the ship until it actually travels. */
    this.trail = [{ x: this.x, y: this.y }];
  };

  Player.prototype.speed = function () { return SPEEDS[this.speedLv]; };

  /* What the meter should show for slot `i`: 'empty', 'owned', or 'max'.
     The HUD used to answer this itself with a chain of index comparisons, so
     removing a slot silently shifted every test onto the wrong power-up.
     Asking the player keeps the two in step by construction. */
  Player.prototype.slotState = function (i) {
    switch (SLOTS[i]) {
      case 'SPEED':   return this.speedLv >= SPEEDS.length - 1 ? 'max'
                           : (this.speedLv > 0 ? 'owned' : 'empty');
      case 'MISSILE': return this.missileLv >= 3 ? 'max'
                           : (this.missileLv > 0 ? 'owned' : 'empty');
      case 'LASER':   return this.weapon === 'laser' ? 'max' : 'empty';
      case 'OPTION':  return this.options.length >= MAX_OPTIONS ? 'max'
                           : (this.options.length > 0 ? 'owned' : 'empty');
      case 'FORCE':   return this.shield >= this.shieldMax ? 'max'
                           : (this.shield > 0 ? 'owned' : 'empty');
    }
    return 'empty';
  };

  Player.prototype.setOrientation = function (mode) {
    this.orientation = mode === 'vertical' ? 'vertical' : 'side';
    if (this.orientation === 'vertical') {
      this.sw = 11; this.sh = 16; this.w = 8; this.h = 13;
    } else {
      this.sw = 20; this.sh = 9; this.w = 14; this.h = 8;
    }
    this.trail = [{ x: this.x, y: this.y }];
  };

  /* ---- power meter ---------------------------------------------------- */
  Player.prototype.giveCapsule = function () {
    this.sel = this.sel >= SLOTS.length ? 1 : this.sel + 1;
    NS.Audio.sfx.pickup();
  };

  Player.prototype.usePower = function () {
    if (this.sel === 0) return false;
    var slot = SLOTS[this.sel - 1];
    var ok = false;

    switch (slot) {
      case 'SPEED':
        if (this.speedLv < SPEEDS.length - 1) { this.speedLv++; ok = true; }
        break;
      case 'MISSILE':
        if (this.missileLv < 3) {
          this.missileLv++;
          this.missile = true;
          ok = true;
        }
        break;
      case 'LASER':
        if (this.weapon !== 'laser') { this.weapon = 'laser'; ok = true; }
        break;
      case 'OPTION':
        if (this.options.length < MAX_OPTIONS) {
          this.options.push({ x: this.x, y: this.y, delay: (this.options.length + 1) * TRAIL_GAP });
          ok = true;
        }
        break;
      case 'FORCE':
        if (this.shield < this.shieldMax) { this.shield = this.shieldMax; ok = true; }
        break;
    }

    if (ok) {
      this.sel = 0;
      NS.Audio.sfx.power();
      var label = slot === 'MISSILE' ? ('MISSILE ' + this.missileLv) : slot;
      NS.FX.popText(this.x - 6, this.y - 12, label, '#9fe8ff');
    } else {
      NS.Audio.sfx.hit();
    }
    return ok;
  };

  /* Reclaim one of the green Options released on death.  This bypasses the
     power meter because it is the old Option itself, not a new capsule. */
  Player.prototype.recoverOption = function () {
    if (this.options.length >= MAX_OPTIONS) return false;
    this.options.push({
      x: this.x,
      y: this.y,
      delay: (this.options.length + 1) * TRAIL_GAP
    });
    NS.Audio.sfx.pickup();
    NS.FX.popText(this.x - 8, this.y - 12, 'OPTION', '#9dffb0');
    return true;
  };

  /* ---- per-frame ------------------------------------------------------ */
  Player.prototype.update = function (scrollX, input) {
    this.anim++;

    if (!this.alive) {
      this.dying--;
      return;
    }

    if (this.invuln > 0) this.invuln--;

    var sp = this.speed();
    var ax = input.axis();
    /* A gamepad still gets a dead zone in Input, but outside it behaves as
       the NES D-pad did. Diagonal input applies the same step on both axes. */
    var dx = ax.x < 0 ? -1 : (ax.x > 0 ? 1 : 0);
    var dy = ax.y < 0 ? -1 : (ax.y > 0 ? 1 : 0);

    this.x += dx * sp;
    this.y += dy * sp;

    /* bank animation — analog input needs a deadzone or the ship flickers
       between frames on a barely-touched stick */
    this.bank = dy < -0.25 ? -1 : (dy > 0.25 ? 1 : 0);

    /* screen bounds — the ship can never outrun the corridor */
    /* Let the side-view hull reach both edges while remaining fully visible. */
    this.x = NS.clamp(this.x, this.sw * 0.5, NS.W - this.sw * 0.5);
    /* Keep the complete visible hull inside the playfield. The vertical
       ship is 16px tall, so clamping only its centre/hitbox let its tail
       disappear behind the HUD at the bottom of Stage 2. */
    var exhaustPad = this.orientation === 'vertical' ? NS.S.flameTop.height - 1 : 0;
    this.y = NS.clamp(this.y, this.sh * 0.5,
                      NS.PLAYFIELD_H - this.sh * 0.5 - exhaustPad);

    /* flesh collision is instant death (no shield save, as in the original) */
    var terrainHit = NS.Game.stage >= 3
      ? NS.Campaign.hitsPlayer(this)
      : (this.orientation === 'vertical'
        ? NS.Level2.hitsPlayer(this)
        : NS.Terrain.hitsRect(scrollX, this.x - this.w / 2, this.y - this.h / 2, this.w, this.h));
    if (terrainHit) {
      this.kill(true);
      return;
    }

    /* Record only distance travelled, then place each Option a fixed path
       distance behind the ship. It can overlap the ship only when the pilot
       deliberately doubles back through the stored path. */
    var head = this.trail[0];
    if (!head || NS.dist2(head.x, head.y, this.x, this.y) > 0.0001) {
      this.trail.unshift({ x: this.x, y: this.y });
    }
    trimTrail(this.trail, MAX_OPTIONS * TRAIL_GAP + 12);
    for (var i = 0; i < this.options.length; i++) {
      var o = this.options[i];
      var t = pointBehind(this.trail, (i + 1) * TRAIL_GAP);
      o.x = t.x; o.y = t.y;
    }

    /* power key */
    if (input.hit('power')) this.usePower();

    /* firing — MANUAL / AUTO / AI ASSIST all funnel through one gate */
    if (this.fireCd > 0) this.fireCd--;
    var wantsFire = NS.Game.stage >= 2 && NS.Gunner.mode === 'assist'
      ? true
      : NS.Gunner.wantsFire(this, input, scrollX,
                            this.orientation === 'vertical' ? null : NS.Game.boss);
    if (this.fireCd === 0 && wantsFire) {
      this.fire();
    }
  };

  function pointBehind(trail, distance) {
    if (!trail.length) return { x: 0, y: 0 };
    for (var i = 0; i < trail.length - 1; i++) {
      var a = trail[i], b = trail[i + 1];
      var dx = b.x - a.x, dy = b.y - a.y;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len <= 0.0001) continue;
      if (distance <= len) {
        var u = distance / len;
        return { x: NS.lerp(a.x, b.x, u), y: NS.lerp(a.y, b.y, u) };
      }
      distance -= len;
    }
    return trail[trail.length - 1];
  }

  function trimTrail(trail, keepDistance) {
    var travelled = 0;
    for (var i = 0; i < trail.length - 1; i++) {
      var a = trail[i], b = trail[i + 1];
      var dx = b.x - a.x, dy = b.y - a.y;
      travelled += Math.sqrt(dx * dx + dy * dy);
      if (travelled >= keepDistance) {
        trail.length = i + 2;
        return;
      }
    }
  }

  Player.prototype.fire = function () {
    if (NS.Game.stage >= 3) {
      this.fireCd = NS.Campaign.firePlayer(this);
      return;
    }
    if (this.orientation === 'vertical') {
      this.fireCd = NS.Level2.firePlayer(this);
      return;
    }
    var W = NS.Weapons;
    var fired = false;
    var muzzleX = this.x + 10, muzzleY = this.y;

    if (this.weapon === 'laser') {
      if (!W.hasLaser()) {
        W.shootLaser(muzzleX, muzzleY);
        for (var i = 0; i < this.options.length; i++) W.shootLaser(this.options[i].x + 4, this.options[i].y);
        NS.Audio.sfx.laser();
        fired = true;
        this.fireCd = 9;
      }
    } else {
      if (W.countNormal() < 4 + this.options.length * 2) {
        W.shootNormal(muzzleX, muzzleY);
        for (var k = 0; k < this.options.length; k++) W.shootNormal(this.options[k].x + 4, this.options[k].y);
        NS.Audio.sfx.shot();
        fired = true;
        this.fireCd = 6;
      }
    }

    if (this.missileLv > 0 && fired) {
      /* Life Force twin launch: every muzzle sends one missile upward and
         one downward. Options duplicate the base pair. Missile levels two
         and three add another ship-launched pair and raise projectile speed;
         two complete salvos may coexist on screen. */
      /* The launch geometry is shared with the other stages, so a salvo
         fans the same way whichever direction the camera is facing. */
      var fan = W.missileFan(this, false);
      var salvoSize = fan.length;
      if (W.countMissiles() + salvoSize <= salvoSize * 2) {
        for (var mm = 0; mm < fan.length; mm++) {
          var launch = fan[mm];
          if (launch.wall < 0) W.shootMissileUp(launch.x + 2, launch.y - 1, this.missileLv, launch.lead);
          else W.shootMissile(launch.x + 2, launch.y + 1, this.missileLv, launch.lead);
        }
        NS.Audio.sfx.missile();
      }
    }
  };

  /* returns true if the hit was absorbed */
  Player.prototype.hit = function () {
    if (NS.Debug && NS.Debug.invincible) return true;
    if (!this.alive || this.invuln > 0) return true;
    if (this.shield > 0) {
      this.shield--;
      NS.Audio.sfx.hit();
      NS.FX.spark(this.x, this.y, 8, 'hit');
      this.invuln = 12;
      return true;
    }
    this.kill(false);
    return false;
  };

  Player.prototype.kill = function () {
    if (NS.Debug && NS.Debug.invincible) return;
    if (!this.alive) return;
    this.alive = false;
    this.dying = 90;
    this.lives--;
    NS.FX.explode(this.x, this.y, 2.2, 'fire');
    NS.FX.explode(this.x + 4, this.y + 3, 1.4, 'fire');
    NS.Audio.sfx.death();
  };

  Player.prototype.respawn = function () {
    var lives = this.lives, score = this.score;
    this.reset(false);
    this.lives = lives; this.score = score;
  };

  /* ---- draw ----------------------------------------------------------- */
  Player.prototype.draw = function (g) {
    if (!this.alive) return;
    if (this.invuln > 0 && (this.anim >> 1) % 2 === 0 && this.invuln > 14) return; // blink

    var spr = this.orientation === 'vertical'
      ? NS.S.shipTop
      : (this.bank < 0 ? NS.S.shipUp : (this.bank > 0 ? NS.S.shipDown : NS.S.ship));
    var px = (this.x - spr.cx) | 0, py = (this.y - spr.cy) | 0;

    /* engine flame */
    var f = this.orientation === 'vertical' ? NS.S.flameTop : NS.S.flame[(this.anim >> 2) & 1];
    if (this.orientation === 'vertical') g.drawImage(f, (this.x - f.cx) | 0, (py + spr.height - 1) | 0);
    else g.drawImage(f, (px - f.width + 1) | 0, (this.y - f.cy) | 0);

    g.drawImage(spr, px, py);

    /* options */
    var of = NS.S.option[(this.anim >> 3) & 1];
    for (var i = 0; i < this.options.length; i++) {
      var o = this.options[i];
      g.drawImage(of, (o.x - 2) | 0, (o.y - 2) | 0);
    }

    /* force field ellipse */
    if (this.shield > 0) {
      var a = 0.25 + 0.55 * (this.shield / this.shieldMax);
      g.strokeStyle = 'rgba(120,200,255,' + a.toFixed(2) + ')';
      g.lineWidth = 1;
      g.beginPath();
      g.ellipse(this.x + 1, this.y, 15, 11, 0, 0, Math.PI * 2);
      g.stroke();
      if ((this.anim >> 2) % 2 === 0) {
        g.strokeStyle = 'rgba(200,240,255,0.35)';
        g.beginPath();
        g.ellipse(this.x + 1, this.y, 12, 8, 0, 0, Math.PI * 2);
        g.stroke();
      }
    }
  };

})(NS);
