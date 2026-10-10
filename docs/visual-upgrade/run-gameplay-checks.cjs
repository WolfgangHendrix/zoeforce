const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(require.resolve('playwright',{paths:[path.resolve(__dirname,'../../../neighborwars')]}));
const root=path.resolve(__dirname,'../..');
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}
    res.setHeader('Content-Type',{'.html':'text/html','.js':'text/javascript','.png':'image/png'}[path.extname(file)]||'application/octet-stream');res.end(data);});
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:720}});
    await page.addInitScript(()=>window.requestAnimationFrame=()=>0);
    await page.goto('http://127.0.0.1:'+server.address().port+'/scratchpad/polish-smoke.html?2d');
    await page.waitForFunction(()=>/^SMOKE (PASS|FAIL)$/.test(document.title),null,{polling:200,timeout:180000});
    const report=JSON.parse(await page.locator('#result').textContent());
    fs.writeFileSync(path.join(__dirname,'implementation/gameplay-report.json'),JSON.stringify({checkedAt:new Date().toISOString(),...report},null,2));
    console.log(JSON.stringify({ok:report.ok,checks:Object.keys(report.checks).length,failures:report.failures,errors:report.errors,extra:report.extra},null,2));
    if(!report.ok)process.exitCode=1;
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
