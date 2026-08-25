/* Views: Inbox, Conversations, Activity */

let _selectedConvo = null;

/* ======================== INBOX ======================== */
function renderInbox() {
  const hasContacts = state.contacts.length > 0;
  const totalMsgs = state.inbox.reduce((n, t) => n + (t.messages || []).length, 0);
  return `
    <div class="page-header"><h2>Inbox <span class="badge badge-muted" style="font-size:12px;vertical-align:middle;margin-left:var(--sp-1)">${totalMsgs} messages</span></h2></div>
    <div class="card-grid" style="margin-bottom:var(--sp-3)">
      <div class="card"><div class="card-header"><h3>Send Message</h3></div>
        ${hasContacts ? `<form id="send-form" novalidate>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Contact<span class="required">*</span></label>
              <select class="select" name="contactId">${selectOpts(state.contacts, "firstName")}</select></div>
            <div class="form-group"><label class="form-label">Channel</label>
              <select class="select" name="channel"><option value="sms">SMS</option><option value="email">Email</option></select></div>
          </div>
          <div class="form-group"><label class="form-label" for="send-body">Message<span class="required">*</span></label>
            <textarea class="textarea" name="body" id="send-body" rows="2" required></textarea>
            <div class="form-error" id="send-body-err"></div></div>
          <div class="form-actions"><button type="submit" class="btn btn-primary" id="send-submit-btn">Send</button></div>
        </form>` : `<div class="empty-state"><div class="empty-state-text">Add a contact first</div>
          <button class="btn btn-primary btn-sm" data-action="navigate" data-to="contacts">Go to Contacts</button></div>`}
      </div>
      <div class="card"><div class="card-header"><h3>Simulate Inbound Reply</h3></div>
        ${hasContacts ? `<form id="reply-form" novalidate>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Contact</label>
              <select class="select" name="contactId">${selectOpts(state.contacts, "firstName")}</select></div>
            <div class="form-group"><label class="form-label">Campaign</label>
              <select class="select" name="campaignId">${selectOpts(state.campaigns, "name", "id", "None")}</select></div>
          </div>
          <div class="form-group"><label class="form-label" for="reply-body">Reply Text</label>
            <textarea class="textarea" name="body" id="reply-body" rows="2"></textarea>
            <div class="form-hint">Type STOP, UNSUBSCRIBE, or END to test opt-out</div></div>
          <div class="form-actions"><button type="submit" class="btn" id="reply-submit-btn">Send Reply</button></div>
        </form>` : `<div class="empty-state"><div class="empty-state-text">Add a contact first</div></div>`}
      </div>
    </div>
    <div class="card"><div class="card-header"><h3>Message Threads</h3>
      <span class="badge badge-muted">${state.inbox.length} contact${state.inbox.length !== 1 ? "s" : ""}</span></div>
      ${state.inbox.length ? state.inbox.map(thread => {
        const name = contactName(thread.contact);
        const msgs = thread.messages || [];
        const hasInbound = msgs.some(m => m.direction === "inbound");
        const isOptedOut = thread.contact?.optedOut;
        const lastMsg = msgs[msgs.length - 1];
        return `
        <div style="padding:var(--sp-2) var(--sp-3);border-bottom:1px solid var(--c-border-light)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-1)">
            <div style="display:flex;align-items:center;gap:var(--sp-2)">
              <strong style="font-size:13px"><span class="avatar-dot">${esc(name.slice(0,2).toUpperCase())}</span>${esc(name)}</strong>
              ${hasInbound ? '<span class="badge badge-success" style="font-size:9px">replied</span>' : ''}
              ${isOptedOut ? '<span class="badge badge-danger" style="font-size:9px">opted out</span>' : ''}
            </div>
            <span style="font-size:11px;color:var(--c-text-muted)">${msgs.length} msg${msgs.length !== 1 ? "s" : ""}${lastMsg ? ' \u00b7 ' + fmtDateShort(lastMsg.createdAt) : ''}</span>
          </div>
          ${msgs.slice(-3).map(m => `
            <div class="message ${m.direction || "outbound"}" style="margin-bottom:var(--sp-1)">
              <div class="message-bubble">${esc(m.body || "")}</div>
              <div class="message-meta">${esc(m.direction || "")} \u00b7 <span class="badge badge-info channel-chip">${esc((m.channel || "sms").toUpperCase())}</span> \u00b7 ${fmtDate(m.createdAt)}${m.status === "failed" ? ' \u00b7 <span class="badge badge-danger" style="font-size:9px">failed</span>' : ""}</div>
            </div>`).join("")}
          ${msgs.length > 3 ? `<div style="font-size:11px;color:var(--c-text-muted);padding:2px 0">+${msgs.length - 3} older</div>` : ""}
        </div>`;
      }).join("") : `<div class="empty-state"><div class="empty-state-icon">\u2709</div><div class="empty-state-title">No messages yet</div><div class="empty-state-text">Send a message or create a campaign to get started</div></div>`}
    </div>`;
}

function bindInboxForms() {
  const sf = document.getElementById("send-form");
  if (sf) sf.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = formData(sf);
    const bodyInput = document.getElementById("send-body"), bodyErr = document.getElementById("send-body-err");
    if (!(data.body || "").trim()) { bodyInput.classList.add("error"); bodyErr.textContent = "Message body is required"; return; }
    bodyInput.classList.remove("error"); bodyErr.textContent = "";
    await withLoading("send-submit-btn", async () => {
      const r = await api("/api/inbox/send", "POST", data);
      if (r.ok) toast("Message sent", "success");
      sf.reset();
      await refreshAndRender();
    });
  });

  const rf = document.getElementById("reply-form");
  if (rf) rf.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = formData(rf);
    data.mode = "reply";
    await withLoading("reply-submit-btn", async () => {
      const r = await api("/api/inbox/reply", "POST", data);
      if (r.ok && r.data?.stopWordDetected) {
        const cid = data.contactId;
        const contact = state.contacts.find(c => c.id === cid);
        openModal("STOP Word Detected", `
          <div class="banner banner-danger">This reply contains a stop word. The contact will be opted out.</div>
          <p style="margin-bottom:var(--sp-3)">${contact ? "Contact: <strong>" + esc(contactName(contact)) + "</strong>" : ""}</p>
          <div class="form-actions">
            <button class="btn" id="stop-dismiss-btn">Dismiss</button>
            <button class="btn btn-danger" id="stop-optout-btn">Opt Out Contact</button>
          </div>`);
        document.getElementById("stop-dismiss-btn").addEventListener("click", async () => { closeModal(); await refreshAndRender(); });
        document.getElementById("stop-optout-btn").addEventListener("click", async () => {
          await withLoading("stop-optout-btn", async () => {
            await api("/api/compliance/opt-out", "POST", { contactId: cid, reason: "STOP detected" });
            toast("Contact opted out", "success");
            closeModal(); await refreshAndRender();
          });
        });
        return;
      }
      if (r.ok) toast("Reply recorded", "success");
      rf.reset();
      await refreshAndRender();
    });
  });
}

/* ======================== CONVERSATIONS ======================== */
function renderConversations() {
  const convos = state.conversations || [];

  // Preserve selection: if selected convo still exists, keep it; otherwise fall back to first
  let sel = null;
  if (_selectedConvo) {
    sel = convos.find(c => c.id === _selectedConvo);
  }
  if (!sel && convos.length) {
    sel = convos[0];
    _selectedConvo = sel.id;
  }

  // Build message list and contact info for selected conversation
  const selThread = sel ? state.inbox.find(t => t.contact?.id === sel.contactId) : null;
  const selMsgs = sel ? ((selThread?.messages || []).filter(m => !sel.campaignId || m.campaignId === sel.campaignId)) : [];
  const selContact = sel ? state.contacts.find(c => c.id === sel.contactId) : null;
  const selOptedOut = selContact?.optedOut;

  return `
    <div class="page-header"><h2>Conversations <span class="badge badge-muted" style="font-size:12px;vertical-align:middle;margin-left:var(--sp-1)">${convos.length}</span></h2></div>
    ${convos.length ? `<div class="split">
      <div class="split-list" id="convo-list">
        ${convos.map(c => {
          const contact = state.contacts.find(x => x.id === c.contactId);
          const thread = state.inbox.find(t => t.contact?.id === c.contactId);
          const msgs = (thread?.messages || []).filter(m => !c.campaignId || m.campaignId === c.campaignId);
          const lastMsg = msgs[msgs.length - 1];
          const lastIsInbound = lastMsg && lastMsg.direction === "inbound";
          const hasInbound = msgs.some(m => m.direction === "inbound");
          const isOptedOut = contact?.optedOut;
          const isActive = sel && sel.id === c.id;
          const unreadCls = lastIsInbound && !isOptedOut ? " unread" : "";
          return `<div class="split-item${isActive ? " active" : ""}${unreadCls}" data-action="select-convo" data-id="${c.id}" role="option" aria-selected="${isActive}">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span class="split-item-name">${esc(contactName(contact))}</span>
              <div style="display:flex;align-items:center;gap:var(--sp-1)">
                ${isOptedOut ? '<span class="badge badge-danger" style="font-size:9px">opted out</span>' : hasInbound ? '<span class="badge badge-success" style="font-size:9px">replied</span>' : ''}
              </div>
            </div>
            <div class="split-item-meta">${esc(c.channel || "sms")} \u00b7 ${msgs.length} msg${msgs.length !== 1 ? "s" : ""} \u00b7 ${statusBadge(c.status)}</div>
            <div class="split-item-preview">${lastMsg ? fmtDateShort(lastMsg.createdAt) : fmtDateShort(c.createdAt)}</div>
          </div>`;
        }).join("")}
      </div>
      <div class="split-detail${sel ? " visible" : ""}">
        ${sel ? `<div class="split-detail-header">
          <div style="display:flex;align-items:center;gap:var(--sp-2)">
            <strong>${esc(contactName(selContact))}</strong>
            <span class="badge badge-info channel-chip">${esc((sel.channel || "sms").toUpperCase())}</span>
            ${selOptedOut ? '<span class="badge badge-danger">Opted Out</span>' : ""}
          </div>
          <div style="display:flex;align-items:center;gap:var(--sp-2)">
            <span class="badge badge-muted">${selMsgs.length} message${selMsgs.length !== 1 ? "s" : ""}</span>
            ${statusBadge(sel.status || "")}
          </div>
        </div>
        <div class="message-list" id="convo-message-list">
          ${selMsgs.length ? selMsgs.map(m => `<div class="message ${m.direction || "outbound"}">
            <div class="message-bubble">${esc(m.body || "")}</div>
            <div class="message-meta">${fmtDate(m.createdAt)} \u00b7 ${statusBadge(m.status)}</div>
          </div>`).join("") : '<div class="empty-state" style="padding:var(--sp-4)"><div class="empty-state-text">No messages in this conversation</div></div>'}
        </div>
        ${!selOptedOut ? `<div class="composer">
          <form id="convo-composer-form" style="display:flex;gap:var(--sp-2);width:100%">
            <input type="hidden" name="contactId" value="${esc(sel.contactId)}" />
            <input type="hidden" name="channel" value="${esc(sel.channel || "sms")}" />
            <input class="input" name="body" placeholder="Type a reply\u2026" autocomplete="off" required />
            <button type="submit" class="btn btn-primary" id="convo-send-btn">Send</button>
          </form>
        </div>` : `<div style="padding:var(--sp-2) 0;text-align:center;font-size:12px;color:var(--c-text-muted);border-top:1px solid var(--c-border)">This contact has opted out. Replies are disabled.</div>`}
        ` : '<div class="empty-state" style="padding:var(--sp-4)"><div class="empty-state-text">Select a conversation</div></div>'}
      </div>
    </div>` : `<div class="card"><div class="empty-state"><div class="empty-state-icon">\u2637</div><div class="empty-state-title">No conversations</div><div class="empty-state-text">Conversations are created when messages are sent or received</div></div></div>`}`;
}

function bindConversationComposer() {
  const form = document.getElementById("convo-composer-form");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = formData(form);
    if (!(data.body || "").trim()) return;
    const savedConvo = _selectedConvo;
    await withLoading("convo-send-btn", async () => {
      const r = await api("/api/inbox/send", "POST", data);
      if (r.ok) toast("Message sent", "success");
      _selectedConvo = savedConvo;
      await refreshAndRender();
      // Scroll message list to bottom after re-render
      requestAnimationFrame(() => {
        const ml = document.getElementById("convo-message-list");
        if (ml) ml.scrollTop = ml.scrollHeight;
      });
    });
  });

  // Scroll message list to bottom on initial load
  requestAnimationFrame(() => {
    const ml = document.getElementById("convo-message-list");
    if (ml) ml.scrollTop = ml.scrollHeight;
  });
}

registerActions({
  "select-convo": (el) => { _selectedConvo = el.dataset.id; renderPage(); },
});

/* ======================== ACTIVITY ======================== */
function renderActivity() {
  return `
    <div class="page-header"><h2>Activity Log <span class="badge badge-muted" style="font-size:12px;vertical-align:middle;margin-left:var(--sp-1)">${state.activity.length}</span></h2></div>
    <div class="page-toolbar">
      <button class="btn btn-sm" data-action="refresh-page" id="btn-refresh-activity">Refresh</button>
    </div>
    <div class="card">
      ${state.activity.length ? `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Type</th><th>Event</th></tr></thead><tbody>
        ${state.activity.slice(0, 100).map(a => {
          const typeBadge = {
            "campaign.sent": "badge-success", "campaign.failed": "badge-danger", "campaign.scheduled": "badge-info", "campaign.created": "badge-info",
            "message.sent": "badge-success", "message.failed": "badge-danger", "message.received": "badge-success",
            "contact.created": "badge-info", "contact.optedOut": "badge-warning",
            "followup.sent": "badge-success", "followup.queued": "badge-warning",
          };
          return `<tr>
          <td style="white-space:nowrap;font-size:12px;color:var(--c-text-muted)">${fmtDate(a.createdAt)}</td>
          <td><span class="badge ${typeBadge[a.type] || "badge-muted"}" style="font-size:10px">${esc(a.type || "event")}</span></td>
          <td>${esc(a.message || "")}</td>
        </tr>`;
        }).join("")}
      </tbody></table></div>` : `<div class="empty-state"><div class="empty-state-icon">\u23F1</div><div class="empty-state-title">No activity</div><div class="empty-state-text">Activity events appear here as you use the system</div></div>`}
    </div>`;
}

registerActions({
  "refresh-page": (el) => withLoading(el, refreshAndRender),
});

/* ======================== EXPORTS ======================== */
window.renderInbox = renderInbox; window.bindInboxForms = bindInboxForms;
window.renderConversations = renderConversations; window.bindConversationComposer = bindConversationComposer;
window.renderActivity = renderActivity;
