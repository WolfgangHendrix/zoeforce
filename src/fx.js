/* fx.js — explosions, sparks, floating score text and the parallax
   background layers behind the flesh corridor. */
(function (NS) {
  'use strict';

  var FX = {};
  NS.FX = FX;

  FX.list = [];

  FX.reset = function () { FX.list.length = 0; };

  /* ---- explosion: expanding ring of chunky pixels (NES style) --------- */
  FX.explode = function (x, y, scale, hue) {
    scale = scale || 1;
    var n = Math.round(10 * scale);
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      var sp = (0.5 + Math.random() * 1.4) * scale;
      FX.list.push({
        kind: 'spark', dead: false,
        x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 14 + Math.random() * 14 * scale, t: 0, hue: hue || 'fire',
        size: Math.random() < 0.4 ? 2 : 1
      });
    }
    FX.list.push({
      kind: 'flash', dead: false, x: x, y: y, t: 0,
      life: 8 + 6 * scale, r0: 2 * scale, r1: 12 * scale, hue: hue || 'fire'
    });
  };

  FX.spark = function (x, y, n, hue) {
    for (var i = 0; i < (n || 4); i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = 0.4 + Math.random() * 1.1;
      FX.list.push({
        kind: 'spark', dead: false, x: x, y: y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 8 + Math.random() * 8, t: 0, hue: hue || 'hit', size: 1
      });
    }
  };

  FX.popText = function (x, y, text, color) {
    FX.list.push({ kind: 'text', dead: false, x: x, y: y, t: 0, life: 40, text: text, color: color || '#ffe9a0' });
  };

  var FIRE = ['#fffbe0', '#ffe066', '#ffa02a', '#e8461e', '#8c1c10'];
  var HIT  = ['#ffffff', '#bfe9ff', '#5fb0ff', '#2a5bd0'];
  var BIO  = ['#e8ffe8', '#8cff9e', '#2fbf6a', '#0e5a35'];

  function ramp(hue) { return hue === 'hit' ? HIT : (hue === 'bio' ? BIO : FIRE); }

  FX.update = function () {
    for (var i = 0; i < FX.list.length; i++) {
      var e = FX.list[i];
      if (e.dead) continue;
      e.t++;
      if (e.kind === 'spark') {
        e.x += e.vx; e.y += e.vy;
        e.vx *= 0.94; e.vy *= 0.94;
        e.x -= NS.SCROLL_SPEED * 0.35;      // drift with the corridor
      } else if (e.kind === 'text') {
        e.y -= 0.35;
      }
      if (e.t >= e.life) e.dead = true;
    }
    NS.prune(FX.list);
  };

  FX.draw = function (g) {
    for (var i = 0; i < FX.list.length; i++) {
      var e = FX.list[i];
      var k = e.t / e.life;
      if (e.kind === 'spark') {
        var pal = ramp(e.hue);
        g.fillStyle = pal[Math.min(pal.length - 1, (k * pal.length) | 0)];
        g.fillRect(e.x | 0, e.y | 0, e.size, e.size);
      } else if (e.kind === 'flash') {
        var r = NS.lerp(e.r0, e.r1, k);
        var pal2 = ramp(e.hue);
        g.strokeStyle = pal2[Math.min(pal2.length - 1, (k * pal2.length) | 0)];
        g.lineWidth = 1;
        g.beginPath();
        g.arc((e.x | 0) + 0.5, (e.y | 0) + 0.5, r, 0, Math.PI * 2);
        g.stroke();
      } else if (e.kind === 'text') {
        g.fillStyle = e.color;
        g.globalAlpha = k > 0.7 ? (1 - (k - 0.7) / 0.3) : 1;
        g.font = '6px monospace';
        g.fillText(e.text, e.x | 0, e.y | 0);
        g.globalAlpha = 1;
      }
    }
  };

  /* Text only. The voxel view draws sparks and flashes as real geometry,
     but floating score text belongs in the flat overlay where it stays
     readable, so it is split out here. */
  FX.drawText = function (g) {
    for (var i = 0; i < FX.list.length; i++) {
      var e = FX.list[i];
      if (e.dead || e.kind !== 'text') continue;
      var k = e.t / e.life;
      g.fillStyle = e.color;
      g.globalAlpha = k > 0.7 ? (1 - (k - 0.7) / 0.3) : 1;
      g.font = '6px monospace';
      g.fillText(e.text, e.x | 0, e.y | 0);
      g.globalAlpha = 1;
    }
  };

  /* ---- background --------------------------------------------------- */
  var stars = [], motes = [];

  FX.initBackground = function () {
    var rng = NS.makeRng(0xC0FFEE);
    stars.length = 0; motes.length = 0;
    for (var i = 0; i < 60; i++) {
      stars.push({
        x: rng() * NS.W, y: rng() * NS.PLAYFIELD_H,
        z: 0.25 + rng() * 0.75,
        c: rng() < 0.3 ? '#7fd4ff' : (rng() < 0.5 ? '#ffd9d9' : '#c8d2e8')
      });
    }
    for (var j = 0; j < 26; j++) {
      motes.push({
        x: rng() * NS.W, y: rng() * NS.PLAYFIELD_H,
        z: 0.5 + rng() * 1.2, r: 1 + (rng() * 2 | 0),
        ph: rng() * Math.PI * 2
      });
    }
  };

  FX.updateBackground = function () {
    var s = NS.SCROLL_SPEED;
    var vertical = NS.Game && NS.Game.stage === 2;
    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      if (vertical) {
        st.y += s * st.z * 0.6;
        if (st.y > NS.PLAYFIELD_H + 1) { st.y = -1; st.x = Math.random() * NS.W; }
      } else {
        st.x -= s * st.z * 0.6;
        if (st.x < -1) { st.x = NS.W + 1; st.y = Math.random() * NS.PLAYFIELD_H; }
      }
    }
    for (var j = 0; j < motes.length; j++) {
      var m = motes[j];
      m.ph += 0.03;
      if (vertical) {
        m.y += s * m.z * 0.35;
        m.x += Math.sin(m.ph) * 0.15;
        if (m.y > NS.PLAYFIELD_H + 4) { m.y = -4; m.x = Math.random() * NS.W; }
      } else {
        m.x -= s * m.z * 0.35;
        m.y += Math.sin(m.ph) * 0.15;
        if (m.x < -4) { m.x = NS.W + 4; m.y = Math.random() * NS.PLAYFIELD_H; }
      }
    }
  };

  FX.drawBackground = function (g, scrollX) {
    /* deep tissue gradient */
    var grd = g.createLinearGradient(0, 0, 0, NS.PLAYFIELD_H);
    grd.addColorStop(0, '#160a12');
    grd.addColorStop(0.5, '#26101c');
    grd.addColorStop(1, '#160a12');
    g.fillStyle = grd;
    g.fillRect(0, 0, NS.W, NS.PLAYFIELD_H);

    /* far membrane arcs — slow parallax, gives the corridor depth */
    g.strokeStyle = 'rgba(120,40,70,0.35)';
    g.lineWidth = 1;
    var off = (scrollX * 0.25) % 64;
    for (var x = -off; x < NS.W + 64; x += 64) {
      g.beginPath();
      g.moveTo(x, 0);
      g.quadraticCurveTo(x + 32, NS.PLAYFIELD_H / 2, x, NS.PLAYFIELD_H);
      g.stroke();
    }

    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      g.fillStyle = st.c;
      g.globalAlpha = 0.25 + st.z * 0.5;
      g.fillRect(st.x | 0, st.y | 0, 1, 1);
    }
    g.globalAlpha = 1;

    for (var j = 0; j < motes.length; j++) {
      var m = motes[j];
      g.fillStyle = 'rgba(200,120,160,0.25)';
      g.fillRect(m.x | 0, m.y | 0, m.r, m.r);
    }
  };

})(NS);
