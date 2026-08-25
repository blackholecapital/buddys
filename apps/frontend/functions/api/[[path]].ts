export const onRequest: PagesFunction<{
  DASHBOARD: Fetcher;
}> = async (context) => {
  const url = new URL(context.request.url);

  const upstream = new URL(url.pathname + url.search, "https://placeholder");
  upstream.protocol = "https:";
  upstream.host = "buddys-dashboard-worker.cryptocapitalgroupfl.workers.dev";

  return context.env.DASHBOARD.fetch(
    new Request(upstream.toString(), context.request)
  );
};
