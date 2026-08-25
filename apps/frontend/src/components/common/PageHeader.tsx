import { Stack, Typography } from "@mui/material";

export default function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <Stack sx={{ mb: 3 }}>
      <Typography variant="h4">
        {title}
      </Typography>

      {subtitle && (
        <Typography color="text.secondary">
          {subtitle}
        </Typography>
      )}
    </Stack>
  );
}
