import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

export function useInbox() {
  return useQuery({
    queryKey: ["inbox"],
    queryFn: () => api("/inbox"),
  });
}
