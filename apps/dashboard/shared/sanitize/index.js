function sanitizeString(value, maxLen = 4000) {
  const cleaned = String(value)
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim();
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

function sanitizePayload(input, depth = 0) {
  if (depth > 8) return null;
  if (input === null || input === undefined) return input;
  if (typeof input === "string") return sanitizeString(input);
  if (typeof input === "number" || typeof input === "boolean") return input;
  if (Array.isArray(input)) return input.slice(0, 200).map((v) => sanitizePayload(v, depth + 1));
  if (typeof input === "object") {
    const out = {};
    const keys = Object.keys(input).slice(0, 200);
    for (const key of keys) {
      out[sanitizeString(key, 120)] = sanitizePayload(input[key], depth + 1);
    }
    return out;
  }
  return null;
}

module.exports = { sanitizeString, sanitizePayload };
