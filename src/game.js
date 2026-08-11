/* game.js — director: state machine, scrolling, collision resolution, HUD.
   This is the file that ties the Life Force systems together. */
(function (NS) {
  'use strict';

  var G = {};
  NS.Game = G;

  /* `buffer` is a native-resolution drawing surface using a 256x224 logical
     coordinate transform. Gameplay remains low-resolution, while fonts are
     rasterized directly at 1080p instead of being enlarged from 6px text.
     `screen` is the native 1920x1080 output the buffer is presented into,
     itself CSS-scaled to fit the window. Keeping them separate is what
     lets the voxel renderer swap in as an alternative presenter without
     any drawing code knowing about it. */
  var screen, sg, buffer, g;
  var acc = 0, last = 0;

  G.state = 'title';        // title | play | dying | departing | clear | gameover | paused
  G.stage = 1;
  G.prevState = 'play';
  G.scrollX = 0;
  G.frame = 0;
  G.player = null;
  G.boss = null;
  G.bossName = '';
  G.capsules = [];
  G.looseOptions = [];
  G.hiScore = 0;
  G.stageMsg = 0;
  G.bossWarn = 0;
  G.clearT = 0;
  G.modeMsg = 0;
  G.voxelMsg = '';
  G.voxelMsgT = 0;
  G.departV = 0;
  G.nextStage = 2;

  /* ---- boot ----------------------------------------------------------- */
  G.init = function () {
    screen = document.getElementById('screen');
    screen.width = NS.SCREEN_W;
    screen.height = NS.SCREEN_H;
    sg = screen.getContext('2d');
    sg.imageSmoothingEnabled = false;

    buffer = document.createElement('canvas');
    buffer.width = NS.SCREEN_W;
    buffer.height = NS.SCREEN_H;
    g = buffer.getContext('2d');
    g.imageSmoothingEnabled = false;
    G.buffer = buffer;

    NS.Terrain.build();
    NS.FX.initBackground();

    try { G.hiScore = parseInt(localStorage.getItem('ns_hiscore') || '0', 10) || 0; } catch (e) { G.hiScore = 0; }
    NS.Gunner.load();
    NS.Touch.init();

    resize();
    window.addEventListener('resize', resize);

    G.player = new NS.Player();
    G.resetStage(true);
    G.state = 'title';

    /* The geometry-backed voxel presentation is the primary renderer now.
       It loads asynchronously so the Canvas2D version remains an immediate
       fallback when the page was opened without a local web server or WebGL
       is unavailable.  V still switches between the two at any time. */
    if (NS.Voxel) {
      NS.Voxel.enable(function (on, err) {
        if (on) {
          resize();
        } else if (err) {
          G.voxelMsg = err + ' - USING 2D';
          G.voxelMsgT = 180;
        }
      });
    }

    last = performance.now();
    requestAnimationFrame(loop);
  };

  /* Dynamic scaling: the 1920x1080 render target keeps its aspect and is
     fitted to whatever space the window gives us. On touch devices the
     controls overlay the picture, so it takes the whole viewport. */
  function resize() {
    var touch = NS.Touch.visible();
    var immersive = touch || (NS.Voxel && NS.Voxel.active()) || !!document.fullscreenElement;
    var maxW = window.innerWidth - (immersive ? 0 : 24);
    var maxH = window.innerHeight - (immersive ? 0 : 70);
    var s = Math.min(maxW / NS.SCREEN_W, maxH / NS.SCREEN_H);
    if (!(s > 0)) s = 0.1;
    screen.style.width = Math.round(NS.SCREEN_W * s) + 'px';
    screen.style.height = Math.round(NS.SCREEN_H * s) + 'px';
    if (NS.Voxel) {
      if (NS.Voxel.active()) NS.Voxel.resize();
      else NS.Voxel.syncBox();
    }
  }
  G.resize = resize;

  /* Present edge-to-edge at the native 1920x1080 target. Gameplay remains
     in its original 256x224 coordinate system; presentation expands that
     view to 16:9 so the 2D fallback and the HUD cover the same frame as the
     Three.js camera instead of leaving 8:7 pillars. */
  function present(transparent) {
    sg.setTransform(1, 0, 0, 1, 0, 0);
    if (transparent) {
      sg.clearRect(0, 0, NS.SCREEN_W, NS.SCREEN_H);
    } else {
      sg.fillStyle = '#05060a';
      sg.fillRect(0, 0, NS.SCREEN_W, NS.SCREEN_H);
    }
    sg.drawImage(buffer, 0, 0, NS.SCREEN_W, NS.SCREEN_H);
  }

  G.requestFullscreen = function () {
    if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
    var request = document.documentElement.requestFullscreen();
    if (request && request.catch) request.catch(function () {});
  };

  G.resetStage = function (full) {
    G.stage = 1;
    G.scrollX = 0;
    G.frame = 0;
    G.boss = null;
    G.bossName = '';
    G.capsules.length = 0;
    G.looseOptions.length = 0;
    G.bossWarn = 0;
    G.clearT = 0;
    G.stageMsg = 150;
    NS.Enemies.reset();
    NS.Enemies.clearTimers();
    NS.Weapons.reset();
    NS.FX.reset();
    NS.Level1.reset();
    if (full) G.player.reset(true);
    else G.player.respawn();
  };

  G.startRun = function () {
    G.player.reset(true);
    G.resetStage(true);
    G.state = 'play';
    NS.Audio.resume();
    NS.Audio.setTrack('stage');
    NS.Audio.rewind();          // a new run hears the intro again
    NS.Audio.startMusic();
  };

  function startStage2() {
    G.stage = 2;
    G.scrollX = 0;
    G.boss = null;
    G.capsules.length = 0;
    G.looseOptions.length = 0;
    NS.Enemies.reset(); NS.Enemies.clearTimers(); NS.Weapons.reset(); NS.FX.reset();
    NS.Level2.reset();
    G.player.setOrientation('vertical');
    G.player.x = NS.W / 2; G.player.y = NS.PLAYFIELD_H - 28;
    G.player.invuln = 90;
    for (var i = 0; i < G.player.options.length; i++) {
      G.player.options[i].x = G.player.x; G.player.options[i].y = G.player.y;
    }
    G.player.trail = [{ x: G.player.x, y: G.player.y }];
    G.state = 'play'; G.stageMsg = 180; G.bossWarn = 0;
    NS.Audio.setTrack('stage'); NS.Audio.rewind(); NS.Audio.startMusic();
  }
  G.startStage2 = startStage2; // debug hook for testing the vertical stage directly

  function startLaterStage(stage) {
    G.stage = stage; G.scrollX = 0; G.boss = null; G.bossName = '';
    G.capsules.length = 0; G.looseOptions.length = 0;
    NS.Enemies.reset(); NS.Enemies.clearTimers(); NS.Weapons.reset(); NS.FX.reset();
    NS.Campaign.reset(stage, G);
    G.player.setOrientation(NS.Campaign.spec.orientation === 'vertical' ? 'vertical' : 'side');
    G.player.x = NS.Campaign.horizontal() ? 38 : NS.W / 2;
    G.player.y = NS.Campaign.horizontal() ? NS.PLAYFIELD_H / 2 : NS.PLAYFIELD_H - 28;
    G.player.invuln = 90; G.player.trail = [{x:G.player.x,y:G.player.y}];
    for (var i=0;i<G.player.options.length;i++){G.player.options[i].x=G.player.x;G.player.options[i].y=G.player.y;}
    G.state='play';G.stageMsg=180;G.bossWarn=0;
    NS.Audio.setTrack('stage');NS.Audio.rewind();NS.Audio.startMusic();
  }
  G.startStage = function(stage){ if(stage===1)G.startRun();else if(stage===2)startStage2();else startLaterStage(stage); };

  /* ---- scoring / pickups ---------------------------------------------- */
  G.addScore = function (n, x, y) {
    G.player.score += n;
    while (G.player.score >= G.player.nextLifeScore) {
      G.player.lives++;
      G.player.nextLifeScore += 30000;
      NS.Audio.sfx.extraLife();
      NS.FX.popText(G.player.x - 8, G.player.y - 14, '1UP', '#9dffb0');
    }
    if (G.player.score > G.hiScore) {
      G.hiScore = G.player.score;
      try { localStorage.setItem('ns_hiscore', String(G.hiScore)); } catch (e) {}
    }
    if (n >= 1000 && x != null) NS.FX.popText(x, y, String(n), '#ffe9a0');
  };

  G.spawnCapsule = function (x, y) {
    G.capsules.push({ x: x, y: y, vx: -0.55, t: 0, dead: false, w: 6, h: 5 });
    NS.FX.popText(x - 4, y - 8, 'POWER', '#ff9c9c');
  };

  /* Life Force recovery rule: on death, equipped Options become neutral
     green pickups at their current positions instead of vanishing. */
  function releaseOptions() {
    var opts = G.player.options;
    for (var i = 0; i < opts.length; i++) {
      G.looseOptions.push({
        x: opts[i].x,
        y: opts[i].y,
        vx: -0.07 - i * 0.012,
        phase: i * 1.7,
        t: 0,
        dead: false,
        w: 5,
        h: 5
      });
    }
    opts.length = 0;
  }

  /* ---- main loop ------------------------------------------------------ */
  function loop(now) {
    var dt = now - last;
    last = now;
    if (dt > 250) dt = 250;
    acc += dt;
    var step = 1000 / NS.FPS;
    var guard = 0;
    while (acc >= step && guard < 5) {
      update();
      NS.Input.endFrame();
      acc -= step;
      guard++;
    }
    if (guard >= 5) acc = 0;
    render();
    requestAnimationFrame(loop);
  }

  function update() {
    var I = NS.Input;

    /* Gamepads are polled at the fixed simulation rate so button edges have
       exactly the same semantics as keyboard and touch presses. */
    I.pollGamepads();

    if (I.hit('fullscreen')) {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
      else document.exitFullscreen && document.exitFullscreen();
    }

    if (I.hit('touchpad')) { NS.Touch.toggle(); resize(); }

    /* voxel view. The import is async, so the confirmation (or the reason
       it could not load) arrives in a callback. */
    if (I.hit('voxel')) {
      G.voxelMsg = 'VOXEL VIEW...';
      G.voxelMsgT = 120;
      NS.Voxel.toggle(function (on, err) {
        G.voxelMsg = err || ('VOXEL VIEW ' + (on ? 'ON' : 'OFF'));
        G.voxelMsgT = 120;
        resize();
      });
    }
    if (G.voxelMsgT > 0) G.voxelMsgT--;

    /* fire mode is switchable at any time, including mid-wave */
    if (I.hit('firemode')) {
      NS.Gunner.cycle();
      NS.Audio.sfx.power();
      G.modeMsg = 90;
    }
    if (G.modeMsg > 0) G.modeMsg--;

    if (NS.Debug && NS.Debug.paused && !NS.Debug.stepping) return;

    if (G.state === 'title') {
      G.frame++;
      NS.FX.updateBackground();
      if (I.hit('start') || I.hit('fire')) G.startRun();
      return;
    }

    if (G.state === 'gameover' || G.state === 'clear') {
      G.frame++;
      G.clearT++;
      NS.FX.update();
      NS.FX.updateBackground();
      if (G.clearT > 90 && (I.hit('start') || I.hit('fire'))) {
        G.state = 'title';
        G.resetStage(true);
        NS.Audio.stopMusic();
      }
      return;
    }

    if (I.hit('pause')) {
      if (G.state === 'paused') { G.state = G.prevState; NS.Audio.startMusic(); }
      else { G.prevState = G.state; G.state = 'paused'; NS.Audio.stopMusic(); }
    }
    if (G.state === 'paused') return;

    G.frame++;
    if (G.stageMsg > 0) G.stageMsg--;

    /* Every stage ends with the ship accelerating in its current forward
       direction before the next horizontal/vertical camera takes over. */
    if (G.state === 'departing') {
      G.clearT++; G.departV = Math.min(10, G.departV + 0.16);
      var verticalDepart = G.player.orientation === 'vertical';
      var oldX = G.player.x, oldY = G.player.y;
      if (verticalDepart) G.player.y -= G.departV; else G.player.x += G.departV;
      for (var di = 0; di < G.player.options.length; di++) {
        G.player.options[di].x += G.player.x - oldX; G.player.options[di].y += G.player.y - oldY;
      }
      G.player.anim++; NS.FX.update(); NS.FX.updateBackground();
      if ((verticalDepart && G.player.y < -45) || (!verticalDepart && G.player.x > NS.W + 45)) G.startStage(G.nextStage);
      return;
    }

    if (G.stage === 2) {
      updateStage2(I);
      return;
    }
    if (G.stage >= 3) {
      updateLaterStage(I);
      return;
    }

    /* ---- scroll ---- */
    /* Life Force continues the stage while the replacement ship is on its
       way in; death does not rewind to a Gradius-style checkpoint. */
    var scrolling = (G.state === 'play' || G.state === 'dying') && !G.boss;
    if (scrolling) {
      G.scrollX += NS.SCROLL_SPEED;
      if (G.scrollX >= NS.Terrain.BOSS_X) {
        G.scrollX = NS.Terrain.BOSS_X;
        G.boss = new NS.Boss(G);
        G.bossWarn = 120;
        NS.Audio.sfx.alarm();
        NS.Audio.setTrack('boss');
      }
      NS.Level1.update(G.scrollX);
    }
    if (G.bossWarn > 0) G.bossWarn--;

    NS.FX.updateBackground();
    NS.Enemies.updateTimers();
    G.player.update(G.scrollX, I);
    NS.Enemies.update(G.scrollX, G.player);
    NS.Weapons.update(G.scrollX);
    if (G.boss) G.boss.update(G.player);
    updateCapsules();
    updateLooseOptions();
    NS.FX.update();

    collide();

    /* ---- death / respawn flow ---- */
    if (!G.player.alive && G.state === 'play') {
      releaseOptions();
      G.state = 'dying';
    }
    if (G.state === 'dying' && G.player.dying <= 0) {
      if (G.player.lives > 0) {
        G.player.respawn();
        /* Put the new ship inside the corridor at the current scroll point,
           including tight passages where screen centre may be solid flesh. */
        var spawnTop = NS.Terrain.topAt(G.scrollX + G.player.x) + 7;
        var spawnBot = NS.Terrain.botAt(G.scrollX + G.player.x) - 7;
        G.player.y = (spawnTop + spawnBot) * 0.5;
        G.state = 'play';
      } else {
        G.state = 'gameover';
        G.clearT = 0;
        NS.Audio.stopMusic();
      }
    }

    /* ---- boss defeated ---- */
    if (G.boss && G.boss.dead) {
      G.boss = null;
      G.state = 'departing';
      G.nextStage = 2;
      G.clearT = 0;
      G.departV = 0;
      G.addScore(20000);
      NS.Audio.stopMusic();
    }
  }

  function updateStage2(I) {
    if (G.bossWarn > 0) G.bossWarn--;
    NS.FX.updateBackground();
    G.player.update(0, I);
    NS.Level2.update(G);
    NS.FX.update();

    if (!G.player.alive && G.state === 'play') {
      releaseOptions(); G.state = 'dying';
    }
    if (G.state === 'dying' && G.player.dying <= 0) {
      if (G.player.lives > 0) {
        G.player.respawn(); G.player.setOrientation('vertical');
        G.player.x = NS.W / 2; G.player.y = NS.PLAYFIELD_H - 28;
        G.state = 'play';
      } else {
        G.state = 'gameover'; G.clearT = 0; NS.Audio.stopMusic();
      }
    }
    if (NS.Level2.complete) {
      G.state = 'departing'; G.nextStage = 3; G.departV = 0; G.clearT = 0; G.boss = null;
    }
  }

  function updateLaterStage(I) {
    if (G.bossWarn > 0) G.bossWarn--;
    NS.FX.updateBackground(); G.player.update(0,I); NS.Campaign.update(G); NS.FX.update();
    if(!G.player.alive&&G.state==='play'){releaseOptions();G.state='dying';}
    if(G.state==='dying'&&G.player.dying<=0){
      if(G.player.lives>0){G.player.respawn();G.player.setOrientation(NS.Campaign.spec.orientation==='vertical'?'vertical':'side');
        G.player.x=NS.Campaign.horizontal()?38:NS.W/2;G.player.y=NS.Campaign.horizontal()?NS.PLAYFIELD_H/2:NS.PLAYFIELD_H-28;G.state='play';}
      else{G.state='gameover';G.clearT=0;NS.Audio.stopMusic();}
    }
    if(NS.Campaign.complete&&G.state!=='gameover'){G.boss=null;G.clearT=0;
      if(G.stage<6){G.state='departing';G.nextStage=G.stage+1;G.departV=0;}
      else{G.state='clear';}
    }
  }

  function updateCapsules() {
    for (var i = 0; i < G.capsules.length; i++) {
      var c = G.capsules[i];
      if (c.dead) continue;
      c.t++;
      c.x += c.vx - NS.SCROLL_SPEED * 0.5;
      /* capsules float: they hold the height they were released at and drift
         with the scroll — never falling. Terrain only nudges them back into
         the corridor so they can't disappear inside the flesh. */
      var floor = NS.Terrain.botAt(G.scrollX + c.x) - c.h - 1;
      var ceil = NS.Terrain.topAt(G.scrollX + c.x) + 1;
      if (c.y > floor) c.y = floor;
      if (c.y < ceil) c.y = ceil;
      if (c.x < -10 || c.t > 900) c.dead = true;
    }
    NS.prune(G.capsules);
  }

  function updateLooseOptions() {
    for (var i = 0; i < G.looseOptions.length; i++) {
      var o = G.looseOptions[i];
      if (o.dead) continue;
      o.t++;
      o.x += o.vx;
      o.y += Math.sin(o.t * 0.045 + o.phase) * 0.08;

      /* Keep recoverable Options in the open corridor while they drift. */
      var floor = NS.Terrain.botAt(G.scrollX + o.x) - o.h - 1;
      var ceil = NS.Terrain.topAt(G.scrollX + o.x) + 1;
      if (o.y > floor) o.y = floor;
      if (o.y < ceil) o.y = ceil;
      if (o.x < -8 || o.t > 720) o.dead = true;
    }
    NS.prune(G.looseOptions);
  }

  /* ---- collision ------------------------------------------------------ */
  function collide() {
    var p = G.player;
    var i, j;

    /* player shots vs enemies */
    for (i = 0; i < NS.Weapons.player.length; i++) {
      var s = NS.Weapons.player[i];
      if (s.dead) continue;
      var sr = NS.Weapons.rectOf(s);

      for (j = 0; j < NS.Enemies.list.length; j++) {
        var e = NS.Enemies.list[j];
        if (e.dead || e.spawnDelay > 0) continue;
        if (!NS.rectHit(sr, { x: e.x, y: e.y, w: e.w, h: e.h })) continue;
        if (!NS.Weapons.canHit(s, e)) continue;
        NS.Enemies.damage(e, s.dmg, G);
        if (!s.pierce) { s.dead = true; break; }
      }
      if (s.dead) continue;

      if (G.boss) {
        if (G.boss.tryHit(sr, s.dmg, G) && !s.pierce) s.dead = true;
      }
    }

    if (!p.alive) return;

    var pr = { x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h };

    /* enemy shots vs player */
    for (i = 0; i < NS.Weapons.enemy.length; i++) {
      var es = NS.Weapons.enemy[i];
      if (es.dead) continue;
      if (NS.rectHit(pr, { x: es.x, y: es.y, w: 4, h: 4 })) {
        es.dead = true;
        NS.FX.explode(es.x, es.y, 0.6, 'hit');
        if (!p.hit()) return;
      }
    }

    /* enemy bodies vs player */
    for (i = 0; i < NS.Enemies.list.length; i++) {
      var en = NS.Enemies.list[i];
      if (en.dead || en.spawnDelay > 0 || en.kind === 'prominence') continue;
      if (NS.rectHit(pr, { x: en.x, y: en.y, w: en.w, h: en.h })) {
        if (!en.invincible) NS.Enemies.destroy(en, G);
        if (!p.hit()) return;
      }
    }

    /* prominence flames */
    var burned = false;
    NS.Enemies.eachHazard(function (x, y, w, h) {
      if (burned) return;
      if (NS.rectHit(pr, { x: x, y: y, w: w, h: h })) burned = true;
    });
    if (burned && !p.hit()) return;

    /* boss body + cells */
    if (G.boss) {
      var touched = false;
      G.boss.eachHazard(function (x, y, w, h) {
        if (touched) return;
        if (NS.rectHit(pr, { x: x, y: y, w: w, h: h })) touched = true;
      });
      if (touched && !p.hit()) return;
    }

    /* capsules */
    for (i = 0; i < G.capsules.length; i++) {
      var c = G.capsules[i];
      if (c.dead) continue;
      if (NS.rectHit({ x: p.x - 10, y: p.y - 8, w: 20, h: 16 }, { x: c.x, y: c.y, w: c.w, h: c.h })) {
        c.dead = true;
        p.giveCapsule();
        G.addScore(100);
      }
    }

    /* released Options are collected directly, without advancing the meter */
    for (i = 0; i < G.looseOptions.length; i++) {
      var o = G.looseOptions[i];
      if (o.dead) continue;
      if (NS.rectHit({ x: p.x - 10, y: p.y - 8, w: 20, h: 16 },
                     { x: o.x - 2, y: o.y - 2, w: o.w, h: o.h }) &&
          p.recoverOption()) {
        o.dead = true;
      }
    }
  }

  /* ---- rendering ------------------------------------------------------
     render() draws the simulation frame, then hands it to a presenter:
     either the plain 2D blit or, when it is switched on, the voxel view.
     drawFrame() below is the original Canvas2D renderer, unchanged in its
     coordinate space — it always paints into the 256x224 buffer. */
  function render() {
    var vox = NS.Voxel && NS.Voxel.active();
    /* In voxel mode the world is drawn by three.js and the 2D buffer keeps
       only what belongs flat on top: the HUD, the messages, and the score
       pops. Everything else is left transparent so the 3D shows through. */
    drawFrame(vox);
    if (vox) NS.Voxel.render(G);
    present(vox);
  }

  function stageName() {
    var key = 'stage' + G.stage + 'Name';
    return NS.THEME[key] || NS.THEME.stage1Name;
  }
  function bossName() {
    var key = G.stage === 1 ? 'bossName' : 'boss' + G.stage + 'Name';
    return NS.THEME[key] || 'BOSS';
  }

  function drawFrame(overlayOnly) {
    /* All existing drawing code keeps using simulation coordinates. Canvas
       applies the expansion while drawing, allowing vector font outlines to
       rasterize at their final display size and remain genuinely sharp. */
    g.setTransform(NS.SCREEN_W / NS.W, 0, 0, NS.SCREEN_H / NS.H, 0, 0);
    if (overlayOnly) g.clearRect(0, 0, NS.W, NS.H);
    else { g.fillStyle = '#000'; g.fillRect(0, 0, NS.W, NS.H); }

    if (G.state === 'title') { drawTitle(overlayOnly); drawHud(); return; }

    /* playfield is clipped so nothing bleeds into the HUD strip */
    g.save();
    g.beginPath();
    g.rect(0, 0, NS.W, NS.PLAYFIELD_H);
    g.clip();

    if (overlayOnly) {
      NS.FX.drawText(g);
    } else if (G.stage === 2) {
      NS.Level2.draw(g);
      G.player.draw(g);
      NS.FX.draw(g);
    } else if (G.stage >= 3) {
      NS.Campaign.draw(g); G.player.draw(g); NS.FX.draw(g);
    } else {
      NS.FX.drawBackground(g, G.scrollX);
      NS.Terrain.draw(g, G.scrollX, G.frame);
      NS.Terrain.drawChamberSeal(g, G.scrollX, !!G.boss);

      drawCapsules();
      NS.Enemies.draw(g);
      if (G.boss) G.boss.draw(g);
      NS.Weapons.draw(g);
      G.player.draw(g);
      NS.FX.draw(g);
    }

    if (G.stageMsg > 0 && G.stageMsg % 30 < 20) {
      centerText(stageName(), 74, '#ffd7e6');
      centerText('STAGE ' + G.stage, 60, '#8fd0ff');
    }
    if (G.bossWarn > 0 && (G.bossWarn >> 3) % 2 === 0) {
      centerText('!! WARNING !!', 40, '#ff7676');
      centerText(G.bossName || bossName(), 52, '#ffb0b0');
    }
    if (G.modeMsg > 0) {
      centerText('FIRE: ' + NS.Gunner.label(), 30, '#9fe8ff');
    }
    if (G.voxelMsgT > 0) {
      centerText(G.voxelMsg, 20,
                 NS.Voxel.status() === 'failed' ? '#ff9a9a' : '#9fe8ff');
    }
    if (NS.Debug) NS.Debug.draw(g, G);
    if (G.state === 'paused') {
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(0, 0, NS.W, NS.PLAYFIELD_H);
      centerText('PAUSED', 96, '#ffffff');
    }
    if (G.state === 'gameover') {
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillRect(0, 0, NS.W, NS.PLAYFIELD_H);
      centerText('GAME OVER', 92, '#ff8080');
      if (G.clearT > 90) centerText('PRESS ENTER', 112, '#c8d2e8');
    }
    if (G.state === 'clear') {
      g.fillStyle = 'rgba(0,0,0,' + Math.min(0.6, G.clearT / 200) + ')';
      g.fillRect(0, 0, NS.W, NS.PLAYFIELD_H);
      centerText(G.stage === 6 ? 'ZELOS DESTROYED' : 'STAGE ' + G.stage + ' CLEAR', 84, '#a8ffc0');
      if (G.stage === 6 && G.clearT > 45) centerText('THE SIX TERROR ZONES ARE SILENT', 100, '#d6e9ff');
      centerText('SCORE ' + pad(G.player.score, 7), G.stage === 6 ? 116 : 100, '#ffe9a0');
      if (G.clearT > 90) centerText('PRESS ENTER', G.stage === 6 ? 138 : 120, '#c8d2e8');
    }

    g.restore();
    drawHud();
  }

  function drawCapsules() {
    for (var i = 0; i < G.capsules.length; i++) {
      var c = G.capsules[i];
      if (c.dead) continue;
      g.drawImage(NS.S.capsule[(c.t >> 3) & 1], c.x | 0, c.y | 0);
    }
    for (var j = 0; j < G.looseOptions.length; j++) {
      var o = G.looseOptions[j];
      if (o.dead) continue;
      var spr = NS.S.looseOption[(o.t >> 3) & 1];
      g.drawImage(spr, (o.x - 2) | 0, (o.y - 2) | 0);
    }
  }

  function drawTitle(overlayOnly) {
    if (!overlayOnly) {
      NS.FX.drawBackground(g, G.frame * 0.6);

      /* silhouette of the corridor behind the logo */
      g.globalAlpha = 0.5;
      NS.Terrain.draw(g, (G.frame * 0.5) % (NS.Terrain.LENGTH - NS.W), G.frame);
      g.globalAlpha = 1;
    }

    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(0, 40, NS.W, 92);

    centerText(NS.THEME.title, 62, '#ffffff', '12px');
    centerText(NS.THEME.subtitle, 78, '#ff9ec0');
    centerText('A LIFE FORCE STYLE CAMPAIGN', 92, '#6f7f9c');

    if ((G.frame >> 4) % 2 === 0) centerText('PRESS ENTER', 120, '#8fd0ff');

    centerText('Z FIRE    X POWER-UP    ARROWS MOVE', 144, '#5f6c86');
    centerText('M  —  FIRE MODE: ' + NS.Gunner.label(), 156,
               NS.Gunner.mode === 'manual' ? '#5f6c86' : '#9fe8ff');
    centerText('HI ' + pad(G.hiScore, 7), 168, '#ffe9a0');

    if (!overlayOnly) {
      g.drawImage(NS.S.ship, 26, 100 + Math.sin(G.frame * 0.05) * 4);
      g.drawImage(NS.S.flame[(G.frame >> 2) & 1], 21, 104 + Math.sin(G.frame * 0.05) * 4);
    }
  }

  /* ---- HUD ------------------------------------------------------------ */
  function drawHud() {
    var y = NS.PLAYFIELD_H;
    g.fillStyle = '#0b0d14';
    g.fillRect(0, y, NS.W, NS.HUD_H);
    g.fillStyle = '#1e2740';
    g.fillRect(0, y, NS.W, 1);

    g.font = '6px monospace';
    g.textAlign = 'left';

    /* score + hi */
    g.fillStyle = '#ffe9a0';
    g.fillText(pad(G.player ? G.player.score : 0, 7), 3, y + 7);
    g.fillStyle = '#8fd0ff';
    g.fillText('HI ' + pad(G.hiScore, 7), 3, y + 14);

    /* power meter */
    var slots = NS.Player.SLOTS;
    var x0 = 62, sw = 27;
    for (var i = 0; i < slots.length; i++) {
      var sx = x0 + i * sw;
      var on = G.player && G.player.sel === i + 1;
      var owned = false;
      if (G.player) {
        if (i === 0) owned = G.player.speedLv > 0;
        else if (i === 1) owned = G.player.missileLv > 0;
        else if (i === 2) owned = G.player.weapon === 'ripple';
        else if (i === 3) owned = G.player.weapon === 'laser';
        else if (i === 4) owned = G.player.options.length > 0;
        else if (i === 5) owned = G.player.shield > 0;
      }
      g.fillStyle = on ? ((G.frame >> 2) % 2 ? '#ff5a5a' : '#ffa0a0') : (owned ? '#1c3a5c' : '#151a26');
      g.fillRect(sx, y + 3, sw - 2, 10);
      g.strokeStyle = on ? '#ffd0d0' : '#2a3450';
      g.lineWidth = 1;
      g.strokeRect(sx + 0.5, y + 3.5, sw - 3, 9);
      g.fillStyle = on ? '#ffffff' : (owned ? '#8fd0ff' : '#4b5673');
      g.fillText(slots[i], sx + 2, y + 10);
    }

    /* option / speed detail + lives */
    g.textAlign = 'right';
    if (G.player) {
      /* fire mode rides on the stats line; MANUAL is the default so it
         stays unmarked and only the assisted modes announce themselves */
      var mode = NS.Gunner.mode;
      var tag = mode === 'auto' ? ' AUTO' : (mode === 'assist' ? ' AI' : '');
      g.fillStyle = '#8fd0ff';
      g.fillText('SP' + G.player.speedLv + ' M' + G.player.missileLv +
                 ' OP' + G.player.options.length + tag, NS.W - 3, y + 7);
      g.fillStyle = '#ff9ec0';
      var l = '';
      for (var k = 0; k < Math.max(0, G.player.lives); k++) l += '▲';
      g.fillText(l, NS.W - 3, y + 14);
    }
    g.textAlign = 'left';

    /* boss life bar sits just above the HUD while the boss is alive */
    if (G.boss && G.boss.state !== 'dying') {
      var pct = NS.clamp(G.boss.hp / G.boss.maxHp, 0, 1);
      g.fillStyle = '#3a0d18';
      g.fillRect(60, y - 6, 136, 4);
      g.fillStyle = pct > 0.45 ? '#ff5a7a' : '#ffca3a';
      g.fillRect(61, y - 5, Math.round(134 * pct), 2);
    }
  }

  function centerText(t, y, color, size) {
    g.font = (size || '6px') + ' monospace';
    g.textAlign = 'center';
    g.fillStyle = color;
    g.fillText(t, NS.W / 2, y);
    g.textAlign = 'left';
    g.font = '6px monospace';
  }

  function pad(n, w) {
    var s = String(n | 0);
    while (s.length < w) s = '0' + s;
    return s;
  }

  /* Debug hook: advance the simulation by hand. Browsers throttle rAF in
     hidden tabs, so automated smoke-testing drives the game through this. */
  G.step = function (n) {
    for (var i = 0; i < (n || 1); i++) { update(); NS.Input.endFrame(); }
    render();
  };

  window.addEventListener('load', function () { G.init(); });
  window.addEventListener('fullscreenchange', function () { if (G.resize) G.resize(); });
  /* Browsers prohibit fullscreen before a user gesture. Enter/fire starts
     the game and enters fullscreen in that same trusted keyboard event;
     the first pointer press does likewise for mouse and touch players. */
  function fullscreenStartKey(e) {
    if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyZ' || e.code === 'KeyJ') {
      G.requestFullscreen();
      window.removeEventListener('keydown', fullscreenStartKey);
    }
  }
  window.addEventListener('keydown', fullscreenStartKey);
  window.addEventListener('pointerdown', function () { G.requestFullscreen(); }, { once: true });
  /* unlock audio on the first interaction, as browsers require */
  window.addEventListener('keydown', function () { NS.Audio.resume(); }, { once: true });

})(NS);
