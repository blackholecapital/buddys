import worker from "../worker-entry.mjs";

const req =
  new Request(
    "https://example.com/api/system-status"
  );

const env = {

  CONCIERGE: {
    fetch: async () =>
      new Response(
        JSON.stringify({
          ok: true,
          service: "concierge",
          health: "online"
        }),
        {
          headers: {
            "Content-Type":
              "application/json"
          }
        }
      )
  },

  ASSETS: {
    fetch() {
      return new Response("asset");
    }
  }

};

const ctx = {
  waitUntil() {}
};

const res =
  await worker.fetch(req, env, ctx);

console.log(await res.text());
