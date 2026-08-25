import { useEffect, useMemo, useState } from "react";
import {
  BarChart3, CalendarDays, CheckCircle2, ExternalLink,
  FileSignature, FileText, LayoutDashboard, Mail, MessageSquare,
  Phone, Search, ShoppingCart, Users
} from "lucide-react";
import "./App.css";

type Stage = "New Lead" | "Contacted" | "Engaged" | "Docs Sent" | "Scheduled" | "Closed";
type Lead = {
  id:string; firstName:string; lastName:string; phone?:string; email?:string;
  interest?:string; selectedProduct?:string; location?:string; stage:Stage; score?:number; source?:string;
  callStatus?:string; outreachStatus?:string; documentStatus?:string; docusignEnvelopeId?:string; agreementId?:string; signingShortUrl?:string;
  deliveryAt?:string; deliveryEnd?:string; deliveryStatus?:string; calendarEventId?:string; calendarEventUrl?:string; value?:number;
};
type BuddyEvent = { id:number|string; contactId?:string; callSid?:string; type:string; role?:string; text?:string; createdAt:number; payload?:any };
type Conversation = { callSid?:string; contactId?:string; startedAt:number; endedAt:number; transcript:{role:string;text:string;at:number;type?:string}[]; events:BuddyEvent[] };
type Tab = "Pipeline" | "Leads" | "Documents" | "Deliveries";
type View = "Operations" | "Customers" | "Conversations" | "Analytics";
type LeadAction = "email" | "call" | "sms" | "document" | "calendar";

const stages:Stage[]=["New Lead","Contacted","Engaged","Docs Sent","Scheduled","Closed"];
const DOC_BASE="https://blackhole-concierge-worker.cryptocapitalgroupfl.workers.dev/docusign/document";
const BUDDY_TZ="America/New_York";
const demoLeads:Lead[]=[{id:"demo-1",firstName:"Demo",lastName:"Customer",phone:"555-0100",email:"demo@example.com",interest:"Shopping inquiry",location:"Unassigned",stage:"New Lead",score:70,callStatus:"Not called",documentStatus:"Not sent"}];

function zonedParts(value:any){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:BUDDY_TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(value));
  const p:Record<string,string>={}; for(const part of parts) if(part.type!=="literal")p[part.type]=part.value;
  return {year:Number(p.year),month:Number(p.month),day:Number(p.day),hour:Number(p.hour),minute:Number(p.minute)};
}
function formatEtTime(iso?:string){return iso?new Intl.DateTimeFormat("en-US",{timeZone:BUDDY_TZ,hour:"numeric",minute:"2-digit"}).format(new Date(iso)):"";}
function formatEtDateTime(iso?:string){return iso?new Intl.DateTimeFormat("en-US",{timeZone:BUDDY_TZ,weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"}).format(new Date(iso)):"";}
function formatEtMonthDay(iso?:string){return iso?new Intl.DateTimeFormat("en-US",{timeZone:BUDDY_TZ,month:"short",day:"numeric"}).format(new Date(iso)):"";}
async function postJson(path:string,body:any){const r=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const data=await r.json().catch(()=>({}));if(!r.ok||data?.ok===false)throw new Error(data?.error||`Request failed (${r.status})`);return data;}

function inferStage(d:any):Stage {
  if(String(d?.stage||"")==="Closed"||String(d?.deliveryStatus||"").toLowerCase()==="completed")return "Closed";
  if(d?.deliveryAt||String(d?.deliveryStatus||"").toLowerCase()==="scheduled")return "Scheduled";
  if(d?.docusignEnvelopeId||["sent","signed","completed"].includes(String(d?.documentStatus||"").toLowerCase()))return "Docs Sent";
  if(d?._buddyEngaged||d?.selectedProduct)return "Engaged";
  const call=String(d?.callStatus||"").toLowerCase();
  if(call.includes("completed")||call.includes("in progress")||call.includes("in-progress")||call.includes("answered")||call.includes("connected"))return "Engaged";
  if(d?._buddyContacted||d?.outreachStatus==="Sent"||call.includes("requested")||call.includes("ringing")||call.includes("initiated"))return "Contacted";
  const raw=String(d?.stage||d?.status||"New Lead");return stages.includes(raw as Stage)?raw as Stage:"New Lead";
}
function normalizeContact(raw:any,i:number):Lead {
  let d=raw?.data??raw;if(typeof d==="string"){try{d=JSON.parse(d);}catch{d=raw;}}
  return {
    id:String(d?.id||raw?.id||`lead-${i}`),firstName:d?.firstName||d?.first_name||d?.name?.split?.(" ")?.[0]||"Guest",
    lastName:d?.lastName||d?.last_name||d?.name?.split?.(" ")?.slice?.(1)?.join?.(" ")||"",phone:d?.phone||"",email:d?.email||"",
    interest:d?.interest||d?.product||d?.lookingFor||"Shopping inquiry",selectedProduct:d?.selectedProduct||d?.selected_product||"",
    location:d?.location||d?.state||d?.area||"Unassigned",stage:inferStage(d),score:Number(d?.leadScore||d?.score||70),source:d?.source||"Buddy web lead",
    callStatus:d?.callStatus||d?.call_status||"Not called",outreachStatus:d?.outreachStatus||"",documentStatus:d?.documentStatus||d?.document_status||"Not sent",
    docusignEnvelopeId:d?.docusignEnvelopeId||d?.docusign_envelope_id||"",agreementId:d?.agreementId||d?.agreement_id||"",signingShortUrl:d?.signingShortUrl||"",
    deliveryAt:d?.deliveryAt||d?.delivery_at,deliveryEnd:d?.deliveryEnd||d?.delivery_end,
    deliveryStatus:d?.deliveryStatus||d?.delivery_status||(d?.deliveryAt?"Scheduled":"Not scheduled"),calendarEventId:d?.calendarEventId||d?.calendar_event_id||"",
    calendarEventUrl:d?.calendarEventUrl||d?.calendar_event_url||"",value:Number(d?.value||d?.amount||0),
  };
}

export default function App(){
  const [view,setView]=useState<View>("Operations"),[tab,setTab]=useState<Tab>("Pipeline"),[leads,setLeads]=useState<Lead[]>(demoLeads),[selected,setSelected]=useState<Lead>(demoLeads[0]),[live,setLive]=useState(false);
  const [conversations,setConversations]=useState<Conversation[]>([]),[events,setEvents]=useState<BuddyEvent[]>([]),[selectedCall,setSelectedCall]=useState<Conversation|null>(null);

  useEffect(()=>{const load=()=>fetch("/api/contacts").then(r=>r.ok?r.json():Promise.reject()).then(payload=>{const rows=Array.isArray(payload)?payload:payload?.contacts||payload?.rows||payload?.data||[];if(Array.isArray(rows)&&rows.length){const mapped=rows.map(normalizeContact);setLeads(mapped);setSelected(current=>mapped.find((l:Lead)=>l.id===current?.id)||mapped[0]);setLive(true);}}).catch(()=>setLive(false));load();const timer=window.setInterval(load,5000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{const load=()=>fetch("/api/buddy-events?limit=2000").then(r=>r.ok?r.json():Promise.reject()).then(p=>{const data=p?.data||{};setConversations(data.conversations||[]);setEvents(data.events||[]);setSelectedCall(current=>current?((data.conversations||[]).find((c:Conversation)=>c.callSid===current.callSid)||current):((data.conversations||[])[0]||null));}).catch(()=>{});load();const timer=window.setInterval(load,8000);return()=>clearInterval(timer);},[]);

  const metrics=useMemo(()=>{const closed=leads.filter(l=>l.stage==="Closed").length,engaged=leads.filter(l=>["Engaged","Docs Sent","Scheduled","Closed"].includes(l.stage)).length,signed=leads.filter(l=>l.documentStatus?.toLowerCase()==="signed").length,scheduled=leads.filter(l=>Boolean(l.deliveryAt)).length;return{total:leads.length,engaged,signed,scheduled,conversion:leads.length?Math.round(closed/leads.length*100):0};},[leads]);
  const customerFor=(id?:string)=>leads.find(l=>l.id===id);

  async function act(lead:Lead,action:LeadAction){
    setSelected(lead);
    try{
      if(action==="email"){
        if(!lead.email)throw new Error("This customer has no email address.");
        window.location.href=`mailto:${encodeURIComponent(lead.email)}?subject=${encodeURIComponent("Buddy's Home Furnishings")}`;
        return;
      }
      if(action==="call"){
        if(!lead.phone)throw new Error("This customer has no phone number.");
        await postJson("/api/calls",{contactId:lead.id});
        window.alert(`Buddy is calling ${lead.firstName} now.`);
        return;
      }
      if(action==="sms"){
        if(!lead.phone)throw new Error("This customer has no phone number.");
        const body=window.prompt(`Text ${lead.firstName}:`,"Hi, this is Buddy's Home Furnishings. How can we help?");
        if(!body?.trim())return;
        await postJson("/api/inbox",{contactId:lead.id,channel:"sms",body:body.trim()});
        window.alert("SMS sent.");
        return;
      }
      if(action==="document"){
        if(lead.docusignEnvelopeId){window.open(`${DOC_BASE}/${encodeURIComponent(lead.id)}`,"_blank","noopener,noreferrer");return;}
        const productName=window.prompt("Item for the Buddy agreement:",lead.selectedProduct||lead.interest||"");
        if(!productName?.trim())return;
        await postJson("/api/manual-agreement",{contactId:lead.id,productName:productName.trim()});
        window.alert("Buddy agreement sent by text and email.");
        return;
      }
      if(action==="calendar"){
        setView("Operations");setTab("Deliveries");
      }
    }catch(error:any){window.alert(error?.message||"That action failed.");}
  }

  return <div className="buddy-app">
    <aside className="side-nav"><div className="brand"><div className="brand-mark">B</div><div><strong>BUDDY'S</strong><span>Sales Center</span></div></div><nav>
      <button onClick={()=>setView("Operations")} className={view==="Operations"?"nav-item active":"nav-item"}><LayoutDashboard size={19}/> Operations</button>
      <button onClick={()=>setView("Customers")} className={view==="Customers"?"nav-item active":"nav-item"}><Users size={19}/> Customers</button>
      <button onClick={()=>setView("Conversations")} className={view==="Conversations"?"nav-item active":"nav-item"}><Phone size={19}/> Conversations</button>
      <button onClick={()=>setView("Analytics")} className={view==="Analytics"?"nav-item active":"nav-item"}><BarChart3 size={19}/> Analytics</button>
    </nav><div className="side-status"><span className={live?"dot live":"dot"}/>{live?"Live data":"Demo data"}<small>AI sales workflow</small></div></aside>

    <main className="workspace"><header className="topbar"><div><span className="eyebrow">BUDDY'S HOME FURNISHINGS</span><h1>Personal Shopper Operations</h1><p>Lead to conversation to signed agreement to delivery.</p></div><div className="top-actions"><div className="search"><Search size={17}/><span>Search customers...</span></div><div className="avatar">JS</div></div></header>
      <section className="kpis"><Kpi label="Total Leads" value={metrics.total} icon={<Users/>}/><Kpi label="Engaged" value={metrics.engaged} icon={<MessageSquare/>}/><Kpi label="Signed" value={metrics.signed} icon={<FileSignature/>}/><Kpi label="Scheduled" value={metrics.scheduled} icon={<CalendarDays/>}/><Kpi label="Conversion" value={`${metrics.conversion}%`} icon={<BarChart3/>}/></section>

      {view==="Operations"&&<><div className="tabbar">{(["Pipeline","Leads","Documents","Deliveries"] as Tab[]).map(t=><button key={t} onClick={()=>setTab(t)} className={tab===t?"tab active":"tab"}>{t}</button>)}</div><div className="content-shell"><section className="content-main">{tab==="Pipeline"&&<Pipeline leads={leads} onSelect={setSelected} onAction={act}/>} {tab==="Leads"&&<Leads leads={leads} onSelect={setSelected} onAction={act}/>} {tab==="Documents"&&<Documents leads={leads} onSelect={setSelected}/>} {tab==="Deliveries"&&<Deliveries leads={leads} onSelect={setSelected}/>}</section><LeadDetail lead={selected} onAction={act}/></div></>}
      {view==="Customers"&&<div className="content-shell"><section className="content-main"><div className="table-title"><div><h2>Customers</h2><p>Live Buddy lead and customer records.</p></div></div><Leads leads={leads} onSelect={setSelected} onAction={act}/></section><LeadDetail lead={selected} onAction={act}/></div>}
      {view==="Conversations"&&<ConversationsView conversations={conversations} selected={selectedCall} onSelect={setSelectedCall} customerFor={customerFor}/>} 
      {view==="Analytics"&&<AnalyticsView events={events}/>} 
    </main>
  </div>;
}

function Kpi({label,value,icon}:{label:string,value:any,icon:any}){return <div className="kpi"><div><span>{label}</span><strong>{value}</strong></div><div className="kpi-icon">{icon}</div></div>}
function Pipeline({leads,onSelect,onAction}:{leads:Lead[],onSelect:(l:Lead)=>void,onAction:(l:Lead,a:LeadAction)=>void}){return <div className="pipeline">{stages.map(stage=>{const items=leads.filter(l=>l.stage===stage);return <div className={`stage stage-${stage.toLowerCase().replaceAll(" ","-")}`} key={stage}><div className="stage-head"><div><strong>{stage}</strong><span>{items.length} lead{items.length===1?"":"s"}</span></div><b>{items.reduce((s,l)=>s+(l.value||0),0).toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0})}</b></div><div className="stage-body">{items.length?items.map(l=><LeadCard key={l.id} lead={l} onClick={()=>onSelect(l)} onAction={onAction}/>):<div className="empty-stage"><ShoppingCart size={28}/><span>No leads in this stage</span></div>}</div></div>})}</div>}
function Leads({leads,onSelect,onAction}:{leads:Lead[],onSelect:(l:Lead)=>void,onAction:(l:Lead,a:LeadAction)=>void}){return <div className="lead-grid">{leads.map(l=><LeadCard key={l.id} lead={l} onClick={()=>onSelect(l)} onAction={onAction} large/>)}</div>}
function LeadCard({lead,onClick,onAction,large=false}:{lead:Lead,onClick:()=>void,onAction:(l:Lead,a:LeadAction)=>void,large?:boolean}){const run=(e:any,a:LeadAction)=>{e.stopPropagation();onAction(lead,a);};return <div className={`${large?"lead-card large":"lead-card"} card-stage-${lead.stage.toLowerCase().replaceAll(" ","-")}`} onClick={onClick} role="button" tabIndex={0}><div className="lead-card-top"><span className="initials">{lead.firstName[0]}{lead.lastName?.[0]||""}</span><span className="score">Score {lead.score}</span></div><strong>{lead.firstName} {lead.lastName}</strong><span className="interest">{lead.selectedProduct||lead.interest}</span><div className="lead-tags"><span>{lead.location}</span><span>{lead.callStatus}</span></div><div style={{display:"grid",gap:4,marginTop:8,fontSize:11,color:"#64748b",textAlign:"left"}}><span style={{display:"flex",gap:6,alignItems:"center"}}><Phone size={12}/>{lead.phone||"No phone"}</span><span style={{display:"flex",gap:6,alignItems:"center",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}><Mail size={12}/>{lead.email||"No email"}</span></div><div className="lead-actions"><button title="Email customer" onClick={e=>run(e,"email")}><Mail size={15}/></button><button title="Start Buddy call" onClick={e=>run(e,"call")}><Phone size={15}/></button><button title="Send SMS" onClick={e=>run(e,"sms")}><MessageSquare size={15}/></button><button title="Open or send agreement" onClick={e=>run(e,"document")}><FileText size={15}/></button><button title="Delivery calendar" onClick={e=>run(e,"calendar")}><CalendarDays size={15}/></button></div></div>}

function Documents({leads,onSelect}:{leads:Lead[],onSelect:(l:Lead)=>void}){return <div className="table-card"><div className="table-title"><div><h2>Documents</h2><p>Live DocuSign status, agreement IDs and signed documents.</p></div></div><div className="doc-table head"><span>Customer</span><span>Document</span><span>Selection</span><span>Status</span><span>Action</span></div>{leads.map(l=>{const hasDoc=Boolean(l.docusignEnvelopeId);return <div className="doc-table" key={l.id}><span><b>{l.firstName} {l.lastName}</b><small>{l.agreementId||l.email||l.phone}</small></span><span>Purchase / Rental Agreement</span><span>{l.selectedProduct||l.interest}</span><span><Status value={l.documentStatus||"Not sent"}/></span><span>{hasDoc?<a className="link" href={`${DOC_BASE}/${encodeURIComponent(l.id)}`} target="_blank" rel="noreferrer" onClick={()=>onSelect(l)}>View PDF <ExternalLink size={14}/></a>:<span style={{color:"#94a3b8"}}>Not available</span>}</span></div>})}</div>}

function Deliveries({leads,onSelect}:{leads:Lead[],onSelect:(l:Lead)=>void}){
  const deliveries=leads.filter(l=>l.deliveryAt).sort((a,b)=>new Date(a.deliveryAt!).getTime()-new Date(b.deliveryAt!).getTime());
  const anchorParts=zonedParts(deliveries[0]?.deliveryAt||new Date());
  const year=anchorParts.year,month=anchorParts.month;
  const firstDow=new Date(Date.UTC(year,month-1,1)).getUTCDay();
  const daysInMonth=new Date(Date.UTC(year,month,0)).getUTCDate();
  const cells=Array.from({length:42},(_,i)=>{const day=i-firstDow+1;return day>=1&&day<=daysInMonth?day:null;});
  const monthLabel=new Intl.DateTimeFormat("en-US",{timeZone:BUDDY_TZ,month:"long",year:"numeric"}).format(new Date(Date.UTC(year,month-1,15,12)));
  return <div className="delivery-layout"><div className="calendar-card"><div className="table-title"><div><h2>Delivery Calendar</h2><p>Live Google Calendar schedule · Eastern Time</p></div><button>{monthLabel}</button></div><div className="calendar-grid">{["SUN","MON","TUE","WED","THU","FRI","SAT"].map(d=><div className="dow" key={d}>{d}</div>)}{cells.map((day,i)=>{const ds=day?deliveries.filter(l=>{const p=zonedParts(l.deliveryAt!);return p.year===year&&p.month===month&&p.day===day;}):[];return <div className={day?"day":"day muted"} key={i}><b>{day||""}</b>{ds.map(l=><button className="delivery-pill" style={{border:0,textAlign:"left",cursor:"pointer"}} onClick={()=>onSelect(l)} key={l.id}>{formatEtTime(l.deliveryAt)} · {l.firstName}</button>)}</div>})}</div></div><div className="delivery-side"><h3>Upcoming deliveries</h3>{deliveries.length?deliveries.map(l=><button className="delivery-row" style={{width:"100%",border:0,textAlign:"left",cursor:"pointer",background:"transparent"}} onClick={()=>onSelect(l)} key={l.id}><div className="date-box"><b>{zonedParts(l.deliveryAt!).day}</b><span>{new Intl.DateTimeFormat("en-US",{timeZone:BUDDY_TZ,month:"short"}).format(new Date(l.deliveryAt!)).toUpperCase()}</span></div><div><strong>{l.firstName} {l.lastName}</strong><span>{l.selectedProduct||l.interest}</span><small>{formatEtTime(l.deliveryAt)} ET · {l.location}</small></div></button>):<p>No deliveries scheduled.</p>}</div></div>
}

function ConversationsView({conversations,selected,onSelect,customerFor}:{conversations:Conversation[],selected:Conversation|null,onSelect:(c:Conversation)=>void,customerFor:(id?:string)=>Lead|undefined}){return <div style={{display:"grid",gridTemplateColumns:"340px minmax(0,1fr)",gap:16,padding:"0 24px 24px"}}><div className="table-card" style={{padding:12,maxHeight:"68vh",overflow:"auto"}}><div className="table-title"><div><h2>Voice Conversations</h2><p>{conversations.length} captured calls from Buddy telemetry</p></div></div>{conversations.length?conversations.map(c=>{const lead=customerFor(c.contactId);return <button key={c.callSid||`${c.contactId}-${c.startedAt}`} onClick={()=>onSelect(c)} style={{width:"100%",padding:14,marginBottom:8,border:"1px solid #e2e8f0",borderRadius:10,background:selected?.callSid===c.callSid?"#eff6ff":"white",textAlign:"left",cursor:"pointer"}}><strong>{lead?`${lead.firstName} ${lead.lastName}`:c.contactId||"Unknown customer"}</strong><div style={{fontSize:12,color:"#64748b",marginTop:4}}>{new Date(c.startedAt).toLocaleString()} · {c.transcript.length} turns</div>{lead?.selectedProduct&&<div style={{fontSize:11,color:"#1d4ed8",marginTop:5}}>{lead.selectedProduct}</div>}</button>}):<p style={{padding:16}}>No captured Buddy calls yet.</p>}</div><div className="table-card" style={{padding:18,maxHeight:"68vh",overflow:"auto"}}><div className="table-title"><div><h2>Call Transcript</h2><p>{selected?.callSid||"Select a conversation"}</p></div></div>{selected?.transcript?.length?selected.transcript.map((turn,i)=><div key={`${turn.at}-${i}`} style={{display:"flex",justifyContent:turn.role==="buddy"?"flex-start":"flex-end",margin:"12px 0"}}><div style={{maxWidth:"76%",padding:"12px 14px",borderRadius:12,background:turn.role==="buddy"?"#eef4ff":"#f8fafc",border:"1px solid #dbe4f0"}}><b style={{fontSize:11,textTransform:"uppercase",color:"#1d4ed8"}}>{turn.role==="buddy"?"Buddy":"Customer"}</b><div style={{marginTop:5,lineHeight:1.45}}>{turn.text}</div><small style={{display:"block",marginTop:6,color:"#94a3b8"}}>{new Date(turn.at).toLocaleTimeString()}</small></div></div>):<p>No transcript selected.</p>}</div></div>}
function AnalyticsView({events}:{events:BuddyEvent[]}){const counts=events.reduce((m:any,e)=>{m[e.type]=(m[e.type]||0)+1;return m;},{});const recent=events.slice(0,50);return <div style={{padding:"0 24px 24px",display:"grid",gap:16}}><div className="table-card" style={{padding:18}}><div className="table-title"><div><h2>Workflow Analytics</h2><p>Live operational telemetry from the Buddy automation.</p></div></div><div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}><Kpi label="Calls" value={events.filter(e=>e.type==="call.created").length} icon={<Phone/>}/><Kpi label="Customer Turns" value={counts["stt.transcript.final"]||0} icon={<MessageSquare/>}/><Kpi label="DocuSign Events" value={events.filter(e=>e.type.includes("docusign")).length} icon={<FileSignature/>}/><Kpi label="Delivery Events" value={events.filter(e=>e.type.includes("delivery")).length} icon={<CalendarDays/>}/></div></div><div className="table-card" style={{padding:18}}><div className="table-title"><div><h2>Recent Activity</h2><p>Newest call, document and delivery events.</p></div></div>{recent.map(e=><div key={e.id} style={{display:"grid",gridTemplateColumns:"155px 190px 160px 1fr",gap:12,padding:"10px 4px",borderBottom:"1px solid #eef2f7",fontSize:12}}><span>{new Date(e.createdAt).toLocaleString()}</span><b>{e.type}</b><span>{e.contactId||"—"}</span><span>{e.text||e.payload?.productName||e.payload?.deliveryAt||e.payload?.status||"Workflow event"}</span></div>)}</div></div>}

function Status({value}:{value:string}){const good=["signed","completed","scheduled"].includes(value.toLowerCase());return <span className={good?"status good":"status"}>{good&&<CheckCircle2 size={14}/>} {value}</span>}
function LeadDetail({lead,onAction}:{lead:Lead,onAction:(l:Lead,a:LeadAction)=>void}){return <aside className="detail-panel"><div className="detail-person"><span className="detail-avatar">{lead.firstName[0]}{lead.lastName?.[0]}</span><div><span className="eyebrow">SELECTED CUSTOMER</span><h2>{lead.firstName} {lead.lastName}</h2><p>{lead.selectedProduct||lead.interest}</p></div></div><div className="detail-score"><span>Lead score</span><strong>{lead.score}</strong></div><section><h3>Contact</h3><p><Phone size={15}/>{lead.phone||"No phone"}</p><p><Mail size={15}/>{lead.email||"No email"}</p></section><section><h3>AI workflow</h3><Timeline icon={<MessageSquare/>} title="Outreach" value={lead.outreachStatus||((lead.stage!=="New Lead")?"Sent":"Pending")}/><Timeline icon={<Phone/>} title="Voice conversation" value={lead.callStatus||"Not called"}/><Timeline icon={<FileSignature/>} title="DocuSign" value={lead.documentStatus||"Not sent"}/><Timeline icon={<CalendarDays/>} title="Delivery" value={lead.deliveryAt?`${lead.deliveryStatus||"Scheduled"} · ${formatEtDateTime(lead.deliveryAt)}`:"Not scheduled"}/></section>{lead.docusignEnvelopeId&&<a className="primary-action" style={{textDecoration:"none",justifyContent:"center"}} href={`${DOC_BASE}/${encodeURIComponent(lead.id)}`} target="_blank" rel="noreferrer"><FileText size={16}/> View Agreement PDF</a>}{lead.calendarEventUrl&&<a className="primary-action" style={{textDecoration:"none",justifyContent:"center"}} href={lead.calendarEventUrl} target="_blank" rel="noreferrer"><CalendarDays size={16}/> Open Google Calendar Event</a>}<div style={{marginTop:12,fontSize:11,color:"#64748b"}}>{lead.deliveryAt&&`Delivery: ${formatEtMonthDay(lead.deliveryAt)} at ${formatEtTime(lead.deliveryAt)} ET`}</div><button className="primary-action" onClick={()=>onAction(lead,"call")}><Phone size={16}/> Start / Resume Call</button></aside>}
function Timeline({icon,title,value}:{icon:any,title:string,value:string}){return <div className="timeline"><span>{icon}</span><div><b>{title}</b><small>{value}</small></div></div>}
