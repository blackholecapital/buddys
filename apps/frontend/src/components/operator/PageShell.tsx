import { Box } from "@mui/material";
import type { ReactNode } from "react";

export default function PageShell({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <Box
      sx={{
        background: "#eef4ff",
        borderRadius: 4,
        p: 3,
        minHeight: "calc(100vh - 140px)",
      }}
    >
      {children}
    </Box>
  );
}
