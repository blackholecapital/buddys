import { Stack, Button, TextField } from "@mui/material";

export default function ContactsToolbar() {
  return (
    <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
      <TextField fullWidth size="small" placeholder="Search contacts..." />
      <Button variant="contained">New Contact</Button>
    </Stack>
  );
}
