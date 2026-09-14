// Built CRM, isolated API fixtures: no customer or production writes.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('./browser/node_modules/playwright');
const root=path.resolve('apps/frontend/dist');
const server=http.createServer(async(req,res)=>{
  try{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(pathname==='/api/contacts'?[]:{ok:true,data:{events:[],conversations:[]}}));return;}
    const filename=path.resolve(root,'.'+(pathname==='/buddy-dashboard'?'/index.html':pathname));
    if(!filename.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    const data=await readFile(filename);
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.PNG':'image/png','.png':'image/png','.jpg':'image/jpeg'})[path.extname(filename)]||'application/octet-stream');res.end(data);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BUDDY_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
const shots=process.env.BUDDY_SCREENSHOT_DIR;
if(shots)await mkdir(shots,{recursive:true});
try{
  for(const width of [1440,1024,390]){
    const page=await browser.newPage({viewport:{width,height:900}});const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://**/*',route=>route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/buddy-dashboard`);
    await page.waitForSelector('.crm-banner');
    assert.equal(await page.locator('.crm-brand-copy img').evaluate(img=>img.complete&&img.naturalWidth>0),true);
    assert.equal(await page.locator('.crm-banner-actions a').getAttribute('href'),'/buddys/#contact-form');
    for(const card of await page.locator('.kpis .kpi').all()){
      const icon=await card.locator('.kpi-icon').boundingBox(),value=await card.locator('strong').boundingBox();
      assert.ok(icon.x<value.x,'KPI icon is left of value');
      assert.ok((await card.boundingBox()).width<210,'KPI stays compact');
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    if(shots)await page.screenshot({path:path.join(shots,`crm-${width}.png`),fullPage:true});
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PASS: CRM premium banner, assets, sales link, compact KPI alignment, and responsive widths');
}finally{await browser.close();server.close();}
