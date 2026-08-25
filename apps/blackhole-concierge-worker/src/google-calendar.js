const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

function pick(env, ...names) {
  for (const name of names) {
    const value = env?.[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

export function googleCalendarConfigured(env) {
  const direct = pick(env, "GOOGLE_ACCESS_TOKEN");
  const clientId = pick(env, "GOOGLE_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = pick(env, "GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET");
  const refreshToken = pick(env, "GOOGLE_REFRESH_TOKEN", "GOOGLE_OAUTH_REFRESH_TOKEN");
  return Boolean(direct || (clientId && clientSecret && refreshToken));
}

export function googleCalendarId(env) {
  return pick(env, "GOOGLE_CALENDAR_ID", "BUDDY_GOOGLE_CALENDAR_ID") || "primary";
}

export function googleCalendarTimeZone(env) {
  return pick(env, "GOOGLE_CALENDAR_TIMEZONE", "BUDDY_TIMEZONE") || "America/New_York";
}

async function googleAccessToken(env) {
  const direct = pick(env, "GOOGLE_ACCESS_TOKEN");
  if (direct) return direct;

  const clientId = pick(env, "GOOGLE_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = pick(env, "GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET");
  const refreshToken = pick(env, "GOOGLE_REFRESH_TOKEN", "GOOGLE_OAUTH_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Google Calendar OAuth is not configured");
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data?.error_description || data?.error || `Google OAuth token refresh failed (${response.status})`);
  }
  return data.access_token;
}

async function googleJson(env, url, options = {}) {
  const token = await googleAccessToken(env);
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const detail = data?.error?.message || data?.error_description || data?.error || `Google Calendar request failed (${response.status})`;
    throw new Error(detail);
  }
  return data;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

export async function freeBusy(env, timeMin, timeMax) {
  const calendarId = googleCalendarId(env);
  const data = await googleJson(env, `${GOOGLE_CALENDAR_BASE}/freeBusy`, {
    method: "POST",
    body: JSON.stringify({
      timeMin,
      timeMax,
      timeZone: googleCalendarTimeZone(env),
      items: [{ id: calendarId }],
    }),
  });
  return data?.calendars?.[calendarId]?.busy || [];
}

export async function isSlotAvailable(env, startIso, endIso) {
  const busy = await freeBusy(env, startIso, endIso);
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  return !busy.some((item) => overlaps(start, end, new Date(item.start).getTime(), new Date(item.end).getTime()));
}

export async function createDeliveryEvent(env, { contact = {}, product = {}, startIso, endIso, timeZone, contactId = "" } = {}) {
  if (!startIso || !endIso) throw new Error("Delivery event requires startIso and endIso");
  const calendarId = googleCalendarId(env);
  const tz = timeZone || googleCalendarTimeZone(env);
  const fullName = `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || "Customer";
  const summary = `Buddy Delivery - ${fullName}`;
  const description = [
    `Customer: ${fullName}`,
    `Product: ${product.name || contact.selectedProduct || contact.interest || ""}`,
    `Phone: ${contact.phone || ""}`,
    `Email: ${contact.email || ""}`,
    `Location: ${contact.location || ""}`,
    `Contact ID: ${contactId || contact.id || ""}`,
    `Agreement ID: ${contact.agreementId || ""}`,
    `DocuSign Envelope ID: ${contact.docusignEnvelopeId || ""}`,
  ].join("\n");

  const event = await googleJson(
    env,
    `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`,
    {
      method: "POST",
      body: JSON.stringify({
        summary,
        description,
        location: contact.location || undefined,
        start: { dateTime: startIso, timeZone: tz },
        end: { dateTime: endIso, timeZone: tz },
        extendedProperties: {
          private: {
            buddyContactId: String(contactId || contact.id || ""),
            buddyProduct: String(product.name || contact.selectedProduct || ""),
          },
        },
      }),
    },
  );

  return {
    id: event.id || "",
    htmlLink: event.htmlLink || "",
    status: event.status || "confirmed",
    summary: event.summary || summary,
    start: event.start?.dateTime || startIso,
    end: event.end?.dateTime || endIso,
    timeZone: event.start?.timeZone || tz,
  };
}
