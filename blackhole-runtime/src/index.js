import { createTenantAdapter } from "./tenant-adapter.js";
import manifest from "./tenant.manifest.json" with { type: "json" };

const ASSISTANT_INSTRUCTIONS = Object.freeze({
  "buddy": "You are Buddy, the Buddy's AI assistant. Be concise, capable, conversational, and stay within the product's supplied facts."
});

export default createTenantAdapter({
  manifest,
  instructionsFor: (assistant) => ASSISTANT_INSTRUCTIONS[assistant.assistant_id],
});
