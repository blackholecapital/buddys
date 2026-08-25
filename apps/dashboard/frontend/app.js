/* app.js — boot, render loop, central event delegation */

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function boot() {
  await loadScript("/lib/core.js");
  await loadScript("/lib/views-main.js");
  await loadScript("/lib/views-messaging.js");
  await loadScript("/lib/views-admin.js");

  setupDelegation();

  document.getElementById("menuToggle").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("open");
  });

  // Close sidebar when clicking outside on mobile
  document.querySelector(".main").addEventListener("click", () => {
    document.getElementById("sidebar").classList.remove("open");
  });

  initRouting();
  renderNav();
  renderUtilityBar();
  await refresh();
  renderPage();
  startSyncTimer();
}

window.renderPage = async function renderPage() {
  const view = document.getElementById("view");
  renderNav();
  renderBreadcrumb();
  renderUtilityBar();

  const showLoading = () => {
    view.innerHTML = '<div style="text-align:center;padding:var(--sp-8)"><div class="spinner" style="margin:0 auto"></div><div class="form-hint" style="margin-top:var(--sp-2)">Loading\u2026</div></div>';
  };

  if (currentPage() === "health") { showLoading(); view.innerHTML = await renderHealth(); bindPageActions(); return; }
  if (currentPage() === "reconciliation") { showLoading(); view.innerHTML = await renderReconciliation(); bindPageActions(); return; }

  const views = {
    dashboard: renderDashboard, contacts: renderContacts, templates: renderTemplates,
    campaigns: renderCampaigns, inbox: renderInbox, conversations: renderConversations,
    activity: renderActivity, settings: renderSettings, "rate-limits": renderRateLimits,
  };

  const renderer = views[currentPage()];
  view.innerHTML = renderer ? renderer() : '<div class="card"><div class="empty-state"><div class="empty-state-title">Page not found</div></div></div>';
  bindPageActions();
};

function bindPageActions() {
  const page = currentPage();
  if (page === "contacts") bindContactSearch();
  if (page === "inbox") bindInboxForms();
  if (page === "settings") bindSettingsForm();
  if (page === "campaigns") bindCampaignToolbar();
  if (page === "conversations") bindConversationComposer();
}

boot();
