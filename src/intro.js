/* intro.js — the boss entrance sequence.

   Every stage used to announce its boss the same way: two lines of blinking
   text over unchanged gameplay while the thing slid in from off-screen. This
   replaces that with one shared, scripted cutscene that each boss plugs its
   own choreography into.

   The sequence owns three things and nothing else:

     • the frame — letterbox bars close in, the world dims, and (in the voxel
       view) the camera pushes toward the spawn point. focus() below is the
       single source of truth for that push: voxel.js already solves its
       projection from a rectangle of the playfield every frame, so handing
       it a smaller rectangle *is* the dolly. No second camera path exists.

     • the plate — WARNING, then the boss name typed in against a sweeping
       rule, then the stage's own subtitle.

     • the beat — start, hold, and release, exposed as holding() so the
       simulation can keep the boss invulnerable and silent until the
       cutscene hands control back.

   It deliberately does NOT move the boss. Each boss runs its own entrance in
   its own update(), reading Intro.k() (0..1 progress) when it wants to time a
   move to the cut. That keeps the choreography next to the fight it belongs
   to, and keeps this file from growing a switch over every stage. */
(function (NS) {
  'use strict';

  var I = {};
  NS.Intro = I;

  I.active = false;
  I.t = 0;
  I.dur = 0;
  I.name = '';
  I.sub = '';

  var fx = NS.W / 2, fy = NS.PLAYFIELD_H / 2;   // point the camera pushes to
  var zoomMin = 0.62;                           // tightest framing, 1 = full
  var flash = 0;
  var noteT = 0;

  /* Phase boundaries as fractions of the whole. Held here rather than as
     magic numbers inside update()/draw() so the two always agree. */
  var CLOSE = 0.14;    // bars closing
  var HOLD  = 0.74;    // pushed in, boss making its entrance
  var PLATE = 0.24;    // name plate starts typing
  var SLAM  = 0.80;    // name locks in, the hit lands

  function ease(u) { return u < 0 ? 0 : (u > 1 ? 1 : u * u * (3 - 2 * u)); }

  /* opts: name, sub, x, y, dur, zoom */
  I.start = function (opts) {
    opts = opts || {};
    I.active = true;
    I.t = 0;
    I.dur = opts.dur || 210;
    I.name = opts.name || 'BOSS';
    I.sub = opts.sub || '';
    fx = opts.x != null ? opts.x : NS.W / 2;
    fy = opts.y != null ? opts.y : NS.PLAYFIELD_H / 2;
    zoomMin = opts.zoom || 0.62;
    flash = 0;
    noteT = 0;
    NS.Audio.sfx.klaxon();
    NS.Audio.sfx.rumble();
  };

  I.stop = function () { I.active = false; I.t = 0; };

  /* Where the boss should be by now, 0 at the cut in and 1 by the slam.
     Boss entrance paths interpolate against this so they always land on the
     same frame the name does, whatever the cutscene length is set to. */
  I.k = function () {
    if (!I.active) return 1;
    return ease((I.t / I.dur - CLOSE) / (SLAM - CLOSE));
  };

  /* The boss is untouchable and holds its fire until the cut releases. */
  I.holding = function () { return I.active && I.t < I.dur * SLAM; };

  I.update = function () {
    if (!I.active) return;
    I.t++;
    var u = I.t / I.dur;

    /* the klaxon repeats through the close, then stops for the plate */
    if (u < HOLD && I.t % 46 === 12) NS.Audio.sfx.klaxon();
    if (Math.abs(u - SLAM) < 0.5 / I.dur) {
      NS.Audio.sfx.slam();
      flash = 16;
      NS.FX.explode(fx, fy, 2.2, 'hit');
    }
    if (flash > 0) flash--;
    if (u >= PLATE) noteT++;

    if (I.t >= I.dur) { I.active = false; I.t = 0; }
  };

  /* Camera framing for the voxel view: the rectangle of playfield that
     should fill the frame. Returns null when the flat 1:1 framing applies,
     which is what voxel.js falls back to. */
  I.focus = function () {
    if (!I.active) return null;
    var u = I.t / I.dur;
    var k;
    if (u < CLOSE) k = 1 - (1 - zoomMin) * ease(u / CLOSE) * 0.35;
    else if (u < HOLD) k = NS.lerp(1 - (1 - zoomMin) * 0.35, zoomMin,
                                   ease((u - CLOSE) / (HOLD - CLOSE)));
    else k = NS.lerp(zoomMin, 1, ease((u - HOLD) / (1 - HOLD)));
    /* a small shake on the slam, in world units so it reads at any zoom */
    var shake = flash > 0 && !NS.reducedFlash() ? flash * 0.22 : 0;
    return {
      x: fx + (shake ? (Math.random() - 0.5) * shake * 3 : 0),
      y: fy + (shake ? (Math.random() - 0.5) * shake * 3 : 0),
      k: k
    };
  };

  /* Bar height in playfield pixels right now. */
  function barH() {
    var u = I.t / I.dur;
    var open = u < CLOSE ? ease(u / CLOSE)
             : (u < HOLD ? 1 : 1 - ease((u - HOLD) / (1 - HOLD)));
    return Math.round(22 * open);
  }

  I.draw = function (g) {
    if (!I.active) return;
    var u = I.t / I.dur;
    var H = NS.PLAYFIELD_H;

    /* dim — enough to lift the plate off the world without hiding the boss */
    var dim = (u < CLOSE ? ease(u / CLOSE) : (u < HOLD ? 1 : 1 - ease((u - HOLD) / (1 - HOLD)))) * 0.34;
    if (dim > 0.01) {
      g.fillStyle = 'rgba(4,5,10,' + dim.toFixed(3) + ')';
      g.fillRect(0, 0, NS.W, H);
    }

    /* letterbox */
    var bh = barH();
    if (bh > 0) {
      g.fillStyle = '#05060a';
      g.fillRect(0, 0, NS.W, bh);
      g.fillRect(0, H - bh, NS.W, bh);
      g.fillStyle = '#ff5a7a';
      g.fillRect(0, bh - 1, NS.W, 1);
      g.fillRect(0, H - bh, NS.W, 1);
      /* corner ticks, so the bars read as a viewfinder rather than a crop */
      g.fillStyle = '#8fd0ff';
      g.fillRect(6, bh + 2, 10, 1); g.fillRect(6, bh + 2, 1, 4);
      g.fillRect(NS.W - 16, bh + 2, 10, 1); g.fillRect(NS.W - 7, bh + 2, 1, 4);
      g.fillRect(6, H - bh - 3, 10, 1); g.fillRect(6, H - bh - 6, 1, 4);
      g.fillRect(NS.W - 16, H - bh - 3, 10, 1); g.fillRect(NS.W - 7, H - bh - 6, 1, 4);
    }

    /* target reticle on the thing that is arriving */
    if (u > CLOSE * 0.6 && u < SLAM) {
      var pulse = 1 - ((I.t % 26) / 26);
      var r = 14 + pulse * 16;
      g.strokeStyle = 'rgba(255,120,140,' + (0.10 + pulse * 0.35).toFixed(2) + ')';
      g.lineWidth = 1;
      g.strokeRect((fx - r) | 0, (fy - r) | 0, r * 2, r * 2);
      g.fillStyle = 'rgba(255,180,190,0.55)';
      g.fillRect((fx - 1) | 0, (fy - 9) | 0, 1, 5);
      g.fillRect((fx - 1) | 0, (fy + 5) | 0, 1, 5);
      g.fillRect((fx - 9) | 0, (fy - 1) | 0, 5, 1);
      g.fillRect((fx + 5) | 0, (fy - 1) | 0, 5, 1);
    }

    /* the plate */
    if (u > CLOSE * 0.4) {
      var warnY = 62;
      if ((I.t >> 3) % 2 === 0 || u > SLAM) {
        text(g, '!! WARNING !!', warnY, '#ff7676', '6px');
      }
    }
    if (u > PLATE) {
      /* rule sweeping open from the centre, then the name typed onto it */
      var sweep = ease((u - PLATE) / 0.16);
      var half = Math.round(sweep * 96);
      g.fillStyle = '#ff5a7a';
      g.fillRect((NS.W / 2 - half) | 0, 80, half * 2, 1);
      g.fillRect((NS.W / 2 - half) | 0, 98, half * 2, 1);

      var shown = Math.min(I.name.length, Math.floor(noteT / 2));
      if (shown > 0) {
        var s = I.name.substring(0, shown);
        if (shown < I.name.length && (I.t & 2)) s += '_';
        text(g, s, 93, u > SLAM ? '#fff2c8' : '#ffb0b0', '11px');
      }
      if (I.sub && u > SLAM - 0.14) {
        text(g, I.sub, 110, '#8fd0ff', '6px');
      }
    }

    if (flash > 0 && !NS.reducedFlash()) {
      g.fillStyle = 'rgba(255,255,255,' + (flash / 16 * 0.55).toFixed(3) + ')';
      g.fillRect(0, 0, NS.W, H);
    }
  };

  function text(g, t, y, color, size) {
    g.font = size + ' monospace';
    g.textAlign = 'center';
    g.fillStyle = color;
    g.fillText(t, NS.W / 2, y);
    g.textAlign = 'left';
    g.font = '6px monospace';
  }

})(NS);
