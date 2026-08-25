/* app.js — boot, render loop, central event delegation */

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function boot() {
  if (!window.location.hash)
    window.location.hash = "#dashboard";

  await loadScript("/operator/lib/core.js?v=buddy-mobile-5");
  await loadScript("/operator/lib/views-main.js?v=buddy-mobile-5");
  await loadScript("/operator/lib/views-messaging.js?v=buddy-mobile-5");
  await loadScript("/operator/lib/buddy-enrichment.js?v=buddy-mobile-5");
  await loadScript("/operator/lib/views-admin.js?v=buddy-mobile-5");

  setupDelegation();

  const sidebar = document.getElementById("sidebar");
  const menuToggle = document.getElementById("menuToggle");

  menuToggle.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const open = sidebar.classList.toggle("open");
    menuToggle.setAttribute("aria-expanded", open ? "true" : "false");
  });

  // Keep taps inside the mobile drawer from immediately closing it.
  sidebar.addEventListener("click", (event) => event.stopPropagation());

  document.querySelector(".main").addEventListener("click", () => {
    sidebar.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
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
    dashboard: renderDashboard,
    contacts: renderContacts,
    templates: renderTemplates,
    campaigns: renderCampaigns,
    inbox: renderInbox,
    conversations: renderConversations,
    activity: renderActivity,
    settings: renderSettings,
    health: renderHealth,
    reconciliation: renderReconciliation,
    "rate-limits": renderRateLimits,
  };

  try {
    const renderer = views[currentPage()];
    const html = renderer ? await renderer() : '<div class="card"><div class="empty-state"><div class="empty-state-title">Page not found</div></div></div>';
    view.innerHTML = html;
    bindPageActions();
  } catch (e) {
    console.error("PAGE RENDER FAILED", currentPage(), e);
    view.innerHTML = "<pre style='padding:24px;color:#f66;background:#111;overflow:auto'>" + e.stack + "</pre>";
  }
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
