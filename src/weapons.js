/* weapons.js — every projectile in the game.
   Player armament follows the Life Force / Gradius rules:
     • normal shot: 2 volleys on screen at a time
     • missile:     twin ceiling/floor crawlers, three speed/salvo levels
     • ripple:      expanding ring, passes through enemies
     • laser:       long piercing beam, one on screen
   Options fire copies of whatever the ship currently has equipped. */
(function (NS) {
  'use strict';

  var W = {};
  NS.Weapons = W;

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
  };

  W.shootRipple = function (x, y) {
    W.player.push({
      type: 'ripple', dead: false, x: x, y: y, w: 6, h: 6,
      vx: 3.1, vy: 0, dmg: 1, pierce: true, r: 3, hitIds: {}
    });
  };

  W.shootLaser = function (x, y) {
    W.player.push({
      type: 'laser', dead: false, x: x, y: y - 2, w: 46, h: 4,
      vx: 10, vy: 0, dmg: 1, pierce: true, hitIds: {}, t: 0
    });
  };

  W.shootMissile = function (x, y, level) {
    level = NS.clamp(level || 1, 1, 3);
    W.player.push({
      type: 'missile', dead: false, x: x, y: y, w: 5, h: 3,
      vx: 1.35 + level * 0.28, vy: 0.78 + level * 0.10,
      crawlSpeed: 2.0 + level * 0.42,
      level: level, dmg: 2, pierce: false, hitIds: null,
      crawling: false, dirDown: true, anim: 0
    });
  };

  /* upward missile variant when the ship is closer to the ceiling —
     Life Force's vertical stages use this; keeps stage 1 fair in tunnels. */
  W.shootMissileUp = function (x, y, level) {
    level = NS.clamp(level || 1, 1, 3);
    var m = { type: 'missile', dead: false, x: x, y: y, w: 5, h: 3,
      vx: 1.35 + level * 0.28, vy: -(0.78 + level * 0.10),
      crawlSpeed: 2.0 + level * 0.42,
      level: level, dmg: 2, pierce: false, hitIds: null,
      crawling: false, dirDown: false, anim: 0 };
    W.player.push(m);
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
      } else if (p.type === 'ripple') {
        p.x += p.vx;
        p.r += 0.42;
        p.w = p.r * 2; p.h = p.r * 2;
        if (p.r > 13) p.dead = true;
      } else if (p.type === 'laser') {
        p.t++;
        p.x += p.vx;
      } else {
        p.x += p.vx;
        p.y += p.vy;
      }

      if (p.x > NS.W + 60 || p.x < -60 || p.y < -20 || p.y > NS.PLAYFIELD_H + 20) p.dead = true;

      /* normal shots and missiles are stopped by the flesh */
      if (!p.dead && (p.type === 'normal' || p.type === 'ripple')) {
        if (NS.Terrain.hitsPoint(scrollX, p.x + p.w * 0.5, p.y + (p.type === 'ripple' ? 0 : 1))) {
          if (p.type === 'normal') { NS.FX.spark(p.x, p.y, 3, 'hit'); p.dead = true; }
        }
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

  /* Ripples/lasers pierce, so they must not re-hit the same target. */
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

  /* ---- draw ----------------------------------------------------------- */
  W.draw = function (g) {
    var i, p;
    for (i = 0; i < W.player.length; i++) {
      p = W.player[i];
      if (p.dead) continue;
      if (p.type === 'normal') {
        g.drawImage(NS.S.shot, p.x | 0, p.y | 0);
      } else if (p.type === 'missile') {
        g.drawImage(NS.S.missile, p.x | 0, p.y | 0);
        if ((p.anim & 3) < 2) {
          g.fillStyle = 'rgba(255,180,80,0.7)';
          g.fillRect((p.x | 0) - 2, (p.y | 0) + 1, 2, 1);
        }
      } else if (p.type === 'ripple') {
        g.strokeStyle = '#7fe9ff';
        g.lineWidth = 1;
        g.beginPath(); g.arc((p.x | 0) + 0.5, (p.y | 0) + 0.5, p.r, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = 'rgba(120,180,255,0.55)';
        g.beginPath(); g.arc((p.x | 0) + 0.5, (p.y | 0) + 0.5, Math.max(1, p.r - 2), 0, Math.PI * 2); g.stroke();
      } else if (p.type === 'laser') {
        var x = p.x | 0, y = p.y | 0;
        g.fillStyle = '#0b3fa0'; g.fillRect(x, y, p.w, 4);
        g.fillStyle = '#4fb0ff'; g.fillRect(x, y + 1, p.w, 2);
        g.fillStyle = '#eaf6ff'; g.fillRect(x, y + 1, p.w, 1);
      }
    }
    for (i = 0; i < W.enemy.length; i++) {
      p = W.enemy[i];
      if (p.dead) continue;
      if (p.big) {
        g.fillStyle = '#ffd0d0'; g.fillRect((p.x | 0) - 1, (p.y | 0) - 1, 6, 6);
        g.fillStyle = '#ff4444'; g.fillRect(p.x | 0, p.y | 0, 4, 4);
      } else {
        g.drawImage(NS.S.eshot, p.x | 0, p.y | 0);
      }
    }
  };

  /* Rect for collision purposes (ripples are circles, approximate). */
  W.rectOf = function (p) {
    if (p.type === 'ripple') return { x: p.x - p.r, y: p.y - p.r, w: p.r * 2, h: p.r * 2 };
    return { x: p.x, y: p.y, w: p.w, h: p.h };
  };

})(NS);
