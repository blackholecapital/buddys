// Buddy-owned Access verification. Never trust role/email headers as identity.
const anonymous = () => ({ id:"anonymous", role:"anonymous" });
const encoder = new TextEncoder();
function decode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid encoding");
  return Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/")), c=>c.charCodeAt(0));
}
async function equalSecret(a,b) {
  if (!a || !b) return false;
  const hash = value=>crypto.subtle.digest("SHA-256",encoder.encode(String(value)));
  const [left,right]=await Promise.all([hash(a),hash(b)]);
  const aBytes=new Uint8Array(left),bBytes=new Uint8Array(right);
  let mismatch=0;for(let i=0;i<aBytes.length;i++)mismatch|=aBytes[i]^bBytes[i];
  return mismatch===0;
}
async function identity(headers, env) {
  const token=String(headers["cf-access-jwt-assertion"]||"");
  const issuer=String(env.CF_ACCESS_TEAM_DOMAIN||"").replace(/\/$/,"");
  const audience=String(env.CF_ACCESS_AUD||"");
  if (!token || token.length>16384 || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) || !audience) return anonymous();
  try {
    const parts=token.split('.'); if(parts.length!==3) return anonymous();
    const head=JSON.parse(new TextDecoder().decode(decode(parts[0])));
    const claims=JSON.parse(new TextDecoder().decode(decode(parts[1])));
    const now=Math.floor(Date.now()/1000);
    if(head.alg!=="RS256" || !head.kid || claims.iss!==issuer || ![claims.aud].flat().includes(audience) || !claims.sub || !claims.email || !Number.isFinite(claims.exp) || claims.exp<=now || (claims.nbf!==undefined && (!Number.isFinite(claims.nbf)||claims.nbf>now))) return anonymous();
    const res=await fetch(`${issuer}/cdn-cgi/access/certs`,{signal:AbortSignal.timeout(5000)});
    if(!res.ok) return anonymous();
    const jwk=(await res.json()).keys?.find(k=>k.kid===head.kid && k.kty==="RSA");
    if(!jwk) return anonymous();
    const key=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
    if(!await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,decode(parts[2]),encoder.encode(`${parts[0]}.${parts[1]}`))) return anonymous();
    const roles=JSON.parse(env.OPERATOR_ROLES_JSON||"{}");
    const email=String(claims.email).toLowerCase();
    const role=Object.hasOwn(roles,email)?roles[email]:null;
    if(!["admin","agent","viewer"].includes(role)) return anonymous();
    return {id:claims.sub,email,role};
  } catch { return anonymous(); }
}
module.exports={identity,equalSecret,anonymous};
