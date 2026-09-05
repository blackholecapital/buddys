// Execute the shipped UI with DOM/media/network test doubles. This is a lifecycle
// regression test, not browser rendering or real microphone/avatar acceptance.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
class Element {
  constructor() { this.children=[]; this.listeners={}; this.style={}; this.value=''; this.disabled=false; this.textContent=''; this.classes=new Set(); this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x),contains:x=>this.classes.has(x)}; }
  addEventListener(name,fn) { this.listeners[name]=fn; }
  async emit(name,extra={}) { return this.listeners[name]?.({preventDefault(){},...extra}); }
  setAttribute() {}
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.append(node); }
  replaceChildren(...nodes) { this.children=nodes; }
  querySelector() { return new Element(); }
  querySelectorAll() { return []; }
  focus() {}
  remove() {}
}
const ids=['buddyVideoModal','buddyVideoMount','buddyConnectButton','buddyMicButton','instantMessageButton','instantVideoButton','closeVideoButton','buddyHangupButton','buddyChatForm','buddyChatInput','buddyChatStream','buddyChatState','buddyResourcePanel','buddyResourceList','buddyVideoStatus'];
const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));
const document=new Element(); document.getElementById=id=>elements[id]; document.createElement=()=>new Element(); document.body=new Element();document.head=new Element();
const window=new Element(), storage=new Map(), requests=[];
let failVideo=false,failText=false,failMic=false,pendingVideo=null, mediaLoads=0;
const history=[];
const session={ok:true,contactId:'lead',chatSessionId:'chat-1',sessionId:'chat-1',chatToken:'chat-token',workflowToken:'workflow-token',workflow:{phase:'complete',productOptions:[],resumePrompt:'Saved state'}};
class Room {
  constructor(){this.listeners={};this.name='room-1';this.remoteParticipants=new Map([['buddy',{identity:'buddy',trackPublications:new Map()}]]);this.localParticipant={identity:'customer',setMicrophoneEnabled:async()=>{if(failMic)throw new Error("Microphone denied");},sendText:async()=>{}};}
  registerTextStreamHandler(){}
  on(name,fn){this.listeners[name]=fn;}
  async connect(){}
  async startAudio(){}
  async disconnect(){await this.listeners.disconnected?.();}
}
document.head.appendChild=node=>{mediaLoads++;window.LivekitClient={Room,RoomEvent:{Disconnected:'disconnected'},Track:{Kind:{Video:'video',Audio:'audio'}}};queueMicrotask(()=>node.onload());};
const context=vm.createContext({document,window,console,crypto:webcrypto,URL,sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},requestAnimationFrame:fn=>fn(),fetch:async(url,options)=>{
  const body=JSON.parse(options.body);requests.push({url,body});
  if(url==='/api/chat/session')return Response.json({...session,history:{messages:[...history]}});
  if(url==='/api/chat/message') {
    if(failText)return Response.json({ok:false,error:'Retry your message'});
    history.push({role:'customer',text:body.text,segmentId:body.requestId},{role:'buddy',text:'Saved reply',segmentId:body.requestId+'-reply'});
    return Response.json({ok:true,response:'Saved reply'});
  }
  if(url==='/api/video/session') {
    if(pendingVideo)await pendingVideo;
    return Response.json(failVideo?{ok:false,error:'Video offline'}:{...session,sessionId:'video-1',dispatchId:'video-1',room:'room-1',livekitUrl:'wss://media.test',token:'media-token',history:{messages:[...history]}});
  }
  if(url==='/api/video/transcript')return Response.json({ok:true});
  throw new Error(`Unexpected UI request ${url}`);
}});
vm.runInContext(readFileSync(new URL('../apps/frontend/public/buddys/video.js',import.meta.url),'utf8'),context);
const click=id=>elements[id].emit('click');
const submit=async(text)=>{elements.buddyChatInput.value=text;await elements.buddyChatForm.emit('submit');};
await click('instantMessageButton');
await submit('Camera quality matters');
assert.equal(requests.filter(r=>r.url.includes('/video/')).length,0);
assert.equal(mediaLoads,0,'Message Buddy must not load LiveKit');
assert.ok(elements.buddyChatStream.children.some(n=>n.textContent==='Saved reply'));
failVideo=true;
await click('buddyConnectButton');
await submit('Still messaging');
assert.equal(requests.filter(r=>r.url==='/api/chat/message').length,2);
assert.equal(elements.buddyChatState.textContent,'Ready to message');
failText=true;await submit('Keep my draft');assert.equal(elements.buddyChatInput.value,'Keep my draft');failText=false;
failVideo=false;failMic=true;
await click('buddyConnectButton');
await submit('Text after microphone denial');
assert.equal(elements.buddyChatState.textContent,'Ready to message');
failMic=false;
await click('buddyConnectButton');
assert.equal(mediaLoads,1);
const upgrade=requests.find(r=>r.url==='/api/video/session');assert.equal(upgrade.body.chatSessionId,'chat-1');
await click('closeVideoButton');
const transcript=requests.find(r=>r.url==='/api/video/transcript');assert.equal(transcript.body.messages.length,0,'Restored text is not uploaded as new video transcript');
await click('instantMessageButton');
assert.ok(elements.buddyChatStream.children.some(n=>n.textContent==='Still messaging'));
let release;pendingVideo=new Promise(resolve=>{release=resolve;});
const connecting=click('buddyConnectButton');
await new Promise(resolve=>setTimeout(resolve,5));
await click('closeVideoButton');release();await connecting;pendingVideo=null;
assert.ok(elements.buddyVideoModal.classList.contains('hidden'),'Closing during allocation must stay closed');
console.log('PASS: text opens/sends without LiveKit; failed video fallback; draft recovery; video upgrade; history deduplication; close/reopen and allocation cancellation (DOM/media doubles)');
