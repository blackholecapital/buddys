import { Stack, Typography } from "@mui/material";
import OperatorCard from "./OperatorCard";

export default function MetricCard({
  title,
  value,
}: {
  title: string;
  value: string | number;
}) {
  return (
    <OperatorCard>
      <Stack spacing={1}>
        <Typography
          variant="body2"
          color="text.secondary"
        >
          {title}
        </Typography>

        <Typography
          variant="h4"
          sx={{ fontWeight: 700 }}
        >
          {value}
        </Typography>
      </Stack>
    </OperatorCard>
  );
}
