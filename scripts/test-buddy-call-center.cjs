// Operator API tests against SQLite using the same SQL interface as D1. No providers called.
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const sql = new DatabaseSync(":memory:");
const db = {
  prepare(query) {
    const stmt = sql.prepare(query);
    return {
      bind(...args) {
        return {
          run: async () => ({
            meta: { changes: Number(stmt.run(...args).changes) },
          }),
          all: async () => ({ results: stmt.all(...args) }),
          first: async () => stmt.get(...args),
        };
      },
      run: async () => ({ meta: { changes: Number(stmt.run().changes) } }),
      all: async () => ({ results: stmt.all() }),
    };
  },
};
let state = {
  contacts: [
    {
      id: "lead-1",
      firstName: "Casey",
      phone: "+15555550100",
      stage: "Docs Sent",
      optedOut: false,
    },
  ],
  activities: [],
  users: [],
};
require("../apps/dashboard/backend/layers/core/db").setBackend({
  readDb: () => state,
  mutate: (fn) => {
    const r = fn(state);
    return r;
  },
});
const handler = require("../apps/dashboard/backend/functions/api/call-center");
const calls = require("../apps/dashboard/backend/functions/api/calls");
const permissions = require("../apps/dashboard/shared/permissions");
const events = require("../apps/dashboard/backend/layers/domain/buddy-events");
const env = { BUDDY_DB: db };
const invoke = (body) =>
  handler({ method: "POST", body, env, user: { id: "operator-1" } });
(async () => {
  await events.ensureTable(db);
  assert.equal((await handler({ method: "GET", env })).ok, true);
  assert.equal((await handler({ method: "GET", env: {} })).ok, false);
  const dueAt = new Date(Date.now() + 3600000).toISOString();
  const create = {
    action: "callback",
    contactId: "lead-1",
    dueAt,
    note: "After work",
    status: "scheduled",
  };
  assert.equal((await invoke({ ...create, dueAt: "invalid" })).ok, false);
  assert.equal(
    (await invoke({ ...create, dueAt: new Date(0).toISOString() })).ok,
    false,
  );
  assert.equal((await invoke({ ...create, contactId: "missing" })).ok, false);
  const first = await invoke(create);
  assert.equal(first.ok, true);
  assert.equal(
    (await invoke(create)).ok,
    false,
    "duplicate create must not overwrite",
  );
  const updates = await Promise.all([
    invoke({ ...create, version: first.data.version, note: "first edit" }),
    invoke({ ...create, version: first.data.version, note: "second edit" }),
  ]);
  assert.equal(
    updates.filter((r) => r.ok).length,
    1,
    "one stale concurrent edit rejected",
  );
  const saved = (await handler({ method: "GET", env })).data[0];
  assert.equal(
    (await invoke({ ...create, version: saved.version, status: "completed" }))
      .ok,
    true,
  );
  assert.equal(
    (await invoke({ action: "intake", firstName: "New", phone: "555" })).ok,
    false,
  );
  assert.equal(
    (
      await invoke({
        action: "intake",
        firstName: "Casey",
        phone: "+15555550100",
      })
    ).ok,
    false,
  );
  const lead = await invoke({
    action: "intake",
    firstName: "New",
    phone: "+15555550102",
    smsConsent: true,
  });
  assert.equal(lead.ok, true);
  assert.equal(
    lead.data.smsConsent,
    false,
    "intake does not invent messaging consent",
  );
  assert.equal(lead.data.stage, "New Lead");
  for (const role of ["viewer", "anonymous"])
    assert.equal(
      (
        await permissions.enforce(
          "POST",
          "/api/call-center",
          { "x-user-role": role },
          { NODE_ENV: "test" },
        )
      ).allowed,
      false,
    );
  assert.equal(
    (
      await permissions.enforce(
        "GET",
        "/api/call-center",
        { "x-user-role": "viewer" },
        { NODE_ENV: "test" },
      )
    ).allowed,
    true,
  );
  assert.equal(
    (
      await permissions.enforce(
        "POST",
        "/api/call-center",
        { "x-user-role": "agent" },
        { NODE_ENV: "test" },
      )
    ).allowed,
    true,
  );
  let requests = 0;
  env.CONCIERGE = {
    fetch: async (req) => {
      requests++;
      const body = await req.json();
      assert.equal(body.contact.stage, "Docs Sent");
      return Response.json({
        ok: true,
        result: { ok: true, callSid: "CA-fixture", status: "queued" },
      });
    },
  };
  const call = (requestId, contactId = "lead-1") =>
    calls({ method: "POST", body: { contactId, requestId }, env });
  const results = await Promise.all([
    call("request-0000000001"),
    call("request-0000000001"),
  ]);
  assert.equal(requests, 1, "concurrent repeated request dials once");
  assert.ok(results.some((r) => r.ok));
  assert.equal((await call("request-0000000001")).ok, true);
  assert.equal(requests, 1);
  assert.equal(
    state.contacts.find((c) => c.id === "lead-1").stage,
    "Docs Sent",
    "call acceptance preserves sales stage",
  );
  state.contacts.find((c) => c.id === "lead-1").optedOut = true;
  await db.prepare('INSERT OR REPLACE INTO buddy_contacts (contact_id,phone,contact_json,updated_at) VALUES (?,?,?,?)').bind('lead-1','+15555550100',JSON.stringify({id:'lead-1',phone:'+15555550100',optedOut:false}),Date.now()).run();
  assert.equal((await call("request-0000000002")).ok, false);
  assert.equal(requests, 1);
  state.contacts.find((c) => c.id === "lead-1").optedOut = false;
  env.CONCIERGE = {
    fetch: async () => {
      requests++;
      throw new Error("network failure");
    },
  };
  assert.equal((await call("request-0000000003")).ok, false);
  assert.equal((await call("request-0000000003")).ok, false);
  assert.equal(requests, 2, "uncertain retry never redials");
  assert.equal(
    (await call("request-0000000001", lead.data.id)).ok,
    false,
    "request cannot be reused across contacts",
  );
  console.log(
    "Call Center API: callback persistence/concurrency, intake validation, permissions, opt-out, stage preservation, and call idempotency passed.",
  );
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => sql.close());
