const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:[path.resolve(__dirname,'../../../neighborwars')]}));
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(__dirname,'combat-polish');
const baseline=process.argv.includes('--baseline'),checks=[],captures=[],errors=[];
fs.mkdirSync(OUT,{recursive:true});
const server=http.createServer((req,res)=>{
  const file=path.resolve(ROOT,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!file.startsWith(ROOT+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',{'.html':'text/html','.js':'text/javascript','.png':'image/png'}[path.extname(file)]||'application/octet-stream');res.end(data);});
});
async function main(){
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1920,height:1080}});
    page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>window.requestAnimationFrame=()=>0);
    await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
    await page.waitForFunction(()=>{if(window.NS?.Game?.state==='loading')NS.Game.step(1);return NS.Game?.state==='title';},null,{polling:30,timeout:30000});
    const src=fs.readFileSync(path.join(__dirname,'capture-reference.cjs'),'utf8');
    await page.evaluate('(function(){'+src.slice(src.indexOf('function installHelpers()'),src.indexOf('\nasync function boot('))+';installHelpers();})()');
    await page.addStyleTag({content:'#hint{display:none}#wrap{width:100vw;height:100vh}canvas{box-shadow:none!important}'});
    async function shot(id,label){await page.evaluate(()=>{NS.Transitions.finish();ref.render();});const file=(baseline?'before-':'')+id+'.png';await page.locator('#screen').screenshot({path:path.join(OUT,file)});captures.push({file,label});}
    // Real boss spawning and simulation, including shared large-shot painter.
    await page.evaluate(()=>{ref.encounter(1,'boss',245);const b=NS.Game.boss;b.state='open';b.eyeOpen=1;b.stateT=5;NS.Weapons.enemy.length=0;ref.tick(26);ref.loadout();ref.clean();});
    await shot('boss-spread','Golem live plasma spread; selected gold LASER');
    await page.evaluate(()=>{ref.scene(1,.12,1);NS.Enemies.reset();const e=NS.Enemies.spawnProminence(NS.Game.scrollX+135,false,{period:150,power:3.6,spread:2});e.worldX=NS.Game.scrollX+135;ref.tick(27);});
    await shot('fireballs','Live prominence fireballs');
    if(!baseline){
      assert(await page.evaluate(()=>NS.Enemies.list.some(e=>e.kind==='prominence'&&e.flames.length>=3)));
      checks.push('Actual prominence eruption supplies visible fireballs');
      const hud=await page.evaluate(()=>{
        ref.base(1);NS.Transitions.finish();ref.loadout();const G=NS.Game,p=G.player,c=G.buffer.getContext('2d');
        const pixel=(x,y)=>Array.from(c.getImageData(Math.round(x*G.buffer.width/NS.W),Math.round(y*G.buffer.height/NS.H),1,1).data);
        const result=[];
        p.speedLv=4;
        for(let slot=0;slot<5;slot++){
          p.sel=0;ref.render();const x=44+slot*29;
          const before=pixel(x+3,NS.PLAYFIELD_H+5),idle=pixel(x+8,NS.PLAYFIELD_H+14);
          for(let i=0;i<=slot;i++)p.giveCapsule();ref.render();
          result.push({max:p.slotState(slot)==='max',before,after:pixel(x+3,NS.PLAYFIELD_H+5),idle,active:pixel(x+8,NS.PLAYFIELD_H+14)});
        }
        return result;
      });
      for(const row of hud){assert(row.max);assert.deepEqual(row.before,row.after);assert(row.after[0]>row.after[1]&&row.after[1]>row.after[2]);assert.notDeepEqual(row.idle,row.active);}
      checks.push('All five maxed slots retain rendered gold when selected by energy pickups and show a separate active marker');
      await shot('gold-selected','Selected gold FORCE with cyan pointer and frame');
      await page.evaluate(()=>{ref.encounter(2,'fortress',245);NS.Game.player.invuln=0;ref.clean();});await shot('fortress-fire','Fortress hostile fireballs');
      const drawings=await page.evaluate(()=>{
        ref.base(1);const g=NS.Game.buffer.getContext('2d'),p={x:100,y:100,w:4,h:4,vx:-1.8,vy:.7,t:30,big:true};
        const before=JSON.stringify(p);NS.Weapons.drawEnemyShot(g,p);
        NS.Game.settings.projectileContrast=true;NS.Game.settings.reducedFlash=true;NS.Game.settings.reducedMotion=true;NS.Weapons.drawEnemyShot(g,p);NS.Weapons.drawFireball(g,p,5);
        const saved=NS.Art.images.bossPlasma;delete NS.Art.images.bossPlasma;NS.Weapons.drawEnemyShot(g,p);NS.Art.images.bossPlasma=saved;
        return before===JSON.stringify(p);
      });assert(drawings);checks.push('Painted, accessibility and missing-art projectile rendering preserve simulation state');
    }
    const deathResults=[];
    for(let stage=1;stage<=6;stage++)for(const edge of [false,true]){
      const result=await page.evaluate(({stage,edge})=>{
        ref.base(stage);NS.Transitions.finish();NS.Game.requestFullscreen=()=>{};NS.Debug.freezeScroll=true;
        const G=NS.Game,p=G.player,vertical=stage===2||stage===4||stage===6;
        p.options=[{x:vertical?128:(edge?1:110),y:vertical?(edge?207:140):104,delay:20},{x:vertical?128:(edge?2:90),y:vertical?(edge?206:150):104,delay:40}];
        p.lives=3;NS.Debug.invincible=false;p.kill();NS.Debug.invincible=true;
        for(let frame=0;frame<150&&!p.alive;frame++)ref.tick(1);
        const drops=G.looseOptions.filter(o=>!o.dead).map(o=>({x:o.x,y:o.y,t:o.t}));
        const survived=p.alive&&G.state==='play'&&drops.length+p.options.length===2;
        const visible=drops.every(o=>o.x>=3&&o.x<=253&&o.y>=3&&o.y<=205);
        const meter=p.sel;for(let i=0;i<3&&G.looseOptions.length;i++){
          const o=G.looseOptions[0];p.x=o.x;p.y=o.y;ref.tick(1);
        }
        return{stage,edge,survived,visible,drops,recovered:p.options.length,meterUnchanged:p.sel===meter};
      },{stage,edge});deathResults.push(result);
      if(!baseline){assert(result.survived,'Drops survive stage '+stage+' respawn');assert(result.visible,'Drops visible stage '+stage+' edge='+edge);assert.equal(result.recovered,2);assert(result.meterUnchanged);checks.push('Stage '+stage+' '+(edge?'edge':'normal')+' death preserves visible and directly recoverable Options');}
    }
    if(!baseline){
      const lifetime=await page.evaluate(()=>{
        ref.base(1);const G=NS.Game,o={x:160,y:104,vx:-.07,phase:0,t:719,recoveryGrace:0,dead:false};
        for(let i=0;i<100;i++)G.driftOption(o,false);
        const onScreen=!o.dead&&o.x>100;
        o.x=-7.99;G.driftOption(o,false);const exits=o.dead;
        return{onScreen,exits};
      });assert.deepEqual(lifetime,{onScreen:true,exits:true});checks.push('Loose Options remain until collected or drifted offscreen, without an on-screen timeout');
      await page.evaluate(()=>{
        ref.base(1);NS.Transitions.finish();const G=NS.Game,p=G.player;p.options=[{x:110,y:104,delay:20},{x:90,y:112,delay:40}];
        NS.Debug.invincible=false;p.kill();NS.Debug.invincible=true;for(let i=0;i<150&&!p.alive;i++)ref.tick(1);ref.clean();
      });await shot('options-after-respawn','Recoverable green Options after an actual death and respawn');
      await page.evaluate(()=>{ref.encounter(1,'boss',245);NS.Game.boss.state='open';NS.Game.boss.stateT=5;NS.Weapons.enemy.length=0;ref.tick(26);NS.Game.settings.projectileContrast=true;NS.Game.settings.reducedMotion=true;NS.Game.settings.reducedFlash=true;ref.clean();});
      await shot('projectiles-accessibility','Projectile contrast with Reduced Motion and Reduced Flash');
    }
    fs.writeFileSync(path.join(OUT,baseline?'baseline.json':'validation-report.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks,deathResults,captures,errors},null,2));
    assert.deepEqual(errors,[]);console.log(JSON.stringify({checks:checks.length,errors},null,2));
  }finally{await browser.close();server.close();}
}
main().catch(e=>{console.error(e);server.close();process.exitCode=1});
