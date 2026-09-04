function allowedOrigin(origin, requestUrl, config = {}) {
  if (!origin) return true;
  const allowed = String(config.ALLOWED_ORIGINS || "").split(',').map(v=>v.trim()).filter(Boolean);
  return origin === new URL(requestUrl).origin || allowed.includes(origin);
}
function headers(origin) {
  return origin ? {"Access-Control-Allow-Origin":origin,"Vary":"Origin","Access-Control-Allow-Methods":"GET,POST,PUT,DELETE,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Authorization,X-Correlation-Id"} : {};
}
module.exports={allowedOrigin,headers};
