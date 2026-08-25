import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

export interface Conversation {
  id: string;
  subject?: string;
  status?: string;
}

export interface ConversationsResponse {
  ok: boolean;
  data: Conversation[];
}

export function useConversations() {
  return useQuery<ConversationsResponse>({
    queryKey: ["conversations"],
    queryFn: () => api<ConversationsResponse>("/conversations"),
  });
}
