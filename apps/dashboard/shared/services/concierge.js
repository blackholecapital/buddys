const contacts = require("../../backend/layers/domain/contacts");
async function request(env, path, method = "GET", body) {
  if (!env.CONCIERGE) {
    throw new Error("CONCIERGE binding not configured");
  }

  const headers = {
    "Content-Type": "application/json",
    "x-buddy-dashboard-managed":"1",
  };

  if (env.INTERNAL_CALL_SECRET) {
    headers["x-internal-call-secret"] = env.INTERNAL_CALL_SECRET;
  }

  if(body?.contactId) body={...body,contact:contacts.list().find(c=>c.id===body.contactId)||body.contact};
  const res = await env.CONCIERGE.fetch(
    new Request("https://concierge.internal" + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );

  const text = await res.text();

  try {
    const data=JSON.parse(text);
    if(data.contactPatch && body?.contactId) contacts.update(body.contactId,data.contactPatch);
    delete data.contactPatch;
    return res.ok?data:{...data,ok:false,error:data.error||`Concierge failed (${res.status})`};
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
