import worker from "../worker-entry.mjs";

const req = new Request(
  "https://example.com/api/dashboard",
  {
    method: "GET",
  }
);

const env = {
  ASSETS: {
    fetch: () =>
      new Response("asset"),
  },
};

const ctx = {
  waitUntil() {},
};

const res = await worker.fetch(req, env, ctx);

console.log("STATUS", res.status);

console.log(await res.text());
