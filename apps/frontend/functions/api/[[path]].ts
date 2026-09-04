export const onRequest: PagesFunction<{
  DASHBOARD: Fetcher;
  ASSISTANT: Fetcher;
}> = async (context) => {
  const url = new URL(context.request.url);

  // Buddy's talking-head path now goes through the sealed tenant adapter.
  // All other Buddy product APIs remain on the existing dashboard Worker.
  if (
    context.request.method === "POST" &&
    url.pathname === "/api/video/session"
  ) {
    const input = await context.request.json().catch(() => ({}));

    const userName = [
      String(input?.firstName || "").trim(),
      String(input?.lastName || "").trim(),
    ].filter(Boolean).join(" ") || "Buddy customer";

    const userId =
      String(input?.contactId || input?.userId || "").trim() ||
      crypto.randomUUID();

    return context.env.ASSISTANT.fetch(
      new Request("https://buddys-assistant.internal/api/video/session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json",
        },
        body: JSON.stringify({
          tenantId: "buddys",
          assistantId: "buddy",
          metadata: {
            userId,
            userName,
          },
        }),
      })
    );
  }

  const upstream = new URL(url.pathname + url.search, "https://placeholder");
  upstream.protocol = "https:";
  upstream.host = "buddys-dashboard-worker.cryptocapitalgroupfl.workers.dev";

  return context.env.DASHBOARD.fetch(
    new Request(upstream.toString(), context.request)
  );
};
