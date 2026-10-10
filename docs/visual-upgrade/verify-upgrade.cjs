const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(require.resolve('playwright',{paths:[path.resolve(__dirname,'../../../neighborwars')]}));
const ROOT=path.resolve(__dirname,'../..'), OUT=path.join(__dirname,'implementation');
// Fresh capture paths avoid Windows viewers locking an existing PNG during QA.
const SCREEN_DIR='screens/review-'+Date.now();
fs.mkdirSync(path.join(OUT,SCREEN_DIR),{recursive:true});
const checks=[], errors=[], captures=[];
const server=http.createServer((req,res)=>{
  const target=path.resolve(ROOT,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(target!==ROOT&&!target.startsWith(ROOT+path.sep)){res.writeHead(403).end();return;}
  const file=target===ROOT?path.join(ROOT,'index.html'):target;
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',{'.html':'text/html','.js':'text/javascript','.png':'image/png','.json':'application/json'}[path.extname(file)]||'application/octet-stream');res.end(data);});
});
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
async function main(){
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1920,height:1080}});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{window.requestAnimationFrame=()=>0;});
    await page.goto(origin+'/index.html');
    await page.waitForFunction(()=>{if(window.NS?.Game?.state==='loading')NS.Game.step(1);return NS.Game?.state==='title';},null,{polling:30,timeout:30000});
    await page.evaluate(()=>{NS.Transitions.finish();NS.Game.settings.attractMode=false;NS.Game.settings.master=0;NS.Game.requestFullscreen=()=>{};NS.Game.step(1);});
    await page.addStyleTag({content:'#hint{display:none}body,#wrap{background:#000}#wrap{width:100vw;height:100vh}canvas{box-shadow:none!important}'});
    await check('painted 2D boots by default and loads all manifest assets',async()=>assert(await page.evaluate(()=>NS.Art.ready&&NS.Art.loaded===NS.Art.total&&NS.Art.failed.length===0&&!NS.Voxel.active())));
    await check('128 original sprite dimensions and anchors remain unchanged',async()=>{
      const expected=JSON.parse(fs.readFileSync(path.join(__dirname,'reference/sprite-index.json'),'utf8'));
      const actual=await page.evaluate(list=>list.map(e=>{const c=e.id.split('.').reduce((o,k)=>o[k],NS.S);return{id:e.id,width:c.width,height:c.height,anchor:{x:c.cx,y:c.cy}};}),expected);
      assert.deepEqual(actual,expected.map(({id,width,height,anchor})=>({id,width,height,anchor})));
    });
    const src=fs.readFileSync(path.join(__dirname,'capture-reference.cjs'),'utf8');
    const helper=src.slice(src.indexOf('function installHelpers()'),src.indexOf('\nasync function boot('));
    await page.evaluate('(function(){'+helper+'; installHelpers();})()');
    await page.evaluate(()=>ref.clean());
    async function shot(id,label,group){
      await page.evaluate(()=>{NS.Transitions.finish();ref.render();});
      const file=SCREEN_DIR+'/'+id+'.png';await page.locator('#screen').screenshot({path:path.join(OUT,file)});
      captures.push({id,label,group,file});
    }
    await shot('title','Title and live main menu','UI');
    for(const screen of ['stages','options','controls','records','profiles']){
      await page.evaluate(s=>ref.title(s),screen);await shot('ui-'+screen,screen,'UI');
    }
    await check('menu crossfade rejects held confirmation and releases on key-up',async()=>{
      const result=await page.evaluate(()=>{
        const G=NS.Game,I=NS.Input,T=NS.Transitions;
        ref.title();NS.Debug.paused=false;G.titleMenu.index=4;
        I.setVirtual('fire',true);G.step(1);
        const entered=G.titleMenu.screen==='options',duration=T.duration;
        G.step(20);const held=G.titleMenu.optionIndex===0&&T.release;
        I.setVirtual('fire',false);G.step(1);
        I.setVirtual('down',true);G.step(1);I.setVirtual('down',false);G.step(1);
        return{entered,duration,held,optionIndex:G.titleMenu.optionIndex};
      });assert.deepEqual(result,{entered:true,duration:12,held:true,optionIndex:1});
    });
    await check('reduced motion removes fades without bypassing confirmation release',async()=>{
      const r=await page.evaluate(()=>{ref.title();NS.Debug.paused=false;NS.Game.settings.reducedMotion=true;NS.Game.titleMenu.index=4;NS.Input.setVirtual('fire',true);NS.Game.step(1);const r={duration:NS.Transitions.duration,screen:NS.Game.titleMenu.screen};NS.Input.setVirtual('fire',false);NS.Game.step(1);NS.Game.settings.reducedMotion=false;return r;});assert.deepEqual(r,{duration:0,screen:'options'});
    });
    await check('stage handoff freezes simulation for the 400 ms crossfade',async()=>{
      const r=await page.evaluate(()=>{ref.base(1);NS.Debug.paused=false;NS.Debug.invincible=true;NS.Intro.stop();NS.Transitions.finish();const G=NS.Game;G.state='departing';G.nextStage=2;G.player.x=NS.W+80;G.departV=3;G.step(1);const first={stage:G.stage,duration:NS.Transitions.duration,scroll:NS.Level2.scrollY};G.step(10);return{...first,frozen:NS.Level2.scrollY===first.scroll};});assert.equal(r.stage,2);assert.equal(r.duration,24);assert(r.frozen);
    });
    for(let stage=1;stage<=6;stage++){
      await page.evaluate(s=>{NS.Transitions.finish();ref.scene(s,.22,65);ref.loadout();ref.clean();ref.render();},stage);
      await shot('stage-0'+stage,'Stage '+stage+' — '+['Bio-Cathedral','Volcanic Ascent','Prominence Inferno','Cellular Current','Latis Temple','Mechanical City'][stage-1],'Stages');
      await check('stage '+stage+' painted renderer leaves terrain and collision state intact',async()=>{
        const result=await page.evaluate(()=>{
          const G=NS.Game,p=G.player,g=G.buffer.getContext('2d');
          const before=JSON.stringify({x:p.x,y:p.y,hit:{w:p.w,h:p.h},terrain:NS.Terrain.top.slice(0,50),enemies:G.stage===1?NS.Enemies.list:NS.Campaign.enemies});
          if(G.stage===1)NS.Terrain.draw(g,G.scrollX,G.frame);else if(G.stage===2)NS.Level2.draw(g);else NS.Campaign.draw(g);
          return before===JSON.stringify({x:p.x,y:p.y,hit:{w:p.w,h:p.h},terrain:NS.Terrain.top.slice(0,50),enemies:G.stage===1?NS.Enemies.list:NS.Campaign.enemies});
        });assert(result);
      });
      await page.evaluate(s=>ref.encounter(s,s===2?'tetran':'boss',245),stage);
      await shot('boss-0'+stage,'Stage '+stage+' boss','Bosses');
    }
    for(const [stage,where]of [[2,'fortress'],[2,'rocks'],[5,'mini'],[5,'blocks']]){
      await page.evaluate(({stage,where})=>ref.encounter(stage,where,245),{stage,where});await shot('encounter-'+stage+'-'+where,where,'Encounters');
    }
    await page.evaluate(()=>{ref.scene(1,.015,325);ref.loadout();NS.Gunner.set('manual');NS.Input.setVirtual('fire',true);ref.tick(20);NS.Input.setVirtual('fire',false);ref.clean();ref.render();});
    await shot('action-laser-formation','Painted ships, formation and live laser fire','Encounters');
    await page.evaluate(()=>{ref.encounter(1,'boss',245);NS.Game.boss.eyeOpen=1;ref.render();});
    await shot('boss-01-open','Golem exposed eye','Bosses');
    await page.evaluate(()=>{ref.encounter(4,'boss',245);NS.Game.boss.hp=70;ref.tick(2);ref.clean();ref.render();});
    await shot('boss-04-detached-eye','Giga detached eye phase','Bosses');
    await page.evaluate(()=>{ref.encounter(6,'boss',245);NS.Game.boss.form='heart';NS.Game.boss.dragonHp=0;ref.render();});
    await shot('boss-06-heart','Zelos exposed heart phase','Bosses');
    await page.evaluate(()=>{ref.base(1);NS.Game.state='paused';NS.Game.pause.auto=false;NS.Game.pause.submenu=null;});await shot('ui-pause','Pause menu','UI');
    for(const state of ['continue','gameover','clear']){
      await page.evaluate(state=>{ref.base(6);NS.Game.state=state;NS.Game.clearT=160;NS.Game.continueT=420;},state);await shot('ui-'+state,state,'UI');
    }
    await page.evaluate(()=>ref.escape(180));await shot('ending-escape','Final escape','Encounters');
    await check('missing painted assets fall back to original sprite drawing',async()=>{
      assert(await page.evaluate(()=>{const img=NS.Art.images.ship;delete NS.Art.images.ship;try{ref.base(1);ref.render();return NS.Game.player.alive;}finally{NS.Art.images.ship=img;}}));
    });
    await check('voxel view can still be enabled and switched back to painted 2D',async()=>{
      const r=await page.evaluate(()=>new Promise(resolve=>NS.Voxel.toggle((on,err)=>{if(!on){resolve({on,err});return;}NS.Game.step(1);NS.Voxel.disable();NS.Game.step(1);resolve({on,painted:NS.Art.active()});})));assert.deepEqual(r,{on:true,painted:true});
    });
    await page.setViewportSize({width:844,height:390});
    await page.evaluate(()=>{NS.Touch.show();NS.Game.resize();ref.scene(1,.12,40);});
    await page.screenshot({path:path.join(OUT,SCREEN_DIR+'/touch-landscape.png')});captures.push({id:'touch-landscape',label:'Touch landscape',group:'Touch',file:SCREEN_DIR+'/touch-landscape.png'});
    await page.setViewportSize({width:390,height:844});await page.evaluate(()=>NS.Game.resize());
    await page.screenshot({path:path.join(OUT,SCREEN_DIR+'/touch-portrait.png')});captures.push({id:'touch-portrait',label:'Touch portrait',group:'Touch',file:SCREEN_DIR+'/touch-portrait.png'});
    await check('touch layout has no horizontal page overflow',async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)));
    const offline=await context.newPage();offline.on('pageerror',e=>errors.push(e.message));
    await offline.goto('file:///'+ROOT.replaceAll('\\','/')+'/index.html');
    await offline.waitForFunction(()=>NS?.Game?.state==='title',null,{timeout:30000});
    await check('file:// offline boot loads painted art without a server',async()=>assert(await offline.evaluate(()=>NS.Art.failed.length===0&&NS.Art.active())));
    assert.deepEqual(errors,[]);
    const report={passed:true,checkedAt:new Date().toISOString(),checks,captures,browserErrors:errors};
    fs.writeFileSync(path.join(OUT,'validation-report.json'),JSON.stringify(report,null,2));
    const cards=captures.map(c=>`<section><h2>${c.label}</h2><a href="${c.file}"><img src="${c.file}" loading="lazy"></a></section>`).join('');
    fs.writeFileSync(path.join(OUT,'index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zoe Force — implemented painted 2D</title><style>body{background:#090c10;color:#e8ddd0;font:16px/1.6 system-ui;margin:30px auto;max-width:1500px;padding:20px}a{color:#a7dbe4}img{width:100%;border:1px solid #786657}section{margin:40px 0}h1{font-size:36px}</style><h1>Zoe Force: implemented painted 2D</h1><p>Actual screenshots of the running local game. All six environments, bosses and live UI use the approved visual direction. Keyboard and touch support retained. Menu fades take 200 ms, world handoffs 400 ms; Reduced Motion removes the fade.</p><p><a href="../../../index.html">Play local build</a> · <a href="../concepts/index.html">Approved concepts</a> · <a href="../reference/index.html">Original reference captures</a> · <a href="validation-report.json">Validation report</a></p>${cards}</html>`);
    console.log(JSON.stringify({passed:true,checks:checks.length,captures:captures.length,browserErrors:errors.length}));
  }finally{await browser.close();server.close();}
}
main().catch(e=>{console.error(e);server.close();process.exitCode=1});
