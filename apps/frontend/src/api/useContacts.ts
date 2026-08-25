import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
}

export interface ContactsResponse {
  ok: boolean;
  data: Contact[];
}

export function useContacts() {
  return useQuery<ContactsResponse>({
    queryKey: ["contacts"],
    queryFn: () => api<ContactsResponse>("/contacts"),
  });
}
