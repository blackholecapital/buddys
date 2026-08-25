import { Chip } from "@mui/material";

export default function StatusChip({
  label,
}: {
  label: string;
}) {

  const color =
    label === "online"
      ? "success"
      : label === "warning"
      ? "warning"
      : "error";

  return (
    <Chip
      label={label}
      color={color}
      size="small"
    />
  );
}
