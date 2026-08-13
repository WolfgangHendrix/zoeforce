/* weapons.js — every projectile in the game.
   Player armament follows the Life Force / Gradius rules:
     • normal shot: 2 volleys on screen at a time
     • missile:     twin wall crawlers, three speed/salvo levels
     • laser:       long piercing beam, one on screen
   Options fire copies of whatever the ship currently has equipped.

   Stage 1 keeps its projectiles in W.player. The later stages keep theirs in
   their own lists, because their collision passes are genuinely different.
   What must not differ — and did — is what a shot *is* and what it looks
   like. Stage 2 had reinvented the armament: the normal shot was a yellow
   3x7 rectangle instead of the blue-white sprite, the laser was a stubby
   3x20 dash instead of the 46px beam, and the flat and voxel renderers there
   disagreed with each other as well as with stage 1. So the geometry, the
   colours and the drawing all live here now, and every stage asks for them
   rather than describing its own. */
(function (NS) {
  'use strict';

  var W = {};
  NS.Weapons = W;

  /* One table, every camera. `long`/`thick` are along and across the line of
     travel, so the same numbers describe a side-on beam and a climbing one. */
  var SPEC = {
    normal:  { long: 6,  thick: 2, speed: 6,  dmg: 1, pierce: false },
    laser:   { long: 46, thick: 4, speed: 10, dmg: 2, pierce: true },
    missile: { long: 5,  thick: 3, dmg: 2, pierce: false }
  };
  W.SPEC = SPEC;

  /* Build one player projectile travelling along (dx, dy), centred on the
     muzzle. The stage pushes it into whichever list it keeps and may add its
     own bookkeeping fields; nothing else about it is the stage's business. */
  W.makeShot = function (type, x, y, dx, dy) {
    var k = SPEC[type] || SPEC.normal;
    var vertical = dy !== 0;
    var s = {
      type: type, dead: false, anim: 0,
      w: vertical ? k.thick : k.long,
      h: vertical ? k.long : k.thick,
      dmg: k.dmg, pierce: k.pierce,
      hit: {}, hitIds: k.pierce ? {} : null
    };
    s.x = x - s.w / 2;
    s.y = y - s.h / 2;
    s.vx = dx * k.speed;
    s.vy = dy * k.speed;
    if (NS.Feedback) NS.Feedback.muzzle(x, y, dx, dy, type === 'laser' ? 1.5 : 1);
    return s;
  };

  /* The laser is one-at-a-time in stage 1 and has to be everywhere, or it
     stops being a laser and becomes a fast repeating dash. */
  W.laserLive = function (list) {
    for (var i = 0; i < list.length; i++) {
      if (!list[i].dead && list[i].type === 'laser') return true;
    }
    return false;
  };

  W.player = [];
  W.enemy = [];

  W.reset = function () { W.player.length = 0; W.enemy.length = 0; };

  W.countNormal = function () {
    var n = 0;
    for (var i = 0; i < W.player.length; i++) {
      if (!W.player[i].dead && W.player[i].type === 'normal') n++;
    }
    return n;
  };
  W.hasLaser = function () {
    for (var i = 0; i < W.player.length; i++) {
      if (!W.player[i].dead && W.player[i].type === 'laser') return true;
    }
    return false;
  };
  W.countMissiles = function () {
    var n = 0;
    for (var i = 0; i < W.player.length; i++) {
      if (!W.player[i].dead && W.player[i].type === 'missile') n++;
    }
    return n;
  };

  /* ---- spawning ------------------------------------------------------- */
  W.shootNormal = function (x, y) {
    W.player.push({
      type: 'normal', dead: false, x: x, y: y - 1, w: 6, h: 2,
      vx: 6, vy: 0, dmg: 1, pierce: false, hitIds: null
    });
    if (NS.Feedback) NS.Feedback.muzzle(x, y, 1, 0, 1);
  };

  /* Launch geometry for one missile salvo, shared by every stage.

     Every muzzle sends a pair at the two surfaces, and missile levels above
     one add further pairs. Those extras used to be stacked three pixels
     apart at identical speed, so at level 3 six missiles flew one track and
     read as two — the upgrade looked like it had done nothing. Each pair now
     gets both a lateral offset and its own launch speed, so they meet the
     surface at different points and string out along it.

     `lead` is that per-pair speed, applied to the crossing rather than the
     advance — see missileLaunch() for why that direction and not the other. */
  W.missileFan = function (p, vertical) {
    var pairs = [{ x: p.x, y: p.y }];
    var i;
    for (i = 0; i < p.options.length; i++) {
      pairs.push({ x: p.options[i].x, y: p.options[i].y });
    }
    /* Options ride the ship's own path, so when the pilot holds still they
       collapse onto the hull and their missiles would launch from the same
       point. Rank spaces every pair regardless of where its muzzle is. */
    for (var extra = 1; extra < p.missileLv; extra++) pairs.push({ x: p.x, y: p.y });

    var out = [];
    for (i = 0; i < pairs.length; i++) {
      for (var side = -1; side <= 1; side += 2) {
        /* The offset is perpendicular to travel and points AWAY from the
           wall this missile is bound for. Both terms then push the same way:
           a later pair starts further from its wall (so it runs longer
           before it lands) and travels faster (so it covers more ground
           while it does). Offsetting along the line of travel instead —
           launching later pairs further back while also making them faster —
           had the two cancelling, which is why a level 3 salvo still landed
           in a heap. */
        out.push({
          x: pairs[i].x - (vertical ? side * i * 4 : 0),
          y: pairs[i].y - (vertical ? 0 : side * i * 4),
          wall: side,
          lead: 1 + i * 0.34
        });
      }
    }
    return out;
  };

  /* Launch speeds for a wall-crawling missile, shared by the stages that
     have to cross a corridor to reach their wall.

     These are deliberately lateral-dominant. An even 45 degree launch looks
     right standing still, but stage 2's banks are up to 230px apart and the
     ship can sit anywhere up the screen, so an even split let the missile
     fly off the top edge before it ever met a wall — the diagonal was real
     but the wall run almost never happened. Reaching the surface is the
     whole weapon; crossing about twice as fast as it advances still reads
     as a diagonal and lands in every position the ship can occupy. */
  W.missileLaunch = function (level, lead) {
    level = NS.clamp(level || 1, 1, 3);
    return {
      /* `lead` scales the crossing, not the advance. Scaling the advance
         staggered the salvo too, but by making later pairs fly further
         forward before landing — which is the one direction that runs them
         off the screen. Crossing faster instead means a later pair lands
         sooner and therefore lower, so the salvo still arrives strung out
         along the wall and every missile reaches it earlier than the first. */
      lateral: (3.1 + level * 0.20) * (lead || 1),
      accel:   0.16,
      forward: 1.35 + level * 0.12,
      /* The pair that crossed fastest landed furthest back, so it crawls
         slowest and the string keeps opening as it runs. Uniform crawl held
         the ~8px they land with, which at a 5px missile still reads as one
         thick line rather than as a salvo. */
      crawl:   (2.0 + level * 0.42) / (lead || 1)
    };
  };

  W.shootLaser = function (x, y) {
    W.player.push({
      type: 'laser', dead: false, x: x, y: y - 2, w: 46, h: 4,
      vx: 10, vy: 0, dmg: 1, pierce: true, hitIds: {}, t: 0
    });
    if (NS.Feedback) NS.Feedback.muzzle(x, y, 1, 0, 1.6);
  };

  /* Stage 1's crawler. Its surfaces are the ceiling and floor, so here the
     crossing is vertical and the advance is horizontal — `lead` scales the
     descent for the same reason it scales the crossing everywhere else, and
     the crawl speed stays uniform so a salvo keeps the spacing it landed
     with instead of collapsing back together along the floor. */
  W.shootMissile = function (x, y, level, lead) {
    level = NS.clamp(level || 1, 1, 3);
    W.player.push({
      type: 'missile', dead: false, x: x, y: y, w: 5, h: 3,
      vx: 1.35 + level * 0.28, vy: (0.78 + level * 0.10) * (lead || 1),
      crawlSpeed: (2.0 + level * 0.42) / (lead || 1),
      level: level, dmg: 2, pierce: false, hitIds: null,
      crawling: false, dirDown: true, anim: 0
    });
    if (NS.Feedback) NS.Feedback.muzzle(x, y, 1, 0.65, 1.25);
  };

  /* upward missile variant when the ship is closer to the ceiling —
     Life Force's vertical stages use this; keeps stage 1 fair in tunnels. */
  W.shootMissileUp = function (x, y, level, lead) {
    level = NS.clamp(level || 1, 1, 3);
    var m = { type: 'missile', dead: false, x: x, y: y, w: 5, h: 3,
      vx: 1.35 + level * 0.28, vy: -(0.78 + level * 0.10) * (lead || 1),
      crawlSpeed: (2.0 + level * 0.42) / (lead || 1),
      level: level, dmg: 2, pierce: false, hitIds: null,
      crawling: false, dirDown: false, anim: 0 };
    W.player.push(m);
    if (NS.Feedback) NS.Feedback.muzzle(x, y, 1, -0.65, 1.25);
  };

  W.enemyShot = function (x, y, vx, vy, opt) {
    opt = opt || {};
    W.enemy.push({
      dead: false, x: x, y: y, w: 4, h: 4, vx: vx, vy: vy,
      big: !!opt.big, ignoreTerrain: !!opt.ignoreTerrain, life: opt.life || 600, t: 0
    });
  };

  W.enemyAimed = function (x, y, tx, ty, speed, opt) {
    var a = NS.angleTo(x, y, tx, ty);
    W.enemyShot(x, y, Math.cos(a) * speed, Math.sin(a) * speed, opt);
  };

  /* ---- update --------------------------------------------------------- */
  W.update = function (scrollX) {
    var i, p;

    for (i = 0; i < W.player.length; i++) {
      p = W.player[i];
      if (p.dead) continue;

      if (p.type === 'missile') {
        p.anim++;
        if ((p.anim & 3) === 0) NS.FX.trail(p.x + p.w / 2, p.y + p.h / 2, '#ff9a45', 1);
        if (!p.crawling) {
          p.x += p.vx + 1.2;
          p.y += p.vy;
          p.vy += p.dirDown ? 0.10 : -0.10;
          var limit = p.dirDown ? NS.Terrain.botAt(scrollX + p.x) : NS.Terrain.topAt(scrollX + p.x);
          if (p.dirDown ? (p.y + p.h >= limit) : (p.y <= limit)) {
            p.crawling = true;
            p.y = p.dirDown ? limit - p.h : limit;
          }
        } else {
          // hug the surface as it scrolls past
          p.x += p.crawlSpeed;
          var surf = p.dirDown
            ? NS.Terrain.botAt(scrollX + p.x + p.w) - p.h
            : NS.Terrain.topAt(scrollX + p.x + p.w);
          p.y = NS.lerp(p.y, surf, 0.5);
        }
        p.x -= NS.SCROLL_SPEED * 0.0; // missiles are already in screen space
      } else if (p.type === 'laser') {
        p.t++;
        if ((p.t & 1) === 0) NS.FX.trail(p.x + p.w * 0.2, p.y + p.h / 2, '#70c8ff', 2);
        p.x += p.vx;
      } else {
        p.x += p.vx;
        p.y += p.vy;
      }

      if (p.x > NS.W + 60 || p.x < -60 || p.y < -20 || p.y > NS.PLAYFIELD_H + 20) p.dead = true;

      /* normal shots are stopped by the flesh */
      if (!p.dead && p.type === 'normal' &&
          NS.Terrain.hitsPoint(scrollX, p.x + p.w * 0.5, p.y + 1)) {
        NS.FX.spark(p.x, p.y, 3, 'hit');
        p.dead = true;
      }
    }

    for (i = 0; i < W.enemy.length; i++) {
      p = W.enemy[i];
      if (p.dead) continue;
      p.t++;
      p.x += p.vx - NS.SCROLL_SPEED;
      p.y += p.vy;
      if (p.x < -8 || p.x > NS.W + 8 || p.y < -8 || p.y > NS.PLAYFIELD_H + 8) p.dead = true;
      else if (!p.ignoreTerrain && NS.Terrain.hitsPoint(scrollX, p.x + 2, p.y + 2)) {
        NS.FX.spark(p.x, p.y, 2, 'fire');
        p.dead = true;
      }
      if (p.t > p.life) p.dead = true;
    }

    NS.prune(W.player);
    NS.prune(W.enemy);
  };

  /* Lasers pierce, so they must not re-hit the same target. */
  var uid = 1;
  W.tagOf = function (obj) {
    if (!obj.__wid) obj.__wid = uid++;
    return obj.__wid;
  };
  W.canHit = function (shot, target) {
    if (!shot.hitIds) return true;
    var t = W.tagOf(target);
    if (shot.hitIds[t]) return false;
    shot.hitIds[t] = 1;
    return true;
  };

  /* ---- draw -----------------------------------------------------------
     One player projectile, drawn the same way whoever owns it and whichever
     way the camera is pointing. Every stage calls this instead of painting
     its own rectangles. */
  W.drawShot = function (g, p) {
    var x = p.x | 0, y = p.y | 0;
    var contrast = NS.projectileContrast();

    if (p.type === 'laser') {
      var vertical = p.h > p.w;
      /* three stacked stripes: dark edge, body, hot core */
      if (vertical) {
        if (contrast) { g.fillStyle = '#ffffff'; g.fillRect(x - 1, y, 6, p.h); }
        g.fillStyle = '#0b3fa0'; g.fillRect(x, y, 4, p.h);
        g.fillStyle = '#4fb0ff'; g.fillRect(x + 1, y, 2, p.h);
        g.fillStyle = '#eaf6ff'; g.fillRect(x + 1, y, 1, p.h);
      } else {
        if (contrast) { g.fillStyle = '#ffffff'; g.fillRect(x, y - 1, p.w, 6); }
        g.fillStyle = '#0b3fa0'; g.fillRect(x, y, p.w, 4);
        g.fillStyle = '#4fb0ff'; g.fillRect(x, y + 1, p.w, 2);
        g.fillStyle = '#eaf6ff'; g.fillRect(x, y + 1, p.w, 1);
      }
      return;
    }

    if (p.type === 'missile') {
      /* the sprite faces the way it is going: out to the wall on the way,
         along the wall once it has arrived */
      g.save();
      g.translate(x + (p.w >> 1), y + (p.h >> 1));
      g.rotate(missileAngle(p));
      g.drawImage(NS.S.missile, -3, -1);
      g.restore();
      if ((p.anim & 3) < 2) {
        g.fillStyle = 'rgba(255,180,80,0.7)';
        g.fillRect(x - 1, y + 1, 2, 1);
      }
      return;
    }

    /* normal shot — the same sprite in both cameras, turned to face travel */
    if (contrast) {
      g.fillStyle = '#ffffff';
      if (p.h > p.w) g.fillRect(x - 1, y, p.w + 2, p.h);
      else g.fillRect(x, y - 1, p.w, p.h + 2);
    }
    if (p.h > p.w) {
      g.save();
      g.translate(x + 1, y + 3);
      g.rotate(-Math.PI / 2);
      g.drawImage(NS.S.shot, -3, 0);
      g.restore();
    } else {
      g.drawImage(NS.S.shot, x, y);
    }
  };

  /* Facing for a missile, in radians, from the surface it is bound for and
     whether it has arrived. Shared so the flat and voxel views cannot end up
     pointing the same missile in two directions. */
  function missileAngle(p) {
    if (p.wall == null) {                    // stage 1: ceiling/floor crawler
      if (p.crawling) return 0;
      return p.dirDown ? 0.7 : -0.7;
    }
    if (p.vertical === false) {              // side-on stage, wall = up/down
      return p.crawling ? 0 : p.wall * 0.7;
    }
    return p.crawling ? -Math.PI / 2         // climbing stage, wall = left/right
                      : (p.wall < 0 ? -Math.PI * 0.75 : -Math.PI * 0.25);
  }
  W.missileAngle = missileAngle;

  W.draw = function (g) {
    var i, p;
    for (i = 0; i < W.player.length; i++) {
      p = W.player[i];
      if (!p.dead) W.drawShot(g, p);
    }
    for (i = 0; i < W.enemy.length; i++) {
      p = W.enemy[i];
      if (p.dead) continue;
      W.drawEnemyShot(g, p);
    }
  };

  W.drawEnemyShot = function (g, p) {
    var x = p.x | 0, y = p.y | 0;
    if (NS.projectileContrast()) {
      g.fillStyle = '#080a10'; g.fillRect(x - 2, y - 2, 8, 8);
      g.fillStyle = '#ffffff'; g.fillRect(x - 1, y - 1, 6, 6);
      g.fillStyle = '#ff3038'; g.fillRect(x, y, 4, 4);
    } else if (p.big) {
      g.fillStyle = '#ffd0d0'; g.fillRect(x - 1, y - 1, 6, 6);
      g.fillStyle = '#ff4444'; g.fillRect(x, y, 4, 4);
    } else {
      g.drawImage(NS.S.eshot, x, y);
    }
  };

  W.rectOf = function (p) {
    return { x: p.x, y: p.y, w: p.w, h: p.h };
  };

})(NS);
