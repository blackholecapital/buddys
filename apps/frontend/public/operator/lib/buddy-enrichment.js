/* Buddy voice/activity enrichment for the legacy operator dashboard. */
let _buddySelectedCall = "";

async function loadBuddyTelemetry(limit = 2000) {
  const result = await api(`/api/buddy-events?limit=${limit}`);
  return result?.ok ? (result.data || { events:[], conversations:[] }) : { events:[], conversations:[] };
}

function buddyContact(id) {
  return (state.contacts || []).find(c => c.id === id) || null;
}

function buddyName(id) {
  const c = buddyContact(id);
  return c ? contactName(c) : (id || "Unknown customer");
}

function eventLabel(event) {
  const type = String(event?.type || "buddy.event");
  const p = event?.payload || {};
  const labels = {
    "lead.created":"Lead created",
    "sms.sent":"SMS sent",
    "sms.queued":"SMS queued",
    "sms.sent":"SMS sent",
    "sms.delivered":"SMS delivered",
    "sms.failed":"SMS failed",
    "sms.reply":"SMS reply received",
    "email.sent":"Email sent",
    "email.failed":"Email failed",
    "call.requested":"Call requested",
    "call.created":"Call created",
    "call.initiated":"Call initiated",
    "call.ringing":"Call ringing",
    "call.answered":"Call answered",
    "call.in-progress":"Call connected",
    "call.completed":"Call completed",
    "call.failed":"Call failed",
    "docusign.sent":"DocuSign agreement sent",
    "docusign.webhook":"DocuSign status update",
    "delivery.scheduled":"Delivery scheduled",
    "buddy.product.selection-preparing":"Product selected",
    "buddy.product.selection-sent":"Agreement instructions sent",
    "buddy.product.selection-failed":"Agreement generation failed",
    "buddy.docusign.signed-acknowledged":"Signed agreement confirmed",
    "buddy.delivery.scheduling":"Delivery scheduling started",
    "buddy.delivery.confirmed":"Delivery confirmed",
    "buddy.delivery.options-failed":"Delivery options failed",
  };
  if (labels[type]) return labels[type];
  if (type === "stt.transcript.final") return "Customer spoke";
  if (type === "buddy.turn.completed") return "Buddy responded";
  if (type === "stream.media.started") return "Voice stream started";
  if (type === "stream.media.stopped") return "Voice stream ended";
  if (type.startsWith("sms.")) return `SMS ${type.slice(4)}`;
  if (type.startsWith("email.")) return `Email ${type.slice(6)}`;
  if (type.startsWith("call.")) return `Call ${type.slice(5)}`;
  return type;
}

function eventMessage(event) {
  const p = event?.payload || {};
  const type = String(event?.type || "");
  if (event?.text) return event.text;
  if (p.message) return p.message;
  if (p.response) return p.response;
  if (p.transcript) return p.transcript;
  if (type === "email.sent") return p.subject || "Buddy email sent";
  if (type === "sms.sent" || type === "sms.delivered") return p.messageType ? `${p.messageType} message` : "Buddy SMS";
  if (type === "docusign.sent") return p.productName ? `Agreement sent for ${p.productName}` : "Agreement sent";
  if (type === "docusign.webhook") return p.status ? `DocuSign ${p.status}` : "DocuSign status update";
  if (type === "delivery.scheduled") return p.productName ? `${p.productName} delivery booked` : "Delivery booked";
  return eventLabel(event);
}

function buddyDetail(event) {
  const p = event?.payload || {};
  const bits = [];
  if (p.messageType) bits.push(`Message: ${p.messageType}`);
  if (p.provider) bits.push(`Provider: ${p.provider}`);
  if (p.to) bits.push(`To: ${p.to}`);
  if (p.subject) bits.push(`Subject: ${p.subject}`);
  if (p.messageId) bits.push(`Message ID: ${p.messageId}`);
  if (p.messageSid) bits.push(`Message SID: ${p.messageSid}`);
  if (p.productName || p.selectedProduct) bits.push(`Product: ${p.productName || p.selectedProduct}`);
  if (p.agreementId) bits.push(`Agreement: ${p.agreementId}`);
  if (p.envelopeId) bits.push(`Envelope: ${p.envelopeId}`);
  if (p.calendarEventId) bits.push(`Calendar: ${p.calendarEventId}`);
  if (p.deliveryAt) bits.push(`Delivery: ${new Date(p.deliveryAt).toLocaleString("en-US", { timeZone:"America/New_York", timeZoneName:"short" })}`);
  if (p.status) bits.push(`Status: ${p.status}`);
  if (p.latencyMs) bits.push(`Latency: ${p.latencyMs} ms`);
  if (p.errorCode) bits.push(`Error code: ${p.errorCode}`);
  if (p.error) bits.push(`Error: ${p.error}`);
  if (event.callSid) bits.push(`Call: ${event.callSid}`);
  return bits.join(" · ");
}

renderConversations = async function renderBuddyConversations() {
  const data = await loadBuddyTelemetry(2000);
  const calls = (data.conversations || []).filter(c => c.callSid || (c.transcript || []).length);
  if (!calls.length) {
    return `<div class="page-header"><h2>Conversations <span class="badge badge-muted">0 voice calls</span></h2></div>
      <div class="card"><div class="empty-state"><div class="empty-state-title">No Buddy voice transcripts captured yet</div><div class="empty-state-text">Voice calls will appear here from the communication event stream.</div></div></div>`;
  }

  let selected = calls.find(c => c.callSid === _buddySelectedCall) || calls[0];
  _buddySelectedCall = selected.callSid || "";
  const contact = buddyContact(selected.contactId);
  const selectedProduct = contact?.selectedProduct || contact?.interest || "";
  const durationMs = Math.max(0, Number(selected.endedAt || 0) - Number(selected.startedAt || 0));
  const duration = durationMs ? `${Math.floor(durationMs/60000)}m ${Math.floor((durationMs%60000)/1000)}s` : "—";

  return `
    <div class="page-header"><h2>Conversations <span class="badge badge-muted" style="font-size:12px">${calls.length} voice call${calls.length===1?"":"s"}</span></h2></div>
    <div class="split">
      <div class="split-list" id="buddy-call-list">
        ${calls.map(c => {
          const cContact = buddyContact(c.contactId);
          const transcript = c.transcript || [];
          const active = c.callSid === selected.callSid;
          const product = cContact?.selectedProduct || cContact?.interest || "";
          return `<div class="split-item${active?" active":""}" data-action="select-buddy-call" data-id="${esc(c.callSid || "")}" role="option" aria-selected="${active}">
            <div style="display:flex;justify-content:space-between;gap:8px"><span class="split-item-name">${esc(buddyName(c.contactId))}</span><span class="badge badge-info">VOICE</span></div>
            <div class="split-item-meta">${transcript.length} turns · ${fmtDate(c.startedAt)}</div>
            <div class="split-item-preview">${esc(product || c.callSid || "Buddy call")}</div>
          </div>`;
        }).join("")}
      </div>
      <div class="split-detail visible">
        <div class="split-detail-header">
          <div><strong>${esc(buddyName(selected.contactId))}</strong> <span class="badge badge-info">VOICE</span>${selectedProduct?` <span class="badge badge-muted">${esc(selectedProduct)}</span>`:""}</div>
          <div style="font-size:11px;color:var(--c-text-muted)">${esc(duration)} · ${esc(selected.callSid || "")}</div>
        </div>
        <div class="message-list" id="convo-message-list" style="padding:var(--sp-3)">
          ${(selected.transcript || []).length ? selected.transcript.map(turn => `
            <div class="message ${turn.role === "customer" ? "inbound" : "outbound"}" style="margin-bottom:var(--sp-2)">
              <div class="message-bubble">${esc(turn.text || "")}</div>
              <div class="message-meta"><strong>${turn.role === "customer" ? "Customer" : "Buddy"}</strong> · ${fmtDate(turn.at)}</div>
            </div>`).join("") : `<div class="empty-state"><div class="empty-state-text">This call has lifecycle telemetry but no transcript turns stored.</div></div>`}
        </div>
        <div style="border-top:1px solid var(--c-border);padding:var(--sp-2) var(--sp-3);font-size:11px;color:var(--c-text-muted)">
          Contact ID: ${esc(selected.contactId || "—")} · Events: ${(selected.events || []).length}
        </div>
      </div>
    </div>`;
};

renderActivity = async function renderBuddyActivity() {
  const data = await loadBuddyTelemetry(2000);
  const buddy = (data.events || []).map(e => ({
    source:"Buddy",
    createdAt:e.createdAt,
    type:e.type || "buddy.event",
    contactId:e.contactId || "",
    message:eventMessage(e),
    detail:buddyDetail(e),
  }));
  const generic = (state.activity || []).map(a => ({
    source:"CRM",
    createdAt:a.createdAt,
    type:a.type || "event",
    contactId:a.entityId || a.contactId || "",
    message:a.message || "",
    detail:a.metadata ? Object.entries(a.metadata).slice(0,8).map(([k,v])=>`${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ") : "",
  }));
  const rows = [...buddy, ...generic].sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime()).slice(0,750);

  return `
    <div class="page-header"><h2>Activity Log <span class="badge badge-muted" style="font-size:12px">${rows.length}</span></h2></div>
    <div class="page-toolbar"><button class="btn btn-sm" data-action="refresh-page">Refresh</button></div>
    <div class="card">
      ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Source</th><th>Customer</th><th>Type</th><th>Event</th><th>Details</th></tr></thead><tbody>
        ${rows.map(row => `<tr>
          <td style="white-space:nowrap;font-size:11px;color:var(--c-text-muted)">${fmtDate(row.createdAt)}</td>
          <td><span class="badge ${row.source === "Buddy" ? "badge-info" : "badge-muted"}">${esc(row.source)}</span></td>
          <td class="table-bold">${esc(row.contactId ? buddyName(row.contactId) : "—")}</td>
          <td><span class="badge badge-muted" style="font-size:9px">${esc(row.type)}</span></td>
          <td style="min-width:220px"><strong>${esc(row.source === "Buddy" ? eventLabel({type:row.type}) : row.type)}</strong>${row.message && row.message !== row.type ? `<div class="table-meta" style="margin-top:3px;white-space:normal">${esc(row.message)}</div>` : ""}</td>
          <td class="table-meta" style="max-width:440px;white-space:normal">${esc(row.detail || "")}</td>
        </tr>`).join("")}
      </tbody></table></div>` : `<div class="empty-state"><div class="empty-state-title">No activity</div></div>`}
    </div>`;
};

registerActions({
  "select-buddy-call": (el) => { _buddySelectedCall = el.dataset.id || ""; renderPage(); },
});
