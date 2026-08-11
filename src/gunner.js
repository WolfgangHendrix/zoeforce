/* gunner.js — the three shooting modes.

     MANUAL  the original: you hold the fire key, the ship shoots
     AUTO    the gun never stops; you only ever have to fly
     ASSIST  an expert gunner flies your guns for you

   ASSIST is not "hold the trigger down". A good Life Force player does not
   spray, because the gun has a hard on-screen shot limit (2 volleys, more
   with Options) and a wasted volley is a wave you fail to clear. So the
   assist gunner does what a strong human does:

     • leads every shot off the target's measured velocity, so it fires at
       where the target *will* be, not where it is
     • checks the flight path against the flesh first — the corridor eats
       normal shots, and a shot into a wall is a shot you did not have
     • counts the Options as extra muzzles, and takes a shot if the lane is
       clear from *any* of them
     • holds fire when nothing is solvable, keeping the shot budget free for
       the moment a target does line up
     • on the boss, fires only while the eye channel is open, which is the
       only window that damages it at all

   The player still flies. Positioning, dodging, and the power meter stay
   entirely in your hands in every mode. */
(function (NS) {
  'use strict';

  var Gun = {};
  NS.Gunner = Gun;

  var MODES = ['manual', 'auto', 'assist'];
  var LABEL = { manual: 'MANUAL', auto: 'AUTO', assist: 'AI ASSIST' };

  Gun.MODES = MODES;
  Gun.mode = 'manual';

  Gun.label = function () { return LABEL[Gun.mode]; };

  Gun.load = function () {
    try {
      var m = localStorage.getItem('ns_firemode');
      if (m && MODES.indexOf(m) >= 0) Gun.mode = m;
    } catch (e) { /* storage unavailable — stay on the default */ }
  };

  Gun.set = function (m) {
    if (MODES.indexOf(m) < 0) return;
    Gun.mode = m;
    try { localStorage.setItem('ns_firemode', m); } catch (e) {}
  };

  Gun.cycle = function () {
    Gun.set(MODES[(MODES.indexOf(Gun.mode) + 1) % MODES.length]);
    return Gun.mode;
  };

  /* ---- shot characteristics per equipped weapon ------------------------ */
  function shotSpeed(p) {
    return p.weapon === 'laser' ? 10 : 6;
  }
  /* vertical tolerance: how far off-lane a target can be and still be hit */
  function shotHalfHeight(p) {
    return p.weapon === 'laser' ? 2 : 1.5;
  }
  /* how many frames ahead it is worth predicting */
  var MAX_LEAD = 110;

  /* ---- does a shot from (mx,my) solve this target? ---------------------
     `window` optionally constrains when the shot must land: the boss core
     is only vulnerable during the eye-open window, so a shot that arrives
     early or late is wasted no matter how well aimed. */
  function solves(p, mx, my, tx, ty, tw, th, tvx, tvy, scrollX, checkTerrain, window) {
    var dx = tx + tw * 0.5 - mx;
    if (dx <= 0) return false;                       // the gun only fires right

    var closing = shotSpeed(p) - tvx;                // tvx is negative inbound
    if (closing <= 0.05) return false;               // target outruns the shot
    var t = dx / closing;
    if (t > MAX_LEAD) return false;
    if (window && (t < window.start || t > window.end)) return false;

    var predY = ty + th * 0.5 + tvy * t;
    var tol = th * 0.5 + shotHalfHeight(p) + 1;
    if (Math.abs(predY - my) > tol) return false;

    /* Normal shots are stopped by the flesh; do not spend a volley on a
       wall. Laser pierces terrain, so it always has the lane. */
    if (checkTerrain && p.weapon !== 'laser') {
      var steps = 5;
      for (var i = 1; i <= steps; i++) {
        var sx = mx + (dx * i / steps);
        var sy = my + (predY - my) * (i / steps);
        if (NS.Terrain.hitsPoint(scrollX, sx, sy)) return false;
      }
    }
    return true;
  }

  /* every muzzle the ship currently has: the nose plus each Option */
  function eachMuzzle(p, fn) {
    if (fn(p.x + 10, p.y)) return true;
    for (var i = 0; i < p.options.length; i++) {
      if (fn(p.options[i].x + 4, p.options[i].y)) return true;
    }
    return false;
  }

  /* ---- the assist decision -------------------------------------------- */
  function assistWantsToFire(p, scrollX, boss) {
    var i;

    /* boss: the eye channel is the only thing worth shooting, and the shot
       has to *arrive* while it is open — so aim at where the bobbing core
       will be, and only take the shot if its flight time lands in the
       vulnerable window. */
    if (boss && boss.state !== 'dying') {
      var win = boss.openWindow();
      if (win) {
        var core = boss.coreRect();
        var cy = core.y + boss.bob;
        var bossVy = boss.prevCy != null ? (boss.y + boss.bob) - boss.prevCy : 0;
        if (eachMuzzle(p, function (mx, my) {
          return solves(p, mx, my, core.x, cy, core.w, core.h, 0, bossVy,
                        scrollX, false, win);
        })) return true;
      }
      /* the cells it coughs up are worth clearing — they home on you */
      for (i = 0; i < boss.cells.length; i++) {
        var c = boss.cells[i];
        if (c.dead) continue;
        if (eachMuzzle(p, (function (c) {
          return function (mx, my) {
            return solves(p, mx, my, c.x - 3, c.y - 3, 6, 6, c.vx, c.vy, scrollX, false);
          };
        })(c))) return true;
      }
    }

    var list = NS.Enemies.list;
    for (i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead || e.spawnDelay > 0 || e.invincible) continue;
      if (e.x > NS.W + 4) continue;                  // not on screen yet

      var vx = e.prevX != null ? e.x - e.prevX : -1.2;
      var vy = e.prevY != null ? e.y - e.prevY : 0;

      var hit = eachMuzzle(p, (function (e, vx, vy) {
        return function (mx, my) {
          return solves(p, mx, my, e.x, e.y, e.w, e.h, vx, vy, scrollX, true);
        };
      })(e, vx, vy));
      if (hit) return true;
    }
    return false;
  }

  /* ---- what the ship asks each frame ---------------------------------- */
  /* Returns true when the guns should fire this frame. */
  Gun.wantsFire = function (p, input, scrollX, boss) {
    switch (Gun.mode) {
      case 'auto':
        return true;
      case 'assist':
        /* holding fire manually still works as an override, so you can
           always take a shot the gunner decided against */
        return input.held('fire') || assistWantsToFire(p, scrollX, boss);
      default:
        return input.held('fire');
    }
  };

})(NS);
