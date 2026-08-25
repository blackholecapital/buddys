import {
  Paper,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
} from "@mui/material";

import { useContacts } from "../../api/useContacts";

export default function ContactsGrid() {
  const { data } = useContacts();

  const rows = data?.data ?? [];

  return (
    <Paper>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Phone</TableCell>
            <TableCell>Email</TableCell>
          </TableRow>
        </TableHead>

        <TableBody>
          {rows.map((c) => (
            <TableRow key={c.id}>
              <TableCell>
                {c.firstName} {c.lastName}
              </TableCell>
              <TableCell>{c.phone}</TableCell>
              <TableCell>{c.email}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
}
