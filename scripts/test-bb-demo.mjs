import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require('./browser/node_modules/playwright');
const root=path.resolve('apps/frontend/public');
const server=http.createServer(async(req,res)=>{try{let pathname=new URL(req.url,'http://localhost').pathname;if(pathname.endsWith('/'))pathname+='index.html';const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep))throw Error();const data=await readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(data);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.BUDDY_CHROMIUM_PATH,args:['--no-sandbox']});
try{for(const width of [1672,1024,390]){const p=await browser.newPage({viewport:{width,height:941}});const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(`http://127.0.0.1:${server.address().port}/bb-demo/`);assert.equal(await p.locator('.look').count(),6);await p.locator('.try-look').nth(1).click();assert.equal(await p.locator('#modelLabel').textContent(),'Bandage Halter Dress');await p.getByRole('button',{name:'Filter Wedding looks'}).click();assert.equal(await p.locator('.look').count(),3);await p.locator('.heart').first().click();assert.equal(await p.locator('.heart').first().getAttribute('aria-pressed'),'true');assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.equal(await p.locator('#chatInput').isDisabled(),true);assert.deepEqual(errors,[]);await p.getByRole('button',{name:'Filter Wedding looks'}).click();if(process.env.BB_SHOTS)await p.screenshot({path:`${process.env.BB_SHOTS}/bb-${width}.png`,fullPage:true});await p.close();}console.log('PASS: BB demo swaps, filters, hearts and responsive layout; live AI explicitly pending');}finally{await browser.close();server.close();}
