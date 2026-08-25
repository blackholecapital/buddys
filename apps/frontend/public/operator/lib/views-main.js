/* Views: Dashboard, Contacts, Templates, Campaigns */

let _campaignFilter = "all";
let _campaignSearch = "";
let _campaignSort = "date";

/* ======================== DASHBOARD ======================== */
function renderDashboard() {
  const d = state.dashboard;
  if (!d) return loadingSkeleton(4);

  const statuses = {};
  (d.campaignStates||[]).forEach(c => { statuses[c.status] = (statuses[c.status]||0) + 1; });
  const statusSummary = Object.entries(statuses).map(([s,n])=>`${statusBadge(s)} <span style="margin-left:2px">${n}</span>`).join('<span style="margin:0 4px;color:var(--c-border)">\u00b7</span>');

  return `
    <div class="page-header"><h2>Dashboard</h2>
      <div class="btn-group">
        <button class="btn btn-primary btn-sm" data-action="run-campaigns" id="btn-run-sends">Run Scheduled Sends</button>
        <button class="btn btn-sm" data-action="run-followups" id="btn-run-followups">Run Follow-up Check</button>
      </div>
    </div>
    <div class="card dashboard-hero" style="margin-bottom:var(--sp-3)">
      <div class="hero-track"></div>
      <div class="hero-stat"><span>Message Volume</span><strong>${d.totals?.sent ?? 0}</strong></div>
      <div class="hero-stat"><span>Replies</span><strong>${d.totals?.replies ?? 0}</strong></div>
      <div class="hero-stat"><span>Next Follow-ups</span><strong>${d.totals?.scheduled ?? 0}</strong></div>
    </div>
    <div class="kpi-grid">
      ${[
        ["Contacts",d.totals?.contacts??0,"contacts","Audience ready"],
        ["Campaigns",d.totals?.campaigns??0,"campaigns","Track coverage"],
        ["Scheduled",d.totals?.scheduled??0,"campaigns","Queued actions"],
        ["Sent",d.totals?.sent??0,"campaigns","Delivered volume"],
        ["Replies",d.totals?.replies??0,"inbox","Engagement signal"],
        ["Opted Out",d.totals?.optedOut??0,"contacts","Compliance watch"]
      ].map(([l,v,page,hint])=>`<div class="kpi clickable" data-action="navigate" data-to="${page}" title="Go to ${page}"><div class="kpi-value">${v}</div><div class="kpi-label">${l}</div><div class="kpi-sub">${hint}</div></div>`).join("")}
    </div>
    <div class="card-grid">
      <div class="card"><div class="card-header"><h3>Live Activity Feed</h3><button class="btn btn-xs btn-ghost" data-action="navigate" data-to="activity">View all</button></div>
        ${(d.recentActivity||[]).length ? `<div class="live-feed">${d.recentActivity.slice(0,8).map(a=>`<div class="live-feed-item"><span class="live-feed-time">${fmtDate(a.createdAt)}</span><span class="live-feed-msg">${esc(a.message)}</span></div>`).join("")}</div>` : `<div class="empty-state"><div class="empty-state-icon">\u23F1</div><div class="empty-state-title">No activity yet</div><div class="empty-state-text">Activity will appear here as you create contacts, templates, and campaigns.</div></div>`}
      </div>
      <div class="card"><div class="card-header"><h3>Campaign Tracks</h3><button class="btn btn-xs btn-ghost" data-action="navigate" data-to="campaigns">View all</button></div>
        ${statusSummary?`<div style="margin-bottom:var(--sp-2)">${statusSummary}</div>`:''}
        ${(d.campaignStates||[]).length ? `<div class="dashboard-track-list">${d.campaignStates.slice(0,5).map(c=>`<div class="dashboard-track-card" data-action="navigate" data-to="campaigns"><div><strong>${esc(c.name)}</strong><div class="table-meta">${fmtDateShort(c.sentAt||c.scheduledAt)}</div></div><div>${campaignTimeline(c)}</div></div>`).join("")}</div>` : `<div class="empty-state"><div class="empty-state-icon">\u27A4</div><div class="empty-state-title">No campaigns yet</div><div class="empty-state-text">Create a campaign to start sending messages.</div><button class="btn btn-primary btn-sm" data-action="navigate" data-to="campaigns">Go to Campaigns</button></div>`}
      </div>
    </div>`;
}


/* ======================== CONTACTS ======================== */
function renderContacts() {
  const q = getContactSearch().toLowerCase();
  const filtered = filterContacts(q);
  return `
    <div class="page-header"><h2>Contacts <span class="badge badge-muted" style="font-size:12px;vertical-align:middle;margin-left:var(--sp-1)">${state.contacts.length}</span></h2>
      <div class="btn-group">
        <button class="btn btn-sm" data-action="open-import-modal">Import CSV</button>
        <button class="btn btn-primary btn-sm" data-action="open-contact-modal">+ New Contact</button>
      </div>
    </div>
    <div class="card">
      <div style="margin-bottom:var(--sp-2)">
        <input class="input" id="contact-search-input" value="${esc(getContactSearch())}" placeholder="Filter by name, phone, or email\u2026" style="max-width:280px;padding:4px var(--sp-2);font-size:12px" />
      </div>
      ${filtered.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Channel</th><th>Status</th><th style="width:1%"></th></tr></thead>
        <tbody id="contacts-tbody">${contactsRows(filtered)}</tbody></table></div>` : ''}
      ${!filtered.length ? `<div class="empty-state"><div class="empty-state-icon">\u263A</div><div class="empty-state-title">No contacts${q?" match":""}</div><div class="empty-state-text">${q?"Try a different search":"Add your first contact to get started"}</div>
        ${!q?'<button class="btn btn-primary btn-sm" data-action="open-contact-modal">+ New Contact</button>':""}</div>` : ""}
    </div>`;
}

function filterContacts(q) {
  return state.contacts.filter(c => {
    if (!q) return true;
    return ((c.firstName||"")+" "+(c.lastName||"")+" "+(c.phone||"")+" "+(c.email||"")).toLowerCase().includes(q);
  });
}

function contactsRows(list) {
  return (list||state.contacts).map(c=>`<tr>
    <td class="table-bold"><span class="avatar-dot">${esc(contactName(c).slice(0,2).toUpperCase())}</span>${esc(contactName(c))}</td>
    <td class="table-meta">${esc(c.phone||"\u2014")}</td><td class="table-meta truncate">${esc(c.email||"\u2014")}</td>
    <td><span class="badge badge-info channel-chip">${esc((c.channelPreference||"sms").toUpperCase())}</span></td>
    <td>${c.optedOut?'<span class="badge badge-danger">Opted Out</span>':'<span class="badge badge-success">Active</span>'}</td>
    <td>${rowActionMenu([
      {action:"edit-contact", label:"Edit", data:{id:c.id}},
      {action:"toggle-optout", label:c.optedOut?"Opt In":"Opt Out", data:{id:c.id, opt:c.optedOut?"in":"out"}},
      {divider:true},
      {action:"delete-contact", label:"Delete", data:{id:c.id, name:contactName(c)}, danger:true}
    ])}</td></tr>`).join("");
}

function bindContactSearch() {
  const input = document.getElementById("contact-search-input");
  if (!input) return;
  input.addEventListener("input", function() {
    setContactSearch(this.value);
    const filtered = filterContacts(this.value.toLowerCase());
    const tbody = document.getElementById("contacts-tbody");
    if (tbody) tbody.innerHTML = contactsRows(filtered);
  });
}

function openContactModal(contact) {
  const c = contact || {};
  const isEdit = !!c.id;
  openModal(isEdit?"Edit Contact":"New Contact", `
    <form id="contact-form" novalidate>
      <div class="form-row">
        <div class="form-group"><label class="form-label" for="cf-firstName">First Name<span class="required">*</span></label>
          <input class="input" name="firstName" id="cf-firstName" value="${esc(c.firstName)}" required />
          <div class="form-error" id="cf-firstName-err"></div></div>
        <div class="form-group"><label class="form-label" for="cf-lastName">Last Name</label>
          <input class="input" name="lastName" id="cf-lastName" value="${esc(c.lastName)}" /></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label" for="cf-phone">Phone</label>
          <input class="input" name="phone" id="cf-phone" value="${esc(c.phone)}" />
          <div class="form-hint">Include country code, e.g. +15550000000</div></div>
        <div class="form-group"><label class="form-label" for="cf-email">Email</label>
          <input class="input" name="email" id="cf-email" value="${esc(c.email)}" type="email" /></div>
      </div>
      <div class="form-group"><label class="form-label">Preferred Channel</label>
        <select class="select" name="channelPreference">
          <option value="sms"${(c.channelPreference||"sms")==="sms"?" selected":""}>SMS</option>
          <option value="email"${c.channelPreference==="email"?" selected":""}>Email</option>
        </select></div>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn btn-primary" id="contact-submit-btn">${isEdit?"Save Changes":"Create Contact"}</button>
      </div>
    </form>`);
  document.getElementById("contact-form").addEventListener("submit", async(e) => {
    e.preventDefault();
    const data = formData(e.target);
    let valid = true;
    const fnInput = document.getElementById("cf-firstName"), fnErr = document.getElementById("cf-firstName-err");
    if (!(data.firstName||"").trim()) { fnInput.classList.add("error"); fnErr.textContent="First name is required"; valid=false; }
    else { fnInput.classList.remove("error"); fnErr.textContent=""; }
    if (!(data.phone||"").trim() && !(data.email||"").trim()) { toast("Provide at least a phone or email","error"); valid=false; }
    if (!valid) return;
    await withLoading("contact-submit-btn", async()=>{
      if (isEdit) { const r=await api("/api/contacts/"+c.id,"PUT",data); if(r.ok) toast("Contact updated","success"); }
      else { const r=await api("/api/contacts","POST",data); if(r.ok) toast("Contact created","success"); }
      closeModal(); await refreshAndRender();
    });
  });
}

function openImportModal() {
  openModal("Import Contacts", `
    <div class="banner banner-info">CSV format: <strong>firstName,lastName,phone,email</strong> \u2014 one row per contact, no header.</div>
    <form id="import-form" novalidate>
      <div class="form-group"><label class="form-label" for="import-csv">CSV Data<span class="required">*</span></label>
        <textarea class="textarea" name="csv" id="import-csv" rows="5" required></textarea>
        <div class="form-hint">Example: <code>Jane,Doe,+15551234567,jane@example.com</code></div>
        <div class="form-error" id="import-csv-err"></div></div>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn btn-primary" id="import-submit-btn">Import</button>
      </div>
    </form>`);
  document.getElementById("import-form").addEventListener("submit", async(e) => {
    e.preventDefault();
    const csv = document.getElementById("import-csv"), csvErr = document.getElementById("import-csv-err");
    if (!(csv.value||"").trim()) { csv.classList.add("error"); csvErr.textContent="Paste CSV data"; return; }
    csv.classList.remove("error"); csvErr.textContent="";
    await withLoading("import-submit-btn", async()=>{
      const r=await api("/api/contacts/import","POST",{csv:csv.value});
      if(r.ok) toast("Imported "+(r.data?.count||0)+" contacts","success");
      closeModal(); await refreshAndRender();
    });
  });
}

async function toggleOptOut(id, direction) {
  if (direction==="out") await api("/api/compliance/opt-out","POST",{contactId:id,reason:"manual opt-out"});
  else await api("/api/contacts/"+id,"PUT",{optedOut:false});
  toast(direction==="out"?"Contact opted out":"Contact opted back in","success");
  await refreshAndRender();
}
async function deleteContact(id) { await api("/api/contacts/"+id,"DELETE"); toast("Contact deleted","success"); await refreshAndRender(); }

registerActions({
  "open-contact-modal": () => openContactModal(),
  "edit-contact": (el) => openContactModal(state.contacts.find(c=>c.id===el.dataset.id)),
  "open-import-modal": () => openImportModal(),
  "toggle-optout": (el) => toggleOptOut(el.dataset.id, el.dataset.opt),
  "delete-contact": (el) => confirmAction("Delete "+el.dataset.name+"? This cannot be undone.", ()=>deleteContact(el.dataset.id), {destructive:true, confirmLabel:"Delete"}),
});


/* ======================== TEMPLATES ======================== */
function renderTemplates() {
  const usageCounts = {};
  state.campaigns.forEach(c => {
    if (c.templateId) usageCounts[c.templateId] = (usageCounts[c.templateId]||0) + 1;
    if (c.followUpTemplateId) usageCounts[c.followUpTemplateId] = (usageCounts[c.followUpTemplateId]||0) + 1;
  });
  return `
    <div class="page-header"><h2>Templates <span class="badge badge-muted" style="font-size:12px;vertical-align:middle;margin-left:var(--sp-1)">${state.templates.length}</span></h2>
      <button class="btn btn-primary btn-sm" data-action="open-template-modal">+ New Template</button></div>
    <div class="card">
      ${state.templates.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Channel</th><th>Preview</th><th>Used By</th><th>Created</th><th style="width:1%"></th></tr></thead><tbody>
        ${state.templates.map(t=>{
          const count = usageCounts[t.id]||0;
          return `<tr>
          <td class="table-bold">${esc(t.name)}</td>
          <td><span class="badge badge-info channel-chip">${esc((t.channel||"sms").toUpperCase())}</span></td>
          <td class="truncate template-preview" title="${esc(t.body)}">${esc(t.body)}</td>
          <td>${count?`<span class="badge badge-muted">${count}</span>`:'\u2014'}</td>
          <td style="white-space:nowrap" class="table-meta">${fmtDateShort(t.createdAt)}</td>
          <td>${rowActionMenu([
            {action:"edit-template", label:"Edit", data:{id:t.id}},
            {action:"duplicate-template", label:"Duplicate", data:{id:t.id}},
            {divider:true},
            {action:"delete-template", label:"Delete", data:{id:t.id, name:t.name, count:String(count)}, danger:true}
          ])}</td></tr>`;}).join("")}
      </tbody></table></div>` : `<div class="empty-state"><div class="empty-state-icon">\u2709</div><div class="empty-state-title">No templates</div><div class="empty-state-text">Create a message template to use in campaigns</div>
        <button class="btn btn-primary" data-action="open-template-modal">+ New Template</button></div>`}
    </div>`;
}

function openTemplateModal(tpl) {
  const t = tpl || {};
  const isEdit = !!t.id;
  openModal(isEdit?"Edit Template":"New Template", `
    <form id="tpl-form" novalidate>
      <div class="form-group"><label class="form-label" for="tpl-name">Name<span class="required">*</span></label>
        <input class="input" name="name" id="tpl-name" value="${esc(t.name)}" required />
        <div class="form-error" id="tpl-name-err"></div></div>
      <div class="form-group"><label class="form-label">Channel</label>
        <select class="select" name="channel">
          <option value="sms"${(t.channel||"sms")==="sms"?" selected":""}>SMS</option>
          <option value="email"${t.channel==="email"?" selected":""}>Email</option>
        </select></div>
      <div class="form-group"><label class="form-label" for="tpl-body">Body<span class="required">*</span></label>
        <textarea class="textarea" name="body" id="tpl-body" rows="4" required>${esc(t.body)}</textarea>
        <div style="display:flex;justify-content:space-between;margin-top:2px">
          <div class="form-hint">Variables: {{firstName}}, {{lastName}}, {{email}}, {{phone}}</div>
          <div class="form-hint" id="tpl-char-count">${(t.body||"").length} chars</div>
        </div>
        <div class="form-error" id="tpl-body-err"></div></div>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn btn-primary" id="tpl-submit-btn">${isEdit?"Save":"Create"}</button>
      </div>
    </form>`);
  const bodyEl = document.getElementById("tpl-body"), countEl = document.getElementById("tpl-char-count");
  bodyEl.addEventListener("input", ()=>{ countEl.textContent = bodyEl.value.length+" chars"; });
  document.getElementById("tpl-form").addEventListener("submit", async(e) => {
    e.preventDefault(); const data=formData(e.target);
    let valid = true;
    const nameI=document.getElementById("tpl-name"), nameE=document.getElementById("tpl-name-err");
    const bodyI=document.getElementById("tpl-body"), bodyE=document.getElementById("tpl-body-err");
    if (!(data.name||"").trim()) { nameI.classList.add("error"); nameE.textContent="Name is required"; valid=false; } else { nameI.classList.remove("error"); nameE.textContent=""; }
    if (!(data.body||"").trim()) { bodyI.classList.add("error"); bodyE.textContent="Body is required"; valid=false; } else { bodyI.classList.remove("error"); bodyE.textContent=""; }
    if (!valid) return;
    await withLoading("tpl-submit-btn", async()=>{
      if(isEdit){ const r=await api("/api/templates/"+t.id,"PUT",data); if(r.ok) toast("Template updated","success"); }
      else{ const r=await api("/api/templates","POST",data); if(r.ok) toast("Template created","success"); }
      closeModal(); await refreshAndRender();
    });
  });
}

async function duplicateTemplate(id) {
  const t = state.templates.find(x=>x.id===id);
  if (!t) return;
  openTemplateModal({ name: t.name+" (copy)", channel: t.channel, body: t.body });
}

async function deleteTemplate(id) { await api("/api/templates/"+id,"DELETE"); toast("Template deleted","success"); await refreshAndRender(); }

registerActions({
  "open-template-modal": () => openTemplateModal(),
  "edit-template": (el) => openTemplateModal(state.templates.find(t=>t.id===el.dataset.id)),
  "duplicate-template": (el) => duplicateTemplate(el.dataset.id),
  "delete-template": (el) => {
    const count = parseInt(el.dataset.count)||0;
    confirmAction("Delete template \u201c"+el.dataset.name+"\u201d?"+(count?" It is used by "+count+" campaign(s).":""), ()=>deleteTemplate(el.dataset.id), {destructive:true, confirmLabel:"Delete"});
  },
});


/* ======================== CAMPAIGNS ======================== */
function campaignMetrics(c) {
  const thread = state.inbox.find(t=>t.contact?.id===c.contactId);
  const msgs = (thread?.messages||[]).filter(m=>m.campaignId===c.id);
  const replies = msgs.filter(m=>m.direction==="inbound").length;
  let nextAction = "\u2014";
  if (c.status==="scheduled") nextAction = "Run send";
  else if (c.status==="failed") nextAction = "Retry";
  else if (c.status==="sent" && c.followUpTemplateId && !c.followUpQueuedAt) {
    const sentDate = new Date(c.sentAt);
    const dueDate = new Date(sentDate.getTime() + (c.followUpAfterDays||3)*86400000);
    const daysLeft = Math.max(0, Math.ceil((dueDate - Date.now()) / 86400000));
    nextAction = daysLeft > 0 ? "Follow-up in "+daysLeft+"d" : "Follow-up due";
  } else if (c.followUpQueuedAt) nextAction = "Complete";
  else if (c.status==="sent") nextAction = "Done";
  return { msgs: msgs.length, replies, nextAction };
}

function filteredCampaigns() {
  let list = [...state.campaigns];
  if (_campaignFilter !== "all") list = list.filter(c => c.status === _campaignFilter);
  if (_campaignSearch) {
    const q = _campaignSearch.toLowerCase();
    list = list.filter(c => {
      const contact = state.contacts.find(x=>x.id===c.contactId);
      return (c.name||"").toLowerCase().includes(q) || contactName(contact).toLowerCase().includes(q);
    });
  }
  if (_campaignSort === "name") list.sort((a,b) => (a.name||"").localeCompare(b.name||""));
  else if (_campaignSort === "status") list.sort((a,b) => (a.status||"").localeCompare(b.status||""));
  else list.sort((a,b) => new Date(b.sentAt||b.scheduledAt||0) - new Date(a.sentAt||a.scheduledAt||0));
  return list;
}

function renderCampaigns() {
  const hasContacts = state.contacts.length > 0;
  const hasTemplates = state.templates.length > 0;
  const canCreate = hasContacts && hasTemplates;
  const all = state.campaigns;
  const scheduled = all.filter(c=>c.status==="scheduled").length;
  const sent = all.filter(c=>c.status==="sent").length;
  const failed = all.filter(c=>c.status==="failed").length;
  const list = filteredCampaigns();

  return `
    <div class="page-header"><h2>Campaigns <span class="badge badge-muted" style="font-size:12px;vertical-align:middle;margin-left:var(--sp-1)">${all.length}</span></h2>
      <div class="btn-group">
        <button class="btn btn-primary btn-sm" data-action="open-campaign-modal" ${canCreate?"":'disabled title="Add contacts and templates first"'}>+ New Campaign</button>
        <button class="btn btn-sm" data-action="run-campaigns" id="btn-camp-send" ${scheduled?"":'disabled'}>Run Sends${scheduled?' ('+scheduled+')':''}</button>
        <button class="btn btn-sm" data-action="run-followups" id="btn-camp-fu" ${sent?"":'disabled'}>Run Follow-ups</button>
      </div>
    </div>
    ${!canCreate && !all.length ? `<div class="banner banner-warning">${!hasContacts?"Add a contact first. ":""}${!hasTemplates?"Add a template first.":""}</div>` : ""}
    ${all.length ? `<div class="page-toolbar">
      <div class="filter-tabs">
        <button class="filter-tab${_campaignFilter==="all"?" active":""}" data-action="filter-campaigns" data-filter="all">All <span class="filter-count">${all.length}</span></button>
        <button class="filter-tab${_campaignFilter==="scheduled"?" active":""}" data-action="filter-campaigns" data-filter="scheduled">Scheduled <span class="filter-count">${scheduled}</span></button>
        <button class="filter-tab${_campaignFilter==="sent"?" active":""}" data-action="filter-campaigns" data-filter="sent">Sent <span class="filter-count">${sent}</span></button>
        <button class="filter-tab${_campaignFilter==="failed"?" active":""}" data-action="filter-campaigns" data-filter="failed">Failed <span class="filter-count">${failed}</span></button>
      </div>
      <input class="input" id="campaign-search-input" value="${esc(_campaignSearch)}" placeholder="Search campaigns\u2026" />
      <select class="select" id="campaign-sort-select">
        <option value="date"${_campaignSort==="date"?" selected":""}>Sort: Date</option>
        <option value="name"${_campaignSort==="name"?" selected":""}>Sort: Name</option>
        <option value="status"${_campaignSort==="status"?" selected":""}>Sort: Status</option>
      </select>
    </div>` : ''}
    ${all.length ? `<div class="card campaign-hero-strip">
      <div class="table-meta"><strong>${list.length}</strong> visible campaigns</div>
      <div class="table-meta">Track-first operations view</div>
    </div>` : ""}
    <div class="card">
      ${list.length ? `<div class="campaign-card-list">
        ${list.map(c=>{
          const contact = state.contacts.find(x=>x.id===c.contactId);
          const m = campaignMetrics(c);
          return `<div class="campaign-unit-card">
            <div class="campaign-unit-head"><div><div class="table-bold">${esc(c.name||"")}</div><div class="table-meta">${esc(contactName(contact))} \u00b7 ${fmtDateShort(c.sentAt||c.scheduledAt)}</div></div><div>${statusBadge(c.status)}</div></div>
            <div>${campaignTimeline(c)}</div>
            <div class="campaign-unit-meta">
              <span class="metric-cell ${m.msgs?'has-value':'zero'}">Msgs ${m.msgs}</span>
              <span class="metric-cell ${m.replies?'has-value':'zero'}">Replies ${m.replies}</span>
              <span class="badge ${m.nextAction==='Run send'?'badge-info':m.nextAction==='Retry'?'badge-danger':m.nextAction==='Complete'||m.nextAction==='Done'?'badge-success':'badge-muted'}" style="font-size:10px">${esc(m.nextAction)}</span>
              ${rowActionMenu([
                {action:"open-campaign-detail", label:"View", data:{id:c.id}},
                {action:"edit-campaign", label:"Edit", data:{id:c.id}},
                {action:"duplicate-campaign", label:"Duplicate", data:{id:c.id}},
                {divider:true},
                {action:"archive-campaign", label:"Delete", data:{id:c.id, name:c.name||""}, danger:true}
              ])}
            </div>
          </div>`;}).join("")}
      </div>` : `<div class="empty-state"><div class="empty-state-icon">\u27A4</div><div class="empty-state-title">${_campaignFilter!=="all"?"No "+_campaignFilter+" campaigns":"No campaigns"}</div><div class="empty-state-text">${_campaignFilter!=="all"?"Try a different filter":"Create a campaign to start your first Message Track rail"}</div>
        ${canCreate && _campaignFilter==="all"?'<button class="btn btn-primary btn-sm" data-action="open-campaign-modal">+ New Campaign</button>':""}</div>`}
    </div>`;
}

function bindCampaignToolbar() {
  const searchInput = document.getElementById("campaign-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", function() {
      _campaignSearch = this.value;
      renderPage();
    });
  }
  const sortSelect = document.getElementById("campaign-sort-select");
  if (sortSelect) {
    sortSelect.addEventListener("change", function() {
      _campaignSort = this.value;
      renderPage();
    });
  }
}

function openCampaignModal(campaign) {
  if(!state.contacts.length){ toast("Add a contact first","error"); return; }
  if(!state.templates.length){ toast("Add a template first","error"); return; }
  const c = campaign || {};
  const isEdit = !!c.id;
  const activeContacts = state.contacts.filter(x=>!x.optedOut);
  const schedVal = c.scheduledAt ? new Date(c.scheduledAt).toISOString().slice(0,16) : "";
  openModal(isEdit?"Edit Campaign":"New Campaign", `
    <form id="camp-form" novalidate>
      <div class="form-group"><label class="form-label" for="camp-name">Campaign Name<span class="required">*</span></label>
        <input class="input" name="name" id="camp-name" value="${esc(c.name)}" required />
        <div class="form-error" id="camp-name-err"></div></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Contact<span class="required">*</span></label>
          <select class="select" name="contactId" id="camp-contact">${selectOpts(activeContacts,"firstName")}</select>
          ${state.contacts.some(x=>x.optedOut)?'<div class="form-hint">Opted-out contacts hidden</div>':""}</div>
        <div class="form-group"><label class="form-label">Channel</label>
          <select class="select" name="channel">
            <option value="sms"${(c.channel||"sms")==="sms"?" selected":""}>SMS</option>
            <option value="email"${c.channel==="email"?" selected":""}>Email</option>
          </select></div>
      </div>
      <div class="form-group"><label class="form-label">Template<span class="required">*</span></label>
        <select class="select" name="templateId" id="camp-template">${selectOpts(state.templates)}</select>
        <div class="form-hint" id="camp-tpl-preview"></div></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Schedule</label>
          <input class="input" name="scheduledAt" id="camp-schedule" type="datetime-local" value="${schedVal}" />
          <div class="form-hint">Leave blank for immediate</div></div>
        <div class="form-group"><label class="form-label">Follow-up After (days)</label>
          <input class="input" name="followUpAfterDays" type="number" value="${c.followUpAfterDays||3}" min="0" /></div>
      </div>
      <div class="form-group"><label class="form-label">Follow-up Template</label>
        <select class="select" name="followUpTemplateId" id="camp-fu-tpl">${selectOpts(state.templates,"name","id","None")}</select>
        <div class="form-hint">Auto-sent if no reply after N days</div></div>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn btn-primary" id="camp-submit-btn">${isEdit?"Save Changes":"Create Campaign"}</button>
      </div>
    </form>`);
  if (c.contactId) { const sel=document.getElementById("camp-contact"); if(sel) sel.value=c.contactId; }
  if (c.templateId) { const sel=document.getElementById("camp-template"); if(sel) sel.value=c.templateId; }
  if (c.followUpTemplateId) { const sel=document.getElementById("camp-fu-tpl"); if(sel) sel.value=c.followUpTemplateId; }
  const tplSelect = document.getElementById("camp-template"), tplPreview = document.getElementById("camp-tpl-preview");
  function updateTplPreview() {
    const t = state.templates.find(x=>x.id===tplSelect.value);
    tplPreview.textContent = t ? "Preview: "+t.body.slice(0,80)+(t.body.length>80?"\u2026":"") : "";
  }
  tplSelect.addEventListener("change", updateTplPreview);
  updateTplPreview();

  document.getElementById("camp-form").addEventListener("submit", async(e) => {
    e.preventDefault(); const data=formData(e.target);
    const nameI=document.getElementById("camp-name"), nameE=document.getElementById("camp-name-err");
    if (!(data.name||"").trim()) { nameI.classList.add("error"); nameE.textContent="Campaign name is required"; return; }
    nameI.classList.remove("error"); nameE.textContent="";
    if (!isEdit) data.scheduledAt = data.scheduledAt ? new Date(data.scheduledAt).toISOString() : new Date().toISOString();
    await withLoading("camp-submit-btn", async()=>{
      if (isEdit) {
        const r=await api("/api/campaigns/"+c.id,"PUT",data);
        if(r.ok) toast("Campaign updated","success");
      } else {
        const r=await api("/api/campaigns","POST",data);
        if(r.ok) toast("Campaign created","success");
      }
      closeModal(); await refreshAndRender();
    });
  });
}

function openCampaignDetail(id) {
  const c = state.campaigns.find(x=>x.id===id);
  if(!c) return;
  const contact = state.contacts.find(x=>x.id===c.contactId);
  const tpl = state.templates.find(x=>x.id===c.templateId);
  const fuTpl = state.templates.find(x=>x.id===c.followUpTemplateId);
  const m = campaignMetrics(c);
  const thread = state.inbox.find(t=>t.contact?.id===c.contactId);
  const msgs = (thread?.messages||[]).filter(msg=>msg.campaignId===c.id);
  const isScheduled = c.status==="scheduled";
  const isSent = c.status==="sent";

  openModal(esc(c.name), `
    ${campaignTimeline(c)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-2);margin:var(--sp-2) 0;font-size:13px">
      <div><span class="form-label" style="margin-bottom:0">Status</span> ${statusBadge(c.status)}</div>
      <div><span class="form-label" style="margin-bottom:0">Channel</span> <span class="badge badge-info">${esc(c.channel||"sms")}</span></div>
      <div><span class="form-label" style="margin-bottom:0">Contact</span> ${esc(contactName(contact))}</div>
      <div><span class="form-label" style="margin-bottom:0">Template</span> ${esc(tpl?tpl.name:"\u2014")}</div>
      <div><span class="form-label" style="margin-bottom:0">Scheduled</span> ${fmtDate(c.scheduledAt)}</div>
      <div><span class="form-label" style="margin-bottom:0">Sent</span> ${fmtDate(c.sentAt)}</div>
      <div><span class="form-label" style="margin-bottom:0">Follow-up After</span> ${c.followUpAfterDays||0} days</div>
      <div><span class="form-label" style="margin-bottom:0">Follow-up Tpl</span> ${esc(fuTpl?fuTpl.name:"\u2014")}</div>
      <div><span class="form-label" style="margin-bottom:0">Messages</span> <strong>${m.msgs}</strong></div>
      <div><span class="form-label" style="margin-bottom:0">Replies</span> <strong>${m.replies}</strong></div>
      ${c.followUpQueuedAt?`<div style="grid-column:1/-1"><span class="form-label" style="margin-bottom:0">Follow-up Queued</span> ${fmtDate(c.followUpQueuedAt)}</div>`:''}
      ${c.failureReason?`<div style="grid-column:1/-1"><div class="banner banner-danger" style="margin:0">${esc(c.failureReason)}</div></div>`:""}
    </div>
    <div style="display:flex;gap:var(--sp-2);margin-bottom:var(--sp-2)">
      ${isScheduled?'<button class="btn btn-primary btn-sm" id="camp-detail-run">Run Send Now</button>':''}
      ${isSent && c.followUpTemplateId && !c.followUpQueuedAt?'<button class="btn btn-sm" id="camp-detail-followup">Run Follow-up</button>':''}
      <button class="btn btn-sm" data-action="edit-campaign" data-id="${c.id}">Edit</button>
      <button class="btn btn-sm btn-ghost" data-action="duplicate-campaign" data-id="${c.id}">Duplicate</button>
    </div>
    ${msgs.length?`<div class="card-header" style="margin-top:var(--sp-1)"><h3>Messages (${msgs.length})</h3></div>
      ${msgs.map(msg=>`<div class="message ${msg.direction||"outbound"}"><div class="message-bubble">${esc(msg.body)}</div><div class="message-meta">${esc(msg.direction||"")} \u00b7 ${fmtDate(msg.createdAt)}</div></div>`).join("")}`
      :'<div class="empty-state" style="padding:var(--sp-2)"><div class="empty-state-text">No messages yet</div></div>'}
  `, {wide:true});

  const runBtn = document.getElementById("camp-detail-run");
  if (runBtn) runBtn.addEventListener("click", async()=>{
    await withLoading(runBtn, async()=>{
      const r=await api("/api/campaigns/run","POST",{});
      toast(r.ok?"Sends executed":"Send failed",r.ok?"success":"error");
      closeModal(); await refreshAndRender();
    });
  });
  const fuBtn = document.getElementById("camp-detail-followup");
  if (fuBtn) fuBtn.addEventListener("click", async()=>{
    await withLoading(fuBtn, async()=>{
      const r=await api("/api/automation/run-followups","POST",{});
      toast(r.ok?"Follow-ups checked":"Check failed",r.ok?"success":"error");
      closeModal(); await refreshAndRender();
    });
  });
}

function duplicateCampaign(id) {
  const c = state.campaigns.find(x=>x.id===id);
  if(!c) return;
  openCampaignModal({ name:c.name+" (copy)", contactId:c.contactId, templateId:c.templateId, channel:c.channel, followUpAfterDays:c.followUpAfterDays, followUpTemplateId:c.followUpTemplateId });
}

async function archiveCampaign(id) {
  await api("/api/campaigns/"+id,"DELETE");
  toast("Campaign deleted","success");
  await refreshAndRender();
}

async function runCampaigns(btn) {
  await withLoading(btn, async()=>{
    const r=await api("/api/campaigns/run","POST",{});
    toast(r.ok?"Sends executed":"Send failed",r.ok?"success":"error");
    await refreshAndRender();
  });
}
async function runFollowups(btn) {
  await withLoading(btn, async()=>{
    const r=await api("/api/automation/run-followups","POST",{});
    toast(r.ok?"Follow-ups checked":"Check failed",r.ok?"success":"error");
    await refreshAndRender();
  });
}

registerActions({
  "open-campaign-modal": () => openCampaignModal(),
  "open-campaign-detail": (el) => openCampaignDetail(el.dataset.id),
  "edit-campaign": (el) => openCampaignModal(state.campaigns.find(c=>c.id===el.dataset.id)),
  "duplicate-campaign": (el) => duplicateCampaign(el.dataset.id),
  "archive-campaign": (el) => confirmAction("Delete campaign \u201c"+el.dataset.name+"\u201d? This cannot be undone.", ()=>archiveCampaign(el.dataset.id), {destructive:true, confirmLabel:"Delete"}),
  "filter-campaigns": (el) => { _campaignFilter = el.dataset.filter; renderPage(); },
  "run-campaigns": (el) => runCampaigns(el),
  "run-followups": (el) => runFollowups(el),
});

/* ======================== EXPORTS ======================== */
window.renderDashboard=renderDashboard;
window.renderContacts=renderContacts; window.bindContactSearch=bindContactSearch;
window.renderTemplates=renderTemplates;
window.renderCampaigns=renderCampaigns; window.bindCampaignToolbar=bindCampaignToolbar;
