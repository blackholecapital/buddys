import worker from "../worker-entry.mjs";

const req = new Request(
  "https://example.com/api/orchestrator",
  { method: "GET" }
);

const env = {
  CONCIERGE: {
    fetch: async () =>
      new Response(
        JSON.stringify({
          ok: true,
          worker: "concierge",
          health: "online",
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      ),
  },

  ASSETS: {
    fetch: () => new Response("asset"),
  },
};

const ctx = {
  waitUntil() {},
};

const res = await worker.fetch(req, env, ctx);

console.log(await res.text());
