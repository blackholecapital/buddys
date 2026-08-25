export interface DashboardTotals {
  contacts: number;
  templates: number;
  campaigns: number;
  scheduled: number;
  sent: number;
  replies: number;
  optedOut: number;
}

export interface DashboardActivity {
  id: string;
  type: string;
  message: string;
  createdAt: string;
}

export interface DashboardResponse {
  ok: boolean;
  data: {
    totals: DashboardTotals;
    recentActivity: DashboardActivity[];
    campaignStates: unknown[];
  };
}
