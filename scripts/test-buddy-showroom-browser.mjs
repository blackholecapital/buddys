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
      else if(url.pathname==='/api/chat/message')data={ok:true,response:'Let’s look at '+catalog.products(category)[1].name+'. Happy to help you compare the options.'};
      else if(url.pathname==='/api/leads'){category=body.product_interest;data={ok:true,contact:{id:'lead-1'},customerToken:'fixture-customer'};}
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
  for(const viewport of [{width:1440,height:1000},{width:1024,height:900},{width:390,height:844},{width:320,height:740}]){
    selected=false;linked=false;category='Living Room Furniture';requests.length=0;
    const page=await browser.newPage({viewport});const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://**/*',route=>route.abort());
    await page.goto(origin+'/buddys/');
    await page.waitForSelector('.showroom-product',{state:'attached'});
    assert.equal(await page.locator('.premium-intro').isVisible(),false);
    assert.equal(await page.locator('#buddyChatForm button').getAttribute('aria-label'),'Send message');
    assert.equal(await page.locator('.premium-ready').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
    assert.equal(requests.filter(r=>r.path==='/api/chat/session').length,0,'No session allocation before interaction');
    assert.equal(await page.locator('#demoForm').count(),1);
    await page.fill('[name=first_name]','Sam');
    for(const format of ['page','widget','mobile','popup','showroom']) {
      await page.click(`.premium-formats [data-format=${format}]`);
      assert.equal(await page.locator('[name=first_name]').inputValue(),'Sam','Format switches preserve draft');
      assert.equal(await page.locator('#buddyShowroom').isVisible(),!['mobile','popup'].includes(format)&&viewport.width>760);
      if(format==='showroom'&&viewport.width>760)assert.equal(await page.locator('.showroom-product').count(),2,'Dedicated showroom presents both category products');
      assert.equal(await page.locator('#demoForm').count(),1);
      assert.equal(await page.locator('.video-room').evaluate(el=>el.scrollWidth>el.clientWidth+1),false,`${format} no overflow at ${viewport.width}`);
      if(shots){await page.locator('#buddyVideoModal').screenshot({path:path.join(shots,`${format}-${viewport.width}.png`)});}
      if(format==='popup'){
        await page.keyboard.press('Escape');
        await page.waitForFunction(()=>!document.getElementById('premiumDialog').open&&document.getElementById('buddyVideoModal').dataset.format==='mobile');
        assert.equal(await page.locator('#buddyVideoModal').getAttribute('data-format'),'mobile');
      }
    }
    assert.equal(await page.locator('.premium-media-chrome').count(),1,'One premium media status layer');
    assert.equal(await page.locator('.buddy-chat-heading').isVisible(),false,'Legacy message status bar stays removed');
    await page.click('.premium-formats [data-format=page]');
    const assets=Object.values(catalog.categories).flatMap(c=>catalog.products(c).map(p=>p.image.src));
    assert.equal(await page.evaluate(async urls=>{const results=await Promise.all(urls.map(src=>new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(img.naturalWidth>0);img.onerror=()=>resolve(false);img.src=src;})));return results.every(Boolean);},assets),true,'All 18 catalog photographs load');
    await page.click('[data-buddy-mode=message]');
    await page.waitForFunction(()=>document.getElementById('buddyChatState').textContent==='Ready to message');
    assert.equal(requests.filter(r=>r.path==='/api/video/session').length,0);
    assert.equal(await page.locator('script[src*="livekit"]').count(),0);
    if(viewport.width>760){
      await page.getByRole('button',{name:/Delivery Information/}).click();
      assert.match(await page.locator('#buddyChatInput').inputValue(),/delivery.*Harris/);
      await page.selectOption('#buddyCategory','Gaming');
      await page.waitForFunction(()=>document.querySelector('.showroom-product h3')?.textContent.includes('PlayStation'));
      await page.getByRole('button',{name:'View details',exact:true}).click();
      await page.waitForSelector('#buddyProductDetail:not([hidden])');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#buddyProductDetail').isVisible(),false);
      await page.getByRole('button',{name:'Add your preferences to select'}).click();
      assert.equal(await page.locator('#buddyVideoModal').isVisible(),true,'Preferences remain beside Buddy');
      assert.equal(await page.locator('[name=product_interest]').inputValue(),'Gaming');
      assert.equal(await page.locator('[name=contact_method]').inputValue(),'Message');
    }
    await page.fill('[name=last_name]','Test');await page.fill('[name=email]','sam@example.test');await page.fill('[name=phone]','5555550123');
    await page.selectOption('[name=product_interest]','Smartphones');await page.selectOption('[name=lead_source]','Other');await page.selectOption('[name=preferred_store]','Florida');
    await page.selectOption('[name=contact_method]','Text');
    assert.equal(await page.locator('#smsConsent').getAttribute('required'),'');
    await page.click('#submitButton');
    assert.equal(requests.filter(r=>r.path==='/api/leads').length,0,'SMS without consent never submits');
    await page.selectOption('[name=contact_method]','Message');
    const submitFormat=viewport.width===1440?'page':viewport.width===1024?'widget':viewport.width===390?'popup':'mobile';
    await page.click(`.premium-formats [data-format=${submitFormat}]`);
    await page.click('#submitButton');
    await page.waitForFunction(()=>document.querySelector('#formStatus').textContent.includes('preferences are saved'));
    assert.equal(requests.filter(r=>r.path==='/api/leads').length,1);
    const lead=requests.find(r=>r.path==='/api/leads').body;
    assert.equal(lead.first_name,'Sam');assert.equal(lead.consent,false);assert.equal(lead.contact_method,'Message');
    await page.waitForFunction(()=>document.getElementById('buddyChatState').textContent==='Ready to message');
    if(submitFormat==='popup'){await page.click('#premiumDialogClose');await page.waitForFunction(()=>!document.getElementById('premiumDialog').open&&document.getElementById('buddyVideoModal').dataset.format!=='popup');}
    await page.click('.premium-formats [data-format=page]');
    if(viewport.width>760){
      await page.selectOption('#buddyCategory','Dining Room Furniture');
      await page.waitForFunction(()=>document.querySelector('.showroom-product h3')?.textContent.includes('Finling'));
    }
    await page.fill('#buddyChatInput','Tell me about this product');await page.locator('#buddyChatForm button').click();
    await page.waitForFunction(()=>!document.getElementById('buddyChatInput').disabled);
    assert.equal(requests.filter(r=>r.body.action==='product-selected').length,0,'Inquiry must not create an agreement');
    const message=requests.find(r=>r.path==='/api/chat/message');assert.equal(Boolean(message.body.showroom?.productId),viewport.width>760,'Only visible product context accompanies message');
    if(viewport.width>760){
      assert.equal(await page.locator('.showroom-product h3').innerText(),catalog.products(category)[1].name,'Buddy product mention follows featured tile');
      await page.getByRole('button',{name:'See another example',exact:true}).click();
      await page.getByRole('button',{name:'Select & prepare agreement',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('.showroom-option')?.textContent==='YOUR SELECTION');
      assert.equal(await page.locator('#buddyCategory').isDisabled(),true);
      assert.equal(requests.find(r=>r.body.action==='product-selected').body.productId,'dining-1');
    }
    await page.click('[data-buddy-mode=video]');
    await page.waitForFunction(()=>document.getElementById('buddyConnectButton').textContent==='Try Video Again');
    assert.equal(await page.locator('.buddy-desk-preview').isVisible(),true);
    await page.fill('#buddyChatInput','Keep helping me here');await page.locator('#buddyChatForm button').click();
    await page.waitForFunction(()=>!document.getElementById('buddyChatInput').disabled);
    assert.equal(await page.locator('#buddyChatState').innerText(),'Ready to message');
    await page.evaluate(()=>{
      const v=document.createElement('video');v.className='buddy-live-video';v.width=1024;v.height=1536;
      document.getElementById('buddyVideoMount').replaceChildren(v);
    });
    const live=await page.locator('.buddy-live-video').boundingBox(),stage=await page.locator('#buddyVideoMount').boundingBox();
    assert.ok(live.height<=stage.height+1&&live.width<=stage.width+1);
    assert.equal(await page.locator('.buddy-live-video').evaluate(el=>getComputedStyle(el).objectFit),'contain');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log('PASS: premium page/widget/pop-up/mobile/showroom at 1440/1024/390/320px; compact media chrome, shared draft, consent, lead submit/link, catalog context, product follow/selection, video fallback, bounded media and no overflow (API/provider fixtures)');
} finally {await browser.close();server.close();}
