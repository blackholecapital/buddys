import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

export interface Campaign {
  id: string;
  name?: string;
  status?: string;
}

export interface CampaignsResponse {
  ok: boolean;
  data: Campaign[];
}

export function useCampaigns() {
  return useQuery<CampaignsResponse>({
    queryKey: ["campaigns"],
    queryFn: () => api<CampaignsResponse>("/campaigns"),
  });
}
