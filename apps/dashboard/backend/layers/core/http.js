const { sanitizePayload } = require("../../../shared/sanitize");

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(payload, null, 2));
}

async function readJson(req) {
  return await new Promise((resolve) => {
    let raw = "";
    let tooLarge = false;
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (raw.length > 1024 * 1024) tooLarge = true;
      if (tooLarge) return resolve({ __invalid: "Payload too large" });
      if (!raw) return resolve({});
      try {
        resolve(sanitizePayload(JSON.parse(raw)));
      } catch {
        resolve({ __invalid: "Malformed JSON payload" });
      }
    });
  });
}

module.exports = { json, readJson };
