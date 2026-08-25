/* Core: API, state, routing, toast, modal, event delegation, helpers */
const state = { contacts:[], templates:[], campaigns:[], inbox:[], conversations:[], dashboard:null, activity:[], settings:null, roles:null, rateLimits:null };
let _currentPage = "dashboard";
let _contactSearch = "";
let _loading = false;
let _online = navigator.onLine !== false;
let _lastSyncAt = null;
let _syncTimer = null;

/* ======================== OFFLINE DETECTION ======================== */
function updateOnlineStatus() {
  _online = navigator.onLine !== false;
  const bar = document.getElementById("offline-bar");
  if (bar) bar.classList.toggle("visible", !_online);
  renderUtilityBar();
}
window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);

/* ======================== API ======================== */
async function api(path, method="GET", body) {
  if (!_online) { toast("You are offline","error"); return { ok:false, error:"offline" }; }
  try {
    const res = await fetch(path, { method, headers:{"Content-Type":"application/json"}, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 403) { toast("Permission denied","error"); return { ok:false, error:"Forbidden" }; }
    if (res.status === 404) { return { ok:false, error:"Not found" }; }
    if (res.status >= 500) { toast("Server error — try again","error"); return { ok:false, error:"Server error" }; }
    const data = await res.json();
    if (!data.ok && data.error) toast(data.error, "error");
    return data;
  } catch(e) {
    if (!navigator.onLine) { updateOnlineStatus(); toast("Connection lost","error"); }
    else toast("Network error: "+e.message, "error");
    return { ok:false, error:e.message };
  }
}

async function refresh() {
  _loading = true;
  try {
    const [dashboard,contacts,templates,campaigns,inbox,convos,activity,settings,roles,rateLimits] = await Promise.all([
      api("/api/dashboard"), api("/api/contacts"), api("/api/templates"), api("/api/campaigns"),
      api("/api/inbox"), api("/api/conversations"), api("/api/activity-log"), api("/api/settings"),
      api("/api/roles"), api("/api/rate-limits")
    ]);
    state.dashboard=dashboard.data; state.contacts=contacts.data||[]; state.templates=templates.data||[];
    state.campaigns=campaigns.data||[]; state.inbox=inbox.data||[]; state.conversations=convos.data||[];
    state.activity=activity.data||[]; state.settings=settings.data; state.roles=roles.data; state.rateLimits=rateLimits.data;
    _lastSyncAt = new Date();
  } catch(e) { toast("Failed to load data","error"); }
  _loading = false;
  renderUtilityBar();
}

async function refreshAndRender() { await refresh(); renderPage(); }

/* ======================== UTILITY BAR ======================== */
function renderUtilityBar() {
  const el = document.getElementById("topbar-right");
  if (!el) return;
  const env = state.settings?.environment || "dev";
  const envCls = env === "production" ? "env-prod" : env === "staging" ? "env-staging" : "env-dev";
  const envLabel = env === "production" ? "prod" : env;
  const dotCls = !_online ? "dot-err" : _loading ? "dot-warn" : "dot-ok";
  const syncText = _lastSyncAt ? timeAgo(_lastSyncAt) : "never";
  el.innerHTML = `<span class="util-env ${envCls}"><span class="util-dot ${dotCls}"></span>${esc(envLabel)}</span>` +
    `<span class="util-divider"></span>` +
    `<span class="util-sync" title="${_lastSyncAt ? _lastSyncAt.toLocaleTimeString() : 'Not synced'}">Synced ${syncText}</span>` +
    `<span class="util-divider"></span>` +
    `<button class="btn-util" id="util-refresh" data-action="global-refresh" title="Refresh all data" aria-label="Refresh">&#8635;</button>`;
}

function timeAgo(date) {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  return Math.floor(m / 60) + "h ago";
}

// Update the "synced X ago" text every 15s
function startSyncTimer() {
  if (_syncTimer) clearInterval(_syncTimer);
  _syncTimer = setInterval(() => {
    const el = document.querySelector(".util-sync");
    if (el && _lastSyncAt) {
      el.textContent = "Synced " + timeAgo(_lastSyncAt);
      el.title = _lastSyncAt.toLocaleTimeString();
    }
  }, 15000);
}

/* ======================== TOAST ======================== */
function toast(msg, type="info") {
  const c = document.getElementById("toasts");
  if (!c) return;
  const el = document.createElement("div");
  el.className = "toast toast-"+type;
  el.setAttribute("role","status");
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(()=>el.remove(), 3500);
}

/* ======================== MODAL ======================== */
function openModal(title, contentHtml, opts={}) {
  closeModal();
  const root = document.getElementById("modal-root");
  root.innerHTML = `<div class="modal-overlay" id="modal-overlay">
    <div class="modal${opts.wide?' modal-wide':''}" role="dialog" aria-label="${esc(title)}">
      <div class="modal-header"><h3>${title}</h3><button class="modal-close" data-action="close-modal" aria-label="Close dialog">&times;</button></div>
      <div id="modal-body">${contentHtml}</div>
    </div></div>`;
  const overlay = root.querySelector(".modal-overlay");
  overlay.addEventListener("click", e => { if(e.target===overlay) closeModal(); });
  const first = root.querySelector("input,select,textarea,button:not(.modal-close)");
  if (first) setTimeout(()=>first.focus(), 50);
  root._escHandler = (e) => { if(e.key==="Escape") closeModal(); };
  document.addEventListener("keydown", root._escHandler);
}
function closeModal() {
  const root = document.getElementById("modal-root");
  if (root._escHandler) { document.removeEventListener("keydown", root._escHandler); root._escHandler = null; }
  root.innerHTML = "";
}

function confirmAction(msg, onConfirm, opts={}) {
  const isDanger = opts.destructive !== false;
  openModal("Confirm", `<p style="margin-bottom:var(--sp-3)">${msg}</p>
    <div class="form-actions"><button class="btn" data-action="close-modal">Cancel</button>
    <button class="btn ${isDanger?'btn-danger':'btn-primary'}" id="confirm-btn">${opts.confirmLabel||"Confirm"}</button></div>`);
  if (isDanger) {
    const modal = document.querySelector(".modal");
    if (modal) modal.classList.add("confirm-destructive");
  }
  document.getElementById("confirm-btn").addEventListener("click", () => { closeModal(); onConfirm(); });
}

/* ======================== BUTTON LOADING ======================== */
async function withLoading(btnOrId, fn) {
  const btn = typeof btnOrId === "string" ? document.getElementById(btnOrId) : btnOrId;
  if (!btn || btn.getAttribute("aria-busy") === "true") return;
  const origHtml = btn.innerHTML;
  btn.setAttribute("aria-busy", "true");
  btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle"></span> Working\u2026';
  try { return await fn(); } finally {
    if (btn.isConnected) { btn.removeAttribute("aria-busy"); btn.innerHTML = origHtml; }
  }
}

/* ======================== ROUTING ======================== */
function navigate(page) {
  _currentPage = page;
  window.location.hash = page;
  document.getElementById("sidebar").classList.remove("open");
  renderPage();
}

function initRouting() {
  window.addEventListener("hashchange", () => {
    const h = window.location.hash.slice(1) || "dashboard";
    if (h !== _currentPage) { _currentPage = h; renderPage(); }
  });
  const h = window.location.hash.slice(1);
  if (h) _currentPage = h;
}

/* ======================== NAV ======================== */
const NAV = [
  { section:"Main", items:[
    { id:"dashboard", label:"Dashboard", icon:"\u25CC" },
    { id:"contacts", label:"Contacts", icon:"\u25C9" },
    { id:"templates", label:"Templates", icon:"\u25CE" },
    { id:"campaigns", label:"Campaigns", icon:"\u25CB" },
  ]},
  { section:"Messaging", items:[
    { id:"inbox", label:"Inbox", icon:"\u25CE" },
    { id:"conversations", label:"Conversations", icon:"\u25C8" },
    { id:"activity", label:"Activity Log", icon:"\u25D4" },
  ]},
  { section:"Admin", items:[
    { id:"settings", label:"Settings", icon:"\u25E6" },
    { id:"health", label:"System Health", icon:"\u25C9" },
    { id:"reconciliation", label:"Reconciliation", icon:"\u25CE" },
    { id:"rate-limits", label:"Rate Limits", icon:"\u25C7" },
  ]},
];

function renderNav() {
  const nav = document.getElementById("nav");
  nav.innerHTML = NAV.map(g => `<div class="sidebar-section">${g.section}</div>` +
    g.items.map(i => `<div class="nav-item${_currentPage===i.id?" active":""}" data-nav="${i.id}" role="link" tabindex="0" aria-current="${_currentPage===i.id?"page":"false"}">
      <span class="nav-icon" aria-hidden="true">${i.icon}</span>${i.label}</div>`).join("")).join("");
  nav.querySelectorAll(".nav-item").forEach(el => {
    el.addEventListener("click", () => navigate(el.dataset.nav));
    el.addEventListener("keydown", (e) => { if(e.key==="Enter"||e.key===" ") { e.preventDefault(); navigate(el.dataset.nav); } });
  });
}

function renderBreadcrumb() {
  const label = NAV.flatMap(g=>g.items).find(i=>i.id===_currentPage)?.label || _currentPage;
  document.getElementById("breadcrumb").innerHTML = `<span class="topbar-brand-mark" aria-hidden="true"></span>Home / <span>${label}</span>`;
}

/* ======================== EVENT DELEGATION ======================== */
const _actions = {};
function registerActions(map) { Object.assign(_actions, map); }

function setupDelegation() {
  document.addEventListener("click", (e) => {
    // Close any open row-action menus when clicking elsewhere
    if (!e.target.closest(".row-actions")) {
      document.querySelectorAll(".row-actions-menu.open").forEach(m => m.classList.remove("open"));
    }
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const handler = _actions[el.dataset.action];
    if (handler) { e.preventDefault(); e.stopPropagation(); handler(el, e); }
  });
}

registerActions({
  "close-modal": () => closeModal(),
  "navigate": (el) => navigate(el.dataset.to),
  "global-refresh": (el) => {
    withLoading(el, async () => {
      await refreshAndRender();
      toast("Data refreshed", "success");
    });
  },
  "toggle-row-menu": (el) => {
    const menu = el.parentElement.querySelector(".row-actions-menu");
    if (!menu) return;
    // Close all others
    document.querySelectorAll(".row-actions-menu.open").forEach(m => { if (m !== menu) m.classList.remove("open"); });
    menu.classList.toggle("open");
  },
});

/* ======================== HELPERS ======================== */
function esc(s) { const d=document.createElement("div"); d.textContent=String(s==null?"":s); return d.innerHTML; }
function fmtDate(iso) { if(!iso) return "\u2014"; try { const d=new Date(iso); if(isNaN(d)) return "\u2014"; return d.toLocaleDateString()+" "+d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}); } catch(e){ return "\u2014"; } }
function fmtDateShort(iso) { if(!iso) return "\u2014"; try { const d=new Date(iso); if(isNaN(d)) return "\u2014"; return d.toLocaleDateString(undefined,{month:"short",day:"numeric"}); } catch(e){ return "\u2014"; } }

function statusBadge(s) {
  if (!s) return '<span class="badge badge-muted">unknown</span>';
  const m={scheduled:"badge-info",sent:"badge-success",failed:"badge-danger",received:"badge-success",queued:"badge-warning",active:"badge-success",draft:"badge-muted",paused:"badge-warning",cancelled:"badge-muted",archived:"badge-muted"};
  return `<span class="badge ${m[s]||"badge-muted"}">${esc(s)}</span>`;
}

function selectOpts(rows, labelKey="name", valueKey="id", blank="") {
  let h = blank ? `<option value="">${blank}</option>` : "";
  return h + (rows||[]).map(r=>`<option value="${esc(r[valueKey])}">${esc(r[labelKey]||r[valueKey]||"")}</option>`).join("");
}
function formData(form) { return Object.fromEntries(new FormData(form).entries()); }

function getContactSearch() { return _contactSearch; }
function setContactSearch(v) { _contactSearch = v; }

function loadingSkeleton(rows) {
  rows = rows || 3;
  let h = '';
  for (let i=0;i<rows;i++) h += '<div class="skeleton-row"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
  return h;
}

function contactName(c) {
  if (!c) return "\u2014";
  return ((c.firstName||"")+" "+(c.lastName||"")).trim() || c.phone || c.email || c.id || "\u2014";
}

/** Campaign status timeline HTML */
function campaignTimeline(c) {
  const steps = [];
  const s = c.status;
  steps.push({ label:"Created", cls: "done" });
  if (s==="scheduled") steps.push({ label:"Scheduled", cls:"current" });
  else steps.push({ label:"Scheduled", cls:"done" });
  if (s==="sent") steps.push({ label:"Sent", cls:"done" });
  else if (s==="failed") steps.push({ label:"Failed", cls:"failed" });
  else steps.push({ label:"Sent", cls:"" });
  if (c.followUpTemplateId) {
    if (c.followUpQueuedAt) steps.push({ label:"Follow-up", cls:"done" });
    else if (s==="sent") steps.push({ label:"Follow-up", cls:"current" });
    else steps.push({ label:"Follow-up", cls:"" });
  }
  return `<div class="timeline">${steps.map((st,i)=>{
    const dot = `<span class="timeline-step ${st.cls}"><span class="timeline-dot"></span>${st.label}</span>`;
    return (i>0?'<span class="timeline-line"></span>':'')+dot;
  }).join("")}</div>`;
}

/** Row action menu (standardized "..." dropdown) */
function rowActionMenu(actions) {
  const items = actions.map(a => {
    if (a.divider) return '<div class="menu-divider"></div>';
    const cls = a.danger ? ' class="danger"' : '';
    const dataAttrs = Object.entries(a.data||{}).map(([k,v])=>` data-${k}="${esc(v)}"`).join("");
    return `<button${cls} data-action="${esc(a.action)}"${dataAttrs}>${esc(a.label)}</button>`;
  }).join("");
  return `<div class="row-actions">
    <button class="row-actions-trigger" data-action="toggle-row-menu" aria-label="Actions">&hellip;</button>
    <div class="row-actions-menu">${items}</div>
  </div>`;
}

/* ======================== EXPORTS ======================== */
window.api=api; window.state=state; window.toast=toast;
window.openModal=openModal; window.closeModal=closeModal; window.confirmAction=confirmAction;
window.navigate=navigate; window.refresh=refresh; window.refreshAndRender=refreshAndRender;
window.withLoading=withLoading;
window.esc=esc; window.fmtDate=fmtDate; window.fmtDateShort=fmtDateShort; window.statusBadge=statusBadge;
window.selectOpts=selectOpts; window.formData=formData;
window.currentPage=()=>_currentPage;
window.getContactSearch=getContactSearch; window.setContactSearch=setContactSearch;
window.loadingSkeleton=loadingSkeleton; window.contactName=contactName;
window.campaignTimeline=campaignTimeline;
window.registerActions=registerActions; window.setupDelegation=setupDelegation;
window.NAV=NAV; window.initRouting=initRouting; window.renderNav=renderNav; window.renderBreadcrumb=renderBreadcrumb;
window.renderUtilityBar=renderUtilityBar; window.startSyncTimer=startSyncTimer;
window.rowActionMenu=rowActionMenu; window.timeAgo=timeAgo;
