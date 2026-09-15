import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const repoRoot = process.cwd();
const db = require(path.join(repoRoot, 'apps/dashboard/backend/layers/core/db.js'));
const memoryStore = require(path.join(repoRoot, 'apps/dashboard/backend/layers/core/memory-store.js'));
const leadHandler = require(path.join(repoRoot, 'apps/dashboard/backend/functions/api/leads/index.js'));
const contactsHandler = require(path.join(repoRoot, 'apps/dashboard/backend/functions/api/contacts/index.js'));

memoryStore.reset();
db.setBackend(memoryStore);

const html = await readFile(path.join(repoRoot, 'apps/frontend/public/buddys/index.html'), 'utf8');
assert.match(html, /<form id="demoForm"[^>]*data-endpoint="\/api\/leads"/s, 'customer form posts to /api/leads');
assert.match(html, /fetch\(form\.dataset\.endpoint/, 'customer form submits through its configured endpoint');

const conciergeRequests = [];
const env = {
  INTERNAL_CALL_SECRET: 'buddy-test-secret',
  CONCIERGE: {
    async fetch(request) {
      conciergeRequests.push({ url: request.url, method: request.method, body: await request.clone().json() });
      return new Response(JSON.stringify({
        ok: true,
        results: { sms: { ok: false }, email: { ok: false } },
        contactFlow: 'test-no-delivery',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  },
};

const submitted = await leadHandler({
  method: 'POST',
  body: {
    first_name: 'Demo',
    last_name: 'Buyer',
    phone: '+15550102020',
    email: 'demo.buyer@example.com',
    product_interest: 'Living Room Furniture',
    lead_source: 'I was searching online',
    preferred_store: 'Florida',
    contact_method: 'Phone',
    contact_time: 'Afternoon',
    comments: 'Looking for a sectional for the living room.',
    consent: true,
    owner: 'Buddy Web Lead',
    company: "Buddy's Home Furnishings",
  },
  params: {},
  env,
});

assert.equal(submitted.ok, true, 'lead submission succeeds');
assert.ok(submitted.contact?.id, 'lead submission returns a contact id');
assert.equal(submitted.contact.stage, 'New Lead', 'new customer enters New Lead stage');
assert.equal(submitted.contact.firstName, 'Demo');
assert.equal(submitted.contact.interest, 'Living Room Furniture');
assert.equal(submitted.contact.location, 'Florida');
assert.equal(submitted.contact.source, 'Buddy web lead');
assert.equal(submitted.leadScore, 100, 'lead score is calculated from the submitted intake');
assert.ok(submitted.customerToken, 'lead receives a customer capability token');
assert.equal(conciergeRequests.length, 1, 'lead is forwarded to Buddy Concierge once');
assert.equal(conciergeRequests[0].body.contactId, submitted.contact.id, 'Concierge receives the same contact id');

const listed = await contactsHandler({ method: 'GET', body: {}, params: {}, env: {} });
assert.equal(listed.ok, true, 'CRM contact read succeeds in the test persistence layer');
const persisted = listed.data.find((row) => row.id === submitted.contact.id);
assert.ok(persisted, 'submitted public lead appears in the CRM contact read model');
assert.equal(persisted.stage, 'New Lead');
assert.equal(persisted.email, 'demo.buyer@example.com');
assert.equal(persisted.phone, '+15550102020');

console.log('PASS: public Buddy lead form -> /api/leads -> persisted CRM contact -> New Lead pipeline');
