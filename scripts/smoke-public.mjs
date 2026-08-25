const checks = [
  {
    name:"Buddy customer page",
    url:"https://buddys-4nm.pages.dev/buddys/",
    status:200,
    body:/Start Live Video Chat/,
  },
  {
    name:"Buddy avatar asset",
    url:"https://buddys-4nm.pages.dev/buddys/images/buddy-avatar.jpg",
    status:200,
    contentType:/^image\//,
  },
  {
    name:"Buddy concierge Worker",
    url:"https://buddys-concierge-worker.cryptocapitalgroupfl.workers.dev/api/health",
    status:200,
    jsonOk:true,
  },
  {
    name:"Buddy dashboard Worker",
    url:"https://buddys-dashboard-worker.cryptocapitalgroupfl.workers.dev/api/health",
    status:200,
    jsonOk:true,
  },
  {
    name:"Buddy voice Worker",
    url:"https://buddys-voice-worker.cryptocapitalgroupfl.workers.dev/health",
    status:200,
    jsonOk:true,
  },
  {
    name:"RX 6800 EILA runtime",
    url:"https://alley-voice.xyz-labs.xyz/health",
    status:200,
    jsonOk:true,
  },
  {
    name:"Buddy LemonSlice relay route",
    url:"https://alley-ai.cryptocapitalgroupfl.workers.dev/internal/lemonslice/buddys/sessions",
    status:401,
    body:/unauthorized/i,
    init:{
      method:"POST",
      headers:{ "content-type":"application/json" },
      body:"{}",
    },
  },
];

let failures = 0;

for (const check of checks) {
  try {
    const response = await fetch(check.url, {
      ...check.init,
      signal:AbortSignal.timeout(15_000),
    });
    const contentType = response.headers.get("content-type") || "";
    const body = await response.text();
    const statusMatches = response.status === check.status;
    const typeMatches = !check.contentType || check.contentType.test(contentType);
    const bodyMatches = !check.body || check.body.test(body);
    let jsonMatches = true;
    if (check.jsonOk) {
      try { jsonMatches = JSON.parse(body)?.ok === true; }
      catch { jsonMatches = false; }
    }

    const ok = statusMatches && typeMatches && bodyMatches && jsonMatches;
    if (!ok) failures += 1;
    console.log(`${ok ? "PASS" : "FAIL"} ${check.name} (${response.status})`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${check.name} (${error instanceof Error ? error.message : String(error)})`);
  }
}

if (failures) {
  console.error(`\nBuddy public readiness: ${failures} check${failures === 1 ? "" : "s"} failed.`);
  process.exitCode = 1;
} else {
  console.log("\nBuddy public readiness: GREEN. Open https://buddys-4nm.pages.dev/buddys/ and test both video entry paths.");
}
