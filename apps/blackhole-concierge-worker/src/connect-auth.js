// Verify the exact request bytes before parsing a Connect notification.
export async function verifyConnect(request, raw, env) {
  const configured=env.DOCUSIGN_CONNECT_HMAC_SECRET;
  const secret=String(configured?.get ? await configured.get() : configured || "");
  if(!secret) return false;
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
  for(const [name,value] of request.headers) {
    if(!/^x-docusign-signature-\d+$/i.test(name)) continue;
    try {
      const signature=Uint8Array.from(atob(value),c=>c.charCodeAt(0));
      if(await crypto.subtle.verify("HMAC",key,signature,raw)) return true;
    } catch {}
  }
  return false;
}
