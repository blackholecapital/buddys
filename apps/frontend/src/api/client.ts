const API_BASE =
  import.meta.env.VITE_API_BASE ??
  "https://blackhole-dashboard-worker.cryptocapitalgroupfl.workers.dev/api";

export async function api<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);

  if (!response.ok) {
    throw new Error(
      `API ${response.status}: ${response.statusText}`
    );
  }

  return response.json();
}
