/* campaign.js — deterministic Stages 3–6.
   These stages share one simulation because Life Force alternates the camera,
   not its fundamental rules: complete-set power rows, continuous scrolling,
   same-run respawns, terrain hazards, a weak-point boss, then departure. */
(function (NS) {
  'use strict';
  var C = {}; NS.Campaign = C;

  var SPEC = {
    3: { orientation:'side', length:7600, name:'stage3Name', boss:'boss3Name', theme:'fire' },
    4: { orientation:'vertical', length:7900, name:'stage4Name', boss:'boss4Name', theme:'cell' },
    5: { orientation:'side', length:9400, name:'stage5Name', boss:'boss5Name', theme:'temple', miniAt:5200 },
    6: { orientation:'vertical', length:8600, name:'stage6Name', boss:'boss6Name', theme:'machine' }
  };
  C.SPEC = SPEC;
  C.stage=3; C.spec=SPEC[3]; C.scroll=0; C.t=0; C.phase='flight';
  C.enemies=[]; C.shots=[]; C.enemyShots=[]; C.pickups=[]; C.hazards=[];
  C.groups={}; C.boss=null; C.mini=null; C.complete=false; C.ending=false;
  C.escapeBars=[]; C.escapeT=0;
  var uid=1, gid=1;

  function horizontal(){ return C.spec.orientation==='side'; }
  C.horizontal=horizontal;
  function mainScreen(world){ return horizontal()?world-C.scroll:NS.PLAYFIELD_H-(world-C.scroll); }
  function point(e){ return horizontal()?{x:mainScreen(e.world),y:e.lane}:{x:e.lane,y:mainScreen(e.world)}; }
  C.point=point;

  function groupWave(world,lane,count,reward,mirror,kind){
    var id=gid++, g={id:id,total:count,killed:0,paid:false,reward:reward||''}; C.groups[id]=g;
    for(var i=0;i<count;i++) C.enemies.push({id:uid++,kind:kind||'flier',group:id,slot:i,
      world:world+i*15,lane:lane,baseLane:lane,mirror:mirror||1,hp:1,w:9,h:7,t:0,dead:false,active:false,bonus:!!reward});
  }
  function addEnemy(kind,world,lane,hp,bonus){ C.enemies.push({id:uid++,kind:kind,world:world,lane:lane,baseLane:lane,
    hp:hp||2,w:kind==='dragon'?24:10,h:kind==='dragon'?12:9,t:0,dead:false,active:false,bonus:!!bonus}); }
  function hazard(type,world,side,opt){ opt=opt||{}; C.hazards.push({id:uid++,type:type,world:world,side:side,t:opt.offset||0,
    period:opt.period||150,span:opt.span||70,dead:false}); }

  function build3(){
    for(var w=0;w<6;w++) groupWave(320+w*330,w%2?52:145,5,'capsule',w%2?1:-1,'phoenix');
    for(var x=2450,n=0;x<7100;x+=330,n++){
      hazard('prominence',x,n%2?'top':'bottom',{period:n===5||n===10?82:150,span:n===5||n===10?112:68,offset:n*19});
      if(n%2===0)addEnemy('phoenix',x+145,n%4<2?48:154,1,n%4===0);
      if(n===4||n===11)addEnemy('dragon',x+90,104,16,true);
    }
  }
  function build4(){
    /* Low-entry rows bend right and high-entry rows bend left. These signs
       were reversed, so all 35 opening cells completed their turn outside
       the playfield before becoming visible. */
    for(var w=0;w<7;w++)groupWave(340+w*285,w%2?58:188,5,w<6?'capsule':'',w%2?1:-1,'cell');
    /* Capillary rush: two more authored rows are compressed by the faster
       scroll instead of being independently steered scatter enemies. */
    groupWave(2670,62,5,'capsule',1,'cell');
    groupWave(3180,190,5,'capsule',-1,'cell');
    for(var y=2450,n=0;y<7300;y+=260,n++){
      if(n<5)addEnemy('corpuscle',y,42+(n*47)%170,4,n===3);
      else if(n<11)addEnemy('lung',y,50+(n*61)%155,10,n%3===0);
      else {hazard(n%4===3?'web':'rib',y,n%2?'left':'right',{period:n%4===3?145:110,span:n%4===3?66:88,offset:n*13});
        if(n%3===0)addEnemy('nodule',y+90,n%2?46:208,7,n%6===0);}
    }
  }
  function build5(){
    /* Ten three-ship gold sets, presented as alternating upper/lower pairs. */
    for(var w=0;w<10;w++)groupWave(300+Math.floor(w/2)*420,w%2?142:58,3,'capsule',w%2?-1:1,'gold');
    for(var x=2600,n=0;x<9000;x+=310,n++){
      if(n%5===0)addEnemy('hatch',x,n%2?35:166,8,n%10===0);
      else if(n<9)addEnemy('rock',x,40+(n*43)%130,n%3===0?3:999,false);
      else {hazard('pillar',x,n%2?'top':'bottom',{period:125,span:72,offset:n*9});
        if(n%2===0)addEnemy('block',x+72,n%4?74:136,9,n%6===0);}
    }
  }
  function build6(){
    for(var w=0;w<12;w++)groupWave(300+w*245,w%2?190:66,5,w===2||w===7?'capsule':'',w%2?-1:1,w===2||w===7?'gold':'blue');
    for(w=0;w<5;w++)groupWave(3650+w*620,w%2?188:68,4,w===2?'capsule':'',w%2?-1:1,w===2?'gold':'blue');
    for(var y=3400,n=0;y<8200;y+=250,n++){
      if(n<7)addEnemy('crystal',y,35+(n*53)%185,5,n===4);
      else if(n<13)addEnemy('cannon',y,n%2?38:210,5,n%4===0);
      else addEnemy('moai',y,n%2?50:196,12,n%5===0);
      if(n%4===2)hazard(n>8?'cylinder':'burst',y+105,n%2?'left':'right',{period:120,span:n>8?78:60,offset:n*11});
    }
  }

  C.reset=function(stage,G){
    C.stage=stage;C.spec=SPEC[stage];C.scroll=0;C.t=0;C.phase='flight';C.complete=false;C.ending=false;
    C.spec.miniDone=false;
    C.enemies=[];C.shots=[];C.enemyShots=[];C.pickups=[];C.hazards=[];C.groups={};C.boss=null;C.mini=null;C.escapeBars=[];C.escapeT=0;uid=1;gid=1;
    if(stage===3)build3();else if(stage===4)build4();else if(stage===5)build5();else build6();
    if(G){G.boss=null;G.bossName='';}
  };

  function bounds(progress){
    var b={a:0,z:horizontal()?NS.PLAYFIELD_H:NS.W};
    if(C.stage===3){b.a=18+Math.sin(progress*.008)*4;b.z=NS.PLAYFIELD_H-18-Math.sin(progress*.006)*5;}
    else if(C.stage===4){var cap=progress>2200&&progress<3650?34+Math.sin(progress*.021)*18:14+Math.sin(progress*.006)*6;b.a=cap;b.z=NS.W-cap;}
    else if(C.stage===5){b.a=12+Math.max(0,Math.sin(progress*.004))*34;b.z=NS.PLAYFIELD_H-12-Math.max(0,Math.sin(progress*.005+2))*36;}
    else {b.a=18+Math.max(0,Math.sin(progress*.006))*22;b.z=NS.W-18-Math.max(0,Math.sin(progress*.007+1))*22;}
    return b;
  }
  C.bounds=bounds;

  /* Keep permanent corridor walls separate from animated hazards so the
     player's optional nonlethal-wall mode can slide along scenery without
     also making eruptions or the Stage 6 escape bars harmless. */
  C.hitsWall=function(p){
    if(C.phase==='boss'||C.phase==='ending')return false;
    var progress=C.scroll+(horizontal()?p.x:NS.PLAYFIELD_H-p.y),b=bounds(progress);
    if(horizontal())return p.y-p.h/2<b.a||p.y+p.h/2>b.z;
    return p.x-p.w/2<b.a||p.x+p.w/2>b.z;
  };

  C.hitsHazard=function(p){
    if(C.phase==='boss')return false;
    if(C.phase==='ending'){
      for(var eb=0;eb<C.escapeBars.length;eb++){var bar=C.escapeBars[eb];
        if(p.y+p.h/2>bar.y&&p.y-p.h/2<bar.y+12&&(bar.side==='left'?p.x-p.w/2<bar.w:p.x+p.w/2>NS.W-bar.w))return true;}
      return false;
    }
    for(var i=0;i<C.hazards.length;i++){
      var h=C.hazards[i],m=mainScreen(h.world);if(m<-30||m>(horizontal()?NS.W:NS.PLAYFIELD_H)+30)continue;
      var extent=hazardExtent(h);
      if(horizontal()){
        if(Math.abs(p.x-m)<7+p.w/2&&(h.side==='top'?p.y-p.h/2<extent:p.y+p.h/2>NS.PLAYFIELD_H-extent))return true;
      }else if(Math.abs(p.y-m)<7+p.h/2&&(h.side==='left'?p.x-p.w/2<extent:p.x+p.w/2>NS.W-extent))return true;
    }
    return false;
  };
  C.hitsPlayer=function(p){return C.hitsWall(p)||C.hitsHazard(p);};
  function hazardExtent(h){var q=(h.t%h.period)/h.period;var pulse=Math.sin(q*Math.PI);return Math.max(0,pulse)*h.span;}

  C.firePlayer=function(p){
    var vertical=!horizontal(),type=p.weapon,m=[],i;
    /* one beam at a time, as in stage 1 */
    if(type==='laser'&&NS.Weapons.laserLive(C.shots))return 4;
    m.push({x:p.x+(vertical?0:10),y:p.y-(vertical?9:0)});
    for(i=0;i<p.options.length;i++)m.push({x:p.options[i].x+(vertical?0:4),y:p.options[i].y-(vertical?5:0)});
    for(i=0;i<m.length;i++){
      /* the shared armament table, not a local description of it */
      var sh=NS.Weapons.makeShot(type,m[i].x,m[i].y,vertical?0:1,vertical?-1:0);
      sh.id=uid++;C.shots.push(sh);
    }
    if(p.missileLv){
      /* One weapon, four cameras: the missile always leaves at 45 degrees
         toward the two surfaces bounding the corridor and then runs along
         whichever it reaches — walls in the climbing stages, ceiling and
         floor in the side-on ones. It used to be a symmetric spread here,
         which read as a different gun entirely. */
      var salvo=NS.Weapons.missileFan(p,vertical);
      if(countMissiles()+salvo.length<=salvo.length*2){
        for(i=0;i<salvo.length;i++)launchMissile(salvo[i].x,salvo[i].y,salvo[i].wall,p.missileLv,salvo[i].lead);
        NS.Audio.sfx.missile();
      }
    }
    NS.Audio.sfx[type==='laser'?'laser':'shot']();return type==='laser'?9:6;
  };

  function countMissiles(){var n=0;for(var i=0;i<C.shots.length;i++)if(!C.shots[i].dead&&C.shots[i].type==='missile')n++;return n;}

  function launchMissile(x,y,wall,level,lead){
    var k=NS.Weapons.missileLaunch(level,lead);
    /* lateral-dominant for the same reason stage 2 is: the missile has to
       meet its surface while still on screen from any position the ship can
       hold. `lead` scales only the forward run, which strings the salvo out
       along the surface rather than stacking it on one track. */
    C.shots.push({id:uid++,x:x-2,y:y-2,w:5,h:5,dmg:2,pierce:false,hit:{},dead:false,type:'missile',
      vertical:!horizontal(),
      vx:horizontal()?k.forward:wall*k.lateral,
      vy:horizontal()?wall*k.lateral:-k.forward,
      accel:k.accel,crawlSpeed:k.crawl,wall:wall,crawling:false,anim:0});
  }

  /* Position of the surface this missile is bound for, in the axis it will
     eventually lock to: y for the side stages, x for the climbing ones. */
  function missileSurface(m){
    var b=horizontal()?bounds(C.scroll+m.x+m.w/2)
                      :bounds(C.scroll+NS.PLAYFIELD_H-(m.y+m.h/2));
    return m.wall<0?b.a:b.z;
  }

  function updateMissile(m){
    m.anim++;
    var face=missileSurface(m);
    if(!m.crawling){
      m.x+=m.vx;m.y+=m.vy;
      if(horizontal())m.vy+=m.wall*m.accel;else m.vx+=m.wall*m.accel;
      var landed=horizontal()
        ? (m.wall<0?m.y<=face:m.y+m.h>=face)
        : (m.wall<0?m.x<=face:m.x+m.w>=face);
      if(landed){
        m.crawling=true;
        if(horizontal())m.y=m.wall<0?face:face-m.h;else m.x=m.wall<0?face:face-m.w;
        NS.FX.spark(m.x+m.w/2,m.y+m.h/2,3,'fire');
      }
    }else{
      if(horizontal()){m.x+=m.crawlSpeed;m.y=NS.lerp(m.y,m.wall<0?face:face-m.h,.5);}
      else{m.y-=m.crawlSpeed;m.x=NS.lerp(m.x,m.wall<0?face:face-m.w,.5);}
    }
    if(m.x<-20||m.x>NS.W+20||m.y<-20||m.y>NS.PLAYFIELD_H+20)m.dead=true;
  }

  function enemyPos(e){
    var p=point(e),travel=horizontal()?p.x:p.y;
    if(e.group){
      /* One equation per row: slots differ only by their world delay.  The
         Stage 3 Phoenix rows use the reference game's tight shared sine,
         while later stages retain a crisp straight-diagonal-straight turn. */
      if(C.stage===3){var wave=Math.sin(travel*.052)*24*e.mirror;
        if(horizontal())p.y=e.baseLane+wave;else p.x=e.baseLane+wave;
      }else{var u=NS.clamp((travel+80)/90,0,1),bend=u*u*(3-2*u)*70*e.mirror;
        if(horizontal())p.y=e.baseLane+bend;else p.x=e.baseLane+bend;}
    }
    else if(e.kind==='dragon'){if(horizontal())p.y=e.baseLane+Math.sin(e.t*.035)*55;else p.x=e.baseLane+Math.sin(e.t*.035)*55;}
    else if(e.kind==='hatch'||e.kind==='rock'||e.kind==='block'||e.kind==='cannon'||e.kind==='moai'){}
    else {if(horizontal())p.y=e.baseLane+Math.sin(e.t*.04+e.id)*12;else p.x=e.baseLane+Math.sin(e.t*.04+e.id)*12;}
    e.x=p.x;e.y=p.y;return p;
  }
  function killEnemy(e,G){if(e.dead)return;e.dead=true;G.addScore(e.kind==='dragon'||e.kind==='moai'?700:100,e.x,e.y);NS.FX.explode(e.x,e.y,e.hp>5?1.3:.7,'fire');
    if(e.group){var gr=C.groups[e.group];gr.killed++;if(gr.reward&&gr.killed>=gr.total&&!gr.paid){gr.paid=true;C.pickups.push({x:e.x,y:e.y,t:0,dead:false});}}
    else if(e.bonus)C.pickups.push({x:e.x,y:e.y,t:0,dead:false});}

  function updateEnemies(G){for(var i=0;i<C.enemies.length;i++){var e=C.enemies[i];if(e.dead)continue;enemyPos(e);var lim=horizontal()?NS.W:NS.PLAYFIELD_H;
    if((horizontal()?e.x:e.y)<-100||(horizontal()?e.x:e.y)>lim+100)continue;e.active=true;e.t++;
    if((e.kind==='cannon'||e.kind==='moai'||e.kind==='crystal')&&e.t%95===0)aimed(e.x,e.y,G.player,1.5);
    if(e.kind==='hatch'&&e.t%135===30){for(var r=-1;r<=1;r++)C.enemyShots.push({x:e.x,y:e.y,vx:-1.55,vy:r*.55,t:0,dead:false,big:true});}
    if(e.kind==='lung'&&!e.released&&e.t===105){e.released=true;for(var k=-1;k<=1;k++)C.enemyShots.push({x:e.x,y:e.y,vx:k*.85,vy:1.5,t:0,dead:false,bounce:true,big:true});}
    if(e.kind==='moai'){e.open=e.t%120>58&&e.t%120<94;if(e.open&&e.t%120===62)for(k=-1;k<=1;k++)C.enemyShots.push({x:e.x,y:e.y,vx:k*.55,vy:1.45,t:0,dead:false,big:true});}
    /* Retire an enemy once it is *behind* the player, which is a different
       edge per orientation: side stages scroll it off the left, but vertical
       stages fly upward, so enemies enter at negative y and leave past the
       bottom. Testing y<-80 in a vertical stage killed every enemy on the
       frame it came into range, ~100px above the screen — which is why the
       upward stages looked empty. */
    if(horizontal()?e.x<-80:e.y>lim+80)e.dead=true;}}
  function aimed(x,y,p,s){var a=NS.angleTo(x,y,p.x,p.y);C.enemyShots.push({x:x,y:y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,t:0,dead:false});}

  function startMini(G){C.phase='mini';C.mini={cores:[{x:176,y:52,hp:32,rewarded:false},{x:194,y:104,hp:32,rewarded:false},{x:176,y:156,hp:32,rewarded:false}],t:0,dead:false,hp:96,maxHp:96,state:'active',intro:true};G.boss=C.mini;G.bossName='TRIPLE CORE GUARD';
    NS.Intro.start({name:'TRIPLE CORE GUARD',sub:'TEMPLE CHECKPOINT',x:186,y:104,dur:170,zoom:0.70});NS.Audio.setTrack('boss');}
  function updateMini(G){var m=C.mini;m.t++;
    if(m.intro){if(!NS.Intro.holding())m.intro=false;return;}var hp=0;for(var i=0;i<m.cores.length;i++){var c=m.cores[i];if(c.hp>0){hp+=c.hp;if(m.t%75===i*17)aimed(c.x,c.y,G.player,1.6);}}m.hp=hp;if(hp<=0){m.dead=true;C.phase='flight';C.spec.miniDone=true;G.boss=null;G.addScore(9000);NS.Audio.setTrack('stage');NS.Audio.startMusic();}}

  function ease(u){return u<0?0:(u>1?1:u*u*(3-2*u));}

  /* Where each boss comes from, and the line it says when it gets there.
     Kept as data so the entrance below is one path rather than four. */
  var ENTRANCE={
    3:{sub:'FIRE MAW — STRIKE WHEN IT OPENS'},
    4:{sub:'CELL LORD — THE EYES DETACH'},
    5:{sub:'TOMB GUARDIAN — RING OF EIGHT'},
    6:{sub:'FINAL CORE — KILL THE SERPENT FIRST'}
  };

  function startBoss(G){C.phase='boss';var b={stage:C.stage,t:0,introT:0,intro:true,deploy:0,dead:false,dying:150,state:'active',hitCd:0};
    if(C.stage===3){b.x=NS.W+56;b.y=104;b.hp=b.maxHp=105;b.open=false;}
    if(C.stage===4){b.x=128;b.y=-42;b.hp=b.maxHp=125;b.open=false;b.eyes=2;b.eyeList=[];}
    if(C.stage===5){b.x=NS.W+44;b.y=104;b.hp=b.maxHp=150;b.open=true;b.side=1;b.orbs=8;}
    if(C.stage===6){b.x=128;b.y=-40;b.hp=b.maxHp=150;b.dragonHp=120;b.maxDragonHp=120;b.form='dragon';}
    C.boss=b;G.boss=b;G.bossName=NS.THEME[C.spec.boss];
    NS.Intro.start({name:NS.THEME[C.spec.boss],sub:ENTRANCE[C.stage].sub,
      x:C.stage===3?228:(C.stage===5?218:128),y:C.stage===4?42:(C.stage===6?65:104),
      dur:210,zoom:C.stage===6?0.54:0.60});
    NS.Audio.setTrack('boss');}

  /* The entrance: each boss hauls itself into frame along its own line and
     unfolds whatever it fights with, landing on the frame the name plate
     locks in.  Nothing here can be hit and nothing here shoots — see
     bossHit() and updateBoss(). */
  function enterBoss(b){
    var k=NS.Intro.active?NS.Intro.k():NS.clamp(b.t/170,0,1),e=ease(k);
    b.deploy=NS.clamp((k-0.40)/0.45,0,1);
    if(C.stage===3){b.x=NS.lerp(NS.W+56,228,e);b.open=k>0.58;}
    else if(C.stage===4){b.y=NS.lerp(-42,42,e);b.open=k>0.62;}
    else if(C.stage===5){b.x=NS.lerp(NS.W+44,218,e);b.y=104-Math.sin(k*Math.PI)*10;}
    else{b.y=NS.lerp(-40,65,e);
      b.dragonX=b.x+Math.cos(b.t*.025)*48*b.deploy;b.dragonY=b.y+Math.sin(b.t*.05)*42*b.deploy;}
    if(k>0.42&&b.t%8===0)NS.FX.spark(b.x+(Math.random()-.5)*44,b.y+(Math.random()-.5)*44,2,'fire');
    if(k>=1){b.intro=false;b.introT=b.t;b.deploy=1;
      NS.FX.explode(b.x,b.y,2.4,'fire');NS.Audio.sfx.explode();}
  }

  function updateBoss(G){var b=C.boss;if(!b||b.dead)return;b.t++;if(b.hitCd>0)b.hitCd--;
    if(b.intro){enterBoss(b);return;}
    /* pattern clock, zeroed when the cut released — otherwise every boss
       starts its cycle mid-phase, at whatever frame the entrance ended on */
    var ft=b.t-b.introT;
    if(C.stage===3){b.y=NS.lerp(b.y,G.player.y,.025);b.open=ft%160<105;if(b.open&&ft%90===0)for(var i=-1;i<=1;i++)C.enemyShots.push({x:b.x-18,y:b.y,vx:-2.1,vy:i*.65,t:0,dead:false,big:true});}
    else if(C.stage===4){b.x=128+Math.sin(ft*.018)*70;b.open=ft%150>82;if(b.open&&ft%22===0)aimed(b.x,b.y+12,G.player,1.35);
      var wanted=b.hp<40?0:(b.hp<80?1:2);while(b.eyes>wanted){var side=b.eyes===2?-1:1;b.eyeList.push({x:b.x+side*13,y:b.y-5,vx:side*.45,vy:.65,t:0,dead:false});b.eyes--;}
      for(var ei=0;ei<b.eyeList.length;ei++){var eye=b.eyeList[ei];eye.t++;var aa=NS.angleTo(eye.x,eye.y,G.player.x,G.player.y);eye.vx=NS.lerp(eye.vx,Math.cos(aa)*1.2,.025);eye.vy=NS.lerp(eye.vy,Math.sin(aa)*1.2,.025);eye.x+=eye.vx;eye.y+=eye.vy;}}
    else if(C.stage===5){b.y=104+Math.sin(ft*.025)*62;if(ft%260===0)b.side*=-1;b.x=b.side>0?218:38;if(ft%45===0)aimed(b.x,b.y,G.player,1.45);if(ft%90===0){var oa=b.t*.025;C.enemyShots.push({x:b.x+Math.cos(oa)*29,y:b.y+Math.sin(oa)*29,vx:-b.side*1.7,vy:Math.sin(oa)*.7,t:0,dead:false,big:true});}}
    else {if(b.form==='dragon'){b.dragonX=b.x+Math.cos(b.t*.025)*48;b.dragonY=b.y+Math.sin(b.t*.05)*42;if(ft%50===0)aimed(b.dragonX,b.dragonY,G.player,1.5);}else if(ft%75===0)for(i=0;i<5;i++)aimed(b.x,b.y,G.player,1.1+i*.1);}}

  function bossHit(s,G){var b=C.boss;if(!b||b.dead||b.intro||b.hitCd>0||s.hit.boss)return false;var tx=b.x,ty=b.y,vulnerable=true;
    if(C.stage===3){tx=b.x-15;ty=b.y;vulnerable=b.open;}
    else if(C.stage===4){ty=b.y+12;vulnerable=b.open;}
    else if(C.stage===5){tx=b.x-b.side*9;ty=b.y-5;
      for(var oi=0;oi<8;oi++){var oa=oi*Math.PI/4+b.t*.025,odx=s.x+s.w/2-(b.x+Math.cos(oa)*29),ody=s.y+s.h/2-(b.y+Math.sin(oa)*29);if(odx*odx+ody*ody<8*8){s.hit.boss=1;NS.FX.spark(s.x,s.y,3,'hit');return true;}}}
    else if(b.form==='dragon'){tx=b.dragonX;ty=b.dragonY;}else{tx=b.x;ty=b.y;}
    var dx=s.x+s.w/2-tx,dy=s.y+s.h/2-ty;if(dx*dx+dy*dy>18*18)return false;s.hit.boss=1;b.hitCd=2;if(!vulnerable){NS.FX.spark(s.x,s.y,3,'hit');return true;}
    if(C.stage===6&&b.form==='dragon'){b.dragonHp-=s.dmg;if(b.dragonHp<=0){b.form='heart';b.t=0;G.addScore(10000);NS.FX.explode(tx,ty,2,'fire');}}
    else b.hp-=s.dmg;
    if(b.hp<=0){b.dead=true;b.state='dying';G.addScore(C.stage===6?50000:25000,b.x,b.y);for(var z=0;z<8;z++)NS.FX.explode(b.x+Math.sin(z)*20,b.y+Math.cos(z)*18,1.6,'fire');if(C.stage===6){C.phase='ending';C.ending=true;C.escapeT=0;C.escapeBars=[];b.dying=420;}else b.dying=150;NS.Audio.stopMusic();}return true;}

  function updateEnding(){
    if(C.phase!=='ending')return;C.escapeT++;
    if(C.escapeT%42===1){var index=(C.escapeT/42)|0;C.escapeBars.push({side:index%2?'right':'left',y:-12,w:118+(index%3)*16});}
    for(var i=0;i<C.escapeBars.length;i++){C.escapeBars[i].y+=5.2;if(C.escapeBars[i].y>NS.PLAYFIELD_H+15)C.escapeBars[i].dead=true;}
    NS.prune(C.escapeBars);
  }

  function collide(G){var p=G.player,i,j;
    for(i=0;i<C.shots.length;i++){var s=C.shots[i];if(s.dead)continue;var r={x:s.x,y:s.y,w:s.w,h:s.h};
      for(j=0;j<C.enemies.length;j++){var e=C.enemies[j];if(e.dead||!e.active||s.hit[e.id])continue;if(NS.rectHit(r,{x:e.x-e.w/2,y:e.y-e.h/2,w:e.w,h:e.h})){s.hit[e.id]=1;if(e.kind==='moai'&&!e.open)NS.FX.spark(s.x,s.y,2,'hit');else{e.hp-=s.dmg;if(e.hp<=0)killEnemy(e,G);}if(!s.pierce){s.dead=true;break;}}}
      if(!s.dead&&C.mini&&!C.mini.dead&&!C.mini.intro){for(j=0;j<C.mini.cores.length;j++){var mc=C.mini.cores[j];if(mc.hp<=0||s.hit['m'+j])continue;if(NS.rectHit(r,{x:mc.x-10,y:mc.y-10,w:20,h:20})){s.hit['m'+j]=1;mc.hp-=s.dmg;if(mc.hp<=0&&!mc.rewarded){mc.rewarded=true;C.pickups.push({x:mc.x,y:mc.y,t:0,dead:false});G.addScore(1500,mc.x,mc.y);NS.FX.explode(mc.x,mc.y,1.4,'fire');}if(!s.pierce)s.dead=true;break;}}}
      if(!s.dead&&C.boss&&bossHit(s,G)&&!s.pierce)s.dead=true;
    }
    if(!p.alive)return;var pr={x:p.x-p.w/2,y:p.y-p.h/2,w:p.w,h:p.h};
    for(i=0;i<C.enemyShots.length;i++){var es=C.enemyShots[i];if(!es.dead&&NS.rectHit(pr,{x:es.x-2,y:es.y-2,w:5,h:5})){es.dead=true;if(!p.hit())return;}}
    for(i=0;i<C.enemies.length;i++){e=C.enemies[i];if(!e.dead&&e.active&&NS.rectHit(pr,{x:e.x-e.w/2,y:e.y-e.h/2,w:e.w,h:e.h})){killEnemy(e,G);if(!p.hit())return;}}
    if(C.boss&&!C.boss.dead&&!C.boss.intro&&C.stage===4)for(i=0;i<C.boss.eyeList.length;i++){var eye=C.boss.eyeList[i];if(!eye.dead&&NS.rectHit(pr,{x:eye.x-5,y:eye.y-5,w:10,h:10})&&!p.hit())return;}
    if(C.boss&&!C.boss.dead&&!C.boss.intro&&C.stage===5)for(i=0;i<8;i++){var oa=i*Math.PI/4+C.boss.t*.025,ox=C.boss.x+Math.cos(oa)*29*C.boss.deploy,oy=C.boss.y+Math.sin(oa)*29*C.boss.deploy;if(NS.rectHit(pr,{x:ox-4,y:oy-4,w:8,h:8})&&!p.hit())return;}
    for(i=0;i<C.pickups.length;i++){var c=C.pickups[i];if(!c.dead&&NS.rectHit(pr,{x:c.x-3,y:c.y-3,w:6,h:6})){c.dead=true;p.giveCapsule();G.addScore(100);}}
    for(i=0;i<G.looseOptions.length;i++){var o=G.looseOptions[i];if(!o.dead&&NS.rectHit(pr,{x:o.x-3,y:o.y-3,w:6,h:6})&&p.recoverOption())o.dead=true;}
    if(C.boss&&!C.boss.dead&&!C.boss.intro){var b=C.boss,dx=p.x-b.x,dy=p.y-b.y;if(dx*dx+dy*dy<28*28&&!p.hit())return;}
  }

  C.update=function(G){C.t++;
    if(C.phase==='flight'&&(G.state==='play'||G.state==='dying')){
      var scrollRate=NS.SCROLL_SPEED;
      if(C.stage===4&&C.scroll>2200&&C.scroll<3650)scrollRate*=1.35;
      if(C.stage===6&&C.scroll>6900)scrollRate*=1.3;
      C.scroll=Math.min(C.spec.length,C.scroll+scrollRate);
      if(C.stage===5&&!C.spec.miniDone&&C.scroll>=C.spec.miniAt){C.scroll=C.spec.miniAt;startMini(G);}
      else if(C.scroll>=C.spec.length)startBoss(G);
    }else if(C.phase==='mini')updateMini(G);
    updateEnemies(G);for(var h=0;h<C.hazards.length;h++)C.hazards[h].t++;
    for(var i=0;i<C.shots.length;i++){var s=C.shots[i];if(s.dead)continue;
      if(s.type==='missile'){updateMissile(s);continue;}
      s.x+=s.vx;s.y+=s.vy;if(s.x<-60||s.x>NS.W+60||s.y<-40||s.y>NS.PLAYFIELD_H+40)s.dead=true;}
    for(i=0;i<C.enemyShots.length;i++){var q=C.enemyShots[i];q.t++;q.x+=q.vx;q.y+=q.vy;if(q.bounce){if(q.x<3||q.x>NS.W-3)q.vx*=-1;if(q.y<3||q.y>NS.PLAYFIELD_H-3)q.vy*=-1;q.x=NS.clamp(q.x,3,NS.W-3);q.y=NS.clamp(q.y,3,NS.PLAYFIELD_H-3);}if(q.x<-10||q.x>NS.W+10||q.y<-10||q.y>NS.PLAYFIELD_H+10||q.t>500)q.dead=true;}
    for(i=0;i<C.pickups.length;i++){var c=C.pickups[i];c.t++;if(horizontal())c.x-=.15;else c.y+=.25;if(c.x<-10||c.y>NS.PLAYFIELD_H+10)c.dead=true;}
    for(i=0;i<G.looseOptions.length;i++){var o=G.looseOptions[i];if(o.dead)continue;o.t++;if(horizontal())o.x-=.07;else o.y+=.14;o.y+=Math.sin(o.t*.045+o.phase)*.05;if(o.x<-8||o.y>NS.PLAYFIELD_H+8||o.t>720)o.dead=true;}
    updateBoss(G);updateEnding();collide(G);
    if(C.boss&&C.boss.dead){C.boss.dying--;if(C.boss.dying<=0)C.complete=true;}
    NS.prune(C.shots);NS.prune(C.enemyShots);NS.prune(C.pickups);NS.prune(G.looseOptions);
  };

  function drawTerrain(g){var theme=C.spec.theme,bg=theme==='fire'?'#160906':theme==='cell'?'#160b19':theme==='temple'?'#111324':'#070e18';g.fillStyle=bg;g.fillRect(0,0,NS.W,NS.PLAYFIELD_H);
    if(horizontal()){for(var x=0;x<NS.W;x+=3){var b=bounds(C.scroll+x);g.fillStyle=theme==='fire'?'#9f2c12':theme==='temple'?'#7b6a38':'#39485c';g.fillRect(x,0,3,b.a);g.fillRect(x,b.z,3,NS.PLAYFIELD_H-b.z);if(theme==='fire'){g.fillStyle='#ff8a20';g.fillRect(x,b.a-2,3,2);g.fillRect(x,b.z,3,2);}}}
    else for(var y=0;y<NS.PLAYFIELD_H;y+=3){b=bounds(C.scroll+NS.PLAYFIELD_H-y);g.fillStyle=theme==='cell'?'#7b294f':'#344b62';g.fillRect(0,y,b.a,3);g.fillRect(b.z,y,NS.W-b.z,3);}}
  function drawBoss(g,b){if(b.dead&&(b.dying>>2)%2)return;g.save();
    /* everything that unfolds during the entrance is scaled by deploy, so
       the silhouette grows into its fighting shape instead of snapping */
    var dep=b.deploy==null?1:b.deploy;
    if(C.stage===3){g.fillStyle='#9b3020';g.beginPath();g.ellipse(b.x,b.y,28,38,0,0,Math.PI*2);g.fill();g.fillStyle=b.open?'#ffe0a0':'#5d1515';g.fillRect(b.x-25,b.y-7,14,b.open?14:4);}
    else if(C.stage===4){g.fillStyle='#d5d5c9';g.beginPath();g.arc(b.x,b.y,25,0,Math.PI*2);g.fill();g.fillStyle=b.open?'#ff704f':'#342020';g.fillRect(b.x-9,b.y+8,18,b.open?12:3);for(var ei=0;ei<b.eyeList.length;ei++){g.fillStyle='#ffef8b';g.beginPath();g.arc(b.eyeList[ei].x,b.eyeList[ei].y,5,0,Math.PI*2);g.fill();}}
    else if(C.stage===5){g.fillStyle='#d1a336';g.fillRect(b.x-17,b.y-25,34,50);g.fillStyle='#62d8ff';g.fillRect(b.x-b.side*13,b.y-9,8,8);for(var i=0;i<8;i++){var a=i*Math.PI/4+b.t*.025;g.fillStyle='#ffd96b';g.beginPath();g.arc(b.x+Math.cos(a)*29*dep,b.y+Math.sin(a)*29*dep,4,0,Math.PI*2);g.fill();}}
    else {g.fillStyle='#b81735';g.beginPath();g.arc(b.x,b.y,24,0,Math.PI*2);g.fill();if(b.form==='dragon'){g.strokeStyle='#72dc67';g.lineWidth=7;g.beginPath();for(i=0;i<18;i++){a=i/17*Math.PI*2+b.t*.025;var xx=b.x+Math.cos(a)*48*dep,yy=b.y+Math.sin(a*2)*40*dep;if(!i)g.moveTo(xx,yy);else g.lineTo(xx,yy);}g.stroke();g.fillStyle='#baff88';g.beginPath();g.arc(b.dragonX,b.dragonY,8,0,Math.PI*2);g.fill();}else{g.fillStyle='#ff8aa0';g.beginPath();g.arc(b.x,b.y,12,0,Math.PI*2);g.fill();}}
    g.restore();}
  C.draw=function(g){drawTerrain(g);var i;
    for(i=0;i<C.hazards.length;i++){var h=C.hazards[i],m=mainScreen(h.world),ex=hazardExtent(h);g.fillStyle=C.stage===3?'#ff6a18':'#c6d7e8';if(horizontal())g.fillRect(m-5,h.side==='top'?0:NS.PLAYFIELD_H-ex,10,ex);else g.fillRect(h.side==='left'?0:NS.W-ex,m-5,ex,10);}
    for(i=0;i<C.enemies.length;i++){var e=C.enemies[i];if(e.dead||!e.active)continue;g.fillStyle=e.bonus?'#e4b43e':(e.kind==='phoenix'?'#ff7d31':e.kind==='moai'?'#9fa6b0':'#77b9d1');g.beginPath();g.moveTo(e.x,e.y-5);g.lineTo(e.x-6,e.y+5);g.lineTo(e.x+6,e.y+5);g.closePath();g.fill();}
    if(C.mini&&!C.mini.dead)for(i=0;i<C.mini.cores.length;i++){var mc=C.mini.cores[i];if(mc.hp>0){g.fillStyle='#72c6ff';g.beginPath();g.arc(mc.x,mc.y,10,0,Math.PI*2);g.fill();}}
    for(i=0;i<C.pickups.length;i++){var c=C.pickups[i];g.drawImage(NS.S.capsule[(c.t>>3)&1],c.x-3,c.y-3);}
    for(i=0;i<NS.Game.looseOptions.length;i++){var o=NS.Game.looseOptions[i];g.drawImage(NS.S.looseOption[(o.t>>3)&1],o.x-2,o.y-2);}
    /* one painter for every stage's projectiles */
    for(i=0;i<C.shots.length;i++)NS.Weapons.drawShot(g,C.shots[i]);
    for(i=0;i<C.enemyShots.length;i++){var q=C.enemyShots[i];g.drawImage(NS.S.eshot,q.x-2,q.y-2);}
    if(C.boss)drawBoss(g,C.boss);
    if(C.ending){if(!NS.reducedFlash()){g.fillStyle='rgba(255,80,80,.18)';g.fillRect(0,0,NS.W,NS.PLAYFIELD_H);}
      for(i=0;i<C.escapeBars.length;i++){var eb=C.escapeBars[i];g.fillStyle='#6f8294';if(eb.side==='left')g.fillRect(0,eb.y,eb.w,12);else g.fillRect(NS.W-eb.w,eb.y,eb.w,12);g.fillStyle='#d75050';if(eb.side==='left')g.fillRect(eb.w-3,eb.y,3,12);else g.fillRect(NS.W-eb.w,eb.y,3,12);}}
  };

  C.debugJump=function(stage,where,G){C.reset(stage,G);if(where==='boss'){C.scroll=C.spec.length;startBoss(G);}else if(where==='mid')C.scroll=C.spec.length*.52;};
})(NS);
