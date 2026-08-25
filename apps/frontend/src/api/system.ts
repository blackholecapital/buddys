import { api } from "./client";

export interface SystemStatus {
  ok: boolean;
  data: {
    dashboard: string;
    runtime: string;
    version: string;
    concierge: {
      ok: boolean;
      service: string;
      health: string;
    };
  };
}

export function getSystemStatus() {
  return api<SystemStatus>("/system-status");
}
