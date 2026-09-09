// Run after the frontend build. Browser uses API fixtures; no customer calls are placed.
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { readFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("./browser/node_modules/playwright");
} catch {
  playwright = require("playwright");
}
const root = path.resolve("apps/frontend/dist");
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const file = path.resolve(
      root,
      "." +
        (url.pathname === "/buddy-dashboard" ? "/index.html" : url.pathname),
    );
    if (!file.startsWith(root + path.sep)) throw Error();
    const data = await readFile(file);
    res.setHeader(
      "Content-Type",
      { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[
        path.extname(file)
      ] || "application/octet-stream",
    );
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  headless: true,
  ...(process.env.BUDDY_CHROMIUM_PATH
    ? {
        executablePath: process.env.BUDDY_CHROMIUM_PATH,
        args: [
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--use-gl=angle",
          "--use-angle=swiftshader",
        ],
      }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let unavailable = false,
  empty = false,
  callbacks = [],
  calls = 0,
  version = 0;
const leads = [
  {
    id: "lead-1",
    firstName: "Casey",
    lastName: "Morgan",
    phone: "+15555550100",
    email: "casey@example.test",
    interest: "Living room furniture",
    stage: "Contacted",
    leadScore: 92,
    source: "Website inquiry",
  },
  {
    id: "lead-2",
    firstName: "Jamie",
    lastName: "Reed",
    phone: "+15555550101",
    interest: "Bedroom set",
    stage: "New Lead",
    leadScore: 83,
    source: "Store referral",
  },
  {
    id: "lead-3",
    firstName: "Alex",
    lastName: "Rivera",
    phone: "+15555550102",
    interest: "Dining room",
    stage: "New Lead",
    optedOut: true,
  },
];
const conversation = {
  callSid: "CA-fixture",
  contactId: "lead-1",
  startedAt: Date.now() - 100000,
  endedAt: Date.now(),
  events: [{ id: 1, type: "call.completed", createdAt: Date.now() }],
  transcript: [
    {
      role: "buddy",
      text: "What would you like to look at for your living room?",
      at: Date.now() - 90000,
    },
    {
      role: "customer",
      text: "A sectional. Could you call me after work?",
      at: Date.now() - 80000,
    },
  ],
};
await page.route("**/api/**", async (route) => {
  const req = route.request(),
    url = new URL(req.url());
  let data;
  if (unavailable) {
    await route.fulfill({
      status: 403,
      json: { ok: false, error: "Forbidden" },
    });
    return;
  }
  if (url.pathname === "/api/contacts") data = empty ? [] : leads;
  else if (url.pathname === "/api/buddy-events")
    data = { conversations: empty ? [] : [conversation], events: [] };
  else if (url.pathname === "/api/calls") {
    calls++;
    await new Promise((r) => setTimeout(r, 100));
    data = { callSid: "CA-new", status: "queued" };
  } else if (url.pathname === "/api/call-center") {
    if (req.method() === "GET") data = callbacks;
    else {
      const body = req.postDataJSON();
      if (body.action === "intake") {
        data = { ...body, id: "lead-new", stage: "New Lead" };
        leads.push(data);
      } else {
        data = {
          contact_id: body.contactId,
          due_at: body.dueAt,
          note: body.note,
          status: body.status,
          version: String(++version),
        };
        callbacks = callbacks
          .filter((c) => c.contact_id !== body.contactId)
          .concat(data);
      }
    }
  } else throw Error("Unexpected endpoint " + url.pathname);
  await route.fulfill({ json: { ok: true, data } });
});
try {
  await page.goto(origin + "/buddy-dashboard");
  await page.getByRole("button", { name: "Call Center", exact: true }).click();
  await page.getByRole("button", { name: "Add lead", exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Call customer", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start call", exact: true })
    .dblclick();
  await page
    .getByRole("status")
    .filter({ hasText: "Call request accepted" })
    .waitFor();
  assert.equal(calls, 1, "double click makes one request");
  await page
    .getByRole("button", { name: "Schedule callback", exact: true })
    .click();
  await page.locator("input[name=dueAt]").fill("2030-10-09T17:00");
  await page
    .locator("textarea[name=note]")
    .fill("Call after work; compare sectional options.");
  await page
    .getByRole("button", { name: "Save callback", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Callback reminder saved" })
    .waitFor();
  await page.getByRole("button", { name: "Callbacks", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator("textarea[name=note]").fill("Updated request");
  await page
    .getByRole("button", { name: "Save callback", exact: true })
    .click();
  await page.getByText("Updated request", { exact: true }).first().waitFor();
  assert.equal(callbacks[0].note, "Updated request");
  await page.getByRole("button", { name: "Handled", exact: true }).click();
  await page.getByRole("heading", { name: "No callbacks waiting" }).waitFor();
  await page.getByRole("button", { name: "Calls", exact: true }).click();
  await page
    .getByText("A sectional. Could you call me after work?", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Add lead", exact: true }).click();
  await page.getByLabel("First name", { exact: true }).fill("Taylor");
  await page.getByLabel("Phone with country code").fill("+15555550103");
  await page.getByRole("button", { name: "Save lead", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Lead saved" }).waitFor();
  assert.equal(calls, 1, "saving lead or callback must not dial");
  await page.getByRole("button", { name: "Lead queue", exact: true }).click();
  await page.getByRole("button").filter({ hasText: "Alex Rivera" }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Call customer", exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByRole("button")
    .filter({ hasText: "Casey Morgan" })
    .first()
    .click();
  const shots = process.env.BUDDY_SCREENSHOT_DIR;
  if (shots) {
    await mkdir(shots, { recursive: true });
    await page.screenshot({
      path: path.join(shots, "call-center-desktop.png"),
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: /24-hour support/ }).click();
  await page
    .getByRole("textbox", { name: "Search operating guide" })
    .fill("callback");
  await page
    .getByText("How do callback reminders work?", { exact: true })
    .click();
  await page
    .getByText(/Callbacks are reminders, not an automatic dialer/)
    .waitFor();
  if (shots)
    await page.screenshot({
      path: path.join(shots, "support-desktop.png"),
      fullPage: true,
    });
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /24-hour support/ }).click();
  await page.getByRole("dialog").waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
    "no mobile page overflow",
  );
  if (shots)
    await page.screenshot({
      path: path.join(shots, "support-mobile.png"),
      fullPage: true,
    });
  await page.getByRole("button", { name: "Close support guide" }).click();
  empty = true;
  await page.reload();
  await page.getByRole("button", { name: "Call Center", exact: true }).click();
  await page
    .getByRole("heading", { name: "Your call queue starts here" })
    .waitFor();
  assert.equal(
    await page.getByText("Demo Customer", { exact: true }).count(),
    0,
  );
  unavailable = true;
  await page.reload();
  await page.getByRole("button", { name: "Call Center", exact: true }).click();
  await page.getByText(/Live lead or callback data is unavailable/).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Add lead", exact: true })
      .isDisabled(),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Call Center browser: call confirmation/double-click, intake, callback edit/handled, transcript, opt-out, support search/keyboard/mobile, empty and unavailable states passed.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
