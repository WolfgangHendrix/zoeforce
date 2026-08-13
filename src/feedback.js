/* feedback.js — one presentation-only impact director.

   Gameplay reports meaning (flesh hit, shield break, player death) and this
   module fans it out to camera motion, haptics, audio ducking, particles,
   recoil and phase messaging. Nothing here owns collision or positioning,
   so accessibility settings can remove every secondary effect without
   changing the deterministic simulation. */
(function (NS) {
  'use strict';

  var F = {};
  NS.Feedback = F;

  var trauma = 0, age = 0, freeze = 0;
  var banner = null;
  var bossRef = null, bossDisplayHp = 0, bossChipHp = 0, bossChipHold = 0;

  function setting(name, fallback) {
    var s = NS.Game && NS.Game.settings;
    return s && s[name] != null ? s[name] : fallback;
  }
  function shakeScale() {
    return NS.reducedMotion() ? 0 : NS.clamp(setting('shake', 70) / 100, 0, 1);
  }
  function rumbleScale() {
    return NS.clamp(setting('rumble', 70) / 100, 0, 1);
  }

  F.reset = function () {
    trauma = age = freeze = 0; banner = null;
    bossRef = null; bossDisplayHp = bossChipHp = bossChipHold = 0;
  };

  F.impact = function (kind, opt) {
    opt = opt || {};
    var profiles = {
      hit:        { shake: 0.06, weak: 0.10, strong: 0.03, ms: 35 },
      heavy:      { shake: 0.24, weak: 0.28, strong: 0.42, ms: 90 },
      phase:      { shake: 0.48, weak: 0.48, strong: 0.78, ms: 180, freeze: 4, duck: 0.48 },
      playerHit:  { shake: 0.30, weak: 0.36, strong: 0.60, ms: 130, freeze: 2, duck: 0.25 },
      playerDeath:{ shake: 0.72, weak: 0.62, strong: 1.00, ms: 260, freeze: 4, duck: 0.62 },
      bossDeath:  { shake: 0.90, weak: 0.75, strong: 1.00, ms: 420, freeze: 6, duck: 0.72 }
    };
    var p = profiles[kind] || profiles.hit;
    var s = shakeScale();
    trauma = Math.min(1, trauma + (opt.shake == null ? p.shake : opt.shake) * s);
    if (!NS.reducedMotion()) freeze = Math.max(freeze, opt.freeze == null ? (p.freeze || 0) : opt.freeze);
    var rs = rumbleScale();
    if (rs > 0 && NS.Input && NS.Input.rumble) {
      NS.Input.rumble((opt.weak == null ? p.weak : opt.weak) * rs,
                      (opt.strong == null ? p.strong : opt.strong) * rs,
                      opt.ms || p.ms);
    }
    var duck = opt.duck == null ? p.duck : opt.duck;
    if (duck && NS.Audio && NS.Audio.duck) NS.Audio.duck(duck, opt.duckTime || 0.18);
  };

  F.damage = function (target, opt) {
    opt = opt || {};
    NS.flashDamage(target);
    if (target) {
      target.hitKick = NS.reducedMotion() ? 0 : 4;
      target.hitKickX = opt.dx == null ? -1 : NS.clamp(opt.dx, -1, 1);
      target.hitKickY = opt.dy == null ? 0 : NS.clamp(opt.dy, -1, 1);
    }
    if (NS.FX && NS.FX.directional) {
      NS.FX.directional(opt.x == null ? (target && target.x) || 0 : opt.x,
                        opt.y == null ? (target && target.y) || 0 : opt.y,
                        opt.dx == null ? 1 : opt.dx, opt.dy || 0,
                        opt.count || 4, opt.hue || (opt.material === 'flesh' ? 'bio' : 'hit'),
                        opt.material || 'armor');
    }
    if (NS.Audio && NS.Audio.sfx && NS.Audio.sfx.impact) {
      NS.Audio.sfx.impact(opt.material || 'armor', opt.strength || 0.42);
    }
    if ((opt.strength || 0) >= 0.7) F.impact('heavy', opt);
    else F.impact('hit', { shake: 0.035 + (opt.strength || 0.4) * 0.055 });
  };

  F.destroy = function (x, y, opt) {
    opt = opt || {};
    if (NS.FX && NS.FX.directional) {
      NS.FX.directional(x, y, opt.dx == null ? 1 : opt.dx, opt.dy || 0,
                        opt.count || 10, opt.hue || 'fire', opt.material || 'armor');
    }
    if (opt.major) F.impact(opt.boss ? 'bossDeath' : 'heavy', opt);
  };

  F.playerHit = function (shielded, x, y) {
    F.impact(shielded ? 'playerHit' : 'playerDeath');
    if (NS.FX && NS.FX.directional) NS.FX.directional(x, y, -1, 0, shielded ? 9 : 16, shielded ? 'hit' : 'fire', shielded ? 'shield' : 'armor');
  };

  F.phase = function (label, sub, x, y) {
    banner = { text: label, sub: sub || '', t: 110 };
    if (NS.Audio && NS.Audio.sfx && NS.Audio.sfx.phase) NS.Audio.sfx.phase();
    if (NS.FX) {
      NS.FX.explode(x == null ? NS.W / 2 : x, y == null ? NS.PLAYFIELD_H / 2 : y, 1.8, 'fire');
      if (NS.FX.directional) NS.FX.directional(x == null ? NS.W / 2 : x, y == null ? NS.PLAYFIELD_H / 2 : y, -1, 0, 18, 'fire', 'armor');
    }
    F.impact('phase');
  };

  F.muzzle = function (x, y, dx, dy, power) {
    if (NS.FX && NS.FX.muzzle) NS.FX.muzzle(x, y, dx, dy, power || 1);
    var rs = rumbleScale();
    if (rs > 0 && power > 1.2 && NS.Input && NS.Input.rumble) NS.Input.rumble(0.08 * rs, 0.03 * rs, 28);
  };

  F.update = function (G) {
    age++;
    trauma = Math.max(0, trauma - 0.035);
    if (banner && --banner.t <= 0) banner = null;

    var b = G && G.boss;
    if (b !== bossRef) {
      bossRef = b;
      bossDisplayHp = bossChipHp = b && b.hp != null ? b.hp : 0;
      bossChipHold = 0;
    } else if (b && b.hp != null) {
      if (b.hp < bossDisplayHp) {
        bossDisplayHp = b.hp;
        bossChipHold = 10;
      }
      if (bossChipHold > 0) bossChipHold--;
      else bossChipHp = NS.lerp(bossChipHp, b.hp, 0.11);
      if (bossChipHp < b.hp) bossChipHp = b.hp;
    }
  };

  /* Called after global/pause inputs are handled. A freeze is deliberately
     rare and short; input still gets sampled while gameplay holds. */
  F.consumeFreeze = function () {
    if (freeze <= 0) return false;
    freeze--; return true;
  };

  F.cameraOffset = function () {
    var a = trauma * trauma * 3.2;
    if (a <= 0.001 || shakeScale() <= 0) return { x: 0, y: 0 };
    return {
      x: Math.sin(age * 2.17) * a + Math.sin(age * 0.73) * a * 0.35,
      y: Math.cos(age * 1.91) * a * 0.72
    };
  };

  F.bossBar = function (boss) {
    if (!boss || boss !== bossRef) return null;
    return { hp: bossDisplayHp, chip: bossChipHp, flash: bossChipHold > 0 };
  };

  function arrow(g, side, cross, color) {
    g.save();
    g.fillStyle = color || '#ffca3a';
    g.globalAlpha = NS.reducedMotion() ? 0.8 : 0.62 + Math.sin(age * 0.22) * 0.25;
    g.beginPath();
    if (side === 'right') { g.moveTo(NS.W - 2, cross); g.lineTo(NS.W - 8, cross - 4); g.lineTo(NS.W - 8, cross + 4); }
    else if (side === 'top') { g.moveTo(cross, 2); g.lineTo(cross - 4, 8); g.lineTo(cross + 4, 8); }
    else if (side === 'left') { g.moveTo(2, cross); g.lineTo(8, cross - 4); g.lineTo(8, cross + 4); }
    else { g.moveTo(cross, NS.PLAYFIELD_H - 2); g.lineTo(cross - 4, NS.PLAYFIELD_H - 8); g.lineTo(cross + 4, NS.PLAYFIELD_H - 8); }
    g.closePath(); g.fill(); g.restore();
  }

  /* At most three edge cues. They are informational, not decoration, and
     remain static when Reduced Motion is enabled. */
  F.drawTelegraphs = function (g, G) {
    if (!G || G.state !== 'play' || (NS.Intro && NS.Intro.active)) return;
    var list, count = 0, i, e;
    if (G.stage === 1) {
      list = NS.Enemies.list;
      for (i = 0; i < list.length && count < 3; i++) {
        e = list[i];
        if (!e.dead && e.kind !== 'prominence' && e.kind !== 'tentacle' && e.x > NS.W && e.x < NS.W + 58) {
          arrow(g, 'right', NS.clamp(e.y + e.h / 2, 10, NS.PLAYFIELD_H - 10)); count++;
        }
      }
    } else if (G.stage === 2) {
      list = NS.Level2.enemies;
      for (i = 0; i < list.length && count < 3; i++) {
        e = list[i];
        if (!e.dead && e.y < -3 && e.y > -58) { arrow(g, 'top', NS.clamp(e.x, 10, NS.W - 10)); count++; }
      }
    } else {
      list = NS.Campaign.enemies;
      var side = NS.Campaign.horizontal();
      for (i = 0; i < list.length && count < 3; i++) {
        e = list[i]; if (e.dead) continue;
        if (side && e.x > NS.W && e.x < NS.W + 58) { arrow(g, 'right', NS.clamp(e.y, 10, NS.PLAYFIELD_H - 10)); count++; }
        else if (!side && e.y < -3 && e.y > -58) { arrow(g, 'top', NS.clamp(e.x, 10, NS.W - 10)); count++; }
      }
    }
  };

  F.drawOverlay = function (g, G) {
    F.drawTelegraphs(g, G);
    if (!banner) return;
    var k = banner.t > 90 ? (110 - banner.t) / 20 : (banner.t < 20 ? banner.t / 20 : 1);
    g.save(); g.globalAlpha = NS.clamp(k, 0, 1);
    g.fillStyle = 'rgba(10,5,12,0.72)'; g.fillRect(48, 76, NS.W - 96, banner.sub ? 34 : 22);
    g.fillStyle = '#ffca3a'; g.fillRect(48, 76, NS.W - 96, 1);
    g.font = '9px monospace'; g.textAlign = 'center'; g.fillStyle = '#ffffff';
    g.fillText(banner.text, NS.W / 2, 91);
    if (banner.sub) { g.font = '6px monospace'; g.fillStyle = '#ff9ba0'; g.fillText(banner.sub, NS.W / 2, 103); }
    g.restore();
  };

  F.hazardCharge = function (hazard) {
    var q = (hazard.t % hazard.period) / hazard.period;
    /* Build for the last fifth of the safe cycle, then hold a short hot
       ignition cue while the obstruction is still small enough to dodge. */
    if (q > 0.80) return (q - 0.80) / 0.20;
    return q < 0.10 ? 1 - q / 0.10 : 0;
  };

})(NS);
