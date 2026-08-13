/* player.js — the ship, the Gradius/Life Force power meter, and Options.
   Meter slots, left to right:
     SPEED UP | MISSILE | LASER | OPTION | FORCE FIELD
   A capsule advances the highlight; the POWER key spends it.

   The arcade original carries a RIPPLE slot between MISSILE and LASER. It is
   deliberately absent here. */
(function (NS) {
  'use strict';

  var SLOTS = ['SPEED', 'MISSILE', 'LASER', 'OPTION', 'FORCE'];
  /* Preserve the reference game's immediate response without its enormous
     whole-pixel jumps. The old 1,2,3,4,5 curve doubled speed on the first
     upgrade and crossed the playfield in under a second at maximum. */
  var SPEEDS = [1.1, 1.45, 1.8, 2.15, 2.5];
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
      this.lives = NS.Game && NS.Game.settings ? NS.Game.settings.startingLives : 3;
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
    if (NS.Game && NS.Game.record) NS.Game.record('capsulesCollected');
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
    /* Input already normalises digital diagonals and applies the controller
       dead zone. Retaining its magnitude makes a stick genuinely analog and
       prevents diagonal movement from becoming sqrt(2) times faster. */
    var dx = ax.x;
    var dy = ax.y;

    var oldX = this.x;
    var oldY = this.y;
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

    /* Animated hazards stay lethal in both modes. When wall damage is off,
       resolve each movement axis independently: the blocked component stops
       while the component parallel to the surface survives as a slide. */
    if (hitsWall(this, scrollX)) {
      if (!NS.Game.settings || NS.Game.settings.wallDamage !== false) {
        this.kill(true);
        return;
      }
      resolveWallSlide(this, scrollX, oldX, oldY);
    }
    if (hitsHazard(this)) {
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

  function hitsWall(p, scrollX) {
    if (NS.Game.stage >= 3) return NS.Campaign.hitsWall(p);
    if (p.orientation === 'vertical') return NS.Level2.hitsWall(p);
    return NS.Terrain.hitsRect(scrollX,
      p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);
  }

  function hitsHazard(p) {
    return NS.Game.stage >= 3 && NS.Campaign.hitsHazard(p);
  }

  function resolveWallSlide(p, scrollX, oldX, oldY) {
    var movedX = p.x;
    var movedY = p.y;
    /* Side-scrolling corridors usually block vertical movement; vertical
       stages usually block horizontal movement. Trying the parallel axis
       first also makes diagonal contact feel stable at shallow angles. */
    var candidates = p.orientation === 'vertical'
      ? [{ x: oldX, y: movedY }, { x: movedX, y: oldY }]
      : [{ x: movedX, y: oldY }, { x: oldX, y: movedY }];
    candidates.push({ x: oldX, y: oldY });
    for (var i = 0; i < candidates.length; i++) {
      p.x = candidates[i].x;
      p.y = candidates[i].y;
      if (!hitsWall(p, scrollX)) return;
    }
    /* Scrolling geometry can advance into a stationary ship between frames.
       Seek the nearest free pixel so safe walls remain solid rather than
       leaving the hull embedded until the player moves away. */
    var maxNudge = Math.ceil(Math.max(p.w, p.h)) + 4;
    for (var d = 1; d <= maxNudge; d++) {
      var nudges = p.orientation === 'vertical'
        ? [{ x: oldX + d, y: oldY }, { x: oldX - d, y: oldY },
           { x: oldX, y: oldY + d }, { x: oldX, y: oldY - d }]
        : [{ x: oldX, y: oldY + d }, { x: oldX, y: oldY - d },
           { x: oldX + d, y: oldY }, { x: oldX - d, y: oldY }];
      for (var j = 0; j < nudges.length; j++) {
        p.x = NS.clamp(nudges[j].x, p.sw * 0.5, NS.W - p.sw * 0.5);
        p.y = NS.clamp(nudges[j].y, p.sh * 0.5,
          NS.PLAYFIELD_H - p.sh * 0.5 - (p.orientation === 'vertical' ? NS.S.flameTop.height - 1 : 0));
        if (!hitsWall(p, scrollX)) return;
      }
    }
    p.x = oldX;
    p.y = oldY;
  }

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
    if (!this.alive || this.invuln > 0) return true;
    if (NS.Autoplay && NS.Autoplay.active()) {
      NS.Autoplay.noteHit();
      this.invuln = 12;                 // hit feedback without death-blinking
      NS.Audio.sfx.impact('shield', 0.45);
      NS.Feedback.playerHit(true, this.x, this.y);
      return true;
    }
    if (NS.Debug && NS.Debug.invincible) return true;
    if (this.shield > 0) {
      this.shield--;
      NS.Audio.sfx.impact('shield', 0.58);
      NS.Feedback.playerHit(true, this.x, this.y);
      this.invuln = 12;
      return true;
    }
    this.kill(false);
    return false;
  };

  Player.prototype.kill = function () {
    if (NS.Autoplay && NS.Autoplay.active()) { NS.Autoplay.noteTerrain(); return; }
    if (NS.Debug && NS.Debug.invincible) return;
    if (!this.alive) return;
    this.alive = false;
    if (NS.Game && NS.Game.record) NS.Game.record('deaths');
    this.dying = 90;
    this.lives--;
    NS.FX.explode(this.x, this.y, 2.2, 'fire');
    NS.FX.explode(this.x + 4, this.y + 3, 1.4, 'fire');
    NS.Audio.sfx.death();
    NS.Feedback.playerHit(false, this.x, this.y);
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
