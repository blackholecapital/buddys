import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "./dashboard";

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: dashboardApi.summary,
  });
}
