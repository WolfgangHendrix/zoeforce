/* profile.js — four local pilot records with legacy-save migration.

   Display/device preferences remain global because they describe this
   browser and screen. Campaign progress, fire style, records and
   achievements belong to the selected pilot. Profile 1 imports the old
   single-save values the first time this version runs. */
(function (NS) {
  'use strict';

  var P = {};
  NS.Profile = P;

  var KEY = 'ns_profiles_v1';
  var data = null, dirty = false, saveClock = 0;
  var STATS = {
    runsStarted: 0, playFrames: 0, totalScore: 0,
    enemiesDestroyed: 0, bossesDestroyed: 0,
    capsulesCollected: 0, deaths: 0, continuesUsed: 0,
    stagesCleared: 0, campaignClears: 0
  };
  var ACHIEVEMENTS = [
    { id: 'first_sortie', name: 'FIRST SORTIE', desc: 'BEGIN A RUN', test: function (p) { return p.stats.runsStarted >= 1; } },
    { id: 'first_blood', name: 'FIRST BLOOD', desc: 'DESTROY AN ENEMY', test: function (p) { return p.stats.enemiesDestroyed >= 1; } },
    { id: 'centurion', name: 'CENTURION', desc: 'DESTROY 100 ENEMIES', test: function (p) { return p.stats.enemiesDestroyed >= 100; } },
    { id: 'power_collector', name: 'POWER COLLECTOR', desc: 'TAKE 50 CAPSULES', test: function (p) { return p.stats.capsulesCollected >= 50; } },
    { id: 'zone_clear', name: 'ZONE CLEARED', desc: 'CLEAR A STAGE', test: function (p) { return p.stats.stagesCleared >= 1; } },
    { id: 'halfway', name: 'HALFWAY THERE', desc: 'REACH STAGE 4', test: function (p) { return p.furthestStage >= 4; } },
    { id: 'boss_hunter', name: 'BOSS HUNTER', desc: 'DESTROY 6 BOSSES', test: function (p) { return p.stats.bossesDestroyed >= 6; } },
    { id: 'high_flyer', name: 'HIGH FLYER', desc: 'SCORE 100,000', test: function (p) { return p.highScore >= 100000; } },
    { id: 'six_zones', name: 'SIX ZONES SILENT', desc: 'DEFEAT ZELOS FORCE', test: function (p) { return p.stats.campaignClears >= 1; } }
  ];

  function fresh(slot) {
    var stats = {}, k;
    for (k in STATS) stats[k] = STATS[k];
    return {
      version: 1, name: 'PILOT ' + slot, created: Date.now(),
      highScore: 0, furthestStage: 1, fireMode: 'manual',
      stats: stats, achievements: {}
    };
  }

  function normalize(p, slot) {
    if (!p) return null;
    p.name = p.name || ('PILOT ' + slot);
    p.highScore = Math.max(0, parseInt(p.highScore, 10) || 0);
    p.furthestStage = NS.clamp(parseInt(p.furthestStage, 10) || 1, 1, 6);
    if (['manual', 'auto', 'assist'].indexOf(p.fireMode) < 0) p.fireMode = 'manual';
    p.stats = p.stats || {};
    for (var k in STATS) p.stats[k] = Math.max(0, parseInt(p.stats[k], 10) || 0);
    p.achievements = p.achievements || {};
    return p;
  }

  function persist(label) {
    if (!data) return false;
    dirty = false; saveClock = 0;
    return NS.Save.write(KEY, JSON.stringify(data), label || 'PROFILE SAVED');
  }

  P.init = function () {
    if (data) return;
    var raw = NS.Save.read(KEY, '');
    try { data = raw ? JSON.parse(raw) : null; } catch (e) { data = null; }
    if (!data || !Array.isArray(data.slots)) {
      data = { active: 1, slots: [null, null, null, null] };
      var legacy = fresh(1);
      legacy.highScore = Math.max(0, parseInt(NS.Save.read('ns_hiscore', '0'), 10) || 0);
      legacy.furthestStage = NS.clamp(parseInt(NS.Save.read('ns_furthest_stage', '1'), 10) || 1, 1, 6);
      var fire = NS.Save.read('ns_firemode', 'manual');
      legacy.fireMode = ['manual', 'auto', 'assist'].indexOf(fire) >= 0 ? fire : 'manual';
      data.slots[0] = legacy;
      persist('PROFILE 1 CREATED');
    }
    data.active = NS.clamp(parseInt(data.active, 10) || 1, 1, 4);
    for (var i = 0; i < 4; i++) data.slots[i] = normalize(data.slots[i], i + 1);
    if (!data.slots[data.active - 1]) {
      data.slots[data.active - 1] = fresh(data.active); persist('PROFILE CREATED');
    }
  };

  P.activeSlot = function () { P.init(); return data.active; };
  P.current = function () { P.init(); return data.slots[data.active - 1]; };
  P.slot = function (slot) { P.init(); return data.slots[slot - 1] || null; };
  P.slots = function () { P.init(); return data.slots.slice(); };

  P.activate = function (slot) {
    P.init(); slot = NS.clamp(slot | 0, 1, 4);
    if (!data.slots[slot - 1]) data.slots[slot - 1] = fresh(slot);
    data.active = slot; persist('PROFILE ' + slot + ' ACTIVE'); return data.slots[slot - 1];
  };

  P.erase = function (slot) {
    P.init(); slot = NS.clamp(slot | 0, 1, 4); data.slots[slot - 1] = null;
    if (data.active === slot) {
      var next = 0;
      for (var i = 0; i < 4; i++) if (data.slots[i]) { next = i + 1; break; }
      if (!next) { next = 1; data.slots[0] = fresh(1); }
      data.active = next;
    }
    persist('PROFILE ERASED'); return data.active;
  };

  function recording() {
    return !(NS.Autoplay && NS.Autoplay.active && NS.Autoplay.active()) &&
           !(NS.Debug && NS.Debug.invincible);
  }
  P.recording = recording;

  function evaluate(p) {
    var unlocked = [];
    for (var i = 0; i < ACHIEVEMENTS.length; i++) {
      var a = ACHIEVEMENTS[i];
      if (!p.achievements[a.id] && a.test(p)) {
        p.achievements[a.id] = Date.now(); unlocked.push(a.name);
      }
    }
    return unlocked;
  }

  P.record = function (name, amount) {
    if (!recording()) return [];
    var p = P.current();
    if (!Object.prototype.hasOwnProperty.call(p.stats, name)) return [];
    p.stats[name] += amount == null ? 1 : amount; dirty = true;
    return evaluate(p);
  };
  P.setHighScore = function (score) {
    if (!recording()) return [];
    var p = P.current();
    if (score > p.highScore) { p.highScore = score | 0; dirty = true; }
    return evaluate(p);
  };
  P.unlockStage = function (stage) {
    if (!recording()) return [];
    var p = P.current();
    if (stage > p.furthestStage) { p.furthestStage = NS.clamp(stage, 1, 6); dirty = true; }
    return evaluate(p);
  };
  P.setFireMode = function (mode) {
    var p = P.current(); p.fireMode = mode; dirty = true; persist('FIRE MODE');
  };
  P.achievements = function () { return ACHIEVEMENTS.slice(); };
  P.flush = function (label) { if (dirty) persist(label || 'PROFILE SAVED'); };
  P.tick = function () { if (dirty && ++saveClock >= 1800) persist('PROFILE SAVED'); };

})(NS);
