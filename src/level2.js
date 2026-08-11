/* level2.js — vertical volcanic ascent and Cruiser Tetran encounter.
   Everything is authored in upward-scrolling world coordinates at reset,
   including enemies well beyond the camera. Nothing pops into existence at
   the top edge: the camera reaches formations that are already simulated. */
(function (NS) {
  'use strict';

  var L = {};
  NS.Level2 = L;

  L.FORTRESS_Y = 6900;
  L.LENGTH = 8350;
  L.scrollY = 0;
  L.enemies = [];
  L.shots = [];
  L.enemyShots = [];
  L.pickups = [];
  L.islands = [];
  L.volcanoes = [];
  L.gates = [];
  L.rocks = [];
  L.fortress = null;
  L.phase = 'flight';
  L.t = 0;
  L.transitionT = 0;
  L.boss = null;
  L.complete = false;
  L.bossStarted = false;
  L.groups = {};
  var nextId = 1;
  var nextGroup = 1;

  function sy(wy) { return NS.PLAYFIELD_H - (wy - L.scrollY); }
  L.screenY = sy;

  /* Narrow volcanic banks become a fortress corridor near Tetran. */
  L.edgesAt = function (wy) {
    var section = Math.floor(wy / 520);
    var pulse = Math.sin(wy * 0.010) * 7 + Math.sin(wy * 0.0027) * 5;
    var left = 13 + pulse + ((section % 4 === 2) ? 13 : 0);
    var right = 13 - pulse + ((section % 5 === 3) ? 15 : 0);
    if (wy > 6900) { left = 30 + Math.sin(wy * 0.018) * 5; right = 30 - Math.sin(wy * 0.018) * 5; }
    return { left: NS.clamp(left, 7, 57), right: NS.clamp(right, 7, 57) };
  };

  function addEnemy(kind, x, wy, wave, slot, carrier, groupId, bonus, turn) {
    L.enemies.push({
      id: nextId++, kind: kind, baseX: x, x: x, wy: wy, y: sy(wy),
      wave: wave || 0, slot: slot || 0, t: 0, hp: kind === 'turret' ? 4 : 1,
      w: kind === 'turret' ? 11 : 9, h: kind === 'turret' ? 11 : 8,
      carrier: !!carrier, bonus: !!bonus, groupId: groupId || 0,
      turn: turn || 1, dead: false, active: false, fired: 0
    });
  }

  function formation(wy, pattern, wave, reward, startX, turn) {
    var groupId = nextGroup++;
    startX = startX == null ? ((wave & 1) ? 190 : 66) : startX;
    turn = turn || (startX < NS.W / 2 ? 1 : -1);
    L.groups[groupId] = { total: 5, killed: 0, paid: false,
      reward: reward || '', startX: startX, turn: turn };
    var i;
    for (i = 0; i < 5; i++) {
      /* World-Y spacing is the formation clock. Every member samples the
         same path equation at a different distance along it, so a squad
         cannot loosen or acquire five unrelated phases. */
      addEnemy(pattern, startX, wy + i * 16, wave, i, false,
               groupId, !!reward, turn);
    }
  }

  function addIsland(x, wy, rx, ry) {
    L.islands.push({ id: nextId++, x: x, wy: wy, y: sy(wy), rx: rx, ry: ry });
  }

  function addVolcano(side, wy) {
    var edge = L.edgesAt(wy);
    L.volcanoes.push({ id: nextId++, side: side, wy: wy,
      x: side === 'left' ? edge.left + 9 : NS.W - edge.right - 9,
      y: sy(wy), hp: 28, maxHp: 28, t: 0, dead: false, active: false });
  }

  function addGate(wy) {
    var gate = { id: nextId++, wy: wy, y: sy(wy), cells: [] };
    for (var x = 24; x < NS.W - 24; x += 20) {
      gate.cells.push({ id: nextId++, x: x, w: 19, hp: 8, dead: false });
    }
    L.gates.push(gate);
  }

  L.reset = function () {
    L.scrollY = 0; L.complete = false; L.bossStarted = false; L.boss = null;
    L.phase = 'flight'; L.fortress = null; L.t = 0; L.transitionT = 0;
    L.enemies.length = 0; L.shots.length = 0;
    L.enemyShots.length = 0; L.pickups.length = 0; L.rocks.length = 0;
    L.islands.length = 0; L.volcanoes.length = 0; L.gates.length = 0;
    L.groups = {}; nextId = 1; nextGroup = 1;

    /* NES cadence: three readable singles, then four mirrored double sets.
       Eleven squads total; ten pay regular capsules and the second-to-last
       pays the blue screen-clear capsule. */
    var w;
    for (w = 0; w < 3; w++) formation(380 + w * 310, 'zeta', w, 'capsule');
    var squad = 3;
    for (var pair = 0; pair < 4; pair++) {
      var pairY = 1370 + pair * 480;
      formation(pairY, 'zeta', squad, squad === 9 ? 'crash' : 'capsule', 64, 1); squad++;
      formation(pairY + 34, 'zeta', squad, squad === 9 ? 'crash' : 'capsule', 192, -1); squad++;
    }
    for (var wy = 3850, n = 0; wy < 6900; wy += 245, n++) {
      var e = L.edgesAt(wy);
      addEnemy('turret', e.left + 7, wy, n, 0, n % 4 === 0);
      addEnemy('turret', NS.W - e.right - 18, wy + 92, n, 1, false);
      if (n % 2 === 0) formation(wy + 135, 'zeta', 20 + n,
                                  n % 4 === 0 ? 'capsule' : '',
                                  n % 4 === 0 ? 66 : 190);
    }
    /* Split paths and solid islands force route choices instead of leaving
       the centre as one empty firing lane. */
    addIsland(128, 3700, 31, 54);
    addIsland(91, 4310, 25, 40); addIsland(177, 4310, 25, 40);
    addIsland(128, 5480, 38, 66);
    addIsland(76, 6220, 22, 43); addIsland(180, 6220, 22, 43);
    addVolcano('right', 4050); addVolcano('left', 4630);
    addVolcano('right', 5260); addVolcano('left', 5940);
    addGate(5050); addGate(6550); addGate(7700);
  };

  function ease(u) { return u < 0 ? 0 : (u > 1 ? 1 : u * u * (3 - 2 * u)); }

  function spawnBoss(G) {
    L.bossStarted = true;
    L.boss = {
      x: NS.W / 2, y: -70, targetY: 61, t: 0, hp: 150, maxHp: 150,
      shields: [55, 55, 55], shield: 3, hitCd: 0,
      /* spin is accumulated rather than read off t, because the entrance
         brakes it: the cruiser drops in whirling and settles to its fight
         speed, and the arms and their collision segments must follow the
         same angle the drawing does */
      spin: 0, deploy: 0, intro: true, introT: 0,
      radius: 23, dead: false, dying: 0, state: 'active'
    };
    G.boss = L.boss;
    G.bossName = NS.THEME.boss2Name;
    NS.Intro.start({ name: NS.THEME.boss2Name, sub: 'ORBITAL GUARD — ARMS DEPLOYING',
                     x: NS.W / 2, y: 61, dur: 210, zoom: 0.58 });
    NS.Audio.setTrack('boss');
  }

  /* Tetran drops out of the ash column with its arms folded against the
     hull, brakes hard over the arena, then throws them out to full span. */
  function enterBoss(b) {
    var k = NS.Intro.active ? NS.Intro.k() : NS.clamp(b.t / 170, 0, 1);
    b.y = NS.lerp(-70, b.targetY, ease(k));
    b.x = NS.W / 2 + Math.sin(k * 7.5) * 12 * (1 - k);
    b.spin += 0.22 - 0.195 * ease(k);
    b.deploy = NS.clamp((k - 0.46) / 0.42, 0, 1);
    if (k > 0.46 && b.t % 6 === 0) {
      var a = b.spin + (b.t % 4) * Math.PI / 2;
      NS.FX.spark(b.x + Math.cos(a) * 36 * b.deploy,
                  b.y + Math.sin(a) * 36 * b.deploy, 2, 'hit');
    }
    if (k >= 1) {
      /* the fight's own clock starts here, so the circling pattern and its
         slow descent begin from the arena centre rather than mid-arc */
      b.intro = false; b.deploy = 1; b.introT = b.t;
      for (var q = 0; q < 4; q++) {
        var qa = q * Math.PI / 2 + b.spin;
        NS.FX.explode(b.x + Math.cos(qa) * 36, b.y + Math.sin(qa) * 36, 1.4, 'hit');
      }
    }
  }

  function startFortress(G) {
    L.phase = 'fortress';
    var cores = [];
    for (var i = 0; i < 3; i++) cores.push({ id: nextId++, x: 68 + i * 60, y: -14, restY: 43, shield: 34, hp: 38, dead: false, t: 0 });
    L.fortress = { cores: cores, balls: [], t: 0, hp: 216, maxHp: 216,
                   state: 'active', dead: false, clearT: 0, intro: true, drop: 0 };
    G.boss = L.fortress; G.bossName = 'VALIS FORTRESS';
    NS.Intro.start({ name: 'VALIS FORTRESS', sub: 'THREE CORES — BREACH THE SHIELDS',
                     x: NS.W / 2, y: 46, dur: 200, zoom: 0.66 });
    NS.Audio.setTrack('boss');
  }

  /* The fortress plate grinds down out of the ceiling and its three cores
     drop into their sockets one after another. */
  function enterFortress(f) {
    var k = NS.Intro.active ? NS.Intro.k() : NS.clamp(f.t / 160, 0, 1);
    f.drop = ease(k);
    for (var i = 0; i < f.cores.length; i++) {
      var c = f.cores[i];
      var stagger = NS.clamp((k - 0.30 - i * 0.14) / 0.34, 0, 1);
      c.y = NS.lerp(-14, c.restY, ease(stagger));
      if (stagger >= 1 && !c.seated) {
        c.seated = true;
        NS.FX.explode(c.x, c.y, 1.1, 'hit');
        NS.Audio.sfx.slam();
      }
    }
    if (k >= 1) f.intro = false;
  }

  L.hitsPlayer = function (p) {
    var wy = L.scrollY + NS.PLAYFIELD_H - p.y;
    var edge = L.edgesAt(wy);
    if (!L.bossStarted && (p.x - p.w / 2 < edge.left || p.x + p.w / 2 > NS.W - edge.right)) return true;
    for (var i = 0; i < L.islands.length; i++) {
      var a = L.islands[i], ay = sy(a.wy), dx = (p.x - a.x) / (a.rx + p.w / 2), dy = (p.y - ay) / (a.ry + p.h / 2);
      if (dx * dx + dy * dy < 1) return true;
    }
    for (i = 0; i < L.gates.length; i++) {
      var gate = L.gates[i], gy = sy(gate.wy);
      if (Math.abs(p.y - gy) > 7 + p.h / 2) continue;
      for (var j = 0; j < gate.cells.length; j++) {
        var cell = gate.cells[j];
        if (!cell.dead && p.x + p.w / 2 > cell.x && p.x - p.w / 2 < cell.x + cell.w) return true;
      }
    }
    for (i = 0; i < L.volcanoes.length; i++) {
      var v = L.volcanoes[i]; if (v.dead) continue;
      var vy = sy(v.wy);
      if (Math.abs(p.x - v.x) < 12 + p.w / 2 && Math.abs(p.y - vy) < 10 + p.h / 2) return true;
    }
    return false;
  };

  function updateStructures(G) {
    var p = G.player, i;
    for (i = 0; i < L.volcanoes.length; i++) {
      var v = L.volcanoes[i]; if (v.dead) continue;
      v.y = sy(v.wy);
      if (v.y < -90 || v.y > NS.PLAYFIELD_H + 60) continue;
      v.active = true; v.t++;
      if (v.y > -5 && v.y < 130 && v.t % 72 === 0) {
        var dir = v.side === 'left' ? 1 : -1;
        for (var r = 0; r < 3; r++) L.rocks.push({ id: nextId++, x: v.x, y: v.y,
          vx: dir * (0.45 + r * 0.35), vy: -1.8 - r * 0.35, hp: 2, t: 0, dead: false });
      }
    }
    for (i = 0; i < L.gates.length; i++) L.gates[i].y = sy(L.gates[i].wy);
    /* NES-style gray-rock storm between the split-path volcanoes and the
       blast-through fortress approach. Its spawn order is deterministic. */
    if (L.scrollY > 5550 && L.scrollY < 5940 && L.t % 24 === 0) {
      var laneX = 18 + ((L.t * 47) % (NS.W - 36));
      L.rocks.push({ id: nextId++, x: laneX, y: -8, vx: Math.sin(L.t * 0.13) * 0.45,
        vy: 1.35, hp: 2, t: 0, dead: false });
    }
    for (i = 0; i < L.rocks.length; i++) {
      var rock = L.rocks[i]; if (rock.dead) continue;
      rock.t++; rock.x += rock.vx; rock.y += rock.vy; rock.vy += 0.055;
      if (rock.x < 4 || rock.x > NS.W - 4) rock.vx *= -1;
      if (rock.y > NS.PLAYFIELD_H + 10 || rock.t > 360) rock.dead = true;
    }
  }

  function updateFortress(G) {
    var f = L.fortress; if (!f || f.dead) return;
    f.t++;
    if (f.intro) { enterFortress(f); return; }
    var alive = 0, totalHp = 0;
    for (var i = 0; i < f.cores.length; i++) {
      var c = f.cores[i]; if (c.dead) continue;
      alive++; totalHp += c.hp + c.shield;
      if (f.t % 82 === i * 18 && f.balls.length < 4) {
        var a = Math.PI * (0.28 + i * 0.22) + Math.sin(f.t * 0.03 + i) * 0.24;
        f.balls.push({ x: c.x, y: c.y + 7, vx: Math.cos(a) * 1.65, vy: Math.sin(a) * 1.65,
          t: 0, dead: false, ball: true });
      }
    }
    f.hp = totalHp;
    for (i = 0; i < f.balls.length; i++) {
      var b = f.balls[i]; if (b.dead) continue;
      b.t++; b.x += b.vx; b.y += b.vy;
      if (b.x < 8) { b.x = 8; b.vx = Math.abs(b.vx); }
      if (b.x > NS.W - 8) { b.x = NS.W - 8; b.vx = -Math.abs(b.vx); }
      if (b.y < 8) { b.y = 8; b.vy = Math.abs(b.vy); }
      if (b.y > NS.PLAYFIELD_H - 7) { b.y = NS.PLAYFIELD_H - 7; b.vy = -Math.abs(b.vy); }
      if (b.t > 520) b.dead = true;
    }
    NS.prune(f.balls);
    if (!alive) {
      f.dead = true; f.state = 'dying'; f.clearT = 90; G.addScore(12000, NS.W / 2, 45);
      for (i = 0; i < 7; i++) NS.FX.explode(50 + i * 27, 42 + (i & 1) * 9, 1.5, 'fire');
    }
  }

  function aimed(x, y, p, speed) {
    var a = NS.angleTo(x, y, p.x, p.y);
    L.enemyShots.push({ x: x, y: y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, t: 0, dead: false });
  }

  function killEnemy(e, G) {
    if (e.dead) return;
    e.dead = true; G.addScore(e.kind === 'turret' ? 400 : 100, e.x, e.y);
    NS.FX.explode(e.x, e.y, e.kind === 'turret' ? 1.2 : 0.7, 'fire');
    if (e.carrier) L.pickups.push({ x: e.x, y: e.y, t: 0, dead: false });
    if (e.groupId) {
      var group = L.groups[e.groupId];
      if (group) {
        group.killed++;
        if (!group.paid && group.reward && group.killed >= group.total) {
          group.paid = true;
          L.pickups.push({ x: e.x, y: e.y, t: 0, dead: false,
                           kind: group.reward });
          NS.FX.popText(e.x - 8, e.y - 10,
                        group.reward === 'crash' ? 'CRASH' : 'POWER',
                        group.reward === 'crash' ? '#8fd0ff' : '#ff9c9c');
        }
      }
    }
  }

  function updateEnemy(e, p, G) {
    e.y = sy(e.wy);
    if (e.y < -100 || e.y > NS.PLAYFIELD_H + 100) return;
    e.active = true; e.t++;
    if (e.groupId) {
      var grp = L.groups[e.groupId];
      var distance = e.y + 100;
      if (e.kind === 'zeta') {
        /* One exact straight–diagonal–straight path sampled by all five.
           The first 70px are straight, the next 68px cross the screen,
           and the exit is straight again. */
        var u = NS.clamp((distance - 70) / 68, 0, 1);
        var eased = u * u * (3 - 2 * u);
        e.x = grp.startX + grp.turn * 124 * eased;
      } else {
        e.x = grp.startX + Math.sin(distance * 0.035) * 20;
      }
    }
    if (e.kind === 'turret' && e.y > 5 && e.y < 170 && e.t % 105 === 0) aimed(e.x + 5, e.y + 5, p, 1.45);
    else if (e.kind !== 'turret' && e.y > 10 && e.y < 135 && e.t === 55 + e.slot * 7) aimed(e.x, e.y, p, 1.25);
    if (e.y > NS.PLAYFIELD_H + 90) e.dead = true;
  }

  function updateBoss(p, G) {
    var b = L.boss;
    if (!b || b.dead) return;
    b.t++;
    if (b.hitCd > 0) b.hitCd--;
    if (b.intro) { enterBoss(b); return; }
    b.spin += 0.025;
    /* Tetran circles clockwise and gradually presses down the arena. */
    var fight = b.t - b.introT;
    var descent = Math.min(62, Math.max(0, fight - 220) * 0.010);
    b.x = NS.W / 2 + Math.sin(fight * 0.018) * 54;
    b.y = b.targetY + Math.cos(fight * 0.018) * 18 + descent;
    if (fight % 70 === 0) {
      aimed(b.x, b.y, p, 1.65);
      for (var q = 0; q < 4; q++) {
        var a = q * Math.PI / 2 + b.spin;
        L.enemyShots.push({ x: b.x, y: b.y, vx: Math.cos(a) * 1.25, vy: Math.sin(a) * 1.25, t: 0, dead: false });
      }
    }
  }

  L.firePlayer = function (p) {
    var muzzles = [{ x: p.x, y: p.y - 9 }];
    for (var i = 0; i < p.options.length; i++) muzzles.push({ x: p.options[i].x, y: p.options[i].y - 5 });
    var type = p.weapon;
    for (i = 0; i < muzzles.length; i++) {
      L.shots.push({ x: muzzles[i].x - 1, y: muzzles[i].y, vx: 0, vy: type === 'laser' ? -8 : -5.5,
        w: type === 'laser' ? 3 : 3, h: type === 'laser' ? 20 : 7, dmg: type === 'laser' ? 2 : 1,
        type: type, pierce: type !== 'normal', dead: false, hit: {} });
    }
    if (p.missileLv) {
      /* The same twin launch stage 1 uses, rotated with the camera. Forward
         is up here, so the pair splays out toward the left and right banks
         instead of the ceiling and floor, then crawls along whichever wall it
         reaches. It was a symmetric spread of straight shots before, which is
         a different weapon wearing the missile's name. */
      var salvo = missileSalvo(p);
      if (countMissiles() + salvo.length <= salvo.length * 2) {
        for (i = 0; i < salvo.length; i++) launchMissile(salvo[i].x, salvo[i].y, salvo[i].wall, p.missileLv);
        NS.Audio.sfx.missile();
      }
    }
    NS.Audio.sfx[type === 'laser' ? 'laser' : 'shot']();
    return type === 'laser' ? 9 : (type === 'ripple' ? 11 : 6);
  };

  /* One launch point per muzzle, each firing a left/right pair; missile
     levels above one add further pairs stepped back along the hull. */
  function missileSalvo(p) {
    var out = [], i, wall;
    var muzzles = [{ x: p.x, y: p.y - 2 }];
    for (i = 0; i < p.options.length; i++) muzzles.push({ x: p.options[i].x, y: p.options[i].y });
    for (i = 0; i < muzzles.length; i++) {
      for (wall = -1; wall <= 1; wall += 2) out.push({ x: muzzles[i].x, y: muzzles[i].y, wall: wall });
    }
    for (var extra = 1; extra < p.missileLv; extra++) {
      for (wall = -1; wall <= 1; wall += 2) out.push({ x: p.x, y: p.y + extra * 3, wall: wall });
    }
    return out;
  }

  function countMissiles() {
    var n = 0;
    for (var i = 0; i < L.shots.length; i++) {
      if (!L.shots[i].dead && L.shots[i].type === 'missile') n++;
    }
    return n;
  }

  function launchMissile(x, y, wall, level) {
    level = NS.clamp(level, 1, 3);
    L.shots.push({
      x: x - 2, y: y - 3, w: 5, h: 5, dmg: 2, type: 'missile',
      pierce: false, dead: false, hit: {},
      /* the diagonal: equal outward and forward speed, with the outward
         component still building, so the track bows toward the wall */
      vx: wall * (1.55 + level * 0.16), vy: -(1.55 + level * 0.16),
      crawlSpeed: 2.0 + level * 0.42,
      wall: wall, crawling: false, anim: 0
    });
  }

  /* Screen-space x of the wall face on the given side, at a screen y. */
  function wallAt(wall, y) {
    var edge = L.edgesAt(L.scrollY + NS.PLAYFIELD_H - y);
    return wall < 0 ? edge.left : NS.W - edge.right;
  }

  function updateMissile(m) {
    m.anim++;
    if (!m.crawling) {
      m.x += m.vx;
      m.y += m.vy;
      m.vx += m.wall * 0.11;
      var face = wallAt(m.wall, m.y);
      if (m.wall < 0 ? m.x <= face : m.x + m.w >= face) {
        m.crawling = true;
        m.x = m.wall < 0 ? face : face - m.w;
        NS.FX.spark(m.x + m.w / 2, m.y, 3, 'fire');
      }
    } else {
      /* hug the bank as it slides past, exactly as the stage 1 crawler
         hugs the corridor floor */
      m.y -= m.crawlSpeed;
      var surf = wallAt(m.wall, m.y - 3);
      m.x = NS.lerp(m.x, m.wall < 0 ? surf : surf - m.w, 0.5);
    }
    if (m.y < -14 || m.x < -14 || m.x > NS.W + 14) m.dead = true;
  }

  function collide(G) {
    var p = G.player, i, j;
    for (i = 0; i < L.shots.length; i++) {
      var s = L.shots[i]; if (s.dead) continue;
      var sr = { x: s.x, y: s.y, w: s.w, h: s.h };
      for (j = 0; j < L.enemies.length; j++) {
        var e = L.enemies[j]; if (e.dead || !e.active || s.hit[e.id]) continue;
        if (NS.rectHit(sr, { x: e.x - e.w / 2, y: e.y - e.h / 2, w: e.w, h: e.h })) {
          s.hit[e.id] = 1; e.hp -= s.dmg; if (e.hp <= 0) killEnemy(e, G);
          if (!s.pierce) { s.dead = true; break; }
        }
      }
      /* Volcanic peaks, falling rocks and blast-through dirt barriers are
         all real targets. Piercing weapons damage each object once. */
      for (j = 0; !s.dead && j < L.volcanoes.length; j++) {
        var v = L.volcanoes[j]; if (v.dead || !v.active || s.hit[v.id]) continue;
        if (NS.rectHit(sr, { x: v.x - 11, y: v.y - 10, w: 22, h: 20 })) {
          s.hit[v.id] = 1; v.hp -= s.dmg;
          if (v.hp <= 0) { v.dead = true; G.addScore(1000, v.x, v.y); NS.FX.explode(v.x, v.y, 1.8, 'fire'); }
          if (!s.pierce) s.dead = true;
        }
      }
      for (j = 0; !s.dead && j < L.rocks.length; j++) {
        var rock = L.rocks[j]; if (rock.dead || s.hit[rock.id]) continue;
        if (NS.rectHit(sr, { x: rock.x - 4, y: rock.y - 4, w: 8, h: 8 })) {
          s.hit[rock.id] = 1; rock.hp -= s.dmg; if (rock.hp <= 0) { rock.dead = true; G.addScore(30); NS.FX.spark(rock.x, rock.y, 4, 'hit'); }
          if (!s.pierce) s.dead = true;
        }
      }
      for (j = 0; !s.dead && j < L.gates.length; j++) {
        var gate = L.gates[j]; if (Math.abs(gate.y - (s.y + s.h / 2)) > 9) continue;
        for (var gc = 0; gc < gate.cells.length; gc++) {
          var cell = gate.cells[gc]; if (cell.dead || s.hit[cell.id]) continue;
          if (NS.rectHit(sr, { x: cell.x, y: gate.y - 7, w: cell.w, h: 14 })) {
            s.hit[cell.id] = 1; cell.hp -= s.dmg;
            if (cell.hp <= 0) { cell.dead = true; G.addScore(100); NS.FX.explode(cell.x + cell.w / 2, gate.y, 0.7, 'fire'); }
            if (!s.pierce) s.dead = true;
            break;
          }
        }
      }
      var fort = L.fortress;
      if (!s.dead && fort && !fort.dead && !fort.intro) {
        for (j = 0; j < fort.cores.length; j++) {
          var fc = fort.cores[j]; if (fc.dead || s.hit[fc.id]) continue;
          var fdx = s.x + s.w / 2 - fc.x, fdy = s.y + s.h / 2 - fc.y;
          if (fdx * fdx + fdy * fdy < 13 * 13) {
            s.hit[fc.id] = 1;
            if (fc.shield > 0) fc.shield -= s.dmg; else fc.hp -= s.dmg;
            if (fc.hp <= 0) { fc.dead = true; G.addScore(2500, fc.x, fc.y); NS.FX.explode(fc.x, fc.y, 1.8, 'fire'); }
            if (!s.pierce) s.dead = true;
            break;
          }
        }
      }
      var b = L.boss;
      if (!s.dead && b && !b.dead && !b.intro && !s.hit.boss && b.hitCd <= 0) {
        var dx = (s.x + s.w / 2) - b.x, dy = (s.y + s.h / 2) - b.y;
        if (dx * dx + dy * dy < b.radius * b.radius) {
          s.hit.boss = 1; b.hitCd = 2;
          if (b.shield > 0) {
            b.shields[b.shield - 1] -= s.dmg;
            if (b.shields[b.shield - 1] <= 0) b.shield--;
          } else b.hp -= s.dmg;
          NS.FX.spark(s.x, s.y, 3, b.shield ? 'hit' : 'fire');
          if (!s.pierce) s.dead = true;
          if (b.hp <= 0) {
            b.dead = true; b.dying = 150; G.addScore(30000, b.x, b.y);
            for (var z = 0; z < 8; z++) NS.FX.explode(b.x + Math.sin(z) * 20, b.y + Math.cos(z) * 20, 1.8, 'fire');
            NS.Audio.stopMusic();
          }
        }
      }
    }
    if (!p.alive) return;
    var pr = { x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h };
    for (i = 0; i < L.enemyShots.length; i++) {
      var es = L.enemyShots[i]; if (!es.dead && NS.rectHit(pr, { x: es.x - 2, y: es.y - 2, w: 4, h: 4 })) {
        es.dead = true; if (!p.hit()) return;
      }
    }
    for (i = 0; i < L.rocks.length; i++) {
      var rr = L.rocks[i]; if (!rr.dead && NS.rectHit(pr, { x: rr.x - 4, y: rr.y - 4, w: 8, h: 8 })) { rr.dead = true; if (!p.hit()) return; }
    }
    if (L.fortress && !L.fortress.dead) {
      for (i = 0; i < L.fortress.balls.length; i++) {
        var fb = L.fortress.balls[i];
        if (!fb.dead && NS.rectHit(pr, { x: fb.x - 5, y: fb.y - 5, w: 10, h: 10 })) { if (!p.hit()) return; }
      }
    }
    for (i = 0; i < L.enemies.length; i++) {
      var en = L.enemies[i]; if (en.dead || !en.active) continue;
      if (NS.rectHit(pr, { x: en.x - en.w / 2, y: en.y - en.h / 2, w: en.w, h: en.h })) { killEnemy(en, G); if (!p.hit()) return; }
    }
    if (L.boss && !L.boss.dead && !L.boss.intro) {
      var bx = p.x - L.boss.x, by = p.y - L.boss.y;
      if (bx * bx + by * by < (L.boss.radius + 5) * (L.boss.radius + 5) && !p.hit()) return;
      for (var arm = 0; arm < 4; arm++) {
        var aa = arm * Math.PI / 2 + L.boss.spin;
        for (var seg = 14; seg <= 38; seg += 11) {
          var ax = L.boss.x + Math.cos(aa) * seg * L.boss.deploy,
              ay = L.boss.y + Math.sin(aa) * seg * L.boss.deploy;
          var adx = p.x - ax, ady = p.y - ay;
          if (adx * adx + ady * ady < 9 * 9 && !p.hit()) return;
        }
      }
    }
    for (i = 0; i < L.pickups.length; i++) {
      var c = L.pickups[i]; if (!c.dead && NS.rectHit(pr, { x: c.x - 3, y: c.y - 3, w: 6, h: 6 })) {
        c.dead = true;
        if (c.kind === 'crash') {
          for (var wipe = 0; wipe < L.enemies.length; wipe++) {
            var target = L.enemies[wipe];
            if (!target.dead && target.active && target.y > -12 && target.y < NS.PLAYFIELD_H + 12) killEnemy(target, G);
          }
          L.enemyShots.length = 0; L.rocks.length = 0;
          NS.FX.popText(p.x - 9, p.y - 14, 'CRASH!', '#8fd0ff');
          NS.Audio.sfx.power();
        } else p.giveCapsule();
        G.addScore(100);
      }
    }
    for (i = 0; i < G.looseOptions.length; i++) {
      var o = G.looseOptions[i];
      if (!o.dead && NS.rectHit(pr, { x: o.x - 3, y: o.y - 3, w: 6, h: 6 }) && p.recoverOption()) o.dead = true;
    }
  }

  L.update = function (G) {
    L.t++;
    if ((G.state === 'play' || G.state === 'dying') && !L.bossStarted) {
      if (L.phase === 'flight') {
        L.scrollY = Math.min(L.FORTRESS_Y, L.scrollY + NS.SCROLL_SPEED);
        if (L.scrollY >= L.FORTRESS_Y) startFortress(G);
      } else if (L.phase === 'fortress') {
        updateFortress(G);
        if (L.fortress && L.fortress.dead) {
          L.fortress.clearT--;
          if (L.fortress.clearT <= 0) {
            L.phase = 'escape'; G.boss = null; G.bossName = '';
            L.transitionT = 180;
            NS.Audio.setTrack('stage'); NS.Audio.startMusic();
          }
        }
      } else if (L.phase === 'escape') {
        if (L.transitionT > 0) L.transitionT--;
        L.scrollY = Math.min(L.LENGTH, L.scrollY + NS.SCROLL_SPEED * 0.82);
        if (L.scrollY >= L.LENGTH) spawnBoss(G);
      }
    }
    for (var i = 0; i < L.enemies.length; i++) if (!L.enemies[i].dead) updateEnemy(L.enemies[i], G.player, G);
    updateStructures(G);
    for (i = 0; i < L.shots.length; i++) {
      var s = L.shots[i];
      if (s.dead) continue;
      if (s.type === 'missile') { updateMissile(s); continue; }
      s.x += s.vx; s.y += s.vy;
      if (s.y < -30 || s.x < -20 || s.x > NS.W + 20) s.dead = true;
    }
    for (i = 0; i < L.enemyShots.length; i++) {
      var es = L.enemyShots[i]; es.t++; es.x += es.vx; es.y += es.vy;
      if (es.x < -10 || es.x > NS.W + 10 || es.y < -10 || es.y > NS.PLAYFIELD_H + 10 || es.t > 480) es.dead = true;
    }
    for (i = 0; i < L.pickups.length; i++) { var c = L.pickups[i]; c.t++; c.y += 0.45; if (c.y > NS.PLAYFIELD_H + 10) c.dead = true; }
    for (i = 0; i < G.looseOptions.length; i++) {
      var o = G.looseOptions[i]; if (o.dead) continue;
      o.t++; o.y += 0.16; o.x += Math.sin(o.t * 0.045 + o.phase) * 0.06;
      if (o.y > NS.PLAYFIELD_H + 8 || o.t > 720) o.dead = true;
    }
    updateBoss(G.player, G); collide(G);
    if (L.boss && L.boss.dead) { L.boss.dying--; if (L.boss.dying <= 0) L.complete = true; }
    NS.prune(L.shots); NS.prune(L.enemyShots); NS.prune(L.pickups); NS.prune(L.rocks);
    NS.prune(G.looseOptions);
  };

  function drawTerrain(g) {
    g.fillStyle = '#13090c'; g.fillRect(0, 0, NS.W, NS.PLAYFIELD_H);
    for (var y = -4; y < NS.PLAYFIELD_H + 4; y += 4) {
      var wy = L.scrollY + NS.PLAYFIELD_H - y, e = L.edgesAt(wy);
      var fortress = wy > L.FORTRESS_Y;
      g.fillStyle = fortress
        ? ((((wy / 24) | 0) & 1) ? '#293e58' : '#354f6b')
        : ((((wy / 32) | 0) & 1) ? '#66242a' : '#7d2e2a');
      g.fillRect(0, y, e.left, 5); g.fillRect(NS.W - e.right, y, e.right, 5);
      g.fillStyle = fortress ? '#7398b8' : '#e05028';
      g.fillRect(e.left - 2, y, 2, 3); g.fillRect(NS.W - e.right, y, 2, 3);
      if (((wy / 90) | 0) % 5 === 0) { g.fillStyle = '#ffb039'; g.fillRect(3, y, 2, 2); g.fillRect(NS.W - 5, y + 1, 2, 2); }
    }
  }

  function drawBoss(g, b) {
    if (b.dead && (b.dying >> 2) % 2) return;
    var dep = b.deploy == null ? 1 : b.deploy;
    g.save(); g.translate(b.x, b.y); g.rotate(b.spin);
    for (var q = 0; q < 4; q++) {
      g.rotate(Math.PI / 2); g.fillStyle = '#7a9ab8';
      g.fillRect(7 * dep, -2, Math.max(1, 28 * dep), 4);
      g.fillStyle = '#d8e7ef'; g.beginPath(); g.arc(36 * dep, 0, 7, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    g.fillStyle = '#273d61'; g.beginPath(); g.arc(b.x, b.y, 22, 0, Math.PI * 2); g.fill();
    g.strokeStyle = b.shield ? '#a9f4ff' : '#ef6272'; g.lineWidth = b.shield ? 4 : 2; g.stroke();
    for (var ring = 0; ring < b.shield; ring++) {
      g.strokeStyle = 'rgba(130,235,255,' + (0.35 + ring * 0.18) + ')'; g.lineWidth = 1;
      g.beginPath(); g.arc(b.x, b.y, 26 + ring * 4, 0, Math.PI * 2); g.stroke();
    }
    g.fillStyle = '#ff5964'; g.beginPath(); g.arc(b.x, b.y, 8, 0, Math.PI * 2); g.fill();
  }

  function drawStructures(g) {
    var i, j;
    for (i = 0; i < L.islands.length; i++) {
      var a = L.islands[i], ay = sy(a.wy); if (ay < -a.ry - 10 || ay > NS.PLAYFIELD_H + a.ry + 10) continue;
      g.fillStyle = '#542323'; g.beginPath(); g.ellipse(a.x, ay, a.rx, a.ry, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#d7502e'; g.lineWidth = 3; g.stroke();
      g.fillStyle = '#7e3430'; g.beginPath(); g.ellipse(a.x - 4, ay - 5, a.rx * 0.62, a.ry * 0.72, 0, 0, Math.PI * 2); g.fill();
    }
    for (i = 0; i < L.volcanoes.length; i++) {
      var v = L.volcanoes[i]; if (v.dead || v.y < -30 || v.y > NS.PLAYFIELD_H + 30) continue;
      g.fillStyle = '#6f3027'; g.beginPath(); g.moveTo(v.x - 13, v.y + 10); g.lineTo(v.x - 5, v.y - 9); g.lineTo(v.x + 5, v.y - 9); g.lineTo(v.x + 13, v.y + 10); g.closePath(); g.fill();
      g.fillStyle = '#ff9a35'; g.fillRect(v.x - 5, v.y - 10, 10, 4);
    }
    for (i = 0; i < L.gates.length; i++) {
      var gate = L.gates[i]; if (gate.y < -20 || gate.y > NS.PLAYFIELD_H + 20) continue;
      for (j = 0; j < gate.cells.length; j++) {
        var cell = gate.cells[j]; if (cell.dead) continue;
        g.fillStyle = '#7b3b43'; g.fillRect(cell.x, gate.y - 7, cell.w, 14);
        g.fillStyle = '#d66a58'; g.fillRect(cell.x + 2, gate.y - 5, cell.w - 4, 3);
      }
    }
    for (i = 0; i < L.rocks.length; i++) {
      var r = L.rocks[i]; if (r.dead) continue;
      g.fillStyle = '#b8b2aa'; g.beginPath(); g.arc(r.x, r.y, 4, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#eee3d0'; g.fillRect(r.x - 1, r.y - 2, 2, 2);
    }
    var f = L.fortress;
    if (f && L.phase === 'fortress') {
      /* the plate grinds down into frame during the entrance */
      var drop = f.drop == null ? 1 : f.drop;
      var py = 22 * drop;                      // bottom edge of the plate
      g.fillStyle = '#263c58'; g.fillRect(0, py - 22, NS.W, 22);
      g.fillStyle = '#58789b'; for (i = 0; i < 8; i++) g.fillRect(i * 34, py - 5, 25, 6);
      for (i = 0; i < f.cores.length; i++) {
        var c = f.cores[i]; if (c.dead) continue;
        g.fillStyle = '#184b78'; g.beginPath(); g.arc(c.x, c.y, 12, 0, Math.PI * 2); g.fill();
        g.strokeStyle = c.shield > 0 ? '#8ee8ff' : '#ffb154'; g.lineWidth = c.shield > 0 ? 4 : 2; g.stroke();
        g.fillStyle = '#ff7b4c'; g.beginPath(); g.arc(c.x, c.y, 5, 0, Math.PI * 2); g.fill();
      }
      for (i = 0; i < f.balls.length; i++) { var ball = f.balls[i]; g.fillStyle = '#8fcaff'; g.beginPath(); g.arc(ball.x, ball.y, 5, 0, Math.PI * 2); g.fill(); }
    }
  }

  L.draw = function (g) {
    drawTerrain(g);
    drawStructures(g);
    for (var i = 0; i < L.enemies.length; i++) {
      var e = L.enemies[i]; if (e.dead || !e.active || e.y < -20 || e.y > NS.PLAYFIELD_H + 20) continue;
      g.save(); g.translate(e.x, e.y);
      if (e.kind === 'turret') { g.fillStyle = '#b76038'; g.fillRect(-6, -6, 12, 12); g.fillStyle = '#ffe070'; g.fillRect(-2, -4, 4, 7); }
      else { g.fillStyle = (e.carrier || e.bonus) ? '#e44848' : '#93c9d8'; g.beginPath(); g.moveTo(0, 6); g.lineTo(-6, -4); g.lineTo(0, -1); g.lineTo(6, -4); g.closePath(); g.fill(); }
      g.restore();
    }
    for (i = 0; i < L.pickups.length; i++) { var c = L.pickups[i]; var pickupSprite = c.kind === 'crash' ? NS.S.crashCapsule : NS.S.capsule; g.drawImage(pickupSprite[(c.t >> 3) & 1], c.x - 3, c.y - 3); }
    for (i = 0; i < L.shots.length; i++) {
      var s = L.shots[i];
      if (s.type === 'missile') {
        /* the stage 1 crawler sprite, turned to face the wall it is running
           along, so the weapon looks the same in both cameras */
        g.save();
        g.translate((s.x + s.w / 2) | 0, (s.y + s.h / 2) | 0);
        g.rotate(s.crawling ? -Math.PI / 2 : (s.wall < 0 ? -Math.PI * 0.75 : -Math.PI * 0.25));
        g.drawImage(NS.S.missile, -3, -1);
        g.restore();
        if ((s.anim & 3) < 2) {
          g.fillStyle = 'rgba(255,180,80,0.7)';
          g.fillRect(s.x | 0, (s.y + s.h) | 0, 2, 2);
        }
        continue;
      }
      g.fillStyle = s.type === 'laser' ? '#8feaff' : '#fff29a';
      g.fillRect(s.x, s.y, s.w, s.h);
    }
    for (i = 0; i < L.enemyShots.length; i++) { var es = L.enemyShots[i]; g.drawImage(NS.S.eshot, es.x - 2, es.y - 2); }
    for (i = 0; i < NS.Game.looseOptions.length; i++) { var o = NS.Game.looseOptions[i]; g.drawImage(NS.S.looseOption[(o.t >> 3) & 1], o.x - 2, o.y - 2); }
    if (L.boss) drawBoss(g, L.boss);
    if (L.transitionT > 0 && (L.transitionT >> 3) % 2 === 0) {
      g.font = '6px monospace'; g.textAlign = 'center'; g.fillStyle = '#9fe8ff';
      g.fillText('FORTRESS BREACHED', NS.W / 2, 86);
      g.fillText('CORE PASSAGE OPEN', NS.W / 2, 98); g.textAlign = 'left';
    }
  };

  /* Stable encounter warps used by the concealed QA console. Each jump is
     made immediately after Game.startStage2(), so it starts from clean state. */
  L.debugJump = function (where, G) {
    G.state = 'play'; G.boss = null; G.bossName = ''; L.boss = null; L.bossStarted = false;
    switch (where) {
      case 'volcano': L.scrollY = 3900; L.phase = 'flight'; break;
      case 'rocks': L.scrollY = 5580; L.phase = 'flight'; break;
      case 'fortress':
        L.scrollY = L.FORTRESS_Y; startFortress(G); break;
      case 'passage':
        L.scrollY = 7160; L.phase = 'escape'; L.transitionT = 180; break;
      case 'tetran':
        L.scrollY = L.LENGTH; L.phase = 'escape'; spawnBoss(G); break;
      default: L.scrollY = 0; L.phase = 'flight'; break;
    }
    for (var i = 0; i < L.enemies.length; i++) {
      var e = L.enemies[i]; e.y = sy(e.wy);
      if (e.y > NS.PLAYFIELD_H + 100) e.dead = true;
    }
    for (i = 0; i < L.gates.length; i++) L.gates[i].y = sy(L.gates[i].wy);
  };
})(NS);
