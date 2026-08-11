/* level1.js — the Stage 1 spawn script.
   Events are keyed to world scroll position, so the stage plays back
   identically every run (arcade-style authored waves, not random spawns).
   Editing this table is how you re-time the stage for the reskin.

   Pacing follows the Life Force rulebook rather than a flat spawn drip:
     • one formation is the unit of threat — waves arrive as shapes, not
       as individual craft, and the shape is readable before it reaches you
     • formations come in phrases: two or three air waves, then a wall
       threat or a terrain set piece, then a beat of air to breathe
     • the corridor's own hazards (prominences, tentacles) carry the hard
       sections; air traffic thins out where the flesh closes in
     • power capsules come from formations and nothing else, exactly as in
       Life Force: wipe a complete row before any member escapes and it pays
       one capsule. The twelve opening rows establish the NES recovery and
       power-up cadence before the authored corridor threats begin */
(function (NS) {
  'use strict';

  var L = {};
  NS.Level1 = L;

  /* Formation id counter. Every shape claims one so its members can be
     tracked as a group for the clear-the-whole-squad capsule bonus. */
  var nextGid = 0;
  function gid() { return ++nextGid; }

  /* ---- formation shapes -------------------------------------------------
     Every helper spawns one readable shape. `bonus` marks the red carrier
     squads: wipe the whole formation without letting one escape and it
     pays a power capsule. */

  /* single file entering from the right — the bread-and-butter wave */
  function line(y, pattern, bonus, n, gap, opt) {
    n = n || 5; gap = gap == null ? 13 : gap;
    var id = gid();
    for (var i = 0; i < n; i++) {
      NS.Enemies.spawnFlapper(NS.W + NS.Enemies.ENTRY_MARGIN, y, mix(opt, {
        pattern: pattern, gid: id, bonus: bonus, delay: i * gap
      }));
    }
  }

  /* arrowhead: a point craft with wings fanning out behind it */
  function vee(y, pattern, bonus, wings, opt) {
    wings = wings || 3;
    var id = gid();
    NS.Enemies.spawnFlapper(NS.W + NS.Enemies.ENTRY_MARGIN, y, mix(opt, {
      pattern: pattern, gid: id, bonus: bonus, delay: 0
    }));
    for (var i = 1; i <= wings; i++) {
      NS.Enemies.spawnFlapper(NS.W + NS.Enemies.ENTRY_MARGIN + i * 9, y - i * 11, mix(opt, {
        pattern: pattern, gid: id, bonus: bonus, delay: i * 5
      }));
      NS.Enemies.spawnFlapper(NS.W + NS.Enemies.ENTRY_MARGIN + i * 9, y + i * 11, mix(opt, {
        pattern: pattern, gid: id, bonus: bonus, delay: i * 5
      }));
    }
  }

  /* vertical stack arriving as one wall — forces a lane choice */
  function column(cy, pattern, bonus, n, spread, opt) {
    n = n || 5; spread = spread || 22;
    var id = gid();
    var top = cy - (n - 1) * spread * 0.5;
    for (var i = 0; i < n; i++) {
      NS.Enemies.spawnFlapper(NS.W + NS.Enemies.ENTRY_MARGIN, top + i * spread, mix(opt, {
        pattern: pattern, gid: id, bonus: bonus, delay: 0
      }));
    }
  }

  /* diagonal staircase — reads as a sweep across the corridor */
  function ladder(y0, y1, pattern, bonus, n, gap, opt) {
    n = n || 6; gap = gap == null ? 9 : gap;
    var id = gid();
    for (var i = 0; i < n; i++) {
      var t = n === 1 ? 0 : i / (n - 1);
      NS.Enemies.spawnFlapper(NS.W + NS.Enemies.ENTRY_MARGIN, NS.lerp(y0, y1, t), mix(opt, {
        pattern: pattern, gid: id, bonus: bonus, delay: i * gap
      }));
    }
  }

  /* two mirrored streams — the classic pincer opener */
  function pincer(bonus, pattern) {
    line(44, pattern || 'sine', bonus, 5, 12);
    line(NS.PLAYFIELD_H - 60, pattern || 'sine', false, 5, 12);
  }

  /* crossing dives: two diagonals that rake the corridor and intersect */
  function cross(bonus) {
    var id = gid();
    for (var i = 0; i < 4; i++) {
      NS.Enemies.spawnFlapper(NS.W + NS.Enemies.ENTRY_MARGIN, 40, {
        pattern: 'dive', gid: id, bonus: bonus, delay: i * 11,
        vx: -1.5, vy: 1.15, shy: true
      });
      NS.Enemies.spawnFlapper(NS.W + NS.Enemies.ENTRY_MARGIN, NS.PLAYFIELD_H - 46, {
        pattern: 'dive', gid: id, bonus: bonus, delay: i * 11,
        vx: -1.5, vy: -1.15, shy: true
      });
    }
  }

  /* rear attack: a flight that overtakes you from behind, flying right.
     Life Force uses this to stop you camping the left edge. */
  function rear(y, n, gap) {
    n = n || 4; gap = gap == null ? 12 : gap;
    var id = gid();
    for (var i = 0; i < n; i++) {
      NS.Enemies.spawnFlapper(-NS.Enemies.ENTRY_MARGIN - i * 4, y, {
        pattern: 'rush', gid: id, delay: i * gap, vx: 1.05, vy: 0
      });
    }
  }

  /* a fast arrowhead dash — no shots, pure positional pressure */
  function dash(y, spread) {
    spread = spread || 14;
    var id = gid();
    for (var i = 0; i < 3; i++) {
      NS.Enemies.spawnFlapper(NS.W + NS.Enemies.ENTRY_MARGIN + i * 10, y + (i - 1) * spread, {
        pattern: 'rush', gid: id, vx: -1.5, vy: (i - 1) * -0.16
      });
    }
  }

  /* NES Cell Stage opening row. Five craft share one piecewise-linear Z
     path and enter 12 frames apart. A paired event calls this twice, giving
     each row its own clear bonus exactly as the cartridge does. */
  function nesRow(y, turn) {
    line(y, 'zigzag', false, 5, 12, { turn: turn, phase: 0, vx: -1.35 });
  }

  function nesPair(topY, bottomY) {
    nesRow(topY, 1);
    nesRow(bottomY, -1);
  }

  function mix(base, over) {
    var o = {};
    var k;
    if (base) for (k in base) if (base.hasOwnProperty(k)) o[k] = base[k];
    for (k in over) if (over.hasOwnProperty(k)) o[k] = over[k];
    return o;
  }

  /* ---- the escalation ladder --------------------------------------------
     Where the stage arms itself, as [worldX, tier]. See E.tier in
     enemies.js for what each tier means.

     This is a *position* lookup rather than script events, deliberately.
     Tier is a property of where you are in the corridor, so it resolves
     correctly however you got there — normal play or jumping the scroll by
     hand for debugging — and it can never be
     knocked out of step with the waves. */
  var TIERS = [
    [    0, 0 ],   // silent opening: formations attack by flying at you
    [ 2850, 1 ],   // after the twelve NES opening rows
    [ 3600, 2 ],   // wall pods wake up, single shots
    [ 5000, 3 ]    // full strength: spreads and bursts
  ];

  function applyTier(scrollX) {
    var t = 0;
    for (var i = 0; i < TIERS.length; i++) {
      if (scrollX >= TIERS[i][0]) t = TIERS[i][1];
    }
    NS.Enemies.setTier(t);
  }
  L.tierAt = function (scrollX) {
    var t = 0;
    for (var i = 0; i < TIERS.length; i++) if (scrollX >= TIERS[i][0]) t = TIERS[i][1];
    return t;
  };

  /* shorthands for the wall furniture */
  function mouth(wx, ceil, opt) { NS.Enemies.spawnMouth(wx, ceil, opt); }
  function ducker(wx, ceil, opt) { NS.Enemies.spawnDucker(wx, ceil, opt); }
  /* a lone enemy visibly holding a capsule — red livery, always drops */
  var CARRY = { carrier: true };
  function hatch(wx, ceil, opt) { NS.Enemies.spawnHatch(wx, ceil, opt); }
  function tentacle(wx, ceil, opt) { NS.Enemies.spawnTentacle(wx, ceil, opt); }
  function prom(wx, ceil, opt) { NS.Enemies.spawnProminence(wx, ceil, opt); }
  function splitter(y, vy) { NS.Enemies.spawnSplitter(NS.W + NS.Enemies.ENTRY_MARGIN, y, 1, vy || 0); }
  function spore(y) { NS.Enemies.spawnSpore(NS.W + NS.Enemies.ENTRY_MARGIN, y); }

  /* Each entry: [worldX, spawnFunction] — must stay sorted by worldX. */
  var SCRIPT = [
    /* === I. NES OPENING (0-2850) — 12 FIVE-CRAFT ROWS ===================
       Reference play puts sixty opening enemies into the first 60-70
       seconds. The first four rows alternate middle/top; the last eight
       arrive as four paired rows. Every row follows the same exact
       straight-diagonal-straight Z equation and pays one capsule on a
       complete clear. Nothing in this section shoots. */
    [  200, function () { nesRow(118,  1); }],
    [  470, function () { nesRow(38,  1); }],
    [  740, function () { nesRow(126, -1); }],
    [ 1010, function () { nesRow(42,  1); }],
    [ 1330, function () { nesPair(38, 130); }],
    [ 1700, function () { nesPair(52, 146); }],
    [ 2100, function () { nesPair(34, 122); }],
    [ 2520, function () { nesPair(62, 154); }],

    /* === II. FIRST PINCH (2850-4000) ====================================
       Air rows yield to the first wall threats and the corridor becomes
       the primary timing challenge. */
    [ 2960, function () { column(96, 'sine', true, 5, 24); }],       // carrier 6

    /* === IV. LOW CEILING (3000-4000) ====================================
       TIER 3: full strength. Mouths spit three-way spreads and duckers
       fire bursts from here to the end. The ceiling drops hard, and rear
       attacks debut — you can no longer park on the left edge and let the
       stage come to you. This is the stage showing its whole hand, a
       third of the way in. */
    [ 3060, function () { mouth(3290, true); }],
    [ 3140, function () { rear(96, 4, 12); }],
    [ 3230, function () { line(120, 'sine', true, 5, 12); }],         // carrier 7
    [ 3350, function () { ducker(3580, false, CARRY); }],
    [ 3430, function () { prom(3670, false, { period: 130, offset: 0, power: 3.6 }); }],
    [ 3520, function () { ladder(150, 60, 'sine', false, 6, 9); }],
    [ 3620, function () { hatch(3850, true, { cycle: 150, broods: 2 }); }],
    [ 3710, function () { splitter(84, -0.25); splitter(132, 0.25); }],
    [ 3800, function () { line(140, 'strafe', false, 5, 13); }],
    [ 3900, function () { line(128, 'loop', true, 5, 11); }],         // carrier 8

    /* === V. OPEN CAVERN (4000-5000) =====================================
       The corridor opens right out — the one place the stage can afford
       genuinely dense air traffic, so this is the busiest stretch. */
    [ 4020, function () { pincer(false, 'swoop'); }],
    [ 4110, function () { vee(100, 'sine', false, 3); }],
    [ 4210, function () { ducker(4440, false); ducker(4510, true); }],
    [ 4290, function () { cross(true); }],                            // carrier 9
    [ 4400, function () { column(110, 'strafe', false, 6, 22); }],
    [ 4490, function () { spore(70); spore(110); spore(150); }],
    [ 4570, function () { rear(70, 4, 10); rear(148, 4, 10); }],
    [ 4680, function () { line(100, 'loop', true, 5, 11); }],         // carrier 10
    [ 4790, function () { mouth(5020, false); mouth(5070, true, CARRY); }],
    [ 4870, function () { dash(80); dash(140); }],

    /* === VI. THE PROMINENCE GAUNTLET (5000-5900) ========================
       The stage's signature stretch, and the reason the air stays clear:
       five staggered eruptions in a squeeze. One carrier squad in the
       middle rewards holding your nerve. */
    [ 4970, function () { prom(5200, false, { period: 120, offset: 0 }); }],
    [ 5050, function () { prom(5280, true, { period: 120, offset: 40 }); }],
    [ 5130, function () { prom(5360, false, { period: 120, offset: 80 }); }],
    [ 5210, function () { prom(5440, true, { period: 120, offset: 20 }); }],
    [ 5290, function () { prom(5520, false, { period: 120, offset: 60 }); }],
    [ 5380, function () { line(100, 'curl', true, 5, 14); }],         // carrier 11
    [ 5500, function () { prom(5730, false, { period: 130, offset: 30, power: 3.6 }); }],
    [ 5590, function () { tentacle(5820, true, { period: 160, offset: 30 }); }],
    [ 5700, function () { ducker(5930, false, CARRY); }],
    [ 5790, function () { line(120, 'sine', false, 6, 10); }],

    /* === VII. SUNKEN CHAMBER (5900-6800) ================================
       Wide floor, low traffic, two tentacles as the local set piece. */
    [ 5920, function () { mouth(6150, false); }],
    [ 6010, function () { line(80, 'swoop', true, 5, 12); }],         // carrier 12
    [ 6120, function () { tentacle(6350, false, { period: 150, offset: 0, reach: 58 }); }],
    [ 6210, function () { splitter(70, 0.3); splitter(118, -0.3); splitter(160, 0); }],
    [ 6320, function () { ducker(6550, false); ducker(6620, false); }],
    [ 6420, function () { vee(104, 'swoop', true, 3); }],            // carrier 13
    [ 6530, function () { prom(6760, false, { period: 125, offset: 0 }); }],
    [ 6620, function () { column(90, 'sine', false, 5, 24); }],
    [ 6710, function () { cross(false); }],

    /* === VIII. CEILING GALLERY (6800-7700) ==============================
       Ceiling hangs low and the floor is far away. Hatches on the ceiling
       drop rushers straight down into your lane. */
    [ 6800, function () { hatch(7030, true, { cycle: 130, broods: 3 }); }],
    [ 6890, function () { ducker(7120, true); mouth(7170, true, CARRY); }],
    [ 6980, function () { line(90, 'strafe', false, 5, 12); }],
    [ 7080, function () { dash(70); }],
    [ 7160, function () { line(150, 'swoop', true, 5, 11); }],        // carrier 14
    [ 7270, function () { prom(7500, false, { period: 120, offset: 50 }); }],
    [ 7350, function () { rear(110, 5, 10); }],
    [ 7440, function () { hatch(7670, false, { cycle: 130, broods: 2 }); }],
    [ 7530, function () { ladder(60, 160, 'sine', true, 7, 8); }],   // carrier 15
    [ 7630, function () { pincer(false, 'swoop'); }],

    /* === IX. FINAL APPROACH (7700-8600) =================================
       Everything the stage has taught, stacked. Waves overlap two and
       three deep, and the last carrier lands with enough runway to spend
       the capsule before the chamber seals. */
    [ 7720, function () { ducker(7950, false); ducker(8010, true); }],
    [ 7800, function () { column(100, 'strafe', false, 6, 21); }],
    [ 7880, function () { splitter(76, -0.2); splitter(144, 0.2); }],
    [ 7960, function () { cross(false); }],
    [ 8040, function () { line(130, 'loop', true, 5, 11); }],         // carrier 16
    [ 8130, function () { tentacle(8360, false, { period: 140, offset: 0 }); }],
    [ 8200, function () { dash(70); dash(150); }],
    [ 8270, function () { vee(104, 'swoop', false, 3); }],
    [ 8340, function () { rear(96, 5, 9); }],
    [ 8410, function () { spore(70); spore(110); spore(150); }],
    [ 8480, function () { pincer(false); }]
  ];

  L.reset = function () {
    L.cursor = 0;
    nextGid = 0;
    applyTier(0);
  };

  /* Advance the script to `scrollX`, spawning everything newly passed. */
  L.update = function (scrollX) {
    applyTier(scrollX);
    while (L.cursor < SCRIPT.length && SCRIPT[L.cursor][0] <= scrollX) {
      SCRIPT[L.cursor][1]();
      L.cursor++;
    }
  };

  /* Jump the script to `scrollX` *without* spawning anything on the way.
     Debug tools need the wave table positioned correctly, not a stage's
     worth of formations dumped on screen at once. */
  L.seek = function (scrollX) {
    L.cursor = 0;
    while (L.cursor < SCRIPT.length && SCRIPT[L.cursor][0] <= scrollX) L.cursor++;
    applyTier(scrollX);
  };

  /* Signposts used by the HUD / director. */
  L.BOSS_TRIGGER = NS.Terrain.BOSS_X;

})(NS);
