// Resolve only declared secret names; never mutate Cloudflare's shared env object.
// Values stay request-scoped. Plain Worker secrets and local fixtures remain supported.
export async function resolveSecrets(env, names) {
  const scoped = { ...env };
  await Promise.all(names.map(async name => {
    const binding = env[name];
    if (binding == null || typeof binding === "string") return;
    if (typeof binding.get !== "function") throw new Error("Secret binding unavailable");
    let value;
    try { value = await binding.get(); } catch { throw new Error("Secret binding unavailable"); }
    if (typeof value !== "string" || !value.trim()) throw new Error("Secret binding unavailable");
    scoped[name] = value;
  }));
  return scoped;
}

export function withSecrets(handler, names) {
  return async function(request, env, ctx) {
    let scoped;
    try { scoped = await resolveSecrets(env, names); }
    catch {
      return Response.json({ok:false, error:"secret_binding_unavailable"}, {
        status:503, headers:{"Cache-Control":"no-store", "Retry-After":"5"},
      });
    }
    return handler.call(this, request, scoped, ctx);
  };
}
