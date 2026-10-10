const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {execFileSync}=require('node:child_process');
const {chromium}=require(require.resolve('playwright',{paths:[path.resolve(__dirname,'../../../neighborwars')]}));
const sharp=require(require.resolve('sharp',{paths:[path.resolve(__dirname,'../../../SpaceChakra')]}));
const root=path.resolve(__dirname,'../..'),out=path.join(__dirname,'implementation');
const ffmpeg=path.resolve(root,'../../AppData/Local/ms-playwright/ffmpeg-1011/ffmpeg-win64.exe');
const server=http.createServer((req,res)=>{const name=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!name.startsWith(root+path.sep)){res.writeHead(403).end();return;}fs.readFile(name,(err,data)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',{'.html':'text/html','.js':'text/javascript','.png':'image/png'}[path.extname(name)]||'application/octet-stream');res.end(data);});});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:720}});await page.addInitScript(()=>window.requestAnimationFrame=()=>0);
    await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
    await page.waitForFunction(()=>{if(NS.Game.state==='loading')NS.Game.step(1);return NS.Game.state==='title';},null,{polling:25,timeout:30000});
    await page.evaluate(()=>{NS.Transitions.finish();NS.Game.settings.master=0;NS.Game.settings.attractMode=false;NS.Save.reset();NS.Game.requestFullscreen=()=>{};const c=document.getElementById('screen');c.style.width='1280px';c.style.height='720px';});
    for(const [name,count]of [['menu',120],['stage',150]]){
      const frames=path.join(out,'.transition-frames-'+name);fs.mkdirSync(frames,{recursive:true});
      await page.evaluate(name=>{NS.Transitions.finish();NS.Debug.paused=false;NS.Intro.stop();NS.Save.reset();if(name==='menu'){NS.Game.state='title';NS.Game.titleMenu.screen='main';NS.Game.titleMenu.index=0;}else{NS.Debug.invincible=true;NS.Game.startRun(1);NS.Game.stageMsg=0;}NS.Game.step(1);},name);
      for(let frame=0;frame<count;frame++){
        await page.evaluate(({name,frame})=>{const G=NS.Game,I=NS.Input;
          if(name==='menu'){
            if(frame===25)G.titleMenu.index=4;
            if(frame===40||frame===81)I.setVirtual('fire',true);
            if(frame===41||frame===82)I.setVirtual('fire',false);
            if(frame===80)G.titleMenu.optionIndex=12;
          }else if(frame===35){G.state='departing';G.nextStage=2;G.player.x=NS.W+80;G.departV=3;}
          G.step(1);
        },{name,frame});
        await page.locator('#screen').screenshot({path:path.join(frames,String(frame).padStart(4,'0')+'.png')});
      }
      /* Playwright's bundled ffmpeg supports MJPEG pipe input and VP8. */
      const encoded=[];for(let frame=0;frame<count;frame++)encoded.push(await sharp(path.join(frames,String(frame).padStart(4,'0')+'.png')).jpeg({quality:90}).toBuffer());
      execFileSync(ffmpeg,['-y','-loglevel','error','-f','image2pipe','-vcodec','mjpeg','-framerate','60','-i','pipe:0','-c:v','libvpx','-b:v','1800k',path.join(out,'transition-'+name+'.webm')],{input:Buffer.concat(encoded)});
      const resolved=path.resolve(frames);if(!resolved.startsWith(path.resolve(out)+path.sep)||!path.basename(resolved).startsWith('.transition-frames-'))throw Error('Unsafe temporary frame directory');
      fs.rmSync(resolved,{recursive:true});console.log('Recorded '+name+' transition at 60 simulation frames/sec (no audio).');
    }
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
