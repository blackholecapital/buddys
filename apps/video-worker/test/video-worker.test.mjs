import assert from "node:assert/strict";
import test from "node:test";

import worker, { apiHeaderValue, normalizeSession } from "../src/index.js";

test("registers the dedicated Buddy tenant contract", () => {
  const input = normalizeSession({
    tenantId:"buddys",
    creatorId:"buddy",
    avatarProvider:"lemonslice",
    avatarSource:"image-url",
    avatarImageUrl:"https://example.com/buddy.jpg",
    voiceProvider:"eila-runtime",
    voiceId:"buddy",
    instructions:"Be Buddy.",
  });
  assert.equal(input.tenantId, "buddys");
  assert.equal(input.voiceId, "buddy");
});

test("rejects other tenants", () => {
  assert.throws(() => normalizeSession({ tenantId:"ai-fans" }), /tenantId must be buddys/);
});

test("normalizes pasted provider keys", () => {
  assert.equal(apiHeaderValue("  sk-test\n"), "sk-test");
});

test("health exposes the exact registered agent name", async () => {
  const response = await worker.fetch(new Request("https://video.test/health"), {
    LIVEKIT_URL:"wss://example.livekit.cloud",
    LIVEKIT_API_KEY:"key",
    LIVEKIT_API_SECRET:"secret",
    LEMONSLICE_BUDDYS_API_KEY:"sk-test",
    VIDEO_AGENT_NAME:"buddys-avatar",
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.agentName, "buddys-avatar");
  assert.equal(body.lemonsliceConfigured, true);
});
