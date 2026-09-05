// Real Chromium, shipped HTML/CSS/JS and catalog; provider/API edges are fixtures.
// Run after npm ci --prefix scripts/browser and its playwright install chromium.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url);
let playwright;
try {playwright=require('./browser/node_modules/playwright');} catch {playwright=require('playwright');}
const catalog=require('../apps/shared/buddy-catalog.cjs');
const root=path.resolve('apps/frontend/public');
const requests=[];
let category='Living Room Furniture',selected=false,linked=false;
const workflow=()=>({phase:selected?'awaiting-signature':'awaiting-product',category,categories:catalog.categories,catalogVersion:catalog.VERSION,
  productOptions:catalog.products(category),selectedProduct:selected?catalog.products(category)[0].name:'',signingUrl:selected?'https://sign.example.test/demo':'',resumePrompt:'Continue the saved shopping state.'});
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/')) {
      let raw='';for await(const part of req)raw+=part;
      const body=raw?JSON.parse(raw):{};requests.push({path:url.pathname,method:req.method,body});
      let data;
      if(url.pathname==='/api/chat/session') {linked=Boolean(body.contactId);data={ok:true,contactId:linked?'lead-1':'',sessionId:'chat-1',chatSessionId:'chat-1',chatToken:'fixture-chat',workflowToken:linked?'fixture-workflow':'',history:{messages:[]},workflow:linked?workflow():{phase:'guest'}};}
      else if(url.pathname==='/api/showroom')data=req.method==='GET'?{ok:true,categories:catalog.categories,category:catalog.categoryFor(url.searchParams.get('category')),products:catalog.products(url.searchParams.get('category'))}:{ok:true};
      else if(url.pathname==='/api/chat/message')data={ok:true,response:'Happy to help you compare the options.'};
      else if(url.pathname==='/api/video/session')data={ok:false,error:'Media unavailable in this fixture'};
      else if(url.pathname==='/api/video/action') {
        if(body.action==='category-selected'){category=body.category;data={ok:true,workflow:workflow()};}
        else if(body.action==='product-selected'){selected=true;data={ok:true,product:catalog.products(category)[0],docusign:{shortSigningUrl:'https://sign.example.test/demo'}};}
        else data={ok:true,documentStatus:'Sent'};
      } else throw new Error('Unexpected API '+url.pathname);
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return;
    }
    const filename=path.resolve(root,'.'+url.pathname+(url.pathname.endsWith('/')?'index.html':''));
    if(!filename.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    const content=await readFile(filename);
    res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.webp':'image/webp','.jpg':'image/jpeg'})[path.extname(filename)]||'application/octet-stream');res.end(content);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await playwright.chromium.launch({headless:true,...(process.env.BUDDY_CHROMIUM_PATH?{executablePath:process.env.BUDDY_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader']}:{} )});
const shots=process.env.BUDDY_SCREENSHOT_DIR;
if(shots)await mkdir(shots,{recursive:true});
try {
  for(const viewport of [{width:1280,height:900},{width:390,height:844},{width:320,height:740}]){
    selected=false;linked=false;category='Living Room Furniture';requests.length=0;
    const page=await browser.newPage({viewport});const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://**/*',route=>route.abort());
    await page.goto(origin+'/buddys/');
    await page.click('#instantMessageButton');
    await page.waitForSelector('.showroom-product');
    assert.equal(await page.locator('.showroom-product').count(),2);
    assert.equal(requests.filter(r=>r.path==='/api/video/session').length,0);
    assert.equal(await page.locator('script[src*="livekit"]').count(),0);
    await page.selectOption('#buddyCategory','Gaming');
    await page.waitForFunction(()=>document.querySelector('.showroom-product h3')?.textContent.includes('PlayStation'));
    await page.getByRole('button',{name:'View details',exact:true}).first().click();
    await page.waitForSelector('#buddyProductDetail:not([hidden])');
    assert.match(await page.locator('#buddyProductDetail').innerText(),/PlayStation 5/);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#buddyVideoModal').isVisible(),true);
    assert.equal(await page.locator('#buddyProductDetail').isVisible(),false);
    await page.getByRole('button',{name:'Add your preferences to select'}).first().click();
    assert.equal(await page.locator('#buddyVideoModal').isVisible(),false);
    assert.equal(await page.locator('[name="product_interest"]').inputValue(),'Gaming');
    assert.equal(await page.locator('[name="contact_method"][value="Message"]').isChecked(),true);
    category='Smartphones';
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('buddy:conversation-requested',{detail:{contactId:'lead-1',customerToken:'fixture-customer',startVideo:false,interest:'Smartphones'}})));
    await page.waitForFunction(()=>document.querySelector('.showroom-product h3')?.textContent.includes('iPhone'));
    await page.selectOption('#buddyCategory','Dining Room Furniture');
    await page.waitForFunction(()=>document.querySelector('.showroom-product h3')?.textContent.includes('Finling'));
    await page.fill('#buddyChatInput','Can you tell me about the first option?');await page.locator('#buddyChatForm button').click();
    await page.waitForFunction(()=>!document.getElementById('buddyChatInput').disabled);
    assert.equal(requests.filter(r=>r.body.action==='product-selected').length,0,'Inquiry must not create an agreement');
    if(shots && viewport.width!==320) {
      await page.locator('.video-room').evaluate(el=>{el.scrollTop=0;});
      await page.waitForTimeout(150);
    }
    if(shots && viewport.width!==320) await page.screenshot({path:path.join(shots,`showroom-${viewport.width}.png`),fullPage:false});
    await page.getByRole('button',{name:'View details',exact:true}).first().click();
    await page.getByRole('button',{name:'Select & prepare agreement',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.showroom-option')?.textContent==='YOUR SELECTION');
    assert.equal(await page.locator('#buddyCategory').isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'Select & prepare agreement',exact:true}).count(),0);
    const selection=requests.find(r=>r.body.action==='product-selected');
    assert.equal(selection.body.productId,'dining-1');assert.equal(selection.body.catalogVersion,catalog.VERSION);
    assert.ok(requests.some(r=>r.body.event==='product.shown'));assert.ok(requests.some(r=>r.body.event==='product.opened'));
    await page.click('#buddyConnectButton');
    await page.waitForFunction(()=>document.getElementById('buddyConnectButton').textContent==='Try Video Again');
    await page.fill('#buddyChatInput','Keep helping me here');await page.locator('#buddyChatForm button').click();
    await page.waitForFunction(()=>!document.getElementById('buddyChatInput').disabled);
    assert.equal(await page.locator('#buddyChatState').innerText(),'Ready to message');
    const horizontalOverflow=await page.locator('.video-room').evaluate(el=>el.scrollWidth>el.clientWidth+1);
    assert.equal(horizontalOverflow,false,`No horizontal overflow at ${viewport.width}`);
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log('PASS: Chromium 1280/390/320px; guest browse/preferences, category switching, details/Escape, safe inquiry, explicit selection, events, video fallback and no horizontal overflow (API/provider fixtures)');
} finally {await browser.close();server.close();}
