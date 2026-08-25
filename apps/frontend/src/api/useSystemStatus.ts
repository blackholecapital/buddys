import { useQuery } from "@tanstack/react-query";
import { getSystemStatus } from "./system";

export function useSystemStatus() {
  return useQuery({
    queryKey: ["system-status"],
    queryFn: getSystemStatus,
    refetchInterval: 10000,
  });
}
