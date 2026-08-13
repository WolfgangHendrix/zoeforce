/* autoplay.js — concealed CPU showcase pilot for hands-free capture.

   This module deliberately has no draw function. When enabled from the QA
   console it supplies only player input, so the recorded frame remains the
   ordinary game: no badge, watermark, telemetry or attract-mode caption. */
(function (NS) {
  'use strict';

  var A = {};
  NS.Autoplay = A;

  var enabled = false;
  var finished = false;
  var attract = false;
  var axis = { x: 0, y: 0 };
  var powerPulse = false;
  var safety = { hits: 0, terrain: 0 };

  A.active = function () { return enabled; };
  A.attracting = function () { return enabled && attract; };
  A.finished = function () { return finished; };
  A.stats = function () { return { hits: safety.hits, terrain: safety.terrain }; };
  A.noteHit = function () { safety.hits++; };
  A.noteTerrain = function () { safety.terrain++; };

  A.start = function (G, opt) {
    opt = opt || {};
    enabled = true;
    attract = !!opt.attract;
    finished = false;
    axis.x = axis.y = 0;
    powerPulse = false;
    safety.hits = safety.terrain = 0;

    /* Remove inspection-only presentation before the debug panel closes. */
    if (NS.Debug) {
      NS.Debug.hitboxes = false;
      NS.Debug.invincible = false;
    }
    G.modeMsg = 0;
    G.voxelMsgT = 0;
    G.startRun(1);
  };

  A.startAttract = function (G) { A.start(G, { attract: true }); };

  A.stop = function () {
    enabled = false;
    attract = false;
    axis.x = axis.y = 0;
    powerPulse = false;
  };

  A.finish = function () {
    enabled = false;
    attract = false;
    finished = true;
    axis.x = axis.y = 0;
    powerPulse = false;
  };

  function horizontal(G) {
    return G.stage === 1 || G.stage === 3 || G.stage === 5;
  }

  function live(list) {
    for (var i = 0; i < list.length; i++) if (!list[i].dead) return list[i];
    return null;
  }

  function pickupTarget(G) {
    var list;
    if (G.looseOptions.length) {
      var loose = live(G.looseOptions);
      if (loose) return loose;
    }
    if (G.stage === 1) list = G.capsules;
    else if (G.stage === 2) list = NS.Level2.pickups;
    else list = NS.Campaign.pickups;
    return live(list || []);
  }

  function stage1Target(G) {
    var p = G.player;
    if (G.boss) {
      var core = G.boss.coreRect ? G.boss.coreRect() : null;
      return { x: 48, y: core ? core.y + core.h / 2 + (G.boss.bob || 0) : G.boss.y };
    }
    var best = null, bestScore = Infinity;
    for (var i = 0; i < NS.Enemies.list.length; i++) {
      var e = NS.Enemies.list[i];
      if (e.dead || e.invincible || e.spawnDelay > 0 || e.x < p.x + 8 || e.x > NS.W + 8) continue;
      var score = e.x - p.x - (e.bonus ? 36 : 0);
      if (score < bestScore) { best = e; bestScore = score; }
    }
    return best ? { x: 48, y: best.y + best.h / 2 } : { x: 48, y: p.y };
  }

  function stage2Target(G) {
    var L = NS.Level2, p = G.player;
    if (L.fortress && !L.fortress.dead) {
      for (var i = 0; i < L.fortress.cores.length; i++) {
        var core = L.fortress.cores[i];
        if (!core.dead) return { x: core.x, y: 172 };
      }
    }
    if (L.boss && !L.boss.dead) return { x: L.boss.x, y: 172 };
    var best = null, distance = Infinity;
    for (i = 0; i < L.enemies.length; i++) {
      var e = L.enemies[i];
      if (e.dead || !e.active || e.y < -8 || e.y >= p.y) continue;
      var d = p.y - e.y - (e.bonus || e.carrier ? 30 : 0);
      if (d < distance) { best = e; distance = d; }
    }
    return best ? { x: best.x, y: 172 } : { x: p.x, y: 172 };
  }

  function campaignBarrierTarget(C, p) {
    if (!C.horizontal() || !C.barriers || !C.barriers.length) return null;
    var nearest = null, nearestX = Infinity;
    for (var i = 0; i < C.barriers.length; i++) {
      var wall = C.barriers[i], wx = C.barrierScreenX(wall);
      if (wx < p.x + 8 || wx > NS.W + 50 || wx >= nearestX) continue;
      nearest = wall; nearestX = wx;
    }
    if (!nearest) return null;

    /* Prefer an existing breach. A full seal has none, so hold the current
       firing lane and bore through its nearest cell; once that cell breaks,
       the same calculation naturally turns it into the route. */
    var chosen = null, best = Infinity;
    for (i = 0; i < nearest.cells.length; i++) {
      var cell = nearest.cells[i];
      if (!cell.dead) continue;
      var cy = cell.y + cell.h / 2, d = Math.abs(cy - p.y);
      if (d < best) { chosen = cell; best = d; }
    }
    if (!chosen) for (i = 0; i < nearest.cells.length; i++) {
      cell = nearest.cells[i]; cy = cell.y + cell.h / 2; d = Math.abs(cy - p.y);
      if (d < best) { chosen = cell; best = d; }
    }
    return chosen ? { x: 48, y: chosen.y + chosen.h / 2 } : null;
  }

  function campaignTarget(G) {
    var C = NS.Campaign, p = G.player, side = C.horizontal();
    if (C.mini && !C.mini.dead) {
      for (var i = 0; i < C.mini.cores.length; i++) {
        var core = C.mini.cores[i];
        if (core.hp > 0) return side ? { x: 48, y: core.y } : { x: core.x, y: 172 };
      }
    }
    if (C.boss && !C.boss.dead) {
      /* Tutanhamanattack alternates sides. When it is behind the ship there
         is no firing solution; tracking its y would only ram the body. */
      if (side) return C.stage === 5 && C.boss.x < 82
        ? { x: 48, y: C.boss.y < NS.PLAYFIELD_H / 2 ? 168 : 40 }
        : { x: 48, y: C.boss.y };
      var bx = C.stage === 6 && C.boss.form === 'dragon' ? C.boss.dragonX : C.boss.x;
      return { x: bx == null ? NS.W / 2 : bx, y: 172 };
    }
    var barrier = campaignBarrierTarget(C, p);
    if (barrier) return barrier;
    var best = null, distance = Infinity;
    for (i = 0; i < C.enemies.length; i++) {
      var e = C.enemies[i];
      if (e.dead || !e.active || e.x < -8 || e.x > NS.W + 8 || e.y < -8 || e.y > NS.PLAYFIELD_H + 8) continue;
      var ahead = side ? e.x - p.x : p.y - e.y;
      if (ahead < 0) continue;
      var d = ahead - (e.bonus ? 30 : 0);
      if (d < distance) { best = e; distance = d; }
    }
    if (best) return side ? { x: 48, y: best.y } : { x: best.x, y: 172 };
    return side ? { x: 48, y: p.y } : { x: p.x, y: 172 };
  }

  function collidesAt(G, x, y) {
    var p = G.player;
    var probe = { x: x, y: y, w: p.w, h: p.h };
    if (G.stage === 1) {
      if (NS.Terrain.hitsRect(G.scrollX, x - p.w / 2, y - p.h / 2, p.w, p.h)) return true;
      var blocked = false;
      NS.Enemies.eachHazard(function (hx, hy, hw, hh) {
        if (!blocked && NS.rectHit({ x:x-p.w/2, y:y-p.h/2, w:p.w, h:p.h },
                                   { x:hx, y:hy, w:hw, h:hh })) blocked = true;
      });
      return blocked;
    }
    return G.stage === 2 ? NS.Level2.hitsPlayer(probe) : NS.Campaign.hitsPlayer(probe);
  }

  function projectileList(G) {
    if (G.stage === 1) return NS.Weapons.enemy;
    if (G.stage === 2) {
      var L = NS.Level2, out = L.enemyShots.concat(L.rocks);
      if (L.fortress) out = out.concat(L.fortress.balls);
      return out;
    }
    var list = NS.Campaign.enemyShots.slice();
    if (NS.Campaign.boss && NS.Campaign.boss.eyeList) list = list.concat(NS.Campaign.boss.eyeList);
    return list;
  }

  function dangerAt(G, x, y) {
    var threats = projectileList(G), danger = 0;
    for (var i = 0; i < threats.length; i++) {
      var q = threats[i];
      if (!q || q.dead) continue;
      var qx = q.x == null ? 0 : q.x, qy = q.y == null ? 0 : q.y;
      var vx = q.vx || 0, vy = q.vy || 0;
      var rx = qx - x, ry = qy - y, vv = vx * vx + vy * vy;
      var t = vv > 0.001 ? NS.clamp(-(rx * vx + ry * vy) / vv, 0, 36) : 0;
      var dx = rx + vx * t, dy = ry + vy * t;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 18) danger += (18 - dist) * 80;
    }

    /* Do not select a firing lane through a body that is already close. */
    var bodies = G.stage === 1 ? NS.Enemies.list
               : (G.stage === 2 ? NS.Level2.enemies : NS.Campaign.enemies);
    for (i = 0; i < bodies.length; i++) {
      var e = bodies[i];
      if (e.dead || (e.spawnDelay != null && e.spawnDelay > 0) || (e.active === false)) continue;
      var ex = e.x + (G.stage === 1 ? e.w / 2 : 0), ey = e.y + (G.stage === 1 ? e.h / 2 : 0);
      var ddx = ex - x, ddy = ey - y;
      if (ddx * ddx + ddy * ddy < 24 * 24) danger += 1400;
    }
    if (G.boss && G.stage !== 2) {
      var bdx = G.boss.x - x, bdy = G.boss.y - y;
      if (bdx * bdx + bdy * bdy < 34 * 34) danger += 2200;
    }

    if (G.stage >= 3 && NS.Campaign.phase === 'flight') {
      var C = NS.Campaign, side = C.horizontal();
      for (i = 0; i < C.hazards.length; i++) {
        var h = C.hazards[i];
        var screen = side ? h.world - C.scroll : NS.PLAYFIELD_H - (h.world - C.scroll);
        var along = side ? x : y, cross = side ? y : x;
        var approach = Math.abs(screen - along);
        if (approach > 58) continue;
        var onNearSide = h.side === 'top' || h.side === 'left';
        var threatened = onNearSide ? cross < h.span + 12
                                    : cross > (side ? NS.PLAYFIELD_H : NS.W) - h.span - 12;
        if (threatened) danger += (58 - approach) * 70 + 1800;
      }
    }
    return danger;
  }

  /* Pick the nearest currently safe cross-axis lane. The CPU still follows
     targets, but terrain and indestructible hazards win the argument. */
  function safeTarget(G, target) {
    var p = G.player, side = horizontal(G);
    /* Stage 5's boss occupies the left edge for half its cycle, so the ship
       holds a recording-safe firing column instead of sharing its body. */
    var minAlong = side && G.stage === 5 ? 88 : 28;
    var along = side ? NS.clamp(target.x, minAlong, 150) : NS.clamp(target.y, 42, 184);
    var desired = side ? NS.clamp(target.y, 8, NS.PLAYFIELD_H - 10)
                       : NS.clamp(target.x, 8, NS.W - 8);
    var best = null, bestScore = Infinity;
    for (var offset = 0; offset <= 128; offset += 6) {
      for (var sign = offset === 0 ? 1 : -1; sign <= 1; sign += 2) {
        var cross = desired + offset * sign;
        if (side) cross = NS.clamp(cross, p.sh / 2 + 2, NS.PLAYFIELD_H - p.sh / 2 - 5);
        else cross = NS.clamp(cross, p.sw / 2 + 2, NS.W - p.sw / 2 - 2);
        var x = side ? along : cross, y = side ? cross : along;
        if (!collidesAt(G, x, y)) {
          var score = Math.abs(cross - desired) + dangerAt(G, x, y);
          if (score < bestScore) { best = {x:x,y:y}; bestScore = score; }
        }
      }
    }
    return best || { x: side ? along : NS.W / 2, y: side ? NS.PLAYFIELD_H / 2 : along };
  }

  function safeAxis(G, target) {
    var p = G.player, speed = p.speed();
    var wanted = {
      x: NS.clamp((target.x - p.x) / 18, -1, 1),
      y: NS.clamp((target.y - p.y) / 18, -1, 1)
    };
    if (!collidesAt(G, p.x + wanted.x * speed, p.y + wanted.y * speed)) return wanted;

    var best = {x:0,y:0}, bestScore = Infinity;
    for (var i = 0; i < 16; i++) {
      var a = i / 16 * Math.PI * 2;
      var candidate = {x:Math.cos(a),y:Math.sin(a)};
      var nx = p.x + candidate.x * speed, ny = p.y + candidate.y * speed;
      if (collidesAt(G, nx, ny)) continue;
      var dx = target.x - nx, dy = target.y - ny;
      var score = dx * dx + dy * dy + dangerAt(G, nx, ny);
      if (score < bestScore) { best = candidate; bestScore = score; }
    }
    return best;
  }

  function wantsPower(p) {
    if (!p.sel) return false;
    if (p.sel === 1) return p.speedLv < 1;
    if (p.sel === 2) return p.missileLv < 1;
    if (p.sel === 3) return p.weapon !== 'laser';
    if (p.sel === 4) return p.options.length < NS.Player.MAX_OPTIONS;
    if (p.sel === 5) return p.shield < p.shieldMax;
    return false;
  }

  function updatePilot(G) {
    var p = G.player;
    var target = pickupTarget(G);
    if (target) target = { x: target.x, y: target.y };
    else if (G.stage === 1) target = stage1Target(G);
    else if (G.stage === 2) target = stage2Target(G);
    else target = campaignTarget(G);

    target = safeTarget(G, target);
    var steering = safeAxis(G, target);
    axis.x = steering.x;
    axis.y = steering.y;
    powerPulse = wantsPower(p);
  }

  A.input = function (raw, G) {
    if (!enabled || !G.player || G.state !== 'play') return raw;
    updatePilot(G);
    return {
      axis: function () { return { x: axis.x, y: axis.y }; },
      held: function (name) { return name === 'fire' || raw.held(name); },
      hit: function (name) { return (name === 'power' && powerPulse) || raw.hit(name); }
    };
  };

})(NS);
