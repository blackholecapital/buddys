/* Views: Settings, Health, Reconciliation, Rate Limits */

/* ======================== SETTINGS ======================== */
function renderSettings() {
  const s = state.settings;
  if (!s) return loadingSkeleton(3);
  return `
    <div class="page-header"><h2>Settings</h2></div>
    <div class="card-grid">
      <div class="card"><div class="card-header"><h3>Organization</h3></div>
        <form id="settings-form" novalidate>
          <div class="form-group"><label class="form-label" for="set-orgName">Organization Name</label>
            <input class="input" name="orgName" id="set-orgName" value="${esc(s.orgName)}" /></div>
          <div class="form-group"><label class="form-label">Default Channel</label>
            <select class="select" name="defaultChannel">
              <option value="sms"${(s.defaultChannel||"sms")==="sms"?" selected":""}>SMS</option>
              <option value="email"${s.defaultChannel==="email"?" selected":""}>Email</option>
            </select></div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Rate Limit / minute</label>
              <input class="input" type="number" name="perMinute" value="${s.rateLimits?.perMinute||10}" min="1" /></div>
            <div class="form-group"><label class="form-label">Rate Limit / hour</label>
              <input class="input" type="number" name="perHour" value="${s.rateLimits?.perHour||100}" min="1" /></div>
          </div>
          <div class="form-actions"><button type="submit" class="btn btn-primary" id="settings-submit-btn">Save Settings</button></div>
        </form>
      </div>
      <div class="card"><div class="card-header"><h3>Compliance</h3></div>
        <div class="form-group"><label class="form-label">Stop Words</label>
          <div style="display:flex;flex-wrap:wrap;gap:var(--sp-1)">${(s.compliance?.stopWords||[]).map(w=>`<span class="badge badge-danger">${esc(w)}</span>`).join("")||'<span class="form-hint">None configured</span>'}</div>
          <div class="form-hint" style="margin-top:var(--sp-1)">Inbound messages with these words trigger auto opt-out</div>
        </div>
        <div class="form-group"><label class="form-label">Providers</label>
          <div style="display:flex;gap:var(--sp-3)">
            <div><span class="table-meta">SMS:</span> <span class="badge badge-info">${esc(s.providers?.sms||"mock")}</span></div>
            <div><span class="table-meta">Email:</span> <span class="badge badge-info">${esc(s.providers?.email||"mock")}</span></div>
          </div>
        </div>
      </div>
      <div class="card"><div class="card-header"><h3>Roles &amp; Permissions</h3></div>
        ${state.roles ? `
          <div class="form-group"><label class="form-label">Current User</label>
            <div><strong>${esc(state.roles.currentUser?.name||"\u2014")}</strong> <span class="badge badge-info">${esc(state.roles.currentUser?.role||"\u2014")}</span></div></div>
          <div class="form-group"><label class="form-label">Permission Matrix</label>
            ${Object.entries(state.roles.permissions||{}).map(([role,perms])=>`<div style="margin-bottom:var(--sp-2)">
              <strong style="font-size:12px">${esc(role)}</strong><div style="display:flex;flex-wrap:wrap;gap:2px;margin-top:2px">${(perms||[]).map(p=>`<span class="badge badge-muted">${esc(p)}</span>`).join("")}</div>
            </div>`).join("")}
          </div>` : '<div class="empty-state"><div class="empty-state-text">Role data unavailable</div></div>'}
      </div>
    </div>`;
}

function bindSettingsForm() {
  const f = document.getElementById("settings-form");
  if (!f) return;
  f.addEventListener("submit", async(e) => {
    e.preventDefault();
    const d = formData(f);
    await withLoading("settings-submit-btn", async()=>{
      await api("/api/settings","PUT",{
        orgName: d.orgName, defaultChannel: d.defaultChannel,
        rateLimits: { perMinute: Number(d.perMinute), perHour: Number(d.perHour) }
      });
      toast("Settings saved","success");
      await refreshAndRender();
    });
  });
}

/* ======================== HEALTH ======================== */
async function renderHealth() {
  const [h, m] = await Promise.all([api("/api/health?metrics=1&dlq=1"), api("/api/health?ready=1")]);
  const hd = h.data || {};
  const ready = m.data?.ready;
  return `
    <div class="page-header"><h2>System Health</h2></div>
    <div class="page-toolbar">
      <button class="btn btn-sm" data-action="refresh-page" id="btn-refresh-health">Refresh</button>
    </div>
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-value">${ready?'<span style="color:var(--c-success)">Ready</span>':'<span style="color:var(--c-danger)">Not Ready</span>'}</div><div class="kpi-label">Readiness</div></div>
      <div class="kpi"><div class="kpi-value">${statusBadge(hd.status)}</div><div class="kpi-label">Status</div></div>
      <div class="kpi"><div class="kpi-value">${esc(hd.runtime||"\u2014")}</div><div class="kpi-label">Runtime</div></div>
      <div class="kpi"><div class="kpi-value">${esc(hd.backend||"\u2014")}</div><div class="kpi-label">Backend</div></div>
      <div class="kpi"><div class="kpi-value">${hd.idempotencyKeys!=null?hd.idempotencyKeys:"\u2014"}</div><div class="kpi-label">Idempotency Keys</div></div>
      <div class="kpi"><div class="kpi-value">${hd.dlqDepth!=null?hd.dlqDepth:"\u2014"}</div><div class="kpi-label">DLQ Depth</div></div>
      ${hd.uptime!=null?`<div class="kpi"><div class="kpi-value">${Math.floor(hd.uptime)}s</div><div class="kpi-label">Uptime</div></div>`:""}
    </div>
    <div class="card-grid">
      ${hd.metrics ? `<div class="card"><div class="card-header"><h3>Metrics</h3></div>
        ${Object.keys(hd.metrics.counters||{}).length ? `<div class="table-wrap"><table><thead><tr><th>Counter</th><th>Value</th></tr></thead><tbody>
          ${Object.entries(hd.metrics.counters).map(([k,v])=>`<tr><td class="table-meta">${esc(k)}</td><td><strong>${v}</strong></td></tr>`).join("")}
        </tbody></table></div>` : '<div class="empty-state"><div class="empty-state-text">No metrics yet</div></div>'}
      </div>` : ""}
      ${(hd.dlqItems||[]).length ? `<div class="card"><div class="card-header"><h3>Dead Letter Queue</h3></div>
        <div class="table-wrap"><table><thead><tr><th>Type</th><th>Error</th><th>Entered</th></tr></thead><tbody>
          ${hd.dlqItems.map(d=>`<tr><td><span class="badge badge-danger">${esc(d.type)}</span></td><td class="truncate">${esc(d.error)}</td><td style="white-space:nowrap" class="table-meta">${fmtDate(d.dlqEnteredAt)}</td></tr>`).join("")}
        </tbody></table></div></div>` : `<div class="card"><div class="card-header"><h3>Dead Letter Queue</h3></div><div class="empty-state"><div class="empty-state-icon">\u2713</div><div class="empty-state-text">DLQ is empty</div></div></div>`}
    </div>`;
}

/* ======================== RECONCILIATION ======================== */
async function renderReconciliation() {
  const r = await api("/api/reconciliation");
  const d = r.data || {};
  const sections = [
    { title:"Overdue Campaigns", count:d.overdueCampaigns?.count, items:d.overdueCampaigns?.items, cols:["ID","Name","Scheduled"], keys:["id","name","scheduledAt"], fmt:[null,null,fmtDate] },
    { title:"Stale Messages", count:d.staleMessages?.count, items:d.staleMessages?.items, cols:["ID","Status","Created"], keys:["id","status","createdAt"], fmt:[null,null,fmtDate] },
    { title:"Opted-Out Conflicts", count:d.conflictCampaigns?.count, items:d.conflictCampaigns?.items, cols:["Campaign","Contact"], keys:["id","contactId"] },
    { title:"Failed Campaigns", count:d.failedCampaigns?.count, items:d.failedCampaigns?.items, cols:["ID","Name","Reason"], keys:["id","name","reason"] },
    { title:"DLQ Items", count:d.dlq?.count, items:d.dlq?.items, cols:["Type","Error"], keys:["type","error"] },
  ];
  const total = sections.reduce((n,s)=>n+(s.count||0),0);
  return `
    <div class="page-header"><h2>Reconciliation ${total?`<span class="badge badge-danger" style="font-size:12px;vertical-align:middle;margin-left:var(--sp-1)">${total} issues</span>`:'<span class="badge badge-success" style="font-size:12px;vertical-align:middle;margin-left:var(--sp-1)">All clear</span>'}</h2></div>
    <div class="page-toolbar">
      <span class="table-meta">${fmtDate(d.generatedAt)}</span>
      <button class="btn btn-sm" data-action="refresh-page" id="btn-refresh-recon">Refresh</button>
    </div>
    <div class="kpi-grid">
      ${sections.map(s=>`<div class="kpi"><div class="kpi-value" style="color:${(s.count||0)>0?"var(--c-danger)":"var(--c-success)"}">${s.count||0}</div><div class="kpi-label">${s.title}</div></div>`).join("")}
    </div>
    ${sections.filter(s=>s.count>0).map(s=>`<div class="card" style="margin-bottom:var(--sp-3)">
      <div class="card-header"><h3>${s.title} (${s.count})</h3></div>
      <div class="table-wrap"><table><thead><tr>${s.cols.map(c=>`<th>${c}</th>`).join("")}</tr></thead><tbody>
        ${(s.items||[]).map(item=>`<tr>${s.keys.map((k,i)=>`<td>${s.fmt&&s.fmt[i]?s.fmt[i](item[k]):esc(item[k]!=null?String(item[k]):"\u2014")}</td>`).join("")}</tr>`).join("")}
      </tbody></table></div></div>`).join("")}
    ${!total?'<div class="card"><div class="empty-state"><div class="empty-state-icon">\u2713</div><div class="empty-state-title">All clear</div><div class="empty-state-text">No reconciliation issues found</div></div></div>':""}`;
}

/* ======================== RATE LIMITS ======================== */
function renderRateLimits() {
  const r = state.rateLimits;
  if (!r) return loadingSkeleton(2);
  const minMax = r.configured?.perMinute || 1;
  const hrMax = r.configured?.perHour || 1;
  const minPct = Math.round((r.usedLastMinute||0)/minMax*100);
  const hrPct = Math.round((r.usedLastHour||0)/hrMax*100);
  const barColor = (pct) => pct > 80 ? "var(--c-danger)" : pct > 50 ? "var(--c-warning)" : "var(--c-primary)";
  return `
    <div class="page-header"><h2>Rate Limits</h2></div>
    <div class="page-toolbar">
      <button class="btn btn-sm" data-action="refresh-page" id="btn-refresh-rl">Refresh</button>
    </div>
    <div class="card-grid">
      <div class="card">
        <div class="card-header"><h3>Per Minute</h3></div>
        <div class="kpi-value">${r.usedLastMinute||0} / ${minMax}</div>
        <div style="background:var(--c-bg);border-radius:4px;height:6px;margin-top:var(--sp-2);overflow:hidden">
          <div style="height:100%;width:${Math.min(minPct,100)}%;background:${barColor(minPct)};border-radius:4px;transition:width .3s"></div>
        </div>
        <div class="form-hint" style="margin-top:2px">${minPct}% utilized</div>
      </div>
      <div class="card">
        <div class="card-header"><h3>Per Hour</h3></div>
        <div class="kpi-value">${r.usedLastHour||0} / ${hrMax}</div>
        <div style="background:var(--c-bg);border-radius:4px;height:6px;margin-top:var(--sp-2);overflow:hidden">
          <div style="height:100%;width:${Math.min(hrPct,100)}%;background:${barColor(hrPct)};border-radius:4px;transition:width .3s"></div>
        </div>
        <div class="form-hint" style="margin-top:2px">${hrPct}% utilized</div>
      </div>
    </div>`;
}

/* ======================== EXPORTS ======================== */
window.renderSettings=renderSettings; window.bindSettingsForm=bindSettingsForm;
window.renderHealth=renderHealth;
window.renderReconciliation=renderReconciliation;
window.renderRateLimits=renderRateLimits;
