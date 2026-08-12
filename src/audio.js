/* audio.js — WebAudio chiptune layer: NES-flavoured square/noise SFX plus a
   fully arranged multi-section stage track and a separate boss theme.
   No audio assets — every note is synthesised at schedule time. */
(function (NS) {
  'use strict';

  var ctx = null, master = null, musicGain = null, sfxGain = null;
  var enabled = true;
  var volumes = { master: 1, music: 1, sfx: 1 };
  var BASE_MASTER = 0.35, BASE_MUSIC = 0.30, BASE_SFX = 0.55;

  function init() {
    if (ctx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { enabled = false; return; }
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = BASE_MASTER * volumes.master; master.connect(ctx.destination);
    musicGain = ctx.createGain(); musicGain.gain.value = BASE_MUSIC * volumes.music; musicGain.connect(master);
    sfxGain = ctx.createGain(); sfxGain.gain.value = BASE_SFX * volumes.sfx; sfxGain.connect(master);
  }

  function resume() {
    init();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  /* Values are normalised so the menu can present useful percentages while
     preserving the deliberately conservative mix levels above. This does not
     create an AudioContext during boot; it only updates live nodes if the
     browser has already unlocked them. */
  function setVolumes(next) {
    if (next.master != null) volumes.master = NS.clamp(next.master, 0, 1);
    if (next.music != null) volumes.music = NS.clamp(next.music, 0, 1);
    if (next.sfx != null) volumes.sfx = NS.clamp(next.sfx, 0, 1);
    if (master) master.gain.value = BASE_MASTER * volumes.master;
    if (musicGain) musicGain.gain.value = BASE_MUSIC * volumes.music;
    if (sfxGain) sfxGain.gain.value = BASE_SFX * volumes.sfx;
  }

  /* one-shot tone */
  function tone(opt) {
    if (!enabled) return;
    init();
    if (!ctx) return;
    var t0 = ctx.currentTime;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = opt.type || 'square';
    osc.frequency.setValueAtTime(opt.f0, t0);
    if (opt.f1 != null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opt.f1), t0 + opt.dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opt.vol || 0.25, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opt.dur);
    osc.connect(g); g.connect(opt.bus || sfxGain);
    osc.start(t0); osc.stop(t0 + opt.dur + 0.02);
  }

  var noiseBuf = null;
  function noise(dur, vol, hp) {
    if (!enabled) return;
    init();
    if (!ctx) return;
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    var t0 = ctx.currentTime;
    var src = ctx.createBufferSource(); src.buffer = noiseBuf;
    var f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.setValueAtTime(hp || 900, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(80, (hp || 900) * 0.25), t0 + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(sfxGain);
    src.start(t0); src.stop(t0 + dur);
  }

  var sfx = {
    shot:     function () { tone({ f0: 1200, f1: 520, dur: 0.06, vol: 0.12, type: 'square' }); },
    laser:    function () { tone({ f0: 900,  f1: 1800, dur: 0.10, vol: 0.10, type: 'sawtooth' }); },
    missile:  function () { noise(0.10, 0.10, 1600); },
    hit:      function () { noise(0.05, 0.16, 2400); },
    explode:  function () { noise(0.34, 0.42, 900); tone({ f0: 180, f1: 40, dur: 0.30, vol: 0.18, type: 'triangle' }); },
    bigBoom:  function () { noise(0.85, 0.55, 500); tone({ f0: 120, f1: 30, dur: 0.8, vol: 0.25, type: 'triangle' }); },
    pickup:   function () { tone({ f0: 700, f1: 1400, dur: 0.10, vol: 0.20 }); },
    power:    function () { tone({ f0: 500, f1: 1200, dur: 0.09, vol: 0.18 }); tone({ f0: 1000, f1: 1600, dur: 0.14, vol: 0.12 }); },
    extraLife:function () {
      tone({ f0: 660, f1: 880, dur: 0.10, vol: 0.18, type: 'square' });
      setTimeout(function () { tone({ f0: 880, f1: 1320, dur: 0.14, vol: 0.20, type: 'square' }); }, 90);
    },
    death:    function () { tone({ f0: 400, f1: 60, dur: 0.7, vol: 0.28, type: 'square' }); noise(0.6, 0.4, 700); },
    alarm:    function () { tone({ f0: 880, f1: 440, dur: 0.18, vol: 0.20, type: 'square' }); },

    /* ---- boss-entrance cues ----
       The intro sequence needs three sounds the fight itself never uses: a
       two-tone klaxon under the warning plate, a long sub rumble while the
       thing hauls itself into the arena, and a metal slam on the beat the
       name locks in. */
    klaxon:   function () {
      tone({ f0: 520, f1: 300, dur: 0.42, vol: 0.20, type: 'square' });
      tone({ f0: 261, f1: 152, dur: 0.42, vol: 0.13, type: 'sawtooth' });
    },
    rumble:   function () {
      noise(1.10, 0.14, 200);
      tone({ f0: 68, f1: 34, dur: 1.30, vol: 0.20, type: 'triangle' });
    },
    slam:     function () {
      noise(0.28, 0.42, 700);
      tone({ f0: 150, f1: 44, dur: 0.36, vol: 0.24, type: 'square' });
      setTimeout(function () { tone({ f0: 92, f1: 30, dur: 0.5, vol: 0.18, type: 'triangle' }); }, 60);
    }
  };

  /* ======================================================================
     MUSIC — a written-out arrangement, not a bar loop.

     The old track was 16 steps of bass against 16 of lead, repeating every
     ~1.7 seconds. This is a scored piece: sections with their own chord
     progressions, four-bar melodic phrases that answer each other, a
     bridge that lifts to the relative major, drum patterns that change per
     section with fills on the turnarounds, and an arrangement that runs
     about 75 seconds before it repeats — and repeats to bar 5, not back
     into the intro.

     Everything is in A minor. Pitches are semitone offsets from A; the
     scheduler resolves them against the chord under them.

     Notation: bars are 16 sixteenth-note tokens.
       "12"  strike this pitch
       "."   rest
       "-"   hold the previous note through this step
     ====================================================================== */
  var musicTimer = null, step = 0, nextTime = 0;
  var BPM = 148, SPB = 60 / 148 / 4;   // one 16th note, in seconds
  var STEPS_PER_BAR = 16;

  function hz(base, semi) { return base * Math.pow(2, semi / 12); }
  function pat(s) { return s.trim().split(/\s+/); }
  function bars() { return Array.prototype.map.call(arguments, pat); }

  /* ---- chords ---------------------------------------------------------
     [root semitone from A, quality]. A=0 C=3 D=5 E=7 F=8 G=10 */
  var TRIAD = { m: [0, 3, 7], M: [0, 4, 7], sus: [0, 5, 7], dim: [0, 3, 6] };
  function ch(root, q) { return { root: root, q: q || 'm' }; }

  var Am = ch(0, 'm'), C = ch(3, 'M'), Dm = ch(5, 'm'),
      E  = ch(7, 'M'), F = ch(8, 'M'), G  = ch(10, 'M');

  /* ---- drum kits ------------------------------------------------------ */
  var DRUMS = {
    none:  { k: pat('. . . . . . . . . . . . . . . .'),
             s: pat('. . . . . . . . . . . . . . . .'),
             h: pat('. . . . . . . . . . . . . . . .') },
    soft:  { k: pat('x . . . . . . . x . . . . . . .'),
             s: pat('. . . . . . . . . . . . . . . .'),
             h: pat('. . x . . . x . . . x . . . x .') },
    drive: { k: pat('x . . . . . x . x . . . . . . .'),
             s: pat('. . . . x . . . . . . . x . . .'),
             h: pat('x . x . x . x . x . x . x . x .') },
    push:  { k: pat('x . . x . . x . x . . x . . . .'),
             s: pat('. . . . x . . . . . x . x . . .'),
             h: pat('x . x . x . x . x . x . x . x x') },
    half:  { k: pat('x . . . . . . . . . . . . . . .'),
             s: pat('. . . . . . . . x . . . . . . .'),
             h: pat('x . . . x . . . x . . . x . . .') }
  };
  /* played instead of the kit's own pattern on a section's final bar */
  var FILL = { k: pat('x . . . . . . . x . . . . . . .'),
               s: pat('. . . . x . x . x . x x s . s s'),
               h: pat('. . . . . . . . . . . . . . . .') };

  /* ---- sections -------------------------------------------------------
     Each section: chords (one per bar), a lead line, a bass line, the
     drum kit, and whether the last bar takes a fill. */
  var SECTIONS = {

    /* four bars of nothing but a rising figure over a held Am — the stage
       gets to start before the track does */
    intro: {
      chords: [Am, Am, F, E],
      drums: 'soft', fill: true,
      lead: bars(
        '.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .',
        '.  .  .  .  .  .  .  .  12 .  15 .  19 .  22 .',
        '24 -  -  -  .  .  .  .  20 .  17 .  15 .  12 .',
        '19 -  -  -  -  -  .  .  .  .  .  .  .  .  .  .'),
      bass: bars(
        '0  .  .  .  7  .  .  .  12 .  .  .  7  .  .  .',
        '0  .  .  .  7  .  .  .  12 .  .  .  7  .  .  .',
        '8  .  .  .  15 .  .  .  20 .  .  .  15 .  .  .',
        '7  .  .  .  14 .  .  .  19 .  .  .  23 .  .  .')
    },

    /* the main theme: a question phrase and its answer */
    A: {
      chords: [Am, Am, F, G, Am, Am, Dm, E],
      drums: 'drive', fill: true,
      lead: bars(
        '12 .  12 .  15 .  19 .  22 .  19 .  15 .  12 .',
        '10 .  10 .  14 .  17 .  22 -  -  .  17 .  14 .',
        '8  .  12 .  15 .  20 .  24 -  -  .  20 .  15 .',
        '19 .  17 .  15 .  14 .  12 -  -  -  .  .  .  .',
        '12 .  15 .  19 .  22 .  24 .  22 .  19 .  15 .',
        '22 .  19 .  17 .  15 .  14 .  15 .  17 .  19 .',
        '17 .  17 .  20 .  22 .  24 .  22 .  20 .  17 .',
        '19 -  -  .  12 -  -  .  7  -  -  -  -  .  .  .'),
      bass: bars(
        '0  .  12 .  0  .  12 .  0  .  12 .  0  .  12 .',
        '0  .  12 .  0  .  12 .  0  .  12 .  0  .  12 .',
        '8  .  20 .  8  .  20 .  8  .  20 .  8  .  20 .',
        '10 .  22 .  10 .  22 .  10 .  22 .  10 .  22 .',
        '0  .  12 .  0  .  12 .  0  .  12 .  0  .  12 .',
        '0  .  12 .  0  .  12 .  0  .  12 .  0  .  12 .',
        '5  .  17 .  5  .  17 .  5  .  17 .  5  .  17 .',
        '7  .  19 .  7  .  19 .  7  .  19 .  11 .  23 .')
    },

    /* the same engine an octave up, chords inverted — this is the hook */
    B: {
      chords: [F, G, Am, Am, F, G, C, E],
      drums: 'push', fill: true,
      lead: bars(
        '24 .  22 .  20 .  22 .  24 .  27 .  24 .  22 .',
        '22 .  20 .  19 .  20 .  22 .  24 .  22 .  19 .',
        '24 .  24 .  27 .  29 .  31 -  -  .  27 .  24 .',
        '22 .  19 .  15 .  12 -  -  -  .  .  .  .  .  .',
        '24 .  22 .  20 .  22 .  24 .  27 .  29 .  31 .',
        '34 -  -  .  31 .  27 .  24 .  22 .  20 .  19 .',
        '15 .  19 .  22 .  27 .  31 -  -  .  27 .  22 .',
        '19 -  -  .  23 -  -  .  19 -  -  -  -  .  .  .'),
      bass: bars(
        '8  12 .  8  20 .  8  .  8  12 .  8  20 .  8  .',
        '10 14 .  10 22 .  10 .  10 14 .  10 22 .  10 .',
        '0  3  .  0  12 .  0  .  0  3  .  0  12 .  0  .',
        '0  3  .  0  12 .  0  .  0  3  .  0  12 .  0  .',
        '8  12 .  8  20 .  8  .  8  12 .  8  20 .  8  .',
        '10 14 .  10 22 .  10 .  10 14 .  10 22 .  10 .',
        '3  7  .  3  15 .  3  .  3  7  .  3  15 .  3  .',
        '7  11 .  7  19 .  7  .  11 .  7  .  11 .  19 .')
    },

    /* everything drops but the low end — the breath before the bridge */
    breakdown: {
      chords: [Am, Am, Am, E],
      drums: 'half', fill: true,
      lead: bars(
        '.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .',
        '.  .  .  .  .  .  .  .  .  .  .  .  12 .  15 .',
        '19 -  -  -  .  .  .  .  .  .  .  .  .  .  .  .',
        '.  .  .  .  .  .  .  .  11 .  14 .  19 .  23 .'),
      bass: bars(
        '0  .  .  .  .  .  0  .  .  .  .  .  0  .  .  .',
        '0  .  .  .  .  .  0  .  .  .  .  .  0  .  .  .',
        '0  .  .  .  .  .  0  .  .  .  .  .  0  .  .  .',
        '7  .  .  .  7  .  .  .  7  .  7  .  7  .  7  .')
    },

    /* the bridge: leans on C major, the relative major, so it reads as a
       genuine lift rather than more of the same minor */
    bridge: {
      chords: [C, G, Am, F, C, G, Dm, E],
      drums: 'drive', fill: true,
      lead: bars(
        '15 -  -  -  .  .  19 .  22 -  -  -  .  .  19 .',
        '17 -  -  -  .  .  20 .  24 -  -  -  .  .  20 .',
        '12 -  -  .  15 .  19 .  24 -  -  -  -  .  .  .',
        '22 -  -  .  19 .  15 .  12 -  -  -  -  .  .  .',
        '15 .  19 .  22 .  24 .  27 -  -  .  24 .  22 .',
        '17 .  20 .  22 .  26 .  29 -  -  .  26 .  22 .',
        '17 .  20 .  24 .  20 .  17 .  14 .  12 .  10 .',
        '11 -  -  .  14 -  -  .  19 -  -  -  -  .  .  .'),
      bass: bars(
        '3  .  10 .  15 .  10 .  3  .  10 .  15 .  10 .',
        '10 .  14 .  19 .  14 .  10 .  14 .  19 .  14 .',
        '0  .  7  .  12 .  7  .  0  .  7  .  12 .  7  .',
        '8  .  12 .  20 .  12 .  8  .  12 .  20 .  12 .',
        '3  .  10 .  15 .  10 .  3  .  10 .  15 .  10 .',
        '10 .  14 .  19 .  14 .  10 .  14 .  19 .  14 .',
        '5  .  12 .  17 .  12 .  5  .  12 .  17 .  12 .',
        '7  .  11 .  19 .  11 .  7  .  11 .  19 .  23 .')
    },

    /* four bars that wind back to the top */
    turnaround: {
      chords: [F, G, Am, E],
      drums: 'push', fill: true,
      lead: bars(
        '20 .  19 .  17 .  15 .  20 .  19 .  17 .  15 .',
        '22 .  20 .  19 .  17 .  22 .  20 .  19 .  17 .',
        '24 -  -  .  19 .  15 .  12 -  -  .  .  .  .  .',
        '11 .  14 .  19 .  23 .  26 -  -  -  -  .  .  .'),
      bass: bars(
        '8  .  20 .  8  .  20 .  8  .  20 .  8  .  20 .',
        '10 .  22 .  10 .  22 .  10 .  22 .  10 .  22 .',
        '0  .  12 .  0  .  12 .  0  .  12 .  0  .  12 .',
        '7  .  19 .  7  .  19 .  11 .  23 .  11 .  23 .')
    },

    /* boss theme: chromatic, urgent, deliberately short and cyclic */
    bossA: {
      chords: [Am, Am, ch(1, 'M'), ch(1, 'M'), Am, Am, E, E],
      drums: 'push', fill: true,
      lead: bars(
        '12 12 .  12 .  12 .  13 12 .  .  .  11 .  10 .',
        '12 12 .  12 .  12 .  13 15 .  .  .  14 .  13 .',
        '13 13 .  13 .  13 .  14 16 .  .  .  15 .  13 .',
        '20 -  -  .  19 .  18 .  17 .  16 .  15 .  13 .',
        '12 12 .  12 .  12 .  13 12 .  .  .  11 .  10 .',
        '15 15 .  15 .  15 .  16 15 .  .  .  14 .  13 .',
        '19 .  18 .  17 .  16 .  15 .  14 .  13 .  12 .',
        '11 -  -  .  11 -  -  .  23 -  -  -  -  .  .  .'),
      bass: bars(
        '0  0  .  0  12 .  0  .  0  0  .  0  12 .  0  .',
        '0  0  .  0  12 .  0  .  0  0  .  0  12 .  0  .',
        '1  1  .  1  13 .  1  .  1  1  .  1  13 .  1  .',
        '1  1  .  1  13 .  1  .  1  1  .  1  13 .  1  .',
        '0  0  .  0  12 .  0  .  0  0  .  0  12 .  0  .',
        '0  0  .  0  12 .  0  .  0  0  .  0  12 .  0  .',
        '7  7  .  7  19 .  7  .  7  7  .  7  19 .  7  .',
        '7  7  .  7  19 .  11 .  11 .  19 .  23 .  19 .')
    }
  };

  /* ---- arrangements ---------------------------------------------------
     `loopFrom` is the index the arrangement returns to, so the intro is
     heard once per run and never again. */
  var TRACKS = {
    stage: { order: ['intro', 'A', 'B', 'breakdown', 'bridge', 'A', 'turnaround'],
             loopFrom: 1 },
    boss:  { order: ['bossA'], loopFrom: 0 }
  };

  var track = TRACKS.stage;

  /* Flattened timeline for the current track: one entry per bar. */
  var timeline = [];
  var loopStartBar = 0;

  function buildTimeline() {
    timeline = [];
    loopStartBar = 0;
    for (var i = 0; i < track.order.length; i++) {
      if (i === track.loopFrom) loopStartBar = timeline.length;
      var sec = SECTIONS[track.order[i]];
      for (var b = 0; b < sec.chords.length; b++) {
        timeline.push({
          sec: sec,
          bar: b,
          last: b === sec.chords.length - 1
        });
      }
    }
  }

  /* ---- voices ---------------------------------------------------------- */
  function blip(t, freq, dur, vol, type, detune) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    if (detune) o.detune.setValueAtTime(detune, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(musicGain);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function drum(t, kind) {
    if (!noiseBuf) return;
    var src = ctx.createBufferSource(); src.buffer = noiseBuf;
    var f = ctx.createBiquadFilter();
    var g = ctx.createGain();

    if (kind === 'k') {
      /* kick is pitched, not noise: a fast drop on a triangle */
      var o = ctx.createOscillator(), og = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(130, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.10);
      og.gain.setValueAtTime(0.34, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      o.connect(og); og.connect(musicGain);
      o.start(t); o.stop(t + 0.15);
      return;
    }
    if (kind === 's') {
      f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.8;
      g.gain.setValueAtTime(0.20, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      src.connect(f); f.connect(g); g.connect(musicGain);
      src.start(t); src.stop(t + 0.12);
      return;
    }
    /* hat */
    f.type = 'highpass'; f.frequency.value = 7000;
    g.gain.setValueAtTime(0.055, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    src.connect(f); f.connect(g); g.connect(musicGain);
    src.start(t); src.stop(t + 0.05);
  }

  /* how long a token sounds: strike plus any '-' holds following it */
  function heldSteps(barTokens, i) {
    var n = 1;
    while (i + n < barTokens.length && barTokens[i + n] === '-') n++;
    return n;
  }

  function scheduleStep(t, absStep) {
    if (!timeline.length) buildTimeline();

    var barsTotal = timeline.length;
    var loopLen = barsTotal - loopStartBar;
    var barIdx = Math.floor(absStep / STEPS_PER_BAR);
    if (barIdx >= barsTotal) {
      barIdx = loopStartBar + ((barIdx - loopStartBar) % loopLen);
    }
    var slot = timeline[barIdx];
    var sec = slot.sec;
    var s = absStep % STEPS_PER_BAR;

    var chord = sec.chords[slot.bar];
    var tri = TRIAD[chord.q];

    /* --- bass: chord root and fifth, an octave and a half below the lead */
    var bassTok = sec.bass[slot.bar][s];
    if (bassTok && bassTok !== '.' && bassTok !== '-') {
      var bn = parseInt(bassTok, 10);
      var bdur = heldSteps(sec.bass[slot.bar], s) * SPB * 0.92;
      blip(t, hz(55, bn), bdur, 0.26, 'triangle');
    }

    /* --- lead */
    var leadTok = sec.lead[slot.bar][s];
    if (leadTok && leadTok !== '.' && leadTok !== '-') {
      var ln = parseInt(leadTok, 10);
      var ldur = heldSteps(sec.lead[slot.bar], s) * SPB * 0.95;
      blip(t, hz(220, ln), ldur, 0.115, 'square');
      /* a quiet detuned double gives the lead some width */
      blip(t, hz(220, ln), ldur * 0.8, 0.045, 'square', 8);
    }

    /* --- inner harmony: the chord's third, on the offbeats, quietly */
    if (s % 4 === 2) {
      blip(t, hz(110, chord.root + tri[1]), SPB * 1.6, 0.035, 'square');
    }

    /* --- drums, with the section's last bar taking a fill */
    var kit = (slot.last && sec.fill) ? FILL : DRUMS[sec.drums];
    if (kit.k[s] !== '.') drum(t, 'k');
    if (kit.s[s] !== '.') drum(t, 's');
    if (kit.h[s] !== '.') drum(t, 'h');
  }

  function pump() {
    if (!ctx) return;
    var horizon = ctx.currentTime + 0.25;
    while (nextTime < horizon) {
      scheduleStep(nextTime, step);
      step++;
      nextTime += SPB;
    }
  }

  function startMusic() {
    if (!enabled) return;
    init();
    if (!ctx || musicTimer) return;
    if (!noiseBuf) noise(0.001, 0.0001, 100); // force buffer creation
    buildTimeline();
    nextTime = ctx.currentTime + 0.1;
    musicTimer = setInterval(pump, 60);
  }

  function stopMusic() {
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  }

  /* Switch arrangements. Restarting from bar 0 is deliberate: the boss
     theme should hit on its downbeat, not wherever the stage track was. */
  function setTrack(name) {
    var next = TRACKS[name] || TRACKS.stage;
    if (next === track) return;
    track = next;
    step = 0;
    buildTimeline();
    if (musicTimer && ctx) nextTime = ctx.currentTime + 0.05;
  }

  NS.Audio = {
    resume: resume,
    sfx: sfx,
    startMusic: startMusic,
    stopMusic: stopMusic,
    setTrack: setTrack,
    setVolumes: setVolumes,
    volumes: function () { return { master: volumes.master, music: volumes.music, sfx: volumes.sfx }; },
    /* restart the arrangement from the top, intro included */
    rewind: function () { step = 0; },
    setMusicRate: function (r) { BPM = 148 * r; SPB = 60 / BPM / 4; },
    toggle: function () { enabled = !enabled; if (!enabled) stopMusic(); return enabled; }
  };

})(NS);
