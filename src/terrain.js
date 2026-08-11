/* terrain.js — the flesh corridor of Stage 1.
   Two heightmaps (ceiling + floor) sampled per world pixel column. Generated
   deterministically from a seed so the stage plays identically every run, but
   the shape of the level is authored by the KEYFRAMES table below. */
(function (NS) {
  'use strict';

  var T = {};
  NS.Terrain = T;

  /* Total scrollable length of the stage, in pixels, boss chamber included. */
  T.LENGTH = 9400;

  /* Keyframes: [worldX, ceilingY, floorY] — linearly-eased between points.
     ceilingY = bottom edge of the ceiling flesh, floorY = top edge of floor. */
  var KEYFRAMES = [
    [    0,  24, 184],
    [  400,  20, 188],
    [  900,  46, 178],   // first pinch
    [ 1300,  16, 190],
    [ 1750,  62, 150],   // tight tunnel
    [ 2050,  60, 148],
    [ 2400,  22, 190],
    [ 2900,  30, 130],   // low ceiling run, high floor
    [ 3300,  84, 190],   // ceiling drops hard
    [ 3700,  86, 186],
    [ 4100,  20, 196],   // open cavern
    [ 4600,  18, 198],
    [ 5000,  70, 132],   // squeeze — the prominence gauntlet
    [ 5500,  74, 128],
    [ 5900,  30, 186],
    [ 6400,  96, 190],   // sunken chamber
    [ 6800,  24, 118],   // ceiling gallery
    [ 7200,  26, 196],
    [ 7700,  56, 160],
    [ 8200,  20, 198],
    [ 8600,  12, 204],   // approach to the boss chamber
    [ 9400,  12, 204]
  ];

  /* Where the boss chamber begins — no terrain hazards past this point. */
  T.BOSS_X = 8600;

  T.top = null;
  T.bot = null;

  function smoothstep(t) { return t * t * (3 - 2 * t); }

  T.build = function () {
    var rng = NS.makeRng(0x5A1A3D0C);
    var n = T.LENGTH;
    var top = new Int16Array(n);
    var bot = new Int16Array(n);

    // interpolate keyframes
    var k = 0;
    for (var x = 0; x < n; x++) {
      while (k < KEYFRAMES.length - 2 && x >= KEYFRAMES[k + 1][0]) k++;
      var a = KEYFRAMES[k], b = KEYFRAMES[k + 1];
      var t = smoothstep(NS.clamp((x - a[0]) / (b[0] - a[0]), 0, 1));
      top[x] = Math.round(NS.lerp(a[1], b[1], t));
      bot[x] = Math.round(NS.lerp(a[2], b[2], t));
    }

    // organic wobble: three octaves of value noise, dampened in the boss room
    var oct = [
      { len: 128, amp: 7 }, { len: 46, amp: 4 }, { len: 17, amp: 2 }
    ];
    for (var o = 0; o < oct.length; o++) {
      var L = oct[o].len, A = oct[o].amp;
      var pts = Math.ceil(n / L) + 2;
      var ct = new Float32Array(pts), cb = new Float32Array(pts);
      for (var i = 0; i < pts; i++) { ct[i] = (rng() * 2 - 1) * A; cb[i] = (rng() * 2 - 1) * A; }
      for (var x2 = 0; x2 < n; x2++) {
        var idx = (x2 / L) | 0;
        var f = smoothstep((x2 % L) / L);
        var damp = x2 > T.BOSS_X - 200 ? Math.max(0, 1 - (x2 - (T.BOSS_X - 200)) / 200) : 1;
        top[x2] += Math.round(NS.lerp(ct[idx], ct[idx + 1], f) * damp);
        bot[x2] += Math.round(NS.lerp(cb[idx], cb[idx + 1], f) * damp);
      }
    }

    // clamp + guarantee a passable gap everywhere
    var MIN_GAP = 46;
    for (var x3 = 0; x3 < n; x3++) {
      top[x3] = NS.clamp(top[x3], 8, NS.PLAYFIELD_H - 30);
      bot[x3] = NS.clamp(bot[x3], 30, NS.PLAYFIELD_H - 8);
      var gap = bot[x3] - top[x3];
      if (gap < MIN_GAP) {
        var mid = (top[x3] + bot[x3]) / 2;
        top[x3] = Math.round(mid - MIN_GAP / 2);
        bot[x3] = Math.round(mid + MIN_GAP / 2);
        top[x3] = NS.clamp(top[x3], 6, NS.PLAYFIELD_H - 40);
        bot[x3] = NS.clamp(bot[x3], 40, NS.PLAYFIELD_H - 6);
      }
    }

    T.top = top;
    T.bot = bot;
  };

  T.topAt = function (wx) {
    if (wx < 0) wx = 0; else if (wx >= T.LENGTH) wx = T.LENGTH - 1;
    return T.top[wx | 0];
  };
  T.botAt = function (wx) {
    if (wx < 0) wx = 0; else if (wx >= T.LENGTH) wx = T.LENGTH - 1;
    return T.bot[wx | 0];
  };

  /* Rect-vs-flesh test. rect is in screen space; scrollX converts to world. */
  T.hitsRect = function (scrollX, x, y, w, h) {
    var x0 = Math.floor(scrollX + x), x1 = Math.floor(scrollX + x + w);
    for (var wx = x0; wx <= x1; wx += 2) {
      if (y < T.topAt(wx) || y + h > T.botAt(wx)) return true;
    }
    // make sure the trailing column is tested even when w is odd
    if (y < T.topAt(x1) || y + h > T.botAt(x1)) return true;
    return false;
  };

  /* point test — used by bullets and particles */
  T.hitsPoint = function (scrollX, x, y) {
    var wx = Math.floor(scrollX + x);
    return y < T.topAt(wx) || y > T.botAt(wx);
  };

  /* ---- rendering ------------------------------------------------------ */
  /* Colour bands from the outer rind inwards, so the flesh reads as layered
     tissue rather than a flat silhouette. */
  var CEIL_BANDS = [
    { d: 0,  c: '#ff9ec0' },   // wet highlight edge
    { d: 1,  c: '#d4557f' },
    { d: 3,  c: '#95305a' },
    { d: 7,  c: '#5e1c3c' },
    { d: 14, c: '#3a1128' }
  ];

  function bandColor(depth, bands) {
    var c = bands[0].c;
    for (var i = 0; i < bands.length; i++) if (depth >= bands[i].d) c = bands[i].c;
    return c;
  }

  /* precomputed vein noise so the wall texture doesn't shimmer */
  var veinRng = NS.makeRng(0xBEEF11);
  var VEIN = new Uint8Array(4096);
  for (var vi = 0; vi < VEIN.length; vi++) VEIN[vi] = (veinRng() * 255) | 0;

  T.draw = function (g, scrollX, time) {
    var pulse = Math.sin(time * 0.04) * 0.5 + 0.5;

    for (var sx = 0; sx < NS.W; sx++) {
      var wx = (scrollX + sx) | 0;
      var ty = T.topAt(wx);
      var by = T.botAt(wx);

      /* ceiling */
      for (var i = 0; i < CEIL_BANDS.length; i++) {
        var b = CEIL_BANDS[i];
        var next = CEIL_BANDS[i + 1];
        var y0 = ty - b.d;
        var y1 = next ? ty - next.d : 0;
        if (y0 <= 0) continue;
        g.fillStyle = b.c;
        g.fillRect(sx, Math.max(0, y1), 1, y0 - Math.max(0, y1));
      }
      g.fillStyle = '#2a0c1e';
      if (ty - 14 > 0) g.fillRect(sx, 0, 1, ty - 14);

      /* floor (mirror of the ceiling banding) */
      for (var j = 0; j < CEIL_BANDS.length; j++) {
        var b2 = CEIL_BANDS[j];
        var next2 = CEIL_BANDS[j + 1];
        var Y0 = by + b2.d;
        var Y1 = next2 ? by + next2.d : NS.PLAYFIELD_H;
        if (Y0 >= NS.PLAYFIELD_H) continue;
        g.fillStyle = b2.c;
        g.fillRect(sx, Y0, 1, Math.min(NS.PLAYFIELD_H, Y1) - Y0);
      }
      g.fillStyle = '#2a0c1e';
      if (by + 14 < NS.PLAYFIELD_H) g.fillRect(sx, by + 14, 1, NS.PLAYFIELD_H - (by + 14));

      /* pulsing capillaries inside the tissue */
      var v = VEIN[wx & 4095];
      if (v > 232) {
        var depth = 4 + (v & 7);
        g.fillStyle = 'rgba(255,140,170,' + (0.20 + 0.25 * pulse).toFixed(2) + ')';
        g.fillRect(sx, ty - depth, 1, 1);
        g.fillRect(sx, by + depth, 1, 1);
      }
      /* dark pores */
      if (v < 12) {
        g.fillStyle = '#43132c';
        g.fillRect(sx, ty - 6, 1, 3);
        g.fillRect(sx, by + 4, 1, 3);
      }
    }
  };

  /* Boss chamber shutter: a membrane that seals the arena behind you. */
  T.drawChamberSeal = function (g, scrollX, closed) {
    var sealWorldX = T.BOSS_X + 210;
    var sx = sealWorldX - scrollX;
    if (sx > NS.W || sx < -8 || !closed) return;
    var ty = T.topAt(sealWorldX | 0), by = T.botAt(sealWorldX | 0);
    g.fillStyle = '#8b2f52';
    g.fillRect(sx | 0, ty, 6, by - ty);
    g.fillStyle = '#ffb0cd';
    g.fillRect(sx | 0, ty, 1, by - ty);
  };

})(NS);
