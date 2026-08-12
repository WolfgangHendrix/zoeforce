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

  G.state = 'title';        // title | play | dying | departing | continue | clear | gameover | paused
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
  G.furthestStage = 1;
  G.continues = 2;
  G.continueT = 0;
  G.continueIndex = 0;
  G.settings = {
    startingLives: 3,
    wallDamage: true,
    master: 100,
    music: 100,
    sfx: 100,
    reducedFlash: false
  };

  var CONTINUES_PER_RUN = 2;
  var CONTINUE_SECONDS = 10;

  function savedInt(key, fallback, lo, hi) {
    var value = parseInt(NS.Save.read(key, String(fallback)), 10);
    if (!isFinite(value)) value = fallback;
    return NS.clamp(value, lo, hi);
  }

  /* ---- boot ------------------------------------------------------------
     Startup used to run as one blocking block before the first frame: carve
     9,400 columns of terrain, seed the background, then kick off the
     three.js import and show the title over a half-built scene. On a slow
     machine that is a black window, and the voxel geometry then popped in
     behind an already-interactive title.

     The work is now a queue, one step per frame, behind a loading screen
     that says which step is running. Nothing here is faster — it is the same
     work — but the frame loop is alive throughout, so the screen paints and
     the player can see progress instead of a stalled tab. */
  var boot = null, bootStep = 0, bootHold = 0;
  var BOOT_MIN = 40;          // frames the screen stays up even if boot is instant

  function buildBootQueue() {
    return [
      { label: 'CARVING THE CORRIDOR', run: function () { NS.Terrain.build(); } },
      { label: 'SEEDING THE DEEP FIELD', run: function () { NS.FX.initBackground(); } },
      { label: 'READING PILOT RECORDS', run: function () {
          G.hiScore = parseInt(NS.Save.read('ns_hiscore', '0'), 10) || 0;
          G.furthestStage = savedInt('ns_furthest_stage', 1, 1, 6);
          G.settings.startingLives = savedInt('ns_starting_lives', 3, 1, 9);
          G.settings.wallDamage = NS.Save.read('ns_wall_damage', '1') !== '0';
          G.settings.master = savedInt('ns_master_volume', 100, 0, 100);
          G.settings.music = savedInt('ns_music_volume', 100, 0, 100);
          G.settings.sfx = savedInt('ns_sfx_volume', 100, 0, 100);
          G.settings.reducedFlash = NS.Save.read('ns_reduced_flash', '0') === '1';
          applyAudioSettings();
          NS.Gunner.load();
        } },
      { label: 'ARMING THE SERAPH', run: function () {
          G.player = new NS.Player();
          G.resetStage(true);
        } },
      { label: 'WIRING CONTROLS', run: function () { NS.Touch.init(); resize(); } },
      /* The only genuinely asynchronous step: three.js is an ES module and
         is fetched at runtime. `wait` holds the queue here until it resolves
         or fails, which is what stops the voxel world assembling itself in
         view behind a live title screen. */
      { label: 'BUILDING VOXEL GEOMETRY', pending: false, done: false,
        run: function () {
          var step = this;
          if (!NS.Voxel) { step.done = true; return; }
          step.pending = true;
          NS.Voxel.enable(function (on, err) {
            step.done = true;
            if (on) resize();
            else if (err) { G.voxelMsg = err + ' - USING 2D'; G.voxelMsgT = 180; }
          });
        },
        wait: function () { return this.pending && !this.done; } }
    ];
  }

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

    resize();
    window.addEventListener('resize', resize);

    boot = buildBootQueue();
    bootStep = 0;
    bootHold = 0;
    G.state = 'loading';

    last = performance.now();
    requestAnimationFrame(loop);
  };

  /* One step per frame. A step that declares `wait` keeps the queue parked
     until it says otherwise. */
  function advanceBoot() {
    bootHold++;
    if (bootStep >= boot.length) {
      if (bootHold >= BOOT_MIN) { boot = null; G.state = 'title'; }
      return;
    }
    var step = boot[bootStep];
    if (step.started) {
      if (!step.wait || !step.wait()) bootStep++;
      return;
    }
    step.started = true;
    try { step.run(); } catch (e) { step.failed = true; }
    if (!step.wait || !step.wait()) bootStep++;
  }

  function bootProgress() {
    if (!boot) return 1;
    return NS.clamp(bootStep / boot.length, 0, 1);
  }
  function bootLabel() {
    if (!boot || bootStep >= boot.length) return 'READY';
    return boot[bootStep].label;
  }

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
    NS.Intro.stop();
    NS.Level1.reset();
    if (full) G.player.reset(true);
    else G.player.respawn();
  };

  function startStageOne() {
    G.resetStage(false);
    G.state = 'play';
    NS.Audio.resume();
    NS.Audio.setTrack('stage');
    NS.Audio.rewind();
    NS.Audio.startMusic();
  }

  /* A title-screen start is a new credit, whether it begins at Stage 1 or at
     an unlocked practice point. Stage transitions use startStage() below and
     deliberately keep the current ships, score and loadout. */
  G.startRun = function (stage) {
    stage = NS.clamp(stage || 1, 1, G.furthestStage);
    G.player.reset(true);
    G.continues = CONTINUES_PER_RUN;
    if (stage === 1) startStageOne();
    else G.startStage(stage);
  };

  function startStage2() {
    G.stage = 2;
    G.scrollX = 0;
    G.boss = null;
    G.capsules.length = 0;
    G.looseOptions.length = 0;
    NS.Enemies.reset(); NS.Enemies.clearTimers(); NS.Weapons.reset(); NS.FX.reset();
    NS.Intro.stop();
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
    NS.Intro.stop();
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

  function unlockStage(stage) {
    stage = NS.clamp(stage, 1, 6);
    if (stage <= G.furthestStage) return;
    G.furthestStage = stage;
    NS.Save.write('ns_furthest_stage', stage, 'STAGE ' + stage + ' UNLOCKED');
  }

  function startNextStage() {
    unlockStage(G.nextStage);
    G.startStage(G.nextStage);
  }

  function beginContinue() {
    flushHiScore();
    G.clearT = 0;
    NS.Audio.stopMusic();
    if (G.continues <= 0) {
      G.state = 'gameover';
      return;
    }
    G.state = 'continue';
    G.continueT = CONTINUE_SECONDS * NS.FPS;
    G.continueIndex = 0;
  }

  function acceptContinue() {
    var stage = G.stage;
    G.continues--;
    G.player.reset(true);       // score, ships and loadout begin a new credit
    if (stage === 1) startStageOne();
    else G.startStage(stage);
  }

  function declineContinue() {
    G.state = 'gameover';
    G.clearT = 0;
  }

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
      /* The high score changes on almost every kill, so writing on each one
         would leave the throbber permanently lit and stop meaning anything.
         Persist on a settled cadence instead; the run-end write below is the
         one that actually has to land. */
      hiScoreDirty = true;
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

    /* the save throbber is UI, not simulation: it keeps counting down in
       every state, including while paused or on the title */
    NS.Save.update();

    if (G.state === 'loading') { G.frame++; advanceBoot(); return; }

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
      updateTitle(I);
      return;
    }

    if (G.state === 'continue') {
      if (NS.Autoplay && NS.Autoplay.active()) { acceptContinue(); return; }
      G.frame++;
      G.clearT++;
      NS.FX.update();
      NS.FX.updateBackground();
      var choice = menuStep(I);
      if (choice) {
        G.continueIndex = (G.continueIndex + 2 + choice) % 2;
        NS.Audio.sfx.pickup();
      }
      if (I.hit('start') || I.hit('fire')) {
        if (G.continueIndex === 0) acceptContinue();
        else declineContinue();
        return;
      }
      G.continueT--;
      if (G.continueT <= 0) declineContinue();
      return;
    }

    if (G.state === 'gameover' || G.state === 'clear') {
      if (G.state === 'gameover' && NS.Autoplay && NS.Autoplay.active()) {
        G.startRun(G.stage);
        return;
      }
      if (G.state === 'clear' && G.stage === 6 && NS.Autoplay && NS.Autoplay.active()) {
        NS.Autoplay.finish();
      }
      /* dying mid-entrance must not leave the cut frozen over the results —
       this branch returns before the intro's own update would run */
      NS.Intro.stop();
      G.frame++;
      G.clearT++;
      NS.FX.update();
      NS.FX.updateBackground();
      if (G.clearT === 1) flushHiScore();
      if (G.clearT > 90 && (I.hit('start') || I.hit('fire'))) {
        G.state = 'title';
        title.screen = 'main'; title.index = 0;
        G.resetStage(true);
        NS.Audio.stopMusic();
      }
      return;
    }

    if (I.hit('pause')) {
      if (G.state === 'paused') {
        resumeFromPause();
        return;
      }
      else {
        G.prevState = G.state;
        G.state = 'paused';
        pause.index = 0;
        pause.confirm = null;
        pause.submenu = null;
        pause.inputArmed = false;
        NS.Audio.stopMusic();
        /* Xbox Start raises both `pause` and `start`. Do not let the same
           physical edge open the pause screen and select its first row. */
        return;
      }
    }
    if (G.state === 'paused') { updatePause(I); return; }

    /* The showcase pilot supplies only ship controls. Director/menu input
       remains physical, so pause and the debug console always stay usable. */
    var playerI = NS.Autoplay ? NS.Autoplay.input(I, G) : I;

    G.frame++;
    if (G.stageMsg > 0) G.stageMsg--;
    /* the boss entrance cut runs above every stage's own update, so each of
       them can read Intro.holding() without owning a copy of the timing */
    NS.Intro.update();

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
      if ((verticalDepart && G.player.y < -45) || (!verticalDepart && G.player.x > NS.W + 45)) startNextStage();
      return;
    }

    if (G.stage === 2) {
      updateStage2(playerI);
      return;
    }
    if (G.stage >= 3) {
      updateLaterStage(playerI);
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
        G.bossName = bossName();
        NS.Intro.start({
          name: bossName(), sub: 'SEALED CHAMBER BREACHED',
          x: NS.W - 74, y: NS.PLAYFIELD_H / 2, dur: 210, zoom: 0.60
        });
        NS.Audio.setTrack('boss');
      }
      NS.Level1.update(G.scrollX);
    }
    if (G.bossWarn > 0) G.bossWarn--;

    NS.FX.updateBackground();
    NS.Enemies.updateTimers();
    G.player.update(G.scrollX, playerI);
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
        beginContinue();
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
        beginContinue();
      }
    }
    if (NS.Level2.complete && G.state !== 'continue' && G.state !== 'gameover') {
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
      else{beginContinue();}
    }
    if(NS.Campaign.complete&&G.state!=='continue'&&G.state!=='gameover'){G.boss=null;G.clearT=0;
      if(G.stage<6){G.state='departing';G.nextStage=G.stage+1;G.departV=0;}
      else{G.state='clear';}
    }
  }

  /* ---- pause menu ------------------------------------------------------
     Two entries throw away a run in progress, so neither
     fires on a single press: each opens a confirmation whose default answer
     is the harmless one. A player reaching for pause on a stray input can
     press through nothing here and lose their ship. */
  var pause = { index: 0, confirm: null, submenu: null, inputArmed: false };
  var title = { screen: 'main', index: 0, stageIndex: 0, optionIndex: 0 };
  /* exposed so the debug console — and the automated menu tests — can see
     which entry is selected without inferring it from pixels */
  G.pause = pause;
  G.titleMenu = title;

  var PAUSE_ITEMS = [
    { label: 'RESUME', act: resumeFromPause },
    { label: 'OPTIONS', act: function () { pause.submenu = 'options'; pause.optionIndex = 0; } },
    { label: 'RESTART STAGE',
      confirm: ['RESTART STAGE ' + '%S' + '?',
                'POWER-UPS AND STAGE PROGRESS ARE LOST.',
                'SCORE AND REMAINING SHIPS ARE KEPT.'],
      act: restartStage },
    { label: 'QUIT TO TITLE',
      confirm: ['END THIS RUN?',
                'THE RUN IS OVER — SHIPS, SCORE AND POWER-UPS GO.',
                'YOUR HIGH SCORE IS ALREADY SAVED.'],
      act: quitToTitle }
  ];

  function resumeFromPause() {
    G.state = G.prevState;
    pause.confirm = null;
    pause.submenu = null;
    NS.Audio.startMusic();
  }

  /* Restart the stage the player is actually in, keeping what the death
     rules would keep: ships and score survive, the loadout does not. */
  function restartStage() {
    pause.confirm = null;
    NS.Intro.stop();
    if (G.stage === 1) {
      G.resetStage(false);              // respawn(): keeps lives and score
      G.state = 'play';
      NS.Audio.setTrack('stage'); NS.Audio.rewind(); NS.Audio.startMusic();
    } else {
      /* startStage() for stage 2+ leaves the ship exactly as it was, which
         would have made the confirmation a lie — it promises the loadout is
         lost. respawn() strips power-ups and keeps ships and score, which is
         the same bargain a death makes. */
      G.player.respawn();
      G.startStage(G.stage);
    }
  }

  function quitToTitle() {
    pause.confirm = null;
    pause.submenu = null;
    flushHiScore();
    NS.Intro.stop();
    G.resetStage(true);
    G.state = 'title';
    title.screen = 'main'; title.index = 0;
    G.clearT = 0;
    NS.Audio.stopMusic();
  }

  function applyAudioSettings() {
    NS.Audio.setVolumes({
      master: G.settings.master / 100,
      music: G.settings.music / 100,
      sfx: G.settings.sfx / 100
    });
  }

  function saveSetting(name) {
    var keys = {
      startingLives: ['ns_starting_lives', 'STARTING LIVES'],
      wallDamage: ['ns_wall_damage', 'WALL DAMAGE'],
      master: ['ns_master_volume', 'MASTER VOLUME'],
      music: ['ns_music_volume', 'MUSIC VOLUME'],
      sfx: ['ns_sfx_volume', 'SFX VOLUME'],
      reducedFlash: ['ns_reduced_flash', 'ACCESSIBILITY']
    };
    var entry = keys[name];
    var value = (name === 'wallDamage' || name === 'reducedFlash')
      ? (G.settings[name] ? 1 : 0)
      : G.settings[name];
    NS.Save.write(entry[0], value, entry[1]);
  }

  var OPTION_NAMES = [
    'STARTING LIVES', 'WALL DAMAGE',
    'MASTER', 'MUSIC', 'SFX', 'REDUCED FLASH', 'BACK'
  ];

  function leaveOptions(context) {
    if (context === 'title') { title.screen = 'main'; title.index = 2; }
    else { pause.submenu = null; pause.index = 1; }
  }

  function adjustOption(index, direction, context) {
    if (index === 6) { leaveOptions(context); NS.Audio.sfx.hit(); return; }
    if (index === 0) {
      G.settings.startingLives = NS.clamp(G.settings.startingLives + direction, 1, 9);
      saveSetting('startingLives');
    } else if (index === 1) {
      G.settings.wallDamage = !G.settings.wallDamage;
      saveSetting('wallDamage');
    } else if (index === 5) {
      G.settings.reducedFlash = !G.settings.reducedFlash;
      saveSetting('reducedFlash');
    } else {
      var key = index === 2 ? 'master' : (index === 3 ? 'music' : 'sfx');
      G.settings[key] = NS.clamp(G.settings[key] + direction * 10, 0, 100);
      applyAudioSettings();
      saveSetting(key);
    }
    NS.Audio.sfx.power();
  }

  /* The touch pad and the analog stick report movement as an axis, not as
     key presses, so a menu driven only by hit('up')/hit('down') cannot be
     used on a phone or a gamepad stick at all. Latch the axis into discrete
     steps here instead. */
  var stickLatched = false;
  var horizontalLatched = false;
  function menuStep(I) {
    /* A key press arrives twice: once as the edge from hit(), and again as a
       held axis on every frame after. Latching on the edge as well as on the
       axis is what stops one tap of a real keyboard — held for more than a
       single frame — from moving two rows. */
    var pressed = I.hit('up') ? -1 : (I.hit('down') ? 1 : 0);
    if (pressed) { stickLatched = true; return pressed; }
    var ay = I.axis().y;
    if (Math.abs(ay) < 0.5) { stickLatched = false; return 0; }
    if (stickLatched) return 0;
    stickLatched = true;
    return ay < 0 ? -1 : 1;
  }

  function menuHorizontalStep(I) {
    var pressed = I.hit('left') ? -1 : (I.hit('right') ? 1 : 0);
    if (pressed) { horizontalLatched = true; return pressed; }
    var ax = I.axis().x;
    if (Math.abs(ax) < 0.5) { horizontalLatched = false; return 0; }
    if (horizontalLatched) return 0;
    horizontalLatched = true;
    return ax < 0 ? -1 : 1;
  }

  function updateOptions(I, context) {
    var owner = context === 'title' ? title : pause;
    var step = menuStep(I);
    if (step) {
      owner.optionIndex = (owner.optionIndex + OPTION_NAMES.length + step) % OPTION_NAMES.length;
      NS.Audio.sfx.pickup();
    }
    var adjust = menuHorizontalStep(I);
    if (adjust && owner.optionIndex < OPTION_NAMES.length - 1) {
      adjustOption(owner.optionIndex, adjust, context);
    }
    if (I.hit('fire') || I.hit('start')) adjustOption(owner.optionIndex, 1, context);
  }

  function updateTitle(I) {
    var select = I.hit('start') || I.hit('fire');
    if (title.screen === 'options') { updateOptions(I, 'title'); return; }
    if (title.screen === 'stages') {
      var stageStep = menuStep(I);
      if (stageStep) {
        title.stageIndex = (title.stageIndex + 7 + stageStep) % 7;
        NS.Audio.sfx.pickup();
      }
      if (select) {
        if (title.stageIndex === 6) { title.screen = 'main'; title.index = 1; NS.Audio.sfx.hit(); }
        else if (title.stageIndex + 1 <= G.furthestStage) G.startRun(title.stageIndex + 1);
        else NS.Audio.sfx.alarm();
      }
      return;
    }

    var step = menuStep(I);
    if (step) {
      title.index = (title.index + 3 + step) % 3;
      NS.Audio.sfx.pickup();
    }
    if (!select) return;
    if (title.index === 0) G.startRun(1);
    else if (title.index === 1) { title.screen = 'stages'; title.stageIndex = 0; NS.Audio.sfx.power(); }
    else { title.screen = 'options'; title.optionIndex = 0; NS.Audio.sfx.power(); }
  }

  function updatePause(I) {
    /* Gameplay inputs often remain held as pause opens (especially Start on
       a controller, which is also the menu-select button). Wait for buttons
       and movement to return to neutral before accepting menu navigation. */
    if (!pause.inputArmed) {
      var openingAxis = I.axis();
      if (!I.held('pause') && !I.held('start') && !I.held('fire') &&
          Math.abs(openingAxis.x) < 0.5 && Math.abs(openingAxis.y) < 0.5) {
        pause.inputArmed = true;
        stickLatched = false;
        horizontalLatched = false;
      }
      return;
    }
    if (pause.submenu === 'options') { updateOptions(I, 'pause'); return; }
    var list = pause.confirm ? 2 : PAUSE_ITEMS.length;
    var step = menuStep(I);
    if (step) {
      pause.index = (pause.index + list + step) % list;
      NS.Audio.sfx.pickup();
    }

    if (pause.confirm) {
      if (I.hit('fire') || I.hit('start')) {
        /* index 0 is CANCEL, and the menu opens on it */
        if (pause.index === 0) { var back = pause.confirm.from; pause.confirm = null; pause.index = back; NS.Audio.sfx.hit(); }
        else { NS.Audio.sfx.power(); pause.confirm.act(); }
      }
      return;
    }

    if (I.hit('fire') || I.hit('start')) {
      var item = PAUSE_ITEMS[pause.index];
      if (item.confirm) {
        pause.confirm = { lines: item.confirm, act: item.act, from: pause.index };
        pause.index = 0;                // default to CANCEL
        NS.Audio.sfx.alarm();
      } else {
        item.act();
      }
    }
  }

  /* The high score is written when a run actually ends, not on every kill
     that raises it — see addScore(). */
  var hiScoreDirty = false;
  function flushHiScore() {
    if (!hiScoreDirty) return;
    hiScoreDirty = false;
    NS.Save.write('ns_hiscore', G.hiScore, 'HIGH SCORE');
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
    /* the loading screen is opaque, so rendering the world behind it is
       pure waste on exactly the machines that need the loading screen */
    var vox = NS.Voxel && NS.Voxel.active() && G.state !== 'loading';
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

    if (G.state === 'loading') { drawLoading(); return; }
    if (G.state === 'title') { drawTitle(overlayOnly); drawHud(); NS.Save.draw(g); return; }

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

    /* the entrance cut owns the frame while it runs: its own letterbox and
       name plate replace the stage banner and the blinking warning */
    NS.Intro.draw(g);

    if (G.stageMsg > 0 && G.stageMsg % 30 < 20 && !NS.Intro.active) {
      centerText(stageName(), 74, '#ffd7e6');
      centerText('STAGE ' + G.stage, 60, '#8fd0ff');
    }
    if (G.bossWarn > 0 && !NS.Intro.active && (G.bossWarn >> 3) % 2 === 0) {
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
    if (G.state === 'paused') drawPause();
    if (G.state === 'continue') {
      g.fillStyle = 'rgba(0,0,0,0.72)';
      g.fillRect(0, 0, NS.W, NS.PLAYFIELD_H);
      centerText('CONTINUE?', 58, '#ffffff', '11px');
      centerText(String(Math.max(0, Math.ceil(G.continueT / NS.FPS))), 82, '#ff8080', '16px');
      drawMenu(['YES — RESTART STAGE ' + G.stage, 'NO — END RUN'], 112,
               ['#8fd0ff', '#ff8080'], G.continueIndex);
      centerText('CONTINUES LEFT  ' + G.continues, 154, '#ffe9a0');
      centerText('SCORE AND POWER-UPS RESET', 170, '#5f6c86');
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
    /* above the HUD and clear of the boss bar, so it never lands on top of
       anything else the player is reading */
    NS.Save.draw(g);
  }

  /* ---- loading screen -------------------------------------------------- */
  function drawLoading() {
    g.fillStyle = '#05060a';
    g.fillRect(0, 0, NS.W, NS.H);

    centerText(NS.THEME.title, 74, '#ffffff', '12px');
    centerText(NS.THEME.subtitle, 90, '#ff9ec0');

    var pct = bootProgress();
    var barW = 148, barX = (NS.W - barW) / 2, barY = 116;
    g.fillStyle = '#151a26';
    g.fillRect(barX, barY, barW, 6);
    g.fillStyle = '#2a3450';
    g.fillRect(barX, barY, barW, 1);
    g.fillStyle = '#4fb0ff';
    g.fillRect(barX + 1, barY + 1, Math.round((barW - 2) * pct), 4);
    /* a moving highlight on the filled part, so a step that takes a while
       still looks like it is working rather than wedged */
    if (pct > 0.02) {
      var head = barX + 1 + Math.round((barW - 2) * pct);
      g.fillStyle = ((G.frame >> 2) & 1) ? '#eaf6ff' : '#9fe8ff';
      g.fillRect(head - 2, barY + 1, 2, 4);
    }

    centerText(bootLabel(), 132, '#8fd0ff');
    centerText(Math.round(pct * 100) + '%', 144, '#5f6c86');
  }

  /* ---- pause menu ------------------------------------------------------ */
  function drawPause() {
    g.fillStyle = 'rgba(0,0,0,0.72)';
    g.fillRect(0, 0, NS.W, NS.PLAYFIELD_H);

    if (pause.submenu === 'options') {
      drawOptions('OPTIONS', pause.optionIndex, 42);
      centerText('ARROWS ADJUST    Z SELECT    P RESUME', 166, '#5f6c86');
      return;
    }

    if (pause.confirm) {
      centerText('ARE YOU SURE?', 52, '#ff7676');
      var lines = pause.confirm.lines;
      centerText(lines[0].replace('%S', String(G.stage)), 70, '#ffffff', '8px');
      centerText(lines[1], 86, '#c8d2e8');
      if (lines[2]) centerText(lines[2], 96, '#7f8aa3');
      drawMenu(['CANCEL', 'YES, DO IT'], 116, ['#8fd0ff', '#ff8080'], pause.index);
      centerText('THIS CANNOT BE UNDONE', 154, '#5f6c86');
      return;
    }

    centerText('PAUSED', 56, '#ffffff', '10px');
    centerText('STAGE ' + G.stage + '  —  ' + stageName(), 72, '#7f8aa3');
    drawMenu(PAUSE_ITEMS.map(function (i) { return i.label; }), 90, null, pause.index);
    centerText('ARROWS CHOOSE    Z SELECT    P RESUME', 158, '#5f6c86');
  }

  /* Shared list rendering for both menu levels: the selection marker, the
     colour and the blink all come from one place so the confirmation cannot
     end up looking like a different control scheme than the menu above it. */
  function drawMenu(labels, top, colors, selected) {
    for (var i = 0; i < labels.length; i++) {
      var on = selected === i;
      var y = top + i * 14;
      var color = colors ? colors[i] : '#c8d2e8';
      if (on) {
        g.fillStyle = 'rgba(80,120,200,0.30)';
        g.fillRect(48, y - 8, NS.W - 96, 12);
        centerText('▶ ' + labels[i] + ' ◀', y,
                   ((G.frame >> 2) & 1) ? '#ffffff' : color, '8px');
      } else {
        centerText(labels[i], y, color === '#ff8080' ? '#8a5560' : '#6f7d99', '8px');
      }
    }
  }

  function optionValue(index) {
    if (index === 0) return String(G.settings.startingLives);
    if (index === 1) return G.settings.wallDamage ? 'ON' : 'OFF';
    if (index === 2) return G.settings.master + '%';
    if (index === 3) return G.settings.music + '%';
    if (index === 4) return G.settings.sfx + '%';
    if (index === 5) return G.settings.reducedFlash ? 'ON' : 'OFF';
    return '';
  }

  function drawOptions(heading, selected, top) {
    centerText(heading, top, '#ffffff', '10px');
    for (var i = 0; i < OPTION_NAMES.length; i++) {
      var y = top + 22 + i * 13;
      var label = OPTION_NAMES[i];
      if (i < OPTION_NAMES.length - 1) label += '  < ' + optionValue(i) + ' >';
      var on = selected === i;
      if (on) {
        g.fillStyle = 'rgba(80,120,200,0.30)';
        g.fillRect(43, y - 8, NS.W - 86, 12);
      }
      centerText((on ? '▶ ' : '') + label + (on ? ' ◀' : ''), y,
                 on ? (((G.frame >> 2) & 1) ? '#ffffff' : '#8fd0ff') : '#6f7d99', '7px');
    }
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

    g.fillStyle = 'rgba(0,0,0,0.58)';
    g.fillRect(0, 34, NS.W, 168);

    centerText(NS.THEME.title, 52, '#ffffff', '12px');
    centerText(NS.THEME.subtitle, 68, '#ff9ec0');

    if (title.screen === 'options') {
      drawOptions('OPTIONS', title.optionIndex, 76);
      centerText('ARROWS ADJUST    Z SELECT', 198, '#5f6c86');
    } else if (title.screen === 'stages') {
      centerText('STAGE SELECT  —  FURTHEST ' + G.furthestStage, 84, '#8fd0ff');
      for (var i = 0; i < 6; i++) {
        var unlocked = i + 1 <= G.furthestStage;
        var selected = title.stageIndex === i;
        var name = unlocked ? NS.THEME['stage' + (i + 1) + 'Name'] : 'LOCKED';
        var label = (i + 1) + '  ' + name;
        if (selected) {
          g.fillStyle = 'rgba(80,120,200,0.30)';
          g.fillRect(43, 91 + i * 14, NS.W - 86, 12);
        }
        centerText((selected ? '▶ ' : '') + label + (selected ? ' ◀' : ''), 99 + i * 14,
                   selected ? (unlocked ? '#ffffff' : '#ff8080') : (unlocked ? '#8fa4c8' : '#4c5363'), '7px');
      }
      var backOn = title.stageIndex === 6;
      centerText((backOn ? '▶ ' : '') + 'BACK' + (backOn ? ' ◀' : ''), 184,
                 backOn ? '#ffffff' : '#6f7d99', '8px');
    } else {
      centerText('A LIFE FORCE STYLE CAMPAIGN', 82, '#6f7f9c');
      drawMenu(['START GAME', 'STAGE SELECT', 'OPTIONS'], 108, null, title.index);
      centerText('Z FIRE    X POWER-UP    ARROWS MOVE', 158, '#5f6c86');
      centerText('M  —  FIRE MODE: ' + NS.Gunner.label(), 172,
                 NS.Gunner.mode === 'manual' ? '#5f6c86' : '#9fe8ff');
      centerText('HI ' + pad(G.hiScore, 7), 188, '#ffe9a0');
    }

    if (!overlayOnly && title.screen === 'main') {
      g.drawImage(NS.S.ship, 26, 100 + Math.sin(G.frame * 0.05) * 4);
      g.drawImage(NS.S.flame[(G.frame >> 2) & 1], 21, 104 + Math.sin(G.frame * 0.05) * 4);
    }
  }

  /* ---- HUD ------------------------------------------------------------
     Three columns across 256px, sized so none of them can reach into the
     next. The meter used to be laid out from a fixed left margin at 27px a
     slot, which ran it to x=224 — straight through the right-hand stats
     block, whose longest form ("SP4 M3 OP2 AUTO") starts at x=199. Both
     ends are now derived from the same constants, so widening one column
     cannot silently overlap another.

       score/hi    3 .. 40      power meter   MET_X .. MET_X+MET_W
       stats/lives right-aligned to NS.W-3, never left of STAT_X          */
  var MET_X = 44, MET_PITCH = 29;
  var MET_W = MET_PITCH * NS.Player.SLOTS.length;
  var STAT_X = MET_X + MET_W + 4;

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
    g.fillText('HI' + pad(G.hiScore, 7), 3, y + 14);

    /* power meter */
    var slots = NS.Player.SLOTS;
    for (var i = 0; i < slots.length; i++) {
      var sx = MET_X + i * MET_PITCH;
      var on = G.player && G.player.sel === i + 1;
      /* the player owns the mapping from slot to power-up; the HUD used to
         re-derive it from hardcoded indices, which quietly pointed every
         test at the wrong power-up the moment a slot was added or removed */
      var state = G.player ? G.player.slotState(i) : 'empty';
      var maxed = state === 'max';
      var owned = maxed || state === 'owned';
      /* a maxed power-up gets its own amber, so "I have this" and "this is
         as good as it gets" are not the same colour */
      g.fillStyle = on ? ((G.frame >> 2) % 2 ? '#ff5a5a' : '#ffa0a0')
                       : (maxed ? '#6a4a12' : (owned ? '#1c3a5c' : '#151a26'));
      g.fillRect(sx, y + 3, MET_PITCH - 2, 10);
      g.strokeStyle = on ? '#ffd0d0' : (maxed ? '#ffca3a' : '#2a3450');
      g.lineWidth = 1;
      g.strokeRect(sx + 0.5, y + 3.5, MET_PITCH - 3, 9);
      /* the labels are set a size down: MISSILE is seven characters and does
         not fit a 22px cell at 6px, so at 6px it bled across the divider */
      g.font = '5px monospace';
      g.textAlign = 'center';
      g.fillStyle = on ? '#ffffff' : (maxed ? '#ffe9a0' : (owned ? '#8fd0ff' : '#4b5673'));
      g.fillText(slots[i], sx + (MET_PITCH - 2) / 2, y + 10);
      g.textAlign = 'left';
      g.font = '6px monospace';
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
      /* a long extra-life run would otherwise grow the row of ships back
         into the meter, so past four it becomes a count */
      var lives = Math.max(0, G.player.lives);
      var l = '';
      if (lives <= 4) { for (var k = 0; k < lives; k++) l += '▲'; }
      else l = '▲x' + lives;
      g.fillText(l, NS.W - 3, y + 14);
    }
    g.textAlign = 'left';

    /* boss life bar sits just above the HUD while the boss is alive, and
       stays out of the way until the entrance cut has finished */
    if (G.boss && G.boss.state !== 'dying' &&
        !(NS.Intro && NS.Intro.active)) {
      var pct = NS.clamp(G.boss.hp / G.boss.maxHp, 0, 1);
      var bw = 136, bx = (NS.W - bw) / 2;
      g.fillStyle = '#3a0d18';
      g.fillRect(bx, y - 7, bw, 5);
      g.fillStyle = pct > 0.45 ? '#ff5a7a' : '#ffca3a';
      g.fillRect(bx + 1, y - 6, Math.round((bw - 2) * pct), 3);
      g.fillStyle = '#ffb0b0';
      g.font = '5px monospace';
      g.textAlign = 'right';
      g.fillText(G.bossName || bossName(), bx - 3, y - 3);
      g.textAlign = 'left';
      g.font = '6px monospace';
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
