import { api } from "./client";
import type { DashboardResponse } from "./types";

export const dashboardApi = {
  summary() {
    return api<DashboardResponse>("/dashboard");
  },
};
