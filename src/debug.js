/* debug.js — concealed QA console.
   Type "userspacechakra", then press tilde/backquote. After unlocking,
   backquote toggles the panel for the rest of the page session. */
(function (NS) {
  'use strict';

  var D = {};
  NS.Debug = D;
  D.unlocked = false;
  D.open = false;
  D.paused = false;
  D.stepping = false;
  D.invincible = false;
  D.hitboxes = false;
  D.noclip = false;
  D.freezeScroll = false;
  D.timeScale = 1;
  var phrase = 'userspacechakra', typed = '';
  var panel = null, telemetry = null;

  function el(tag, text, cls) {
    var n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }

  function button(label, action) {
    var b = el('button', label);
    b.type = 'button'; b.dataset.action = action;
    return b;
  }

  function section(title, items) {
    var box = el('section'); box.appendChild(el('h3', title));
    var grid = el('div', null, 'dbg-grid');
    for (var i = 0; i < items.length; i++) grid.appendChild(items[i]);
    box.appendChild(grid); return box;
  }

  function build() {
    var style = el('style');
    style.textContent =
      '#ns-debug{position:fixed;inset:4vh 4vw;z-index:10000;background:rgba(5,9,18,.96);'+
      'border:2px solid #62cfff;box-shadow:0 0 32px #157aaa;color:#d9f3ff;padding:14px;'+
      'font:14px/1.25 Consolas,monospace;overflow:auto;display:none;text-align:left}'+
      '#ns-debug.open{display:block}#ns-debug h2{margin:0 0 4px;color:#fff;font-size:20px}'+
      '#ns-debug .sub{color:#78a9c5;margin-bottom:12px}#ns-debug .cols{display:grid;'+
      'grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:10px}'+
      '#ns-debug section{border:1px solid #294c66;background:#0a1422;padding:8px}'+
      '#ns-debug h3{font-size:13px;color:#76d9ff;margin:0 0 7px}'+
      '#ns-debug .dbg-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px}'+
      '#ns-debug button{font:12px Consolas,monospace;color:#dff7ff;background:#17314a;'+
      'border:1px solid #42769a;padding:7px 5px;cursor:pointer}'+
      '#ns-debug button:hover,#ns-debug button.on{background:#17638a;border-color:#8de6ff}'+
      '#ns-debug pre{white-space:pre-wrap;margin:0;color:#b8d3e5;font-size:12px}'+
      '#ns-debug .wide{grid-column:1/-1}';
    document.head.appendChild(style);

    panel = el('div'); panel.id = 'ns-debug'; panel.setAttribute('role', 'dialog');
    panel.appendChild(el('h2', 'ZOE FORCE QA CONSOLE'));
    panel.appendChild(el('div', 'TILDE closes · gameplay is frozen while this panel is open · ?debug=1 unlocks it', 'sub'));
    var cols = el('div', null, 'cols');
    cols.appendChild(section('STAGE / ENCOUNTER WARP', [
      button('Stage 1 Start', 'stage1'), button('Stage 1 Mid', 'stage1mid'),
      button('Golem', 'golem'), button('Stage 2 Start', 'stage2'),
      button('Volcano Route', 'volcano'), button('Rock Storm', 'rocks'),
      button('Valis Fortress', 'fortress'), button('Core Passage', 'passage'),
      button('Tetran', 'tetran'), button('Stage 3', 'stage3'),
      button('Intruder', 'boss3'), button('Stage 4', 'stage4'),
      button('Giga', 'boss4'), button('Stage 5', 'stage5'),
      button('Triple Core', 'mini5'), button('Tutanhamanattack', 'boss5'),
      button('Stage 6', 'stage6'), button('Zelos Force', 'boss6')
    ]));
    cols.appendChild(section('PLAYER', [
      button('Invincible: OFF', 'invincible'), button('Center Ship', 'center'),
      button('+1 Life', 'life'), button('Full Loadout', 'loadout'),
      button('Clear Loadout', 'clearloadout'), button('+ Capsule', 'capsule'),
      button('+ Option', 'option'), button('Force Field', 'shield')
    ]));
    cols.appendChild(section('SIMULATION', [
      button('Resume / Close', 'resume'), button('Step 1 Frame', 'step1'),
      button('Step 60 Frames', 'step60'), button('Step 600 Frames', 'step600'),
      button('Clear Enemies', 'clearenemies'), button('Clear Bullets', 'clearbullets'),
      button('Damage Boss', 'damageboss'), button('Kill Encounter', 'killboss')
    ]));
    cols.appendChild(section('SHOWCASE / CAPTURE', [
      button('CPU Showcase: OFF', 'autoplay')
    ]));
    cols.appendChild(section('SOURCE TOOLS', [
      button('Time: 1x', 'timescale'), button('Freeze Scroll: OFF', 'freezescroll'),
      button('Noclip: OFF', 'noclip'), button('Unlock All Stages', 'unlockall'),
      button('Erase Active Profile', 'eraseprofile'), button('Lock Console', 'lock')
    ]));
    cols.appendChild(section('VIEW / INSPECTION', [
      button('Hitboxes: OFF', 'hitboxes'), button('Toggle 2D / Voxel', 'voxel'),
      button('Fullscreen', 'fullscreen'), button('Spawn Pickup', 'spawnpickup')
    ]));
    var status = section('LIVE TELEMETRY', []); telemetry = el('pre', 'Waiting for game…');
    status.querySelector('.dbg-grid').appendChild(telemetry); telemetry.className = 'wide';
    cols.appendChild(status); panel.appendChild(cols); document.body.appendChild(panel);
    panel.addEventListener('click', function (e) {
      var action = e.target && e.target.dataset && e.target.dataset.action;
      if (action) run(action);
    });
    setInterval(refresh, 150);
    if (NS.Save && NS.Save.read('ns_qa_unlock', '0') === '1') D.unlocked = true;
    try {
      if (new URLSearchParams(location.search).get('debug') === '1') grantUnlock();
    } catch (err) { /* non-browser hosts */ }
  }

  function grantUnlock() {
    if (D.unlocked) return;
    D.unlocked = true;
    if (NS.Save) NS.Save.write('ns_qa_unlock', '1', 'QA UNLOCK');
  }

  function toggle(force) {
    if (!D.unlocked || !panel) return;
    D.open = force == null ? !D.open : !!force;
    D.paused = D.open;
    panel.classList.toggle('open', D.open);
    refresh();
  }

  function resetStage1(at) {
    var G = NS.Game;
    G.player.reset(true); G.resetStage(true); G.state = 'play';
    G.scrollX = Math.max(0, at || 0); NS.Level1.seek(G.scrollX);
    var top = NS.Terrain.topAt(G.scrollX + G.player.x) + 7;
    var bot = NS.Terrain.botAt(G.scrollX + G.player.x) - 7;
    G.player.placeClear(G.player.x, (top + bot) * 0.5);
    G.player.invuln = 180; NS.Audio.prepareStage(1);
    NS.Audio.setTrack('stage'); NS.Audio.startMusic();
  }

  function stage2(where) {
    NS.Game.startStage2();
    NS.Level2.debugJump(where || 'start', NS.Game);
    NS.Game.player.placeClear(NS.Game.player.x, NS.Game.player.y);
    NS.Game.player.invuln = 180;
  }
  function later(stage,where){
    NS.Game.startStage(stage);
    NS.Campaign.debugJump(stage,where||'start',NS.Game);
    NS.Game.player.placeClear(NS.Game.player.x, NS.Game.player.y);
    NS.Game.player.invuln=180;
  }

  function step(n) {
    D.stepping = true; NS.Game.step(n); D.stepping = false; refresh();
  }

  function fullLoadout(p) {
    p.speedLv = 3; p.missileLv = 3; p.missile = true; p.weapon = 'laser';
    p.shield = p.shieldMax; p.sel = 0;
    while (p.options.length < NS.Player.MAX_OPTIONS) p.recoverOption();
  }

  function run(a) {
    var G = NS.Game, p = G.player, i;
    switch (a) {
      case 'stage1': resetStage1(0); break;
      case 'stage1mid': resetStage1(4700); break;
      case 'golem': resetStage1(NS.Terrain.BOSS_X - 2); break;
      case 'stage2': stage2('start'); break;
      case 'volcano': stage2('volcano'); break;
      case 'rocks': stage2('rocks'); break;
      case 'fortress': stage2('fortress'); break;
      case 'passage': stage2('passage'); break;
      case 'tetran': stage2('tetran'); break;
      case 'stage3': later(3); break; case 'boss3': later(3,'boss'); break;
      case 'stage4': later(4); break; case 'boss4': later(4,'boss'); break;
      case 'stage5': later(5); break; case 'boss5': later(5,'boss'); break;
      case 'mini5': later(5,'mid'); NS.Campaign.scroll=NS.Campaign.spec.miniAt; NS.Campaign.update(G); break;
      case 'stage6': later(6); break; case 'boss6': later(6,'boss'); break;
      case 'invincible': D.invincible = !D.invincible; break;
      case 'center': p.placeClear(NS.W / 2, NS.PLAYFIELD_H / 2); break;
      case 'life': p.lives++; break;
      case 'loadout': fullLoadout(p); break;
      case 'clearloadout': p.speedLv=0;p.missileLv=0;p.missile=false;p.weapon='normal';p.options=[];p.shield=0;p.sel=0; break;
      case 'capsule': p.giveCapsule(); break;
      case 'option': p.recoverOption(); break;
      case 'shield': p.shield = p.shieldMax; break;
      case 'resume': toggle(false); break;
      case 'step1': step(1); break;
      case 'step60': step(60); break;
      case 'step600': step(600); break;
      case 'autoplay':
        if (NS.Autoplay.active()) NS.Autoplay.stop();
        else { D.noclip = false; NS.Autoplay.start(G); toggle(false); return; }
        break;
      case 'timescale':
        D.timeScale = D.timeScale === 1 ? 2 : (D.timeScale === 2 ? 4 : 1); break;
      case 'freezescroll': D.freezeScroll = !D.freezeScroll; break;
      case 'noclip': D.noclip = !D.noclip; break;
      case 'unlockall':
        NS.Profile.debugUnlockAll(); G.furthestStage = 6; break;
      case 'eraseprofile':
        NS.Profile.erase(NS.Profile.activeSlot()); G.loadProfile(); break;
      case 'lock':
        D.unlocked = false; D.open = false; D.paused = false; D.noclip = false;
        if (NS.Save) NS.Save.write('ns_qa_unlock', '0', 'QA LOCKED');
        panel.classList.remove('open'); return;
      case 'clearenemies':
        if (G.stage >= 3) for(i=0;i<NS.Campaign.enemies.length;i++) NS.Campaign.enemies[i].dead=true;
        else if (G.stage === 2) for(i=0;i<NS.Level2.enemies.length;i++) NS.Level2.enemies[i].dead=true;
        else for(i=0;i<NS.Enemies.list.length;i++) NS.Enemies.list[i].dead=true;
        break;
      case 'clearbullets': NS.Weapons.enemy.length=0; if(NS.Level2){NS.Level2.enemyShots.length=0;NS.Level2.rocks.length=0;if(NS.Level2.fortress)NS.Level2.fortress.balls.length=0;}if(NS.Campaign)NS.Campaign.enemyShots.length=0; break;
      case 'damageboss': damageBoss(false); break;
      case 'killboss': damageBoss(true); break;
      case 'hitboxes': D.hitboxes = !D.hitboxes; break;
      case 'voxel': NS.Voxel.toggle(function(){ NS.Game.resize(); }); break;
      case 'fullscreen': G.requestFullscreen(); break;
      case 'spawnpickup':
        if(G.stage>=3)NS.Campaign.pickups.push({x:p.x,y:p.y-28,t:0,dead:false});
        else if(G.stage===2) NS.Level2.pickups.push({x:p.x,y:p.y-28,t:0,dead:false});
        else G.spawnCapsule(p.x+24,p.y); break;
    }
    refresh();
  }

  function damageBoss(kill) {
    var G=NS.Game, b=G.boss;
    if (!b) return;
    if(G.stage>=3){
      if(NS.Campaign.mini&&b===NS.Campaign.mini){for(var ci=0;ci<b.cores.length;ci++)b.cores[ci].hp=kill?0:Math.max(0,b.cores[ci].hp-12);}
      else if(G.stage===6&&b.form==='dragon'){if(kill){b.dragonHp=0;b.form='heart';}else b.dragonHp=Math.max(1,b.dragonHp-30);}
      else if(kill){b.hp=0;b.dead=true;b.state='dying';b.dying=G.stage===6?420:150;
        if(G.stage===6){NS.Campaign.phase='ending';NS.Campaign.ending=true;NS.Campaign.escapeT=0;NS.Campaign.escapeBars=[];}}
      else b.hp=Math.max(1,b.hp-30);
    } else if (G.stage===2 && NS.Level2.fortress && b===NS.Level2.fortress) {
      for(var i=0;i<b.cores.length;i++) if(!b.cores[i].dead){
        if(kill){b.cores[i].shield=0;b.cores[i].hp=0;b.cores[i].dead=true;}
        else if(b.cores[i].shield>0)b.cores[i].shield=Math.max(0,b.cores[i].shield-12);else b.cores[i].hp=Math.max(1,b.cores[i].hp-12);
      }
    } else if (G.stage===2 && NS.Level2.boss===b) {
      if(kill){b.shield=0;b.shields=[0,0,0];b.hp=0;b.dead=true;b.dying=150;}
      else if(b.shield>0){b.shields[b.shield-1]=0;b.shield--;}else b.hp=Math.max(1,b.hp-30);
    } else if (kill) { b.hp=0; b.dead=true; }
    else b.hp=Math.max(1,b.hp-20);
  }

  function refresh() {
    if (!panel || !D.open || !NS.Game || !NS.Game.player) return;
    var G=NS.Game,p=G.player,L=NS.Level2;
    var enemies=G.stage>=3?NS.Campaign.enemies.filter(function(e){return !e.dead;}).length:(G.stage===2?L.enemies.filter(function(e){return !e.dead;}).length:NS.Enemies.list.length);
    var shots=G.stage>=3?NS.Campaign.shots.length+NS.Campaign.enemyShots.length:(G.stage===2?L.shots.length+L.enemyShots.length+L.rocks.length:NS.Weapons.player.length+NS.Weapons.enemy.length);
    var progress = G.stage >= 3 ? NS.Campaign.scroll / NS.Campaign.spec.length
      : (G.stage === 2 ? L.scrollY / L.LENGTH : G.scrollX / NS.Terrain.BOSS_X);
    var music = NS.Audio.stageMusic ? NS.Audio.stageMusic() : null;
    telemetry.textContent='STATE  '+G.state+'    STAGE  '+G.stage+'    FRAME  '+G.frame+'    '+Math.round(progress*100)+'%\n'+
      'SCROLL '+(G.stage>=3?NS.Campaign.scroll.toFixed(1):(G.stage===2?L.scrollY.toFixed(1):G.scrollX.toFixed(1)))+'    PHASE  '+(G.stage>=3?NS.Campaign.phase:(G.stage===2?L.phase:'corridor'))+'\n'+
      'SHIP   '+p.x.toFixed(1)+', '+p.y.toFixed(1)+'    LIVES '+p.lives+'    SCORE '+p.score+'\n'+
      'NEXT 1UP '+p.nextLifeScore+'    FURTHEST '+G.furthestStage+'\n'+
      'TIME '+D.timeScale+'x    SCROLL '+(D.freezeScroll?'FROZEN':'RUN')+'    NOCLIP '+(D.noclip?'ON':'OFF')+'    INVINCIBLE '+(D.invincible?'ON':'OFF')+'\n'+
      'MUSIC  '+(music?'key '+(music.semi>0?'+':'')+music.semi+'  rate '+music.rate:'')+'\n'+
      'ENEMIES '+enemies+'    PROJECTILES/ROCKS '+shots+'    BOSS '+(G.boss?'YES':'NO');
    var buttons=panel.querySelectorAll('button');
    for(var i=0;i<buttons.length;i++){
      var a=buttons[i].dataset.action;
      if(a==='invincible'){buttons[i].textContent='Invincible: '+(D.invincible?'ON':'OFF');buttons[i].classList.toggle('on',D.invincible);}
      if(a==='hitboxes'){buttons[i].textContent='Hitboxes: '+(D.hitboxes?'ON':'OFF');buttons[i].classList.toggle('on',D.hitboxes);}
      if(a==='noclip'){buttons[i].textContent='Noclip: '+(D.noclip?'ON':'OFF');buttons[i].classList.toggle('on',D.noclip);}
      if(a==='freezescroll'){buttons[i].textContent='Freeze Scroll: '+(D.freezeScroll?'ON':'OFF');buttons[i].classList.toggle('on',D.freezeScroll);}
      if(a==='timescale'){buttons[i].textContent='Time: '+D.timeScale+'x';buttons[i].classList.toggle('on',D.timeScale!==1);}
      if(a==='autoplay'){
        var cpu=NS.Autoplay&&NS.Autoplay.active();
        buttons[i].textContent='CPU Showcase: '+(cpu?'ON':'OFF');
        buttons[i].classList.toggle('on',cpu);
      }
    }
  }

  D.draw = function (g, G) {
    if (!D.hitboxes || !G.player) return;
    g.save(); g.lineWidth=1;
    function box(x,y,w,h,c){g.strokeStyle=c;g.strokeRect((x|0)+.5,(y|0)+.5,w|0,h|0);}
    var p=G.player; box(p.x-p.w/2,p.y-p.h/2,p.w,p.h,'#3dff78');
    if(G.stage===1){
      g.strokeStyle='#7ecbff'; g.beginPath();
      for(var tx=0;tx<=NS.W;tx+=4){
        var top=NS.Terrain.topAt(G.scrollX+tx), bot=NS.Terrain.botAt(G.scrollX+tx);
        if(tx===0)g.moveTo(tx,top); else g.lineTo(tx,top);
      }
      g.moveTo(0,NS.Terrain.botAt(G.scrollX));
      for(tx=0;tx<=NS.W;tx+=4){bot=NS.Terrain.botAt(G.scrollX+tx); if(tx===0)g.moveTo(tx,bot); else g.lineTo(tx,bot);}
      g.stroke();
      for(var i=0;i<NS.Enemies.list.length;i++){var e=NS.Enemies.list[i];if(!e.dead)box(e.x,e.y,e.w,e.h,'#ff5252');}
      NS.Enemies.eachHazard(function(x,y,w,h){box(x,y,w,h,'#ff8c42');});
      for(i=0;i<NS.Weapons.player.length;i++){var s=NS.Weapons.player[i];if(!s.dead){var r=NS.Weapons.rectOf(s);box(r.x,r.y,r.w,r.h,'#ffe34d');}}
      for(i=0;i<NS.Weapons.enemy.length;i++){var es=NS.Weapons.enemy[i];if(!es.dead)box(es.x,es.y,4,4,'#ff9ad8');}
      if(G.boss&&G.boss.eachHazard)G.boss.eachHazard(function(x,y,w,h){box(x,y,w,h,'#ff8c42');});
    }else if(G.stage===2){
      g.strokeStyle='#7ecbff'; g.beginPath();
      for(var ty=0;ty<=NS.PLAYFIELD_H;ty+=4){
        var edge=NS.Level2.edgesAt(NS.Level2.scrollY+NS.PLAYFIELD_H-ty);
        if(ty===0)g.moveTo(edge.left,ty); else g.lineTo(edge.left,ty);
      }
      g.moveTo(NS.W-NS.Level2.edgesAt(NS.Level2.scrollY+NS.PLAYFIELD_H).right,0);
      for(ty=0;ty<=NS.PLAYFIELD_H;ty+=4){
        edge=NS.Level2.edgesAt(NS.Level2.scrollY+NS.PLAYFIELD_H-ty);
        var rx=NS.W-edge.right; if(ty===0)g.moveTo(rx,ty); else g.lineTo(rx,ty);
      }
      g.stroke();
      for(i=0;i<NS.Level2.enemies.length;i++){e=NS.Level2.enemies[i];if(!e.dead&&e.active)box(e.x-e.w/2,e.y-e.h/2,e.w,e.h,'#ff5252');}
      for(i=0;i<NS.Level2.shots.length;i++){s=NS.Level2.shots[i];box(s.x,s.y,s.w,s.h,'#ffe34d');}
      for(i=0;i<NS.Level2.enemyShots.length;i++){es=NS.Level2.enemyShots[i];if(!es.dead)box(es.x-2,es.y-2,4,4,'#ff9ad8');}
      for(i=0;i<NS.Level2.rocks.length;i++){var rock=NS.Level2.rocks[i];if(!rock.dead)box(rock.x-4,rock.y-4,8,8,'#ff9ad8');}
      for(i=0;i<NS.Level2.gates.length;i++){var gt=NS.Level2.gates[i];for(var j=0;j<gt.cells.length;j++){var c=gt.cells[j];if(!c.dead)box(c.x,gt.y-7,c.w,14,'#ff8c42');}}
      for(i=0;i<NS.Level2.islands.length;i++){var isle=NS.Level2.islands[i],iy=NS.Level2.screenY(isle.wy);box(isle.x-isle.rx,iy-isle.ry,isle.rx*2,isle.ry*2,'#ff8c42');}
      for(i=0;i<NS.Level2.volcanoes.length;i++){var vol=NS.Level2.volcanoes[i];if(!vol.dead)box(vol.x-11,vol.y-10,22,20,'#ff8c42');}
      if(NS.Level2.fortress){for(i=0;i<NS.Level2.fortress.balls.length;i++){var ball=NS.Level2.fortress.balls[i];if(!ball.dead)box(ball.x-5,ball.y-5,10,10,'#ff9ad8');}}
    }else{
      var C=NS.Campaign, horizontal=C.horizontal();
      g.strokeStyle='#7ecbff'; g.beginPath();
      if(horizontal){
        for(tx=0;tx<=NS.W;tx+=4){var bd=C.bounds(C.scroll+tx); if(tx===0)g.moveTo(tx,bd.a); else g.lineTo(tx,bd.a);}
        g.moveTo(0,C.bounds(C.scroll).z);
        for(tx=0;tx<=NS.W;tx+=4){bd=C.bounds(C.scroll+tx); if(tx===0)g.moveTo(tx,bd.z); else g.lineTo(tx,bd.z);}
      }else{
        for(ty=0;ty<=NS.PLAYFIELD_H;ty+=4){bd=C.bounds(C.scroll+NS.PLAYFIELD_H-ty); if(ty===0)g.moveTo(bd.a,ty); else g.lineTo(bd.a,ty);}
        g.moveTo(C.bounds(C.scroll+NS.PLAYFIELD_H).z,0);
        for(ty=0;ty<=NS.PLAYFIELD_H;ty+=4){bd=C.bounds(C.scroll+NS.PLAYFIELD_H-ty); if(ty===0)g.moveTo(bd.z,ty); else g.lineTo(bd.z,ty);}
      }
      g.stroke();
      for(i=0;i<C.enemies.length;i++){e=C.enemies[i];if(!e.dead&&e.active)box(e.x-e.w/2,e.y-e.h/2,e.w,e.h,'#ff5252');}
      for(i=0;i<C.shots.length;i++){s=C.shots[i];box(s.x,s.y,s.w,s.h,'#ffe34d');}
      for(i=0;i<C.enemyShots.length;i++){es=C.enemyShots[i];if(!es.dead)box(es.x-2,es.y-2,5,5,'#ff9ad8');}
      for(i=0;i<C.barriers.length;i++){var wall=C.barriers[i], wx=C.barrierScreenX(wall);
        for(j=0;j<wall.cells.length;j++){c=wall.cells[j];if(!c.dead)box(wx,c.y,wall.w,c.h,'#ff8c42');}}
      for(i=0;i<C.hazards.length;i++){
        var hz=C.hazards[i], reach=C.hazardReach(hz);
        var along=horizontal?hz.world-C.scroll:NS.PLAYFIELD_H-(hz.world-C.scroll);
        if(horizontal){if(hz.side==='top')box(along-7,0,14,reach,'#ffb15a'); else box(along-7,NS.PLAYFIELD_H-reach,14,reach,'#ffb15a');}
        else if(hz.side==='left')box(0,along-7,reach,14,'#ffb15a'); else box(NS.W-reach,along-7,reach,14,'#ffb15a');
      }
      for(i=0;i<C.escapeBars.length;i++){var bar=C.escapeBars[i];
        if(bar.side==='left')box(0,bar.y,bar.w,bar.h||12,'#ff8c42'); else box(NS.W-bar.w,bar.y,bar.w,bar.h||12,'#ff8c42');}
      if(C.phase==='ending'){g.strokeStyle='#ff5a7a';g.strokeRect(C.escapeInset+0.5,0.5,NS.W-C.escapeInset*2-1,C.escapeFloor-1);}
    }
    g.restore();
  };

  window.addEventListener('keydown', function (e) {
    if (e.code === 'Backquote') {
      if (!D.unlocked && typed.slice(-phrase.length) === phrase) grantUnlock();
      if (D.unlocked) { e.preventDefault(); e.stopImmediatePropagation(); toggle(); }
      typed=''; return;
    }
    if (!D.unlocked && e.key && e.key.length===1 && /[a-z]/i.test(e.key)) {
      typed=(typed+e.key.toLowerCase()).slice(-phrase.length);
    }
    if(D.open && e.code==='Escape'){e.preventDefault();toggle(false);}
  }, true);

  window.addEventListener('load', build);
})(NS);
