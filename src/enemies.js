/* enemies.js — Stage 1 bestiary.
     flapper  : swooping cell-craft, arrives in squadrons of 5-8
     carrier  : red squadron; wipe the whole formation for a power capsule
     rusher   : fast dart, no shots — arrives in tight arrowheads
     splitter : dividing amoeba; the big one releases two small ones
     ducker   : crawls along the flesh, fires aimed bursts
     mouth    : wall-mounted maw, opens and spits
     hatch    : wall pod that cracks open and launches a rusher flight
     tentacle : wall-anchored whip that lashes across the corridor
     spore    : slow drifting mine
     prominence: erupting fire arc (indestructible terrain hazard) */
(function (NS) {
  'use strict';

  var E = {};
  NS.Enemies = E;

  E.list = [];
  E.groups = {};        // groupId -> { total, killed, bonus, paid }
  var rng = NS.makeRng(0x1F0ACE);    // reset with the stage: identical run data
  E.ENTRY_MARGIN = 128;               // beyond the full perspective frustum

  /* Capsules come from wiping a complete formation — every craft in the
     row, before any of them escapes. As in the original, *every* row pays,
     which is what makes the opening generous: clear a row, take the cube,
     move to the next row, clear that. The power curve comes from how hard
     a full clear is, not from the game rationing the drops.

     Set false to restrict payouts to the marked red carrier sets only. */
  E.everySetDrops = true;

  /* ---- threat tier ------------------------------------------------------
     Life Force does not open at full strength. The stage arms itself in
     stages, and for the first stretch nothing shoots at all — the opening
     formations are a *movement* threat, read and dodged, not a bullet
     threat. Wall pods sit silent through that intro and only join in once
     the initial run of formations is behind you.

       0  nothing fires. Formations attack by flying at you: swoops, dives
          and fan turns. Collision is the only danger in the air.
       1  flyers arm — one aimed shot each, and only once in their life.
       2  wall pods wake up, but single shots only.
       3  full strength: mouths spit three-way spreads, duckers fire bursts.

     Tiers are keyed to world position in the spawn script, so debug seeks
     and ordinary uninterrupted play always resolve to the same state. */
  E.tier = 0;
  E.setTier = function (t) { E.tier = t; };

  /* ---- the passability guarantee ----------------------------------------
     The corridor's indestructible hazards — erupting prominences and
     lashing tentacles — are sized against the gap they sit in, and always
     leave MIN_LANE pixels of corridor open. Tight sections are meant to be
     threading a needle, never a wall with no door in it.

     The ship's hitbox is 8px tall, so 28 leaves real room to aim for
     rather than a pixel-perfect slot. It is set by measurement, not taste:
     at 24 a ship that had spent nothing on SPEED could not cross the
     corridor fast enough when a tentacle sweep split the lane at ~6690.
     See scratchpad/feasible.js — it sweeps the whole stage and reports any
     frame where no survivable path exists. */
  var MIN_LANE = 28;
  var FLAME_G = 0.055;      // per-frame gravity on an eruption
  E.MIN_LANE = MIN_LANE;

  function flyersArmed()  { return E.tier >= 1; }
  function surfaceArmed() { return E.tier >= 2; }
  function surfaceFull()  { return E.tier >= 3; }
  E.flyersArmed = flyersArmed;

  E.reset = function () {
    E.list.length = 0;
    E.groups = {};
    E.tier = 0;
    rng = NS.makeRng(0x1F0ACE);
  };

  function base(o) {
    o.dead = false;
    o.t = 0;
    o.hitFlash = 0;
    o.hp = o.hp || 1;
    o.score = o.score || 100;
    E.list.push(o);
    return o;
  }

  function registerGroup(gid, bonus) {
    if (!E.groups[gid]) E.groups[gid] = { total: 0, killed: 0, bonus: !!bonus };
    E.groups[gid].total++;
  }

  function worldXOffscreen(worldX) {
    var scroll = NS.Game && NS.Game.scrollX ? NS.Game.scrollX : 0;
    return Math.max(worldX, scroll + NS.W + E.ENTRY_MARGIN);
  }

  /* ---- flyers ---------------------------------------------------------
     Patterns, all lifted from the shapes Life Force actually flies:
       sine   — straight-ish wave across the screen
       swoop  — dives toward the player's lane, then peels away
       loop   — curls up and back, the classic fan turn
       strafe — tight vertical shimmy while advancing
       curl   — flies in, brakes, then retreats the way it came
       rush   — fast straight dash on its entry heading, never shoots
       dive   — enters off the top or bottom edge and crosses the corridor
       zigzag — straight, diagonal, straight: the NES opening's Z path
     opt: { pattern, gid, bonus, delay, vx, vy, amp, phase, turn, shy } */
  E.spawnFlapper = function (x, y, opt) {
    opt = opt || {};
    if (opt.gid != null) registerGroup(opt.gid, opt.bonus);
    var rush = opt.pattern === 'rush';
    return base({
      kind: rush ? 'rusher' : 'flapper', x: x, y: y,
      w: rush ? 8 : 9, h: rush ? 5 : 7,
      hp: 1, score: rush ? 120 : (opt.bonus ? 200 : 100),
      pattern: opt.pattern || 'sine', gid: opt.gid, bonus: !!opt.bonus,
      spawnDelay: opt.delay || 0,
      y0: y,
      vx: opt.vx != null ? opt.vx : -1.35,
      vy: opt.vy != null ? opt.vy : 0,
      amp: opt.amp != null ? opt.amp : 16,
      phase: opt.phase != null ? opt.phase : 0,
      turn: opt.turn || 1,
      age: 0,
      /* Whether a craft is armed is decided once, when it spawns. A flight
         that launched during the unarmed opening stays unarmed for its
         whole life — those are "the first guys", and their attack is the
         shape they fly, not a bullet. `shy` marks the dense late formations
         so screen-filling waves don't also become bullet storms. */
      shootAt: (opt.shy || rush || !flyersArmed())
                 ? 1e9
                 : 40 + (rng() * 60 | 0),
      hasShot: false
    });
  };

  /* Dividing amoeba. tier 1 splits into two tier-0 cells on death. */
  E.spawnSplitter = function (x, y, tier, vy) {
    var big = tier !== 0;
    return base({
      kind: 'splitter', x: x, y: y,
      w: big ? 9 : 5, h: big ? 9 : 5,
      hp: big ? 3 : 1, score: big ? 250 : 100,
      tier: big ? 1 : 0,
      vx: big ? -0.75 : -1.1, vy: vy || 0,
      phase: rng() * 6.28
    });
  };

  /* Wall pod: cracks open on a cycle and launches a flight of rushers. */
  E.spawnHatch = function (worldX, onCeiling, opt) {
    opt = opt || {};
    worldX = worldXOffscreen(worldX);
    return base({
      kind: 'hatch', worldX: worldX, x: 0, y: 0, w: 10, h: 6, hp: 4,
      score: opt.carrier ? 800 : 400, carrier: !!opt.carrier,
      onCeiling: !!onCeiling, open: 0,
      cycle: opt.cycle || 150, broods: opt.broods == null ? 2 : opt.broods,
      launched: 0
    });
  };

  /* Wall-anchored whip. The root takes damage; the arm is a hazard volume. */
  E.spawnTentacle = function (worldX, onCeiling, opt) {
    opt = opt || {};
    worldX = worldXOffscreen(worldX);
    return base({
      kind: 'tentacle', worldX: worldX, x: 0, y: 0, w: 8, h: 6, hp: 6,
      score: opt.carrier ? 1000 : 600, carrier: !!opt.carrier,
      onCeiling: !!onCeiling,
      segs: opt.segs || 7, reach: opt.reach || 52,
      period: opt.period || 170, offset: opt.offset || 0,
      joints: [], extend: 0, sweep: 0
    });
  };

  E.spawnSpore = function (x, y) {
    return base({
      kind: 'spore', x: x, y: y, w: 7, h: 7, hp: 2, score: 150,
      vx: -0.6, vy: 0, phase: rng() * 6.28
    });
  };

  /* ---- surface enemies (anchored to world coordinates) ----------------
     Any of these can be flagged `carrier`. A carrier is a lone enemy that
     holds a capsule: it wears the red palette so you can see at a glance
     that it is worth going out of your way for, and it always drops. No
     dice roll — if it looks like it has one, it has one. */
  E.spawnDucker = function (worldX, onCeiling, opt) {
    opt = opt || {};
    worldX = worldXOffscreen(worldX);
    return base({
      kind: 'ducker', worldX: worldX, x: 0, y: 0, w: 8, h: 7,
      hp: 2, score: opt.carrier ? 500 : 200, carrier: !!opt.carrier,
      onCeiling: !!onCeiling, walk: 0, dir: -0.35,
      fireT: 60 + (rng() * 60 | 0)
    });
  };

  E.spawnMouth = function (worldX, onCeiling, opt) {
    opt = opt || {};
    worldX = worldXOffscreen(worldX);
    return base({
      kind: 'mouth', worldX: worldX, x: 0, y: 0, w: 10, h: 7,
      hp: 3, score: opt.carrier ? 700 : 300, carrier: !!opt.carrier,
      onCeiling: !!onCeiling, open: 0, cycle: 90 + (rng() * 40 | 0)
    });
  };

  /* Prominence: the flame tongue that erupts out of the wall in an arc.
     Not destructible — you weave through it. */
  E.spawnProminence = function (worldX, onCeiling, opt) {
    opt = opt || {};
    worldX = worldXOffscreen(worldX);
    return base({
      kind: 'prominence', worldX: worldX, x: 0, y: 0, w: 6, h: 6,
      hp: 9999, score: 0, invincible: true,
      onCeiling: !!onCeiling,
      period: opt.period || 150, offset: opt.offset || 0,
      power: opt.power || 3.2, spread: opt.spread || 0.55,
      flames: [], firing: false
    });
  };

  /* ---- update --------------------------------------------------------- */
  E.update = function (scrollX, player) {
    var i, e;
    for (i = 0; i < E.list.length; i++) {
      e = E.list[i];
      if (e.dead) continue;
      e.t++;
      NS.tickDamageFlash(e);

      /* Remember last frame's position. The AI-assist gunner leads its shots
         off the measured per-frame velocity, which is exact for every
         movement pattern without each pattern having to report it. */
      e.prevX = e.x; e.prevY = e.y;

      if (e.spawnDelay > 0) { e.spawnDelay--; continue; }
      e.age++;

      switch (e.kind) {
        case 'flapper':
        case 'rusher':  updateFlapper(e, player); clampToCorridor(e, scrollX); break;
        case 'splitter': updateSplitter(e, player); clampToCorridor(e, scrollX); break;
        case 'spore':   updateSpore(e, player); clampToCorridor(e, scrollX); break;
        case 'ducker':  updateDucker(e, scrollX, player); break;
        case 'mouth':   updateMouth(e, scrollX, player); break;
        case 'hatch':   updateHatch(e, scrollX); break;
        case 'tentacle': updateTentacle(e, scrollX); break;
        case 'prominence': updateProminence(e, scrollX); break;
      }

      /* off-screen cleanup */
      if (e.kind === 'flapper' || e.kind === 'rusher' ||
          e.kind === 'splitter' || e.kind === 'spore') {
        /* generous left margin: rear-entry flights spawn behind the player
           and fly right, so they must not be culled on the frame they appear */
        if (e.x < -E.ENTRY_MARGIN - 64 || e.x > NS.W + E.ENTRY_MARGIN + 64 ||
            e.y < -E.ENTRY_MARGIN || e.y > NS.PLAYFIELD_H + E.ENTRY_MARGIN) e.dead = true;
      } else if (e.worldX != null) {
        if (e.worldX - scrollX < -40) e.dead = true;
      }
    }
    NS.prune(E.list);
  };

  /* Flyers hug the corridor instead of clipping through the flesh: their
     path is folded back inside the walls, which also keeps squadrons
     killable (and their capsule earnable) in the tight sections. */
  function clampToCorridor(e, scrollX) {
    if (e.x > NS.W + 8) return;                 // still off-screen, let it come in
    var wx = scrollX + e.x + e.w * 0.5;
    var lo = NS.Terrain.topAt(wx) + 2;
    var hi = NS.Terrain.botAt(wx) - e.h - 2;
    if (hi < lo) { lo = hi = (lo + hi) * 0.5; }
    if (e.y < lo) { e.y = lo; if (e.vy < 0) e.vy = -e.vy * 0.4; if (e.y0 != null) e.y0 = NS.clamp(e.y0, lo, hi); }
    else if (e.y > hi) { e.y = hi; if (e.vy > 0) e.vy = -e.vy * 0.4; if (e.y0 != null) e.y0 = NS.clamp(e.y0, lo, hi); }
  }

  function updateFlapper(e, player) {
    e.phase += 0.075;
    switch (e.pattern) {
      case 'sine':
        e.x += e.vx;
        e.y = e.y0 + Math.sin(e.phase) * 16;
        break;
      case 'swoop':
        /* drop in from the right, curve toward the player's height, leave */
        e.x += e.vx * 1.15;
        if (e.age < 70) {
          var dy = player.alive ? (player.y - e.y) : 0;
          e.vy = NS.lerp(e.vy, NS.clamp(dy * 0.05, -1.6, 1.6), 0.08);
        } else {
          e.vy = NS.lerp(e.vy, -0.6, 0.03);
        }
        e.y += e.vy;
        break;
      case 'loop':
        /* fly in, arc up-and-back like the classic fan turn */
        if (e.age < 60) { e.x += e.vx * 1.4; e.y += Math.sin(e.phase) * 0.6; }
        else {
          var a = (e.age - 60) * 0.055;
          e.x += Math.cos(a) * 1.7 - 0.5;
          e.y += Math.sin(a) * -1.7;
        }
        break;
      case 'strafe':
        e.x += e.vx * 0.8;
        e.y += Math.sin(e.phase * 2) * 1.2;
        break;
      case 'curl':
        /* press in, brake, then retreat along the entry heading — the
           popcorn behaviour that punishes you for chasing the formation */
        if (e.age < 54) { e.x += e.vx; e.y = e.y0 + Math.sin(e.phase) * (e.amp * 0.5); }
        else { e.x -= e.vx * 1.25; e.y = e.y0 + Math.sin(e.phase) * (e.amp * 0.5); }
        break;
      case 'rush':
        /* committed dash on the heading it entered with; no course changes */
        e.x += e.vx * 1.9;
        e.y += e.vy * 1.9;
        break;
      case 'dive':
        /* crosses the corridor on a diagonal — clampToCorridor bounces it
           off the flesh so it rakes the full height of the passage */
        e.x += e.vx;
        e.y += e.vy;
        break;
      case 'zigzag':
        /* All five members execute the same three exact line segments.
           Spawn delay supplies their spacing; no per-member random phase
           is allowed to deform the row. */
        e.x += e.vx;
        if (e.age >= 46 && e.age < 78) e.y += e.turn * 1.25;
        break;
    }

    if (!e.hasShot && e.age > e.shootAt && e.x < NS.W - 10 && e.x > 20 && player.alive) {
      e.hasShot = true;
      NS.Weapons.enemyAimed(e.x + 3, e.y + 3, player.x, player.y, 1.9);
    }
  }

  function updateSplitter(e, player) {
    e.phase += 0.045;
    e.x += e.vx - NS.SCROLL_SPEED * 0.25;
    e.y += e.vy + Math.sin(e.phase) * 0.4;
    e.vy *= 0.985;
    /* the big cell lobs one shot mid-screen; the fragments never shoot */
    if (e.tier === 1 && e.age === 90 && player.alive && e.x < NS.W - 10) {
      NS.Weapons.enemyAimed(e.x + 4, e.y + 4, player.x, player.y, 1.6);
    }
  }

  function updateHatch(e, scrollX) {
    e.x = e.worldX - scrollX;
    var surf = e.onCeiling ? NS.Terrain.topAt(e.worldX) : NS.Terrain.botAt(e.worldX);
    e.y = e.onCeiling ? surf - 1 : surf - e.h + 1;

    var ph = e.t % e.cycle;
    e.open = ph > e.cycle - 46 ? 1 : 0;

    if (ph === e.cycle - 30 && e.launched < e.broods && e.x > -12 && e.x < NS.W) {
      e.launched++;
      /* a three-strong arrowhead fired out along the wall normal */
      var dir = e.onCeiling ? 1 : -1;
      for (var i = 0; i < 3; i++) {
        (function (i) {
          setTimeoutFrames(i * 7, function () {
            if (e.dead) return;
            E.spawnFlapper(e.x + 2, e.y + (e.onCeiling ? e.h : 0), {
              pattern: 'rush',
              vx: -1.15 - i * 0.12,
              vy: dir * (0.85 - i * 0.22)
            });
          });
        })(i);
      }
      NS.Audio.sfx.hit();
    }
  }

  function updateTentacle(e, scrollX) {
    e.x = e.worldX - scrollX;
    var surf = e.onCeiling ? NS.Terrain.topAt(e.worldX) : NS.Terrain.botAt(e.worldX);
    e.y = e.onCeiling ? surf : surf - e.h;

    /* extend/retract on a cycle, sweeping through an arc while extended */
    var ph = (e.t + e.offset) % e.period;
    var lash = e.period * 0.55;
    if (ph < lash) {
      var u = ph / lash;                       // 0..1 across the lash
      e.extend = Math.sin(u * Math.PI);        // out and back
      e.sweep = Math.sin(u * Math.PI * 2) * 0.7;
    } else {
      e.extend = 0;
      e.sweep = 0;
    }

    /* rebuild the arm as a chain of joints bending along the sweep */
    e.joints.length = 0;
    if (e.extend <= 0.02) return;
    var dir = e.onCeiling ? 1 : -1;
    var baseA = Math.PI / 2 * dir;
    var px = e.x + e.w * 0.5;
    var py = e.y + (e.onCeiling ? e.h : 0);
    /* same guarantee as the prominences: the arm can never span more of
       the corridor than the gap minus the lane we always keep open */
    var gapT = NS.Terrain.botAt(e.worldX) - NS.Terrain.topAt(e.worldX);
    var reach = Math.min(e.reach, Math.max(10, gapT - MIN_LANE));
    var segLen = (reach / e.segs) * e.extend;
    for (var i = 0; i < e.segs; i++) {
      var a = baseA + e.sweep * (i / e.segs) + Math.sin(e.t * 0.09 + i * 0.5) * 0.08;
      px += Math.cos(a) * segLen - NS.SCROLL_SPEED * 0;
      py += Math.sin(a) * segLen;
      e.joints.push({ x: px, y: py, tip: i === e.segs - 1 });
    }
  }

  function updateSpore(e, player) {
    e.phase += 0.05;
    e.x += e.vx - NS.SCROLL_SPEED * 0.3;
    e.y += Math.sin(e.phase) * 0.55;
    if (e.t % 110 === 0 && flyersArmed() && player.alive && e.x < NS.W - 8) {
      NS.Weapons.enemyAimed(e.x + 3, e.y + 3, player.x, player.y, 1.5);
    }
  }

  function updateDucker(e, scrollX, player) {
    e.worldX += e.dir;
    e.x = e.worldX - scrollX;
    var surf = e.onCeiling ? NS.Terrain.topAt(e.worldX) : NS.Terrain.botAt(e.worldX);
    e.y = e.onCeiling ? surf : surf - e.h;
    e.walk += 0.2;

    /* The cycle keeps running while the pod is dormant, so when the stage
       does arm them they are already out of phase with each other instead
       of all opening up on the same frame. */
    e.fireT--;
    if (e.fireT <= 0) {
      e.fireT = 90 + (rng() * 60 | 0);
      if (!surfaceArmed() || !player.alive || e.x <= -8 || e.x >= NS.W + 8) return;
      var n = surfaceFull() ? 2 : 1;      // bursts only at full strength
      for (var i = 0; i < n; i++) {
        (function (d) {
          setTimeoutFrames(d, function () {
            if (!e.dead && player.alive) {
              NS.Weapons.enemyAimed(e.x + 4, e.y + 3, player.x, player.y, 1.7);
            }
          });
        })(i * 10);
      }
    }
  }

  function updateMouth(e, scrollX, player) {
    e.x = e.worldX - scrollX;
    var surf = e.onCeiling ? NS.Terrain.topAt(e.worldX) : NS.Terrain.botAt(e.worldX);
    e.y = e.onCeiling ? surf - 1 : surf - e.h + 1;

    /* A dormant mouth still opens and closes. That is deliberate: it reads
       as alive and telegraphs what it will eventually do, without yet
       putting anything on screen you have to dodge. */
    var ph = (e.t + e.cycle) % e.cycle;
    e.open = ph > e.cycle - 34 ? 1 : 0;
    if (ph === e.cycle - 20 && surfaceArmed() &&
        player.alive && e.x > -10 && e.x < NS.W) {
      var spread = surfaceFull() ? [-0.22, 0, 0.22] : [0];
      for (var i = 0; i < spread.length; i++) {
        var a = NS.angleTo(e.x + 5, e.y + 3, player.x, player.y) + spread[i];
        NS.Weapons.enemyShot(e.x + 5, e.y + 3, Math.cos(a) * 1.8, Math.sin(a) * 1.8, { ignoreTerrain: true, life: 240 });
      }
    }
  }

  function updateProminence(e, scrollX) {
    e.x = e.worldX - scrollX;
    var surf = e.onCeiling ? NS.Terrain.topAt(e.worldX) : NS.Terrain.botAt(e.worldX);
    e.y = surf;

    var ph = (e.t + e.offset) % e.period;
    /* erupt for ~40 frames each cycle */
    e.firing = ph < 44;
    if (e.firing && ph % 3 === 0 && e.x > -30 && e.x < NS.W + 30) {
      /* An eruption is aimed by the lane it must leave open, not by raw
         power. We reserve MIN_LANE down the middle of the corridor and let
         the flame reach at most halfway into what remains — so even two
         prominences on opposite walls firing on the same frame cannot
         close the passage. Tight tunnels get short, fast jets; open
         caverns get tall dramatic ones, for free, because the budget
         scales with the gap.

         Launch speed is derived from the apex we want rather than picked
         directly: under constant gravity g, apex = v^2/(2g). */
      var gap = NS.Terrain.botAt(e.worldX) - NS.Terrain.topAt(e.worldX);
      var maxReach = Math.max(8, (gap - MIN_LANE) / 2);
      var frac = NS.clamp(e.power / 3.6, 0.55, 1) * (0.75 + rng() * 0.25);
      var vy0 = Math.sqrt(2 * FLAME_G * maxReach * frac);
      var lateral = (rng() - 0.5) * e.spread;
      e.flames.push({
        x: e.x + (rng() * 6 - 3), y: e.y,
        vx: lateral * 1.2 - 0.4,
        vy: (e.onCeiling ? 1 : -1) * vy0,
        life: 46 + (rng() * 16 | 0), t: 0
      });
    }
    for (var i = 0; i < e.flames.length; i++) {
      var f = e.flames[i];
      f.t++;
      f.x += f.vx - NS.SCROLL_SPEED;
      f.y += f.vy;
      f.vy += (e.onCeiling ? -FLAME_G : FLAME_G);   // arc back toward the wall
      f.vx *= 0.995;
      /* the arc dies against either wall — the one it came from or the one
         opposite, so flames never paint over the flesh */
      var fwx = scrollX + f.x;
      var swallowed = f.t > 4 &&
        (f.y < NS.Terrain.topAt(fwx) - 1 || f.y > NS.Terrain.botAt(fwx) + 1);
      if (f.t > f.life || swallowed) { e.flames.splice(i, 1); i--; }
    }
  }

  /* tiny frame-based timer used by burst-firing enemies */
  var timers = [];
  function setTimeoutFrames(frames, fn) { timers.push({ f: frames, fn: fn }); }
  E.updateTimers = function () {
    for (var i = 0; i < timers.length; i++) {
      if (--timers[i].f <= 0) { timers[i].fn(); timers.splice(i, 1); i--; }
    }
  };
  E.clearTimers = function () { timers.length = 0; };

  /* ---- damage / death ------------------------------------------------- */
  E.damage = function (e, dmg, game, shot) {
    var cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    var dx = shot && shot.vx != null ? NS.sign(shot.vx) : 1;
    var dy = shot && shot.vy != null ? NS.sign(shot.vy) : 0;
    if (e.invincible) {
      NS.FX.directional(cx, cy, -dx, -dy, 3, 'hit', 'armor');
      NS.Audio.sfx.impact('armor', 0.3); return false;
    }
    e.hp -= dmg;
    NS.Feedback.damage(e, { x: cx, y: cy, dx: dx, dy: dy, material: 'flesh', hue: 'bio', strength: e.hp > 0 ? 0.42 : 0.58 });
    if (e.hp > 0) {
      return false;
    }
    E.destroy(e, game);
    return true;
  };

  E.destroy = function (e, game) {
    e.dead = true;
    var big = e.kind === 'mouth' || e.kind === 'hatch' || e.kind === 'tentacle';
    NS.FX.explode(e.x + e.w / 2, e.y + e.h / 2, big ? 1.4 : 1.0, 'fire');
    NS.Feedback.destroy(e.x + e.w / 2, e.y + e.h / 2,
      { dx: 1, material: 'flesh', hue: 'bio', count: big ? 14 : 8, major: big });
    NS.Audio.sfx.explode();
    game.addScore(e.score, e.x, e.y);

    /* the amoeba divides rather than dying outright */
    if (e.kind === 'splitter' && e.tier === 1) {
      E.spawnSplitter(e.x - 1, e.y + 1, 0, -0.55);
      E.spawnSplitter(e.x - 1, e.y + 3, 0, 0.55);
    }

    /* ---- the capsule rule ---------------------------------------------
       Exactly as Life Force does it: capsules come from formations, and
       only from formations. Wipe a capsule-bearing set completely — every
       single craft, before any of them escapes off the left edge — and it
       pays one capsule. Not one per kill, not a random chance off a wall
       turret: one per set, deterministically.

       Letting a member escape is the whole tension. Off-screen culling
       marks a craft dead without routing through destroy(), so `killed`
       never reaches `total` and the set pays nothing. */
    if (e.gid != null) {
      var grp = E.groups[e.gid];
      if (grp) {
        grp.killed++;
        if ((grp.bonus || E.everySetDrops) && grp.killed >= grp.total && !grp.paid) {
          grp.paid = true;
          game.spawnCapsule(e.x, e.y);
        }
      }
    } else if (e.carrier) {
      /* a lone carrier — the red one you could see was worth chasing */
      game.spawnCapsule(e.x, e.y);
    }
  };

  /* Indestructible damage volumes: prominence flames and tentacle arms.
     Exposed here so game.js can test them against the ship in one pass. */
  E.eachHazard = function (fn) {
    for (var i = 0; i < E.list.length; i++) {
      var e = E.list[i];
      if (e.dead) continue;
      if (e.kind === 'prominence') {
        for (var j = 0; j < e.flames.length; j++) {
          var f = e.flames[j];
          fn(f.x - 2, f.y - 2, 5, 5);
        }
      } else if (e.kind === 'tentacle') {
        for (var k = 0; k < e.joints.length; k++) {
          var jt = e.joints[k];
          fn(jt.x - 2, jt.y - 2, 4, 4);
        }
      }
    }
  };

  /* ---- draw ----------------------------------------------------------- */
  E.draw = function (g) {
    for (var i = 0; i < E.list.length; i++) {
      var e = E.list[i];
      if (e.dead || e.spawnDelay > 0) continue;
      var f = (e.t >> 3) & 1;
      var hitFlash = NS.damageFlashing(e);
      var kick = NS.hitOffset(e);
      g.save(); g.translate(kick.x, kick.y);

      switch (e.kind) {
        case 'flapper':
          drawSpr(g, e.bonus ? NS.S.carrier[f] : NS.S.flapper[f], e.x, e.y, hitFlash);
          break;
        case 'rusher':
          drawSpr(g, NS.S.rusher[(e.t >> 2) & 1], e.x, e.y, hitFlash);
          break;
        case 'splitter':
          drawSpr(g, e.tier === 1 ? NS.S.splitterBig[f] : NS.S.splitterSmall[f],
                  e.x, e.y, hitFlash);
          break;
        case 'hatch': {
          var hs = skin(e, e.open ? NS.S.hatchOpen : NS.S.hatchClosed);
          if (e.onCeiling) {
            g.save();
            g.translate((e.x | 0), (e.y | 0) + e.h);
            g.scale(1, -1);
            g.drawImage(hitFlash ? NS.tintCache(hs) : hs, 0, 0);
            g.restore();
          } else {
            drawSpr(g, hs, e.x, e.y, hitFlash);
          }
          break;
        }
        case 'tentacle': {
          /* arm first so the root plate sits on top of segment 0 */
          for (var q = 0; q < e.joints.length; q++) {
            var jt = e.joints[q];
            var seg = jt.tip ? NS.S.tentacleTip : NS.S.tentacleSeg;
            g.drawImage(seg, (jt.x - seg.width / 2) | 0, (jt.y - seg.height / 2) | 0);
          }
          var rs = skin(e, NS.S.tentacleRoot[f]);
          if (e.onCeiling) {
            g.save();
            g.translate((e.x | 0), (e.y | 0) + e.h);
            g.scale(1, -1);
            g.drawImage(hitFlash ? NS.tintCache(rs) : rs, 0, 0);
            g.restore();
          } else {
            drawSpr(g, rs, e.x, e.y, hitFlash);
          }
          break;
        }
        case 'spore':
          drawSpr(g, NS.S.spore, e.x, e.y, hitFlash);
          break;
        case 'ducker': {
          var s = skin(e, NS.S.ducker[(e.walk | 0) & 1]);
          if (e.onCeiling) {
            g.save();
            g.translate((e.x | 0), (e.y | 0) + e.h);
            g.scale(1, -1);
            g.drawImage(hitFlash ? NS.tintCache(s) : s, 0, 0);
            g.restore();
          } else {
            drawSpr(g, s, e.x, e.y, hitFlash);
          }
          break;
        }
        case 'mouth': {
          var m = skin(e, e.open ? NS.S.mouthOpen : NS.S.mouthClosed);
          if (e.onCeiling) {
            g.save();
            g.translate((e.x | 0), (e.y | 0) + e.h);
            g.scale(1, -1);
            g.drawImage(hitFlash ? NS.tintCache(m) : m, 0, 0);
            g.restore();
          } else {
            drawSpr(g, m, e.x, e.y, hitFlash);
          }
          break;
        }
        case 'prominence': {
          /* glowing vent at the base */
          var charge = NS.Feedback.hazardCharge({ t: e.t + e.offset, period: e.period });
          if (e.firing || charge > 0) {
            g.fillStyle = charge > 0 ? 'rgba(255,245,170,' + (0.35 + charge * 0.65) + ')' : 'rgba(255,190,90,0.75)';
            g.fillRect((e.x | 0) - 3, (e.y | 0) - (e.onCeiling ? 0 : 2), 7, 2);
          }
          for (var j = 0; j < e.flames.length; j++) {
            var fl = e.flames[j];
            var spr = NS.S.prom[(fl.t >> 2) & 1];
            g.drawImage(spr, (fl.x - 2) | 0, (fl.y - 2) | 0);
          }
          break;
        }
      }
      g.restore();
    }
  };

  function drawSpr(g, spr, x, y, flash) {
    g.drawImage(flash ? NS.tintCache(spr) : spr, x | 0, y | 0);
  }

  /* pick the sprite an enemy should actually be drawn with */
  function skin(e, spr) { return e.carrier ? NS.carrierTint(spr) : spr; }
  E.skin = skin;

  /* Memoised damage-red versions so recoloring never lands in the frame loop. */
  var flashCache = new Map();
  NS.tintCache = function (spr) {
    var c = flashCache.get(spr);
    if (!c) { c = NS.tint(spr, 255, 48, 56, 0.86); flashCache.set(spr, c); }
    return c;
  };

  /* Carrier livery: the same red the carrier squadrons wear, so "this one
     is holding a capsule" reads identically whether it is a whole row of
     craft or a single wall enemy. */
  var carrierCache = new Map();
  NS.carrierTint = function (spr) {
    var c = carrierCache.get(spr);
    if (!c) { c = NS.tint(spr, 255, 70, 40, 0.6); carrierCache.set(spr, c); }
    return c;
  };

})(NS);
