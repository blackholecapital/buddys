function localParts(iso, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23",
  }).formatToParts(new Date(iso));
  const out = {};
  for (const p of parts) if (p.type !== "literal") out[p.type] = p.value;
  return { year:Number(out.year), month:Number(out.month), day:Number(out.day), hour:Number(out.hour), minute:Number(out.minute) };
}

function dayKey(parts) {
  return `${parts.year}-${String(parts.month).padStart(2,"0")}-${String(parts.day).padStart(2,"0")}`;
}

function tomorrowKey(timeZone) {
  const now = new Date();
  const today = localParts(now.toISOString(), timeZone);
  const d = new Date(Date.UTC(today.year, today.month - 1, today.day + 1, 12, 0, 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}

function todayKey(timeZone) {
  return dayKey(localParts(new Date().toISOString(), timeZone));
}

function spokenTime(iso, timeZone) {
  const p = localParts(iso, timeZone);
  const hour12 = p.hour % 12 || 12;
  const suffix = p.hour >= 12 ? "p.m." : "a.m.";
  return p.minute ? `${hour12}:${String(p.minute).padStart(2,"0")} ${suffix}` : `${hour12} ${suffix}`;
}

function spokenDate(iso, timeZone) {
  const key = dayKey(localParts(iso, timeZone));
  if (key === todayKey(timeZone)) return "today";
  if (key === tomorrowKey(timeZone)) return "tomorrow";
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday:"long", month:"short", day:"numeric" }).format(new Date(iso));
}

function spokenLabel(option = {}) {
  const timeZone = option.timeZone || "America/New_York";
  if (!option.startIso) return String(option.label || "").replace(/:00\s*([AP]M)/gi, " $1");
  return `${spokenDate(option.startIso, timeZone)} at ${spokenTime(option.startIso, timeZone)}`;
}

function spokenHour(text) {
  const lower = String(text || "").toLowerCase();
  const wordMap = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12 };
  for (const [word, hour] of Object.entries(wordMap)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) return hour;
  }
  const match = lower.match(/\b(1[0-2]|[1-9])(?::([0-5]\d))?\s*(?:a\.?m\.?|p\.?m\.?)?/i);
  return match ? Number(match[1]) : null;
}

export function chooseDeliveryOption(text, options = []) {
  if (!Array.isArray(options) || !options.length) return null;
  const lower = String(text || "").toLowerCase();
  if (/\b(option\s*)?(one|1|first)\b/.test(lower)) return options[0] || null;
  if (/\b(option\s*)?(two|2|second)\b/.test(lower)) return options[1] || null;
  if (/\b(option\s*)?(three|3|third)\b/.test(lower)) return options[2] || null;

  let candidates = [...options];
  const tz = options[0]?.timeZone || "America/New_York";

  if (/\btomorrow\b/.test(lower)) {
    const key = tomorrowKey(tz);
    const filtered = candidates.filter(o => dayKey(localParts(o.startIso, o.timeZone || tz)) === key);
    if (filtered.length) candidates = filtered;
  }
  if (/\b(today|tonight|this evening)\b/.test(lower)) {
    const nowKey = dayKey(localParts(new Date().toISOString(), tz));
    const filtered = candidates.filter(o => dayKey(localParts(o.startIso, o.timeZone || tz)) === nowKey);
    if (filtered.length) candidates = filtered;
  }
  if (/\b(evening|tonight)\b/.test(lower)) {
    const filtered = candidates.filter(o => localParts(o.startIso, o.timeZone || tz).hour >= 17);
    if (filtered.length) candidates = filtered;
  }

  const hour = spokenHour(lower);
  if (hour !== null) {
    const pmHint = /\b(pm|p\.m\.|afternoon|evening|tonight)\b/.test(lower);
    const amHint = /\b(am|a\.m\.|morning)\b/.test(lower);
    const filtered = candidates.filter(o => {
      const h = localParts(o.startIso, o.timeZone || tz).hour;
      if (pmHint) return h === (hour === 12 ? 12 : hour + 12);
      if (amHint) return h === (hour === 12 ? 0 : hour);
      return (h % 12 || 12) === hour;
    });
    if (filtered.length) candidates = filtered;
  }

  return candidates.length === 1 ? candidates[0] : null;
}

export function describeDeliveryOptions(options = []) {
  if (!options.length) return "I don't have an open delivery slot showing right now.";
  const labels = options.slice(0, 3).map((o, i) => `option ${i + 1}, ${spokenLabel(o)}`);
  if (labels.length === 1) return `I have ${labels[0]}. Does that work for you?`;
  if (labels.length === 2) return `I have ${labels[0]}, or ${labels[1]}. Which works better for you?`;
  return `I have ${labels[0]}, ${labels[1]}, or ${labels[2]}. Which works best for you?`;
}

export function naturalDeliveryLabel(option = {}) {
  return spokenLabel(option);
}
