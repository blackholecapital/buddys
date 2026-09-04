const DEFAULT_TIMEOUT_MS = 15_000;

export class TenantRuntimeError extends Error {
  constructor(message, { status = null, code = "runtime_request_failed", details = null } = {}) {
    super(message);
    this.name = "TenantRuntimeError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class TenantRuntimeClient {
  constructor({ tenantId, baseUrl = "", timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}) {
    if (!tenantId) throw new TypeError("tenantId is required");
    if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");
    this.tenantId = tenantId;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  health() {
    return this.#request("/health", { method: "GET" });
  }

  chat({ assistantId, messages, signal } = {}) {
    if (!assistantId) throw new TypeError("assistantId is required");
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new TypeError("messages must be a non-empty array");
    }
    return this.#request("/api/chat", {
      method: "POST",
      signal,
      json: { tenantId: this.tenantId, assistantId, messages },
    });
  }

  createVideoSession({ assistantId, metadata = {}, signal } = {}) {
    if (!assistantId) throw new TypeError("assistantId is required");
    return this.#request("/api/video/session", {
      method: "POST",
      signal,
      json: { tenantId: this.tenantId, assistantId, metadata },
    });
  }

  updateAssistantSettings({ assistantId, displayName, avatar, voiceReference, signal } = {}) {
    if (!assistantId) throw new TypeError("assistantId is required");
    if (!displayName) throw new TypeError("displayName is required");
    if (!avatar && !voiceReference) throw new TypeError("avatar or voiceReference is required");

    const form = new FormData();
    form.set("tenantId", this.tenantId);
    form.set("assistantId", assistantId);
    form.set("displayName", displayName);
    if (avatar) form.set("avatar", avatar);
    if (voiceReference) form.set("voiceReference", voiceReference);
    return this.#request("/settings/api/assistant-settings", { method: "POST", signal, body: form });
  }

  async #request(pathname, { method, json, body, signal } = {}) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new Error("request timed out")), this.timeoutMs);
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeout.signal])
      : timeout.signal;
    const headers = { accept: "application/json" };
    let requestBody = body;
    if (json !== undefined) {
      headers["content-type"] = "application/json";
      requestBody = JSON.stringify(json);
    }

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
        method,
        headers,
        body: requestBody,
        signal: combinedSignal,
        credentials: "same-origin",
      });
      const contentType = response.headers.get("content-type") ?? "";
      const payload = contentType.includes("application/json")
        ? await response.json()
        : { message: await response.text() };
      if (!response.ok) {
        throw new TenantRuntimeError(payload.message ?? `request failed with ${response.status}`, {
          status: response.status,
          code: payload.code,
          details: payload,
        });
      }
      return payload;
    } catch (error) {
      if (error instanceof TenantRuntimeError) throw error;
      if (timeout.signal.aborted) {
        throw new TenantRuntimeError("runtime request timed out", { code: "runtime_timeout" });
      }
      throw new TenantRuntimeError(error.message, { code: "runtime_network_error" });
    } finally {
      clearTimeout(timer);
    }
  }
}

export const createTenantRuntimeClient = (options) => new TenantRuntimeClient(options);
