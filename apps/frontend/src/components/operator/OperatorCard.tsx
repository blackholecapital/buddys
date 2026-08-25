import { Paper } from "@mui/material";
import type { ReactNode } from "react";

export default function OperatorCard({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 3,
        borderRadius: 4,
        border: "1px solid #dce6ff",
        background: "#fff",
      }}
    >
      {children}
    </Paper>
  );
}
