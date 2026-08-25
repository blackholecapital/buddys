async function request(env, path, method = "GET", body) {
  if (!env.CONCIERGE) {
    throw new Error("CONCIERGE binding not configured");
  }

  const headers = {
    "Content-Type": "application/json",
  };

  if (env.INTERNAL_CALL_SECRET) {
    headers["x-internal-call-secret"] = env.INTERNAL_CALL_SECRET;
  }

  const res = await env.CONCIERGE.fetch(
    new Request("https://concierge.internal" + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );

  const text = await res.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      "Concierge returned non-JSON: " +
      text.substring(0, 120)
    );
  }
}

exports.conciergeGet = (env, path) =>
  request(env, path);

exports.conciergePost = (env, path, body) =>
  request(env, path, "POST", body);
