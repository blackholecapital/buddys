module.exports = {
  health: {
    get: "GET /api/health",
    readiness: "GET /api/health?ready=1",
    metrics: "GET /api/health?metrics=1",
    dlq: "GET /api/health?dlq=1"
  },
  reconciliation: {
    get: "GET /api/reconciliation"
  },
  dashboard: {
    get: "GET /api/dashboard"
  },
  contacts: {
    list: "GET /api/contacts",
    create: "POST /api/contacts",
    update: "PUT /api/contacts/:id",
    delete: "DELETE /api/contacts/:id",
    import: "POST /api/contacts/import"
  },
  templates: {
    list: "GET /api/templates",
    create: "POST /api/templates",
    update: "PUT /api/templates/:id",
    delete: "DELETE /api/templates/:id"
  },
  campaigns: {
    list: "GET /api/campaigns",
    create: "POST /api/campaigns",
    workerTick: "POST /api/campaigns/run"
  },
  inbox: {
    list: "GET /api/inbox",
    send: "POST /api/inbox/send",
    reply: "POST /api/inbox/reply"
  },
  conversations: {
    list: "GET /api/conversations",
    get: "GET /api/conversations/:id"
  },
  activity: {
    list: "GET /api/activity-log"
  },
  settings: {
    get: "GET /api/settings",
    update: "PUT /api/settings"
  },
  compliance: {
    optOut: "POST /api/compliance/opt-out"
  },
  roles: {
    get: "GET /api/roles"
  },
  automation: {
    check: "POST /api/automation/run-followups"
  },
  rateLimits: {
    get: "GET /api/rate-limits"
  },
  webhooks: {
    inbound: "POST /webhooks/:providerKey"
  }
};
